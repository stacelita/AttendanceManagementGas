/**
 * シフト変更の再送
 *
 * シフト表(編集)を直したときに、明日と今日の分を勤務管理へ反映し、変わった人にだけ送り直す。
 * シフト表(編集)の D67 のチェックボックスにチェックを入れると動く（終わるとチェックを外し、E67 に結果を書く）
 *
 *   勤務場所が変わった人：店舗・入り・開始・終了を上書きし、確認欄を空にして「【変更】前日確認／当日確認」を送る
 *   勤務が増えた人      ：勤務管理に追加して「【変更】前日確認／当日確認」を送る
 *   勤務がなくなった人  ：勤務管理の行を削除して「勤務はなくなりました」を送る
 *   ※比べるのはスタッフ単位（1人が1日に入る店舗は1つ）。アラートOFFの店舗の人には送らない
 *
 * 明日の分だけの扱い
 *   ・今日の 11:45 の転記（updateWorkManagement）が済むまでは何もしない（転記で全員分が入り、12:00 に前日確認が届くため）
 *   ・転記のあとなら、勤務管理に明日の行が1件もなくても、シフト表の全員を追加して送る
 *
 * 今日の分だけの扱い
 *   ・空にするのは当日確認（前日確認・実績入力状況はそのまま）
 *   ・終了時刻を過ぎた勤務は、勤務管理だけ直して送らない
 *   ・13:00 に作る「実績報告のお願い」のトリガーがすでに作られていて、新しい終了時刻の分がなければ作る
 *
 * 準備：setupShiftResendTriggers を1回実行して、各部署のスプレッドシートに編集時のトリガーを登録する
 */

/** 反映する日ごとの設定（明日 → 今日の順に処理する） */
function shiftResendTargets_() {
  return [
    {
      label: "明日", dayWord: "明日", addDays: 1,
      alertType: ALERT_TYPE.PREVIOUS, title: "【変更】前日確認", altText: "【変更】前日の勤務確認：",
      checkToClear: "prevCheck",
      requireTransferred: true, // 今日の 11:45 の転記が済んでから
      isToday: false,
    },
    {
      label: "今日", dayWord: "本日", addDays: 0,
      alertType: ALERT_TYPE.TODAY, title: "【変更】当日確認", altText: "【変更】当日の勤務確認：",
      checkToClear: "todayCheck",
      requireTransferred: false,
      isToday: true,
    },
  ];
}

/**
 * シフト表(編集)が編集されたときに呼ばれる（編集時のトリガー）
 * ※関数名はトリガーに登録されているため変えないこと
 */
function onShiftTableEdit(e) {
  if (!isShiftResendChecked_(e)) return;

  const departmentCode = findDepartmentBySpreadsheetId(e.source.getId());
  if (!departmentCode) return;

  const sheet = e.range.getSheet();
  const resultCell = sheet.getRange(SHIFT_RESEND_CELL.RESULT.row, SHIFT_RESEND_CELL.RESULT.column);

  // 続けてチェックされた場合に、同時に処理しないようにする
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    resultCell.setValue("ほかの処理が終わらなかったため、実行できませんでした。もう一度チェックしてください。");
    e.range.setValue(false);
    return;
  }

  try {
    resultCell.setValue("処理中...");
    SpreadsheetApp.flush();

    useDepartment(departmentCode);
    const result = resendChangedShifts_();
    resultCell.setValue(`${result}（${Utilities.formatDate(new Date(), "JST", "M/d H:mm")}）`);
  } catch (error) {
    writeLog("SYSTEM", "resendChangedShifts", "ERROR", errorLogContent(error, undefined));
    resultCell.setValue("エラーのため中断しました：" + error.message);
  } finally {
    e.range.setValue(false);
    lock.releaseLock();
  }
}

/** シフト表(編集)の再送のチェックボックスに、チェックが入った編集か */
function isShiftResendChecked_(e) {
  if (!e || !e.range || e.value !== "TRUE") return false;
  const range = e.range;
  return range.getNumRows() === 1 && range.getNumColumns() === 1
    && range.getRow() === SHIFT_RESEND_CELL.CHECKBOX.row
    && range.getColumn() === SHIFT_RESEND_CELL.CHECKBOX.column
    && range.getSheet().getName() === SHEETS.SHIFT_TABLE;
}

