/**
 * 勤務確認・実績報告の通知（トリガーから呼ばれる）
 *
 * 全部署を順番に処理し、各部署のスタッフ・管理者には、その部署の公式アカウントから送る。
 */

// --- トリガーから呼ばれる入口（関数名はトリガーに登録されているため変えないこと） ---

function sendPreRemind()       { sendAlertToAllDepartments_(ALERT_TYPE.PREVIOUS); }
function reSendPreRemind()     { sendAlertToAllDepartments_(ALERT_TYPE.PREVIOUS_RE); }
function sendAlertPreRemind()  { sendAlertToAllDepartments_(ALERT_TYPE.PREVIOUS_ADMIN); }
function sendDayRemind()       { sendAlertToAllDepartments_(ALERT_TYPE.TODAY); }
function reSendDayRemind()     { sendAlertToAllDepartments_(ALERT_TYPE.TODAY_RE); }
function sendAlertDayRemind()  { sendAlertToAllDepartments_(ALERT_TYPE.TODAY_ADMIN); }
function sendAchieveRemind()   { sendAlertToAllDepartments_(ALERT_TYPE.ACHIEVE); }
function reSendAchieveRemind() { sendAlertToAllDepartments_(ALERT_TYPE.ACHIEVE_RE); }
function sendAlertAchieve()    { sendAlertToAllDepartments_(ALERT_TYPE.ACHIEVE_ADMIN); }

function sendAlertToAllDepartments_(alertType) {
  runForAllDepartments(() => sendAlert(alertType));
}

// --- 通知の種類ごとの設定 ---

/**
 * 通知の種類ごとの設定
 *   forTomorrow   ：明日の勤務が対象（false なら今日）
 *   toAdmins      ：管理者へ未実施者のリストを送る（false ならスタッフ本人へ送る）
 *   skipIfChecked ：勤務管理のこの列が「確認済み」の人を除く（prevCheck / todayCheck）
 *   timeWindow    ：勤務の開始・終了時刻までの残り時間（分）がこの範囲の人だけ送る
 *   skipIfEntered ：実績を登録済みの人を除く
 *   title / altText / confirmPrefix：通知の見出し・代替テキスト・「確認しました」ボタンで送られる文言の先頭
 *   achieveRequest：実績報告のお願い（LIFF を開くボタン付き）を送る（true なら再送の文言）
 */
function alertDefinition_(alertType) {
  const definitions = {
    [ALERT_TYPE.PREVIOUS]: {
      forTomorrow: true, skipIfChecked: "prevCheck",
      title: "前日確認", altText: "前日の勤務確認：", confirmPrefix: MESSAGE_PREFIX.PREV_DONE,
    },
    [ALERT_TYPE.PREVIOUS_RE]: {
      forTomorrow: true, skipIfChecked: "prevCheck",
      title: "【再】前日確認", altText: "【再】前日の勤務確認：", confirmPrefix: MESSAGE_PREFIX.PREV_DONE,
    },
    [ALERT_TYPE.PREVIOUS_ADMIN]: {
      forTomorrow: true, toAdmins: true, skipIfChecked: "prevCheck",
      title: "前日確認未実施者リスト",
    },
    [ALERT_TYPE.TODAY]: {
      skipIfChecked: "todayCheck", timeWindow: { time: "startTime", from: 115, to: 125 }, // 勤務開始の2時間前
      title: "当日確認", altText: "当日の勤務確認：", confirmPrefix: MESSAGE_PREFIX.TODAY_DONE,
    },
    [ALERT_TYPE.TODAY_RE]: {
      skipIfChecked: "todayCheck", timeWindow: { time: "startTime", from: 40, to: 50 },    // 勤務開始の45分前
      title: "【再】当日確認", altText: "【再】当日の勤務確認：", confirmPrefix: MESSAGE_PREFIX.TODAY_DONE,
    },
    [ALERT_TYPE.TODAY_ADMIN]: {
      toAdmins: true, skipIfChecked: "todayCheck", timeWindow: { time: "startTime", from: 25, to: 35 }, // 勤務開始の30分前
      title: "当日確認未実施者リスト",
    },
    [ALERT_TYPE.ACHIEVE]: {
      timeWindow: { time: "endTime", from: -5, to: 5 }, // 勤務終了時刻
      achieveRequest: { isReminder: false },
    },
    [ALERT_TYPE.ACHIEVE_RE]: {
      skipIfEntered: true,
      achieveRequest: { isReminder: true },
    },
    [ALERT_TYPE.ACHIEVE_ADMIN]: {
      toAdmins: true, skipIfEntered: true,
      title: "実績未入力者リスト",
    },
  };
  return definitions[alertType];
}

// --- 送信 ---

/**
 * 処理中の部署に、指定の種類の通知を送る
 * @param {number} alertType ALERT_TYPE
 * @param {Date} now 基準時刻（テスト用。トリガーからは省略され現在時刻になる）
 */
