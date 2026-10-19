/**
 * 設定値（スクリプトプロパティ）
 *
 * 部署ごとに異なる値・環境ごとに異なる値はコードに直書きせず、
 * 「プロジェクトの設定 > スクリプト プロパティ」で管理する。
 *
 * 1部署 = 1 LINE公式アカウント = 1スプレッドシート。
 * 部署ごとの値は「部署コード_」を先頭に付けたキーで持つ（例：SALES1_SPREADSHEET_ID）。
 *
 * 共通（必須）:
 *   DEPARTMENTS                       部署コードの一覧（カンマ区切り。順番に意味はない） 例：SALES1,SALES2
 *   LINE_MODE                         production / test（未設定・それ以外の値はLINE送信を停止）
 * 共通（任意）:
 *   TEST_LINE_USER_ID                 テストモード時の送信先（未設定ならTEST_LOGに記録するだけで送信しない）
 *   LIFF_CHANNEL_ID                   LIFFアプリがあるLINEログインチャネルのID（IDトークンの検証に使う）
 *   REQUIRE_ID_TOKEN                  true にすると、IDトークンのないLIFFからのリクエストを拒否する（移行完了後に設定）
 *   PROXY_SECRET                      Worker（lineauth）と共通の合言葉。設定すると、合言葉のないWebhookを拒否する
 *   BATCH_READ                        true にすると、読むシートが多い処理で複数のシートを1回でまとめて読む（SheetReader.gs）
 * 部署ごと（必須）:
 *   <部署コード>_SPREADSHEET_ID            対象スプレッドシートのID
 *   <部署コード>_LINE_CHANNEL_ACCESS_TOKEN LINEチャネルアクセストークン
 *   <部署コード>_ACHIEVE_LIFF_ID           実績入力用LIFFアプリのID（通知の「実績報告」ボタンで開く）
 *   <部署コード>_BOT_USER_ID               公式アカウントのBotユーザーID（Webhookの destination で部署を判別）
 *
 * ※ファイルの読み込み順に依存しないよう、トップレベルではクラスを生成しない
 */

const PROPERTY_KEY = {
  // 共通
  DEPARTMENTS: "DEPARTMENTS",
  LINE_MODE: "LINE_MODE",
  TEST_LINE_USER_ID: "TEST_LINE_USER_ID",
  LIFF_CHANNEL_ID: "LIFF_CHANNEL_ID",
  REQUIRE_ID_TOKEN: "REQUIRE_ID_TOKEN",
  PROXY_SECRET: "PROXY_SECRET",
  BATCH_READ: "BATCH_READ",
  // 部署ごと（「部署コード_」を先頭に付けて使う）
  SPREADSHEET_ID: "SPREADSHEET_ID",
  LINE_CHANNEL_ACCESS_TOKEN: "LINE_CHANNEL_ACCESS_TOKEN",
  ACHIEVE_LIFF_ID: "ACHIEVE_LIFF_ID",
  BOT_USER_ID: "BOT_USER_ID",
};

// LINE送信モード
const LINE_SEND_MODE = {
  PRODUCTION: "production", // 通常送信
  TEST: "test",             // テスト用ユーザーへ転送
  DISABLED: "disabled",     // 送信しない（LINE_MODE未設定・不正値）
};

/**
 * 1部署分の設定
 */
class AppConfig {
  /**
   * コンストラクタ
   * @param {Object} props スクリプトプロパティ（キー：値）
   * @param {string} departmentCode 部署コード
   */
  constructor(props, departmentCode) {
    const deptKey = key => `${departmentCode}_${key}`;

    this.departmentCode = departmentCode;
    this.spreadsheetId = AppConfig._required(props, deptKey(PROPERTY_KEY.SPREADSHEET_ID));
    this.lineChannelAccessToken = AppConfig._required(props, deptKey(PROPERTY_KEY.LINE_CHANNEL_ACCESS_TOKEN));
    this.achieveLiffId = AppConfig._required(props, deptKey(PROPERTY_KEY.ACHIEVE_LIFF_ID));
    this.botUserId = AppConfig._required(props, deptKey(PROPERTY_KEY.BOT_USER_ID));
    this.lineMode = AppConfig._toLineMode(props[PROPERTY_KEY.LINE_MODE]);
    this.testLineUserId = (props[PROPERTY_KEY.TEST_LINE_USER_ID] || "").trim();
    this.liffChannelId = (props[PROPERTY_KEY.LIFF_CHANNEL_ID] || "").trim();
    this.requireIdToken = (props[PROPERTY_KEY.REQUIRE_ID_TOKEN] || "").trim().toLowerCase() === "true";
  }

  get isTestMode() {
    return this.lineMode === LINE_SEND_MODE.TEST;
  }

  static _required(props, key) {
    const value = (props[key] || "").trim();
    if (!value) throw new Error(`スクリプトプロパティ ${key} が設定されていません。`);
    return value;
  }

  static _toLineMode(value) {
    const mode = (value || "").trim();
    if (mode === LINE_SEND_MODE.PRODUCTION || mode === LINE_SEND_MODE.TEST) return mode;
    return LINE_SEND_MODE.DISABLED;
  }
}

