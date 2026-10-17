/**
 * LINEメッセージ（Flex Message）の組み立て
 *
 * 送信はしない。組み立てたペイロードは lineApiFetch で送る。
 * ※LINE側の表示に影響するため、プロパティの順序・内容を変える場合は注意
 */

/**
 * 通知モード別の代替テキスト・確認ボタンの送信文言
 */
function getAlertMessageConfig(mode, date) {
  const configMap = {
    [ALERT_MESSAGE.PREVIOUS]:    { altText: "前日の勤務確認：" + date, replyText: MESSAGE_PREFIX.PREV_DONE + date },
    [ALERT_MESSAGE.PREVIOUS_RE]: { altText: "【再】前日の勤務確認：" + date, replyText: MESSAGE_PREFIX.PREV_DONE + date },
    [ALERT_MESSAGE.TODAY]:       { altText: "当日の勤務確認：" + date, replyText: MESSAGE_PREFIX.TODAY_DONE + date },
    [ALERT_MESSAGE.TODAY_RE]:    { altText: "【再】当日の勤務確認：" + date, replyText: MESSAGE_PREFIX.TODAY_DONE + date },
    [ALERT_MESSAGE.PREVIOUS_ADMIN]: { altText: "前日確認未実施者リスト", replyText: "" },
    [ALERT_MESSAGE.TODAY_ADMIN]:    { altText: "当日確認未実施者リスト", replyText: "" },
    [ALERT_MESSAGE.ACHIEVE]:    { altText: "実績入力をお願いします", replyText: "" },
    [ALERT_MESSAGE.ACHIEVE_ADMIN]:    { altText: "実績未入力者リスト", replyText: "" },
  };
  return configMap[mode] || { altText: "勤務確認", replyText: "" };
}

/**
 * スタッフ向け通知の本文（タイトル＋テンプレート本文）
 */
function createStaffAlertBodyContents(title, text) {
  return [
    {"type": "text", "text": title, "weight": "bold", "size": "lg"},
    {"type": "text", "text": text, "margin": "md", "wrap": true}
  ];
}

/**
 * 管理者向け未実施者リストの本文
 */
function createAdminListBodyContents(title, dateStr, listText) {
  return [
    {"type": "text", "text": title, "weight": "bold", "size": "lg"},
    {"type": "text", "text": "勤務日:" + dateStr, "margin": "md"},
    {"type": "text", "text": listText, "margin": "md", "wrap": true}
  ];
}

/**
 * 勤務確認のFlex Message（push用ペイロード）
 * @param {boolean} needsFooter 「確認しました」ボタンを付けるか
 */
function createConfirmFlexPayload(userId, bodyContents, config, needsFooter) {
  const bubble = {
    "type": "bubble",
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": bodyContents
    }
  };

  if (needsFooter) {
    bubble.footer = {
      "type": "box",
      "layout": "vertical",
      "contents": [{
        "type": "button",
        "style": "primary",
        "action": {
          "type": "message",
          "label": "確認しました",
          "text": config.replyText
        }
      }]
    };
  }

  return {
    "to": userId,
    "messages": [{
      "type": "flex",
      "altText": config.altText,
      "contents": bubble
    }]
  };
}

/**
 * 実績報告のお願い（push用ペイロード）
 */
function createAchieveAlertContents(userId) {
  return createAchieveRequestPayload(userId, "実績報告のお願い", "本日もお疲れ様でした！\n実績報告をお願いします。");
}

/**
 * 【再】実績報告のお願い（push用ペイロード）
 */
function createReAchieveAlertContents(userId) {
  return createAchieveRequestPayload(userId, "【再】実績報告のお願い", "実績報告が未完了です。\n下のボタンから入力をお願いします。");
}

/**
 * 実績報告（LIFF）へのボタン付きメッセージ
 */
function createAchieveRequestPayload(userId, altText, text) {
  return {
    "to": userId,
    "messages": [
      {
        "type": "flex",
        "altText": altText,
        "contents": {
          "type": "bubble",
          "size": "deca",
          "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": text,
                "size": "md",
                "wrap": true
              }
            ],
          },
          "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "button",
                "style": "primary",
                "height": "sm",
                "action": {
                  "type": "uri",
                  "label": "実績報告",
                  "uri": LIFF_URL_BASE + getAppConfig().achieveLiffId
                },
                "color": "#06C755"
              }
            ],
            "flex": 0,
            "paddingAll": "md", // ボタン周りの余白をbodyと合わせると綺麗です
            "paddingTop": "none" // bodyとの間の余白を削る
          }
        }
      }
    ]
  };
}
