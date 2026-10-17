/**
 * LINE Messaging API クライアント
 *
 * LINE への送信はすべてここを通す。スクリプトプロパティ LINE_MODE によって送り方を切り替える。
 *   production : そのまま送信
 *   test       : TEST_LINE_USER_ID 宛ての push に変換して送信（reply も push に変換）。送信内容は TEST_LOG シートに記録
 *   disabled   : 送信しない（LOG シートにエラーを記録）
 */
class LineClient {
  /**
   * @param {AppConfig} config
   */
  constructor(config) {
    this.token = config.lineChannelAccessToken;
    this.mode = config.lineMode;
    this.testUserId = config.testLineUserId;
  }

  /** 返信（Webhook の replyToken を使う） */
  reply(replyToken, messages) {
    return this._send(LINE_API_URL.REPLY, { replyToken, messages });
  }

  /** テキスト1件で返信 */
  replyText(replyToken, text) {
    return this.reply(replyToken, [textMessage(text)]);
  }

  /** 指定のユーザーへ送信 */
  push(to, messages) {
    return this._send(LINE_API_URL.PUSH, { to, messages });
  }

  /** プロフィール取得（読み取りのみのため、テストモードでも実行する） */
  getProfile(userId) {
    return this._get(LINE_API_URL.PROFILE + userId);
  }

  /** 公式アカウント（Bot）の情報取得（userId が Webhook の destination と同じ値） */
  getBotInfo() {
    return this._get(LINE_API_URL.BOT_INFO);
  }

  /**
   * LIFF の ID トークンを検証（読み取りのみのため、テストモードでも実行する）
   * @param {string} idToken liff.getIDToken() の値
   * @param {string} channelId LIFF アプリがある LINE ログインチャネルの ID
   * @return {Object|null} 検証できればトークンの内容（sub = LINE ユーザー ID）、できなければ null
   */
  verifyIdToken(idToken, channelId) {
    const res = UrlFetchApp.fetch(LINE_API_URL.VERIFY_ID_TOKEN, {
      method: "post",
      payload: { id_token: idToken, client_id: channelId },
      muteHttpExceptions: true,
    });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
  }

  // --- 内部処理 ---

  _get(url) {
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + this.token } });
    return JSON.parse(res.getContentText());
  }

  _send(url, payload) {
    switch (this.mode) {
      case LINE_SEND_MODE.PRODUCTION:
        return this._post(url, payload);
      case LINE_SEND_MODE.TEST:
        return this._sendToTestUser(url, payload);
      default:
        writeLog("SYSTEM", "LINE_SEND", "ERROR", {
          message: "LINE_MODEが未設定または不正なため送信を停止しました",
          url: url,
          payload: payload,
        });
        return null;
    }
  }

  _post(url, payload) {
    return UrlFetchApp.fetch(url, {
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: "Bearer " + this.token,
      },
      method: "post",
      payload: JSON.stringify(payload),
    });
  }

  /** テストモード：本来の送信内容を記録し、先頭に本来の送り先を書いて、テスト用ユーザーへ push する */
  _sendToTestUser(url, payload) {
    writeTestLog(url, payload);
    if (!this.testUserId) return null;

    const messages = [textMessage(LineClient._describeOriginalTarget(url, payload))]
      .concat(payload.messages || [])
      .slice(0, 5); // 1回の送信で送れるメッセージは最大5件
    return this._post(LINE_API_URL.PUSH, { to: this.testUserId, messages: messages });
  }

  static _describeOriginalTarget(url, payload) {
    if (url === LINE_API_URL.PUSH) return `【TEST】本来の宛先(push): ${payload.to}`;
    if (url === LINE_API_URL.REPLY) return `【TEST】本来はreply(replyToken: ${payload.replyToken})`;
    return `【TEST】本来の送信先: ${url} / to: ${JSON.stringify(payload.to)}`;
  }
}

/** 処理中の部署の公式アカウントで送る LineClient */
function getLineClient() {
  return new LineClient(getAppConfig());
}

/** テキストメッセージ */
function textMessage(text) {
  return { type: LINE_MESSAGE_TYPE.TEXT, text: text };
}

/** テストモードの送信内容を TEST_LOG シートに記録（シートがなければ作成） */
function writeTestLog(url, payload) {
  try {
    const spreadsheet = getSpreadsheet();
    const sheet = spreadsheet.getSheetByName(TEST_LOG_SHEET_NAME) || spreadsheet.insertSheet(TEST_LOG_SHEET_NAME);
    sheet.appendRow([new Date(), url, JSON.stringify(payload)]);
  } catch (e) {
    console.error("Failed to write TEST_LOG:", e);
  }
}
