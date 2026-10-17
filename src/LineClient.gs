/**
 * LINE Messaging API クライアント
 *
 * LINEへの送信はすべてここを通す。LINE_MODE によって送信先を切り替える。
 *   production : そのまま送信
 *   test       : TEST_LINE_USER_ID 宛ての push に変換して送信（replyも push に変換）
 *                送信内容は TEST_LOG シートに記録する
 *   disabled   : 送信しない（LOGシートにエラーを記録）
 */
class LineClient {
  /**
   * コンストラクタ
   * @param {AppConfig} config
   */
  constructor(config) {
    this.token = config.lineChannelAccessToken;
    this.mode = config.lineMode;
    this.testUserId = config.testLineUserId;
  }

  /**
   * POST送信（reply / push など）
   */
  post(url, payload) {
    switch (this.mode) {
      case LINE_SEND_MODE.PRODUCTION:
        return this._fetchPost(url, payload);

      case LINE_SEND_MODE.TEST:
        return this._postForTest(url, payload);

      default:
        writeLog("SYSTEM", "LINE_SEND", "ERROR", {
          message: "LINE_MODEが未設定または不正なため送信を停止しました",
          url: url,
          payload: payload,
        });
        return null;
    }
  }

  /**
   * プロフィール取得（読み取りのみのためテストモードでも実行する）
   */
  getProfile(userId) {
    const res = UrlFetchApp.fetch(LINE_API_URL.PROFILE + userId, {
      headers: { Authorization: "Bearer " + this.token }
    });
    return JSON.parse(res.getContentText());
  }

  /**
   * 公式アカウント（Bot）の情報取得（読み取りのみ。userId が Webhook の destination と同じ値）
   */
  getBotInfo() {
    const res = UrlFetchApp.fetch(LINE_API_URL.BOT_INFO, {
      headers: { Authorization: "Bearer " + this.token }
    });
    return JSON.parse(res.getContentText());
  }

  /**
   * LIFF の IDトークンを検証（読み取りのみ。テストモードでも実行する）
   * @param {string} idToken liff.getIDToken() の値
   * @param {string} channelId LIFFアプリがあるLINEログインチャネルのID
   * @return {Object|null} 検証成功ならトークンの内容（sub = LINEユーザーID）、失敗なら null
   */
  verifyIdToken(idToken, channelId) {
    const res = UrlFetchApp.fetch(LINE_API_URL.VERIFY_ID_TOKEN, {
      method: "post",
      payload: { id_token: idToken, client_id: channelId },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  }

  _fetchPost(url, payload) {
    return UrlFetchApp.fetch(url, {
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: "Bearer " + this.token,
      },
      method: "post",
      payload: JSON.stringify(payload),
    });
  }

  /**
   * テストモード送信：本来の内容を記録し、テスト用ユーザー宛てのpushに変換して送る
   */
  _postForTest(url, payload) {
    writeTestLog(url, payload);
    if (!this.testUserId) return null;

    const notice = LineClient._describeOriginalTarget(url, payload);
    const messages = [{ type: LINE_MESSAGE_TYPE.TEXT, text: notice }]
      .concat(payload.messages || [])
      .slice(0, 5); // 1回の送信で送れるメッセージは最大5件

    return this._fetchPost(LINE_API_URL.PUSH, { to: this.testUserId, messages: messages });
  }

  static _describeOriginalTarget(url, payload) {
    if (url === LINE_API_URL.PUSH) return `【TEST】本来の宛先(push): ${payload.to}`;
    if (url === LINE_API_URL.REPLY) return `【TEST】本来はreply(replyToken: ${payload.replyToken})`;
    return `【TEST】本来の送信先: ${url} / to: ${JSON.stringify(payload.to)}`;
  }
}

/**
 * LINEクライアントを取得
 */
function getLineClient() {
  return new LineClient(getAppConfig());
}

/**
 * テストモードの送信内容を TEST_LOG シートに記録（シートがなければ作成）
 */
function writeTestLog(url, payload) {
  try {
    const spreadsheet = getSpreadsheet();
    const sheet = spreadsheet.getSheetByName(TEST_LOG_SHEET_NAME) || spreadsheet.insertSheet(TEST_LOG_SHEET_NAME);
    sheet.appendRow([new Date(), url, JSON.stringify(payload)]);
  } catch (e) {
    console.error("Failed to write TEST_LOG:", e);
  }
}