/**
 * 処理中の部署の、明日と今日のシフトの変更を勤務管理へ反映し、変わった人に送り直す
 * @param {Date} now 基準時刻（テスト用）
 * @return {string} 結果（E67 に書く文言。例「明日：…／今日：…」）
 */
function resendChangedShifts_(now = new Date()) {
  clearRepositories(); // 直したばかりのシフト表を読む
  const departmentCode = getAppConfig().departmentCode;
  return shiftResendTargets_()
    .map(target => `${target.label}：${applyShiftChanges_(target, now, departmentCode)}`)
    .join("／");
}

/**
 * 1日分のシフトの変更を勤務管理へ反映し、変わった人に送り直す
 * @return {string} 結果
 */
function applyShiftChanges_(target, now, departmentCode) {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + target.addDays);
  const workDate = toJstSlashDate(date);

  if (target.requireTransferred && getShiftTransferDate_() !== toJstSlashDate(now)) {
    return "11:45 の勤務管理への転記の前のため、何もしませんでした。";
  }

  const shiftRow = findShiftRowOfDate_(date);
  if (!shiftRow) return "シフト表に日付が見つかりませんでした。";

  const current = findSchedulesOfDate_(workDate);

  const planned = new Map(findShiftAssignmentsOfRow_(shiftRow).map(x => [x.staffName, x])); // 氏名 → 割り当て
  const currentNames = new Set(current.map(x => x.staffName));

  const changed = current.filter(x => planned.has(x.staffName) && planned.get(x.staffName).storeName !== x.storeName);
  const added = [...planned.values()].filter(x => !currentNames.has(x.staffName));
  const removed = current.filter(x => !planned.has(x.staffName));
  if (changed.length + added.length + removed.length === 0) return "違いはありませんでした。";

  // 店舗詳細にない店舗があれば、途中まで書き換えないよう先に止める
  const stores = getRepositories().stores;
  const unknownStores = [...new Set(
    changed.map(x => planned.get(x.staffName).storeName)
      .concat(added.map(x => x.storeName))
      .filter(storeName => !stores.findByStoreName(storeName))
  )];
  if (unknownStores.length > 0) return `店舗詳細にない店舗があるため、中断しました：${unknownStores.join(", ")}`;

  // 実績報告のお願いのトリガーがある終了時刻（書き換える前に調べる。今日の分で、13:00 の作成が済んでいるときだけ）
  const remindTimes = target.isToday ? achieveRemindTimesWithTrigger_(departmentCode) : null;

  // 勤務管理へ反映（上書き → 追加 → 削除の順。削除は下の行から行うので、ほかの行番号に影響しない）
  const schedules = getRepositories().schedules;
  const changedSchedules = changed.map(before => {
    const schedule = scheduleFromAssignment_(planned.get(before.staffName), workDate);
    schedule.rowNumber = before.rowNumber;
    schedule.prevCheck = before.prevCheck;
    schedule.todayCheck = before.todayCheck;
    schedule[target.checkToClear] = ""; // 確認済みでも、確認し直してもらう
    schedules.updateShift(schedule);
    return schedule;
  });
  const addedSchedules = added.map(assignment => scheduleFromAssignment_(assignment, workDate));
  schedules.addRange(addedSchedules);
  schedules.deleteRows(removed);

  // 本人へ送る（今日の分は、終了時刻を過ぎた勤務には送らない）
  const isOngoing = schedule => !(target.isToday && hasShiftEnded_(schedule, workDate, now));
  const notified = changedSchedules.concat(addedSchedules).filter(isOngoing);
  const sentCount =
    notified.filter(x => sendChangedShiftCheck_(x, workDate, target)).length +
    removed.filter(isOngoing).filter(x => sendCanceledShift_(x, date, target)).length;

  if (remindTimes) createMissingAchieveRemindTriggers_(notified, remindTimes, workDate, now);

  writeLog("SYSTEM", "resendChangedShifts", "SUCCESS", {
    workDate,
    changed: changedSchedules.map(x => `${x.staffName}:${x.storeName}`),
    added: addedSchedules.map(x => `${x.staffName}:${x.storeName}`),
    removed: removed.map(x => `${x.staffName}:${x.storeName}`),
    sentCount,
  });
  return `変更${changed.length}名・追加${added.length}名・取消${removed.length}名を反映し、${sentCount}名に送信しました。`;
}