// 同一実行中はプロパティを1回だけ読む
let _scriptPropertiesCache = null;
// 現在処理中の部署（useDepartment で選ぶ。既定の部署はない）
let _currentDepartmentCode = null;
let _appConfigCache = null;

function getScriptProperties_() {
  if (!_scriptPropertiesCache) {
    _scriptPropertiesCache = PropertiesService.getScriptProperties().getProperties();
  }
  return _scriptPropertiesCache;
}

/**
 * 部署コードの一覧（DEPARTMENTS の記載順）
 * @return {string[]}
 */
function getDepartmentCodes() {
  const codes = (getScriptProperties_()[PROPERTY_KEY.DEPARTMENTS] || "")
    .split(",")
    .map(code => code.trim())
    .filter(code => code);
  if (codes.length === 0) throw new Error(`スクリプトプロパティ ${PROPERTY_KEY.DEPARTMENTS} が設定されていません。`);
  return codes;
}

/**
 * 登録済みの部署コードか
 */
function isDepartmentCode(code) {
  return getDepartmentCodes().includes(code);
}

/**
 * BotユーザーID（Webhookの destination）から部署コードを取得
 * @return {string|null} 一致する部署がなければ null
 */
function findDepartmentByBotUserId(botUserId) {
  if (!botUserId) return null;
  const props = getScriptProperties_();
  return getDepartmentCodes().find(code =>
    (props[`${code}_${PROPERTY_KEY.BOT_USER_ID}`] || "").trim() === botUserId
  ) ?? null;
}

/**
 * スプレッドシートIDから部署コードを取得
 * @return {string|null} 一致する部署がなければ null
 */
function findDepartmentBySpreadsheetId(spreadsheetId) {
  if (!spreadsheetId) return null;
  const props = getScriptProperties_();
  return getDepartmentCodes().find(code =>
    (props[`${code}_${PROPERTY_KEY.SPREADSHEET_ID}`] || "").trim() === spreadsheetId
  ) ?? null;
}

/**
 * Webhook の合言葉が正しいか（Worker を通ってきたリクエストか）
 * PROXY_SECRET が未設定の間は確認しない（Worker 側の準備ができてから設定する）
 */
function isValidProxyKey(proxyKey) {
  const expected = (getScriptProperties_()[PROPERTY_KEY.PROXY_SECRET] || "").trim();
  if (!expected) return true;
  return proxyKey === expected;
}

/**
 * 処理する部署を切り替える（以降の設定・リポジトリ・LINE送信はこの部署のものになる）
 */
function useDepartment(departmentCode) {
  if (!isDepartmentCode(departmentCode)) {
    throw new Error(`部署コード ${departmentCode} は ${PROPERTY_KEY.DEPARTMENTS} に登録されていません。`);
  }
  if (_currentDepartmentCode === departmentCode && _appConfigCache) return;

  _currentDepartmentCode = departmentCode;
  _appConfigCache = null;
  clearRepositories();
}

/**
 * 全部署について fn を順番に実行する（部署ごとに useDepartment で切り替える）
 * ある部署で例外が起きても、残りの部署は続けて処理する。
 * @param {function(string): *} fn 部署コードを受け取る処理
 * @return {{results: Array<{department: string, value: *}>, errors: Array<{department: string, error: Error}>}}
 */
function forEachDepartment(fn) {
  const results = [];
  const errors = [];
  getDepartmentCodes().forEach(code => {
    try {
      useDepartment(code);
      results.push({ department: code, value: fn(code) });
    } catch (e) {
      console.error(`部署 ${code} の処理で例外が発生しました：${e && e.message}`);
      errors.push({ department: code, error: e });
    }
  });
  return { results, errors };
}

/**
 * forEachDepartment で発生した例外を投げ直す（トリガーの実行を「失敗」として記録させるため）
 * 1件ならその例外をそのまま、複数なら部署ごとのメッセージをまとめて投げる
 */
function throwDepartmentErrors(errors) {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0].error;
  throw new Error(errors.map(x => `部署 ${x.department}：${x.error && x.error.message}`).join("\n"));
}

/**
 * 全部署について fn を実行し、例外があれば全部署の処理後に投げ直す
 * @return {Array<{department: string, value: *}>} 成功した部署の結果
 */
function runForAllDepartments(fn) {
  const { results, errors } = forEachDepartment(fn);
  throwDepartmentErrors(errors);
  return results;
}

/**
 * 現在処理中の部署の設定を取得（先に useDepartment で部署を選んでおくこと）
 */
function getAppConfig() {
  if (!_appConfigCache) {
    if (!_currentDepartmentCode) {
      throw new Error("部署が選ばれていません。先に useDepartment で部署を選んでください。");
    }
    _appConfigCache = new AppConfig(getScriptProperties_(), _currentDepartmentCode);
  }
  return _appConfigCache;
}

