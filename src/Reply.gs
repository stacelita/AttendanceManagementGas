/**
 * メッセージ返信
 */
function replyToUser(token, text) {
  lineApiFetch(LINE_API_URL.REPLY, {
    replyToken: token,
    messages: [{ type: LINE_MESSAGE_TYPE.TEXT, text: text }],
  });
}

/**
 * LINE API共通リクエスト（送信モードの切り替えは LineClient で行う）
 */
function lineApiFetch(url, payload) {
  return getLineClient().post(url, payload);
}

/**
 * JSONレスポンス処理
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}