function sendAlert(alertType, now = new Date()) {
  // dayAlert から3種類続けて呼ばれるため、種類ごとに最新のシートを読む
  clearRepositories();

  const definition = alertDefinition_(alertType);
  const targetDate = alertTargetDate_(definition, now);
  const targets = findAlertTargets_(alertType, definition, targetDate, now);
  if (targets.length === 0) return;

  if (definition.toAdmins) {
    sendAdminAlerts_(alertType, definition, targets, targetDate);
  } else {
    sendStaffAlerts_(alertType, definition, targets, targetDate);
  }
}

/** 通知の対象日（yyyy/MM/dd） */
function alertTargetDate_(definition, now) {
  const date = new Date(now.getTime());
  if (definition.forTomorrow) date.setDate(date.getDate() + 1);
  return toJstSlashDate(date);
}

/**
 * 通知の対象者（勤務管理の対象日の行から、条件に合う人）
 * @return {Array<{userId, userName, storeName, checkInTime, startTime, endTime, tantosha}>}
 */
function findAlertTargets_(alertType, definition, targetDate, now) {
  const repos = getRepositories();
  // userId → スタッフ（同じIDが複数あれば後の行が優先）
  const staffById = new Map(repos.staffs.findAll().map(x => [x.userId, x]));
  const isEntered = userId => repos.achievements.findAllKeys()
    .some(x => x.userId === userId && toJstSlashDate(x.workDate) === targetDate);

  return repos.schedules.findAll()
    .filter(schedule => {
      if (!schedule.workDate || toJstSlashDate(schedule.workDate) !== targetDate) return false;
      // 店舗詳細にない店舗名だと例外になる（既知の不具合 #7）
      if (repos.stores.findByStoreName(schedule.storeName).isAlertOff) return false;
      if (definition.skipIfChecked && schedule[definition.skipIfChecked] === CHECK_STATUS.DONE) return false;

      if (definition.timeWindow) {
        const time = schedule[definition.timeWindow.time];
        if (!time) return false;
        const minutes = minutesUntil_(targetDate, time, now);
        if (minutes < definition.timeWindow.from || minutes > definition.timeWindow.to) return false;
      }
      if (definition.skipIfEntered && isEntered(schedule.userId)) return false;
      return true;
    })
    .map(schedule => ({
      userId: schedule.userId,
      userName: schedule.staffName,
      storeName: schedule.storeName,
      checkInTime: schedule.checkInTime,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      tantosha: staffById.get(schedule.userId)?.tantoshaCode || 0,
    }));
}

/** スタッフ本人へ送る */
function sendStaffAlerts_(alertType, definition, targets, targetDate) {
  const line = getLineClient();
  targets.forEach(target => {
    const message = definition.achieveRequest
      ? achieveRequestMessage(definition.achieveRequest.isReminder)
      : confirmFlexMessage(
          definition.altText + targetDate,
          staffAlertBodyFor_(alertType, definition, target, targetDate),
          definition.confirmPrefix + targetDate
        );
    line.pushOrLogError(target.userId, [message], "sendAlert", { alertType });
  });
}

/** 管理者へ、担当するスタッフの未実施者リストを送る */
function sendAdminAlerts_(alertType, definition, targets, targetDate) {
  const line = getLineClient();
  getRepositories().admins.findAll().forEach(admin => {
    if (!admin.userId) return;

    const myTargets = targets.filter(t => admin.isInCharge(t.tantosha));
    if (myTargets.length === 0) return;

    const listText = myTargets.map(t => `・${t.userName}`).join("\n");
    const body = adminListBody(definition.title, targetDate, listText);
    line.pushOrLogError(admin.userId, [confirmFlexMessage(definition.title, body, null)], "sendAlert", { alertType });
  });
}

/**
 * スタッフ向け通知の本文（定数シートの通知テンプレートに差し込む）
 * テンプレートがなければ本文なし
 */
function staffAlertBodyFor_(alertType, definition, target, targetDate) {
  const template = getRepositories().consts.findAll().find(x =>
    x.categoryId === CONST_CATEGORY_ID.ALERT_TEMPLATE && x.itemValue === alertType
  );
  if (!template) return [];
  return staffAlertBody(definition.title, fillAlertTemplate_(template.itemName, target, targetDate));
}

function fillAlertTemplate_(template, target, targetDate) {
  return template
    .replace(/{{Date}}/g, toJstSlashDate(targetDate))
    .replace(/{{StoreName}}/g, target.storeName)
    .replace(/{{CheckInTime}}/g, toJstHourMinute(target.checkInTime))
    .replace(/{{StartTime}}/g, toJstHourMinute(target.startTime))
    .replace(/{{EndTime}}/g, toJstHourMinute(target.endTime))
    .replace(/{{TimeLimit}}/g, timeBefore_(target.startTime, 30));
}

// --- 時刻の計算 ---

/** 対象日の指定時刻（"H:mm"）まで、現在時刻から何分あるか */
function minutesUntil_(dateStr, timeStr, now) {
  const target = new Date(`${dateStr} ${timeStr}`);
  return Math.floor((target.getTime() - now.getTime()) / (60 * 1000));
}

/** 時刻（"H:mm"）の指定分前（"HH:mm"） */
function timeBefore_(timeStr, minutesBefore) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes - minutesBefore);
  date.setSeconds(0);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
