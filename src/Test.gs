/**
 * テスト用の関数
 *
 * ※テスト用のプロジェクト専用。本番プロジェクトには入れないこと（clasp でも送らない設定にしてある）。
 * ※LINE_MODE=test のときだけ実行できる。テストモードでは、ファイル名が【TEST】で始まるスプレッドシートしか開けない。
 *
 * 使い方：testSettings_() の値を書き換えて保存し、エディタの関数選択から test_ で始まる関数を実行する。
 *         結果は「実行ログ」と TEST_LOG / LOG シートで確認する。
 */

/** テスト条件（必要に応じて書き換える） */
function testSettings_() {
  return {
    // テストする部署コード（DEPARTMENTS に登録済みのもの）
    department: "SALES1",

    // 「送信者」として使う LINE ユーザー ID（スタッフマスタに登録されている ID）
    senderUserId: "",

    // Webhook で送るメッセージの本文
    messageText: "> シフトの確認",

    // LIFF から送られるパラメータ
    actionParams: { action: ACTIONS.IS_MAINTENANCE },

    // 通知の種類（ALERT_TYPE）と基準時刻（yyyy/MM/dd HH:mm）
    alertType: ALERT_TYPE.PREVIOUS,
    alertNow: "2026/10/09 12:00",
  };
}

/** 設定内容の確認（トークンは伏せ字） */
function test_showConfig() {
  const config = assertTestMode_();
  console.log({
    department: config.departmentCode,
    botUserId: config.botUserId,
    lineMode: config.lineMode,
    testLineUserId: config.testLineUserId || "（未設定：送信せず TEST_LOG に記録のみ）",
    spreadsheetId: config.spreadsheetId,
    spreadsheetName: getSpreadsheet().getName(),
    achieveLiffId: config.achieveLiffId,
    lineChannelAccessToken: config.lineChannelAccessToken.slice(0, 4) + "****",
  });
}

/** 必要なファイルがすべてプロジェクトに入っているか確認 */
function test_checkFiles() {
  const required = {
    "Config": typeof AppConfig,
    "Const": typeof SHEETS,
    "Common": typeof openSpreadsheetById,
    "SheetReader": typeof readSheetValues,
    "Repositories": typeof createRepositories,
    "SystemStatusRepository": typeof SystemStatusRepository,
    "ConstRepository": typeof ConstRepository,
    "StoreRepository": typeof StoreRepository,
    "AdminRepository": typeof AdminRepository,
    "StaffRepository": typeof StaffRepository,
    "ScheduleRepository": typeof ScheduleRepository,
    "AchievementRepository": typeof AchievementRepository,
    "ShiftTableRepository": typeof ShiftTableRepository,
    "HolidayRepository": typeof HolidayRepository,
    "LogRepository": typeof LogRepository,
    "LineClient": typeof LineClient,
    "LineMessages": typeof confirmFlexMessage,
    "RequestHandler": typeof dispatchRequest,
    "ActionController": typeof ActionController,
    "LineWebhookController": typeof LineWebhookController,
    "Notifications": typeof sendAlert,
    "ScheduleTransfer": typeof updateWorkManagement,
    "Trigger": typeof setupTrigger,
    "Diagnostics": typeof measurePerformance,
  };
  const missing = Object.keys(required).filter(name => required[name] === "undefined");
  console.log(missing.length === 0
    ? "OK：必要なファイルはすべてそろっています。"
    : "不足しているファイル：" + missing.join(", "));
}

/** テストモードの送信確認：ダミー宛ての push が自分に届くか */
function test_sendToSelf() {
  assertTestMode_();
  getLineClient().push("U_DUMMY_FOR_TEST", [textMessage("テストモードの送信確認です。")]);
  console.log("送信しました。LINEとTEST_LOGシートを確認してください。");
}

/** Webhook：テキストメッセージを受信 */
function test_webhookMessage() {
  assertTestMode_();
  const settings = testSettings_();
  if (!settings.senderUserId) throw new Error("testSettings_() の senderUserId を設定してください。");
  runWebhook_({
    type: LINE_EVENT.MESSAGE,
    replyToken: "TEST_REPLY_TOKEN",
    source: { type: "user", userId: settings.senderUserId },
    message: { type: LINE_MESSAGE_TYPE.TEXT, text: settings.messageText },
  });
}

/** Webhook：友だち追加（ダミーの ID なので、スタッフマスタに1行追加される） */
function test_webhookFollow() {
  assertTestMode_();
  runWebhook_({
    type: LINE_EVENT.FOLLOW,
    replyToken: "TEST_REPLY_TOKEN",
    source: { type: "user", userId: "U_TEST_FOLLOW_" + Utilities.formatDate(new Date(), "JST", "yyyyMMddHHmmss") },
  });
}

/** LIFF の action を GET で呼ぶ */
function test_actionGet() {
  assertTestMode_();
  logResponse_(doGet({ parameter: actionParamsWithDepartment_() }));
}

/** LIFF の action を POST で呼ぶ */
function test_actionPost() {
  assertTestMode_();
  logResponse_(doPost({ postData: { contents: JSON.stringify(actionParamsWithDepartment_()) } }));
}

/** 通知を指定の時刻として送る */
function test_scheduled() {
  assertTestMode_();
  const settings = testSettings_();
  const now = new Date(settings.alertNow);
  if (isNaN(now.getTime())) throw new Error("alertNow の形式が不正です: " + settings.alertNow);
  sendAlert(settings.alertType, now);
  console.log(`alertType=${settings.alertType} now=${settings.alertNow} を実行しました。TEST_LOGシートを確認してください。`);
}

// --- 内部処理 ---

function assertTestMode_() {
  useDepartment(testSettings_().department);
  const config = getAppConfig();
  if (!config.isTestMode) {
    throw new Error("LINE_MODE=test のときだけ実行できます。（現在: " + config.lineMode + "）");
  }
  return config;
}

/** Worker（lineauth）と同じ形で Webhook を送る（destination は選択中の部署の公式アカウント、合言葉付き） */
function runWebhook_(event) {
  const body = { destination: getAppConfig().botUserId, events: [event] };
  const key = (getScriptProperties_()[PROPERTY_KEY.PROXY_SECRET] || "").trim();
  doPost({ parameter: key ? { key } : {}, postData: { contents: JSON.stringify(body) } });
  console.log("Webhookを実行しました。LINE・TEST_LOG・LOGシートを確認してください。", JSON.stringify(event));
}

/** LIFF のパラメータに部署コード（dept）を付ける */
function actionParamsWithDepartment_() {
  const settings = testSettings_();
  return Object.assign({ dept: settings.department }, settings.actionParams);
}

function logResponse_(response) {
  console.log(response ? response.getContent() : "（レスポンスなし）");
}