/**
 * 各部署の公式アカウントの BotユーザーID を表示（読み取りのみ。本番のエディタから実行してよい）
 * <部署コード>_BOT_USER_ID に設定する値を調べるために使う。DEPARTMENTS とトークンだけ設定してあれば動く
 */
function showBotUserIds() {
  const props = getScriptProperties_();
  getDepartmentCodes().forEach(code => {
    const token = (props[`${code}_${PROPERTY_KEY.LINE_CHANNEL_ACCESS_TOKEN}`] || "").trim();
    if (!token) {
      console.error(`部署 ${code}：${code}_${PROPERTY_KEY.LINE_CHANNEL_ACCESS_TOKEN} が設定されていません。`);
      return;
    }
    const res = UrlFetchApp.fetch(LINE_API_URL.BOT_INFO, { headers: { Authorization: "Bearer " + token } });
    const botInfo = JSON.parse(res.getContentText());
    console.log(`部署 ${code}：公式アカウント「${botInfo.displayName}」 ${code}_${PROPERTY_KEY.BOT_USER_ID} = ${botInfo.userId}`);
  });
}

/**
 * DEPARTMENTS にまだ入れていない部署の設定確認（移行の事前確認用。読み取りのみ。本番のエディタから実行してよい）
 * DEPARTMENTS に入れると、その瞬間から Webhook・通知の処理対象になるため、入れる前にこれで確認する
 *   ・トークンの公式アカウント名と BotユーザーID（<部署>_BOT_USER_ID に設定する値）
 *   ・スプレッドシートを開けるか（シート名の一覧）
 *   ・<部署>_BOT_USER_ID・<部署>_ACHIEVE_LIFF_ID が設定済みか
 */
function previewDepartmentSettings(departmentCode) {
  const props = getScriptProperties_();
  const prop = key => (props[`${departmentCode}_${key}`] || "").trim();
  const result = { department: departmentCode, enabled: getDepartmentCodes().includes(departmentCode) };

  const token = prop(PROPERTY_KEY.LINE_CHANNEL_ACCESS_TOKEN);
  if (token) {
    const res = UrlFetchApp.fetch(LINE_API_URL.BOT_INFO, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    const botInfo = res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
    result.lineAccountName = botInfo ? botInfo.displayName : `取得できません（HTTP ${res.getResponseCode()}）`;
    result.botUserIdFromToken = botInfo ? botInfo.userId : "";
    result.botUserId = prop(PROPERTY_KEY.BOT_USER_ID) || "（未設定）";
    result.botUserIdMatches = botInfo && botInfo.userId === prop(PROPERTY_KEY.BOT_USER_ID) ? "OK" : "NG（上の botUserIdFromToken を設定してください）";
  } else {
    result.lineAccountName = `（${departmentCode}_${PROPERTY_KEY.LINE_CHANNEL_ACCESS_TOKEN} が未設定）`;
  }

  const spreadsheetId = prop(PROPERTY_KEY.SPREADSHEET_ID);
  if (spreadsheetId) {
    try {
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      result.spreadsheetName = spreadsheet.getName();
      const sheetNames = spreadsheet.getSheets().map(x => x.getName());
      const requiredSheets = Object.values(SHEETS);
      result.missingSheets = requiredSheets.filter(x => !sheetNames.includes(x));
    } catch (e) {
      result.spreadsheetName = "開けません：" + e.message;
    }
  } else {
    result.spreadsheetName = `（${departmentCode}_${PROPERTY_KEY.SPREADSHEET_ID} が未設定）`;
  }

  result.achieveLiffId = prop(PROPERTY_KEY.ACHIEVE_LIFF_ID) || "（未設定）";
  console.log(result);
}

/** 1部の移行前の確認（エディタから実行する用） */
function previewSales1Settings() {
  previewDepartmentSettings("SALES1");
}

/**
 * 全部署の設定確認（読み取りのみ。本番のエディタから実行してよい）
 * スプレッドシートを開けるか、BOT_USER_ID がトークンの公式アカウントと一致するかを確認する
 */
function checkDepartmentSettings() {
  getDepartmentCodes().forEach(code => {
    try {
      useDepartment(code);
      const config = getAppConfig();
      const botInfo = getLineClient().getBotInfo();
      console.log({
        department: code,
        spreadsheetName: getSpreadsheet().getName(),
        lineAccountName: botInfo.displayName,
        botUserId: config.botUserId,
        botUserIdMatches: botInfo.userId === config.botUserId ? "OK" : `NG（APIの値: ${botInfo.userId}）`,
        achieveLiffId: config.achieveLiffId,
        lineMode: config.lineMode,
        liffChannelId: config.liffChannelId || "（未設定：IDトークンを検証できません）",
        requireIdToken: config.requireIdToken,
        proxySecret: (getScriptProperties_()[PROPERTY_KEY.PROXY_SECRET] || "").trim()
          ? "設定済み（合言葉のないWebhookは拒否）"
          : "未設定（Webhookの合言葉を確認しない）",
      });
    } catch (e) {
      console.error(`部署 ${code} の設定に問題があります：${e.message}`);
    }
  });
}
