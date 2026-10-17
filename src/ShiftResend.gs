/**
 * シフト変更の再送
 *
 * 11:45 に勤務管理へ転記したあとでシフト表(編集)を直したときに、明日の分を勤務管理へ反映し、
 * 変わった人にだけ「【変更】前日確認」を送り直す。
 * シフト表(編集)の D67 のチェックボックスにチェックを入れると動く（終わるとチェックを外し、E67 に結果を書く）
 *
 *   勤務場所が変わった人：店舗・入り・開始・終了を上書きし、前日確認を空にして「【変更】前日確認」を送る
 *   明日の勤務が増えた人：勤務管理に追加して「【変更】前日確認」を送る
 *   明日の勤務がなくなった人：勤務管理の行を削除して「勤務はなくなりました」を送る
 *   ※比べるのはスタッフ単位（1人が1日に入る店舗は1つ）。アラートOFFの店舗の人には送らない
 *
 * 準備：setupShiftResendTriggers を1回実行して、各部署のスプレッドシートに編集時のトリガーを登録する
 */

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
 * 処理中の部署の、明日のシフトの変更を勤務管理へ反映し、変わった人に送り直す
 * @param {Date} now 基準時刻（テスト用）
 * @return {string} 結果（E67 に書く文言）
 */
function resendChangedShifts_(now = new Date()) {
  clearRepositories(); // 直したばかりのシフト表を読む

  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const workDate = toJstSlashDate(tomorrow);

  const tomorrowRow = findShiftRowOfDate_(tomorrow);
  if (!tomorrowRow) return "明日の日付がシフト表に見つかりませんでした。";

  // 11:45 の転記より前は、勤務管理に明日の行がない（転記で全員分が入るので、ここでは何もしない）
  const current = findSchedulesOfDate_(workDate);
  if (current.length === 0) return "明日の勤務がまだ勤務管理に転記されていないため、何もしませんでした。";

  const planned = new Map(findShiftAssignmentsOfRow_(tomorrowRow).map(x => [x.staffName, x])); // 氏名 → 割り当て
  const currentNames = new Set(current.map(x => x.staffName));

  const changed = current.filter(x => planned.has(x.staffName) && planned.get(x.staffName).storeName !== x.storeName);
  const added = [...planned.values()].filter(x => !currentNames.has(x.staffName));
  const removed = current.filter(x => !planned.has(x.staffName));
  if (changed.length + added.length + removed.length === 0) {
    return "シフト表と勤務管理に違いはありませんでした。";
  }

  // 店舗詳細にない店舗があれば、途中まで書き換えないよう先に止める
  const stores = getRepositories().stores;
  const unknownStores = [...new Set(
    changed.map(x => planned.get(x.staffName).storeName)
      .concat(added.map(x => x.storeName))
      .filter(storeName => !stores.findByStoreName(storeName))
  )];
  if (unknownStores.length > 0) {
    return `店舗詳細にない店舗があるため、中断しました：${unknownStores.join(", ")}`;
  }

  // 勤務管理へ反映（上書き → 追加 → 削除の順。削除は下の行から行うので、ほかの行番号に影響しない）
  const schedules = getRepositories().schedules;
  const changedSchedules = changed.map(before => {
    const schedule = scheduleFromAssignment_(planned.get(before.staffName), workDate);
    schedule.rowNumber = before.rowNumber;
    schedule.prevCheck = ""; // 前日確認済みでも、確認し直してもらう
    schedules.updateShift(schedule);
    return schedule;
  });
  const addedSchedules = added.map(assignment => scheduleFromAssignment_(assignment, workDate));
  schedules.addRange(addedSchedules);
  schedules.deleteRows(removed);

  // 本人へ送る
  const sentCount =
    changedSchedules.concat(addedSchedules).filter(x => sendChangedShiftCheck_(x, workDate)).length +
    removed.filter(x => sendCanceledShift_(x, tomorrow)).length;

  writeLog("SYSTEM", "resendChangedShifts", "SUCCESS", {
    workDate,
    changed: changedSchedules.map(x => `${x.staffName}:${x.storeName}`),
    added: addedSchedules.map(x => `${x.staffName}:${x.storeName}`),
    removed: removed.map(x => `${x.staffName}:${x.storeName}`),
    sentCount,
  });
  return `変更${changed.length}名・追加${added.length}名・取消${removed.length}名を反映し、${sentCount}名に送信しました。`;
}

/** 「【変更】前日確認」を送る（送れたら true。アラートOFFの店舗・LINE未登録の人には送らない） */
function sendChangedShiftCheck_(schedule, workDate) {
  if (!canNotify_(schedule)) return false;

  const definition = Object.assign({}, alertDefinition_(ALERT_TYPE.PREVIOUS), {
    title: "【変更】前日確認",
    altText: "【変更】前日の勤務確認：",
  });
  const target = {
    userId: schedule.userId,
    userName: schedule.staffName,
    storeName: schedule.storeName,
    checkInTime: schedule.checkInTime,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  };
  const message = confirmFlexMessage(
    definition.altText + workDate,
    staffAlertBodyFor_(ALERT_TYPE.PREVIOUS, definition, target, workDate),
    definition.confirmPrefix + workDate
  );
  return getLineClient().pushOrLogError(schedule.userId, [message], "resendChangedShifts", { workDate });
}

/** 「勤務はなくなりました」を送る（送れたら true。アラートOFFの店舗・LINE未登録の人には送らない） */
function sendCanceledShift_(schedule, tomorrow) {
  if (!canNotify_(schedule)) return false;

  const date = Utilities.formatDate(tomorrow, "JST", "M/d");
  const text = `【変更】明日（${date}）の${schedule.storeName}への勤務はなくなりました。`;
  return getLineClient().pushOrLogError(schedule.userId, [textMessage(text)], "resendChangedShifts", { workDate: toJstSlashDate(tomorrow) });
}

/** 通知してよい人か（LINEユーザーIDがあり、店舗のアラートがOFFでない） */
function canNotify_(schedule) {
  if (!schedule.userId || schedule.userId === UNREGISTERED_USER_ID) return false;
  const store = getRepositories().stores.findByStoreName(schedule.storeName);
  return !(store && store.isAlertOff);
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