/** 「【変更】前日確認／当日確認」を送る（送れたら true。アラートOFFの店舗・LINE未登録の人には送らない） */
function sendChangedShiftCheck_(schedule, workDate, target) {
  if (!canNotify_(schedule)) return false;

  const definition = Object.assign({}, alertDefinition_(target.alertType), {
    title: target.title,
    altText: target.altText,
  });
  const alertTarget = {
    userId: schedule.userId,
    userName: schedule.staffName,
    storeName: schedule.storeName,
    checkInTime: schedule.checkInTime,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  };
  const message = confirmFlexMessage(
    definition.altText + workDate,
    staffAlertBodyFor_(target.alertType, definition, alertTarget, workDate),
    definition.confirmPrefix + workDate
  );
  return getLineClient().pushOrLogError(schedule.userId, [message], "resendChangedShifts", { workDate });
}

/** 「勤務はなくなりました」を送る（送れたら true。アラートOFFの店舗・LINE未登録の人には送らない） */
function sendCanceledShift_(schedule, date, target) {
  if (!canNotify_(schedule)) return false;

  const text = `【変更】${target.dayWord}（${Utilities.formatDate(date, "JST", "M/d")}）の${schedule.storeName}への勤務はなくなりました。`;
  return getLineClient().pushOrLogError(schedule.userId, [textMessage(text)], "resendChangedShifts", { workDate: toJstSlashDate(date) });
}

/** 通知してよい人か（LINEユーザーIDがあり、店舗のアラートがOFFでない） */
function canNotify_(schedule) {
  if (!schedule.userId || schedule.userId === UNREGISTERED_USER_ID) return false;
  const store = getRepositories().stores.findByStoreName(schedule.storeName);
  return !(store && store.isAlertOff);
}

/** 勤務の終了時刻を過ぎているか（終了時刻が読めなければ過ぎていないとみなす） */
function hasShiftEnded_(schedule, workDate, now) {
  return minutesUntil_(workDate, toJstHourMinute(schedule.endTime), now) < 0;
}

// --- 実績報告のお願いのトリガー（今日の分） ---

/**
 * 実績報告のお願い（sendAchieveRemind）のトリガーがある終了時刻
 * 13:00 の createTriggerAchieveRemind がまだなら null（そのときの勤務管理から作られるので、ここでは作らない）
 * トリガーの時刻は API で調べられないため、全部署の今日の勤務の終了時刻を「トリガーがある時刻」とみなす
 * （13:00 に作られた分と、この処理で作った分が含まれる）。全部署を読めなかったときも、重複を避けるため null
 * @return {Set<string>|null} "H:mm"
 */
function achieveRemindTimesWithTrigger_(departmentCode) {
  if (getAchieveRemindTriggersDate_() !== toJstSlashDate(new Date())) return null;

  const { times, errors } = collectTodayScheduleTimes_(schedule => schedule.endTime);
  useDepartment(departmentCode); // 全部署を読むために切り替えたので戻す
  return errors.length === 0 ? new Set(times) : null;
}

/** 送り直した勤務のうち、終了時刻のトリガーがまだないものを作る（終了時刻を過ぎたものは作らない） */
function createMissingAchieveRemindTriggers_(schedules, remindTimes, workDate, now) {
  const newTimes = [...new Set(schedules
    .map(x => toJstHourMinute(x.endTime))
    .filter(time => time && !remindTimes.has(time) && minutesUntil_(workDate, time, now) > 0))];
  if (newTimes.length === 0) return;

  createTriggersBefore_(sendAchieveRemind.name, newTimes, [0]);
  newTimes.forEach(time => remindTimes.add(time));
}

/**
 * 各部署のスプレッドシートに、編集時のトリガー（onShiftTableEdit）を登録する
 * 最初に1回だけ、エディタから手動で実行する（登録済みの部署は飛ばすので、部署を増やしたときにもう一度実行してよい）
 */
function setupShiftResendTriggers() {
  const registered = new Set(ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === onShiftTableEdit.name)
    .map(t => t.getTriggerSourceId()));

  getDepartmentCodes().forEach(code => {
    useDepartment(code);
    const spreadsheetId = getAppConfig().spreadsheetId;
    if (registered.has(spreadsheetId)) {
      console.log(`${code}：登録済みのため飛ばしました。`);
      return;
    }
    ScriptApp.newTrigger(onShiftTableEdit.name).forSpreadsheet(spreadsheetId).onEdit().create();
    console.log(`${code}：編集時のトリガーを登録しました。`);
  });
}
