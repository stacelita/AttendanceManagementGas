/**
 * 通知で送る Flex Message の組み立て（送信はしない。LineClient.push で送る）
 *
 * ※LINE 側の表示に関わるため、プロパティの内容を変える場合は実機で表示を確認すること
 */

/**
 * 勤務確認などの Flex Message
 * @param {string} altText 通知やトーク一覧に表示される文言
 * @param {Object[]} bodyContents 本文
 * @param {string|null} confirmText 「確認しました」ボタンで送られる文言（null ならボタンなし）
 */
function confirmFlexMessage(altText, bodyContents, confirmText) {
  const bubble = {
    type: "bubble",
    body: { type: "box", layout: "vertical", contents: bodyContents },
  };
  if (confirmText !== null) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      contents: [{
        type: "button",
        style: "primary",
        action: { type: "message", label: "確認しました", text: confirmText },
      }],
    };
  }
  return { type: "flex", altText: altText, contents: bubble };
}

/** スタッフ向け通知の本文（タイトル＋本文） */
function staffAlertBody(title, text) {
  return [
    { type: "text", text: title, weight: "bold", size: "lg" },
    { type: "text", text: text, margin: "md", wrap: true },
  ];
}

/** 管理者向け未実施者リストの本文 */
function adminListBody(title, dateStr, listText) {
  return [
    { type: "text", text: title, weight: "bold", size: "lg" },
    { type: "text", text: "勤務日:" + dateStr, margin: "md" },
    { type: "text", text: listText, margin: "md", wrap: true },
  ];
}

/**
 * 実績報告のお願い（実績入力の LIFF を開くボタン付き）
 * @param {boolean} isReminder 再送（【再】）か
 */
function achieveRequestMessage(isReminder) {
  const altText = isReminder ? "【再】実績報告のお願い" : "実績報告のお願い";
  const text = isReminder
    ? "実績報告が未完了です。\n下のボタンから入力をお願いします。"
    : "本日もお疲れ様でした！\n実績報告をお願いします。";

  return {
    type: "flex",
    altText: altText,
    contents: {
      type: "bubble",
      size: "deca",
      body: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: text, size: "md", wrap: true }],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{
          type: "button",
          style: "primary",
          height: "sm",
          action: { type: "uri", label: "実績報告", uri: LIFF_URL_BASE + getAppConfig().achieveLiffId },
          color: "#06C755",
        }],
        flex: 0,
        paddingAll: "md",   // ボタンまわりの余白を本文と合わせる
        paddingTop: "none", // 本文との間の余白はなくす
      },
    },
  };
}
