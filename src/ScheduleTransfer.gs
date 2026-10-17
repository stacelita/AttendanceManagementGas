/**
 * シフトの転記（トリガーから呼ばれる）
 * 「シフト表(編集)」の明日の行から、勤務管理に明日の勤務予定を追加する
 */

/**
 * 全部署の明日のシフトを勤務管理へ転記し、すべて転記できたら自身のトリガーを削除する
 * ※関数名はトリガーに登録されているため変えないこと
 */
function updateWorkManagement() {
  const results = runForAllDepartments(() => transferTomorrowShifts_());

  // 明日の行が見つからなかった部署があれば、トリガーを残す
  if (results.every(x => x.value)) {
    deleteTrigger(updateWorkManagement.name);
  }
}

/**
 * 処理中の部署のシフト表から、明日の勤務予定を勤務管理へ転記する
 * @return {boolean} 明日の行が見つかれば true
 */
function transferTomorrowShifts_() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 明日の行（同じ日付が複数行あれば最初の行）
  const shiftTable = getRepositories().shiftTable;
  const tomorrowRow = shiftTable.findAllDates()
    .find(x => toJstCompactDate(new Date(x.date)) === toJstCompactDate(tomorrow));
  if (!tomorrowRow) {
    console.error("明日の日付がシフト表に見つかりませんでした。");
    return false;
  }

  const staffs = getRepositories().staffs.findAll();
  const stores = getRepositories().stores;
  const workDate = toJstSlashDate(tomorrow);

  // 勤務管理に転記済みの明日の勤務（2回実行しても同じ行を重ねて追加しないため）
  const scheduleKey = (staffName, storeName) => `${staffName}\t${storeName}`;
  const transferred = new Set(getRepositories().schedules.findAll()
    .filter(x => x.workDate && toJstSlashDate(x.workDate) === workDate)
    .map(x => scheduleKey(x.staffName, x.storeName)));

  // 明日の行のセルを左の列から順に（店舗名と氏名の両方があり、まだ転記していないもの）
  const newSchedules = shiftTable.findAll()
    .filter(x => x.rowNumber === tomorrowRow.rowNumber && x.storeName && x.staffName)
    .filter(x => !transferred.has(scheduleKey(x.staffName, x.storeName)))
    .map(assignment => {
      // 店舗詳細にない店舗名だと例外になる（既知の不具合 #7）
      const store = stores.findByStoreName(assignment.storeName);
      const schedule = new Schedule();
      schedule.userId = staffs.find(x => x.name === assignment.staffName && x.userId)?.userId || "未登録";
      schedule.staffName = assignment.staffName;
      schedule.workDate = workDate;
      schedule.storeName = assignment.storeName;
      schedule.checkInTime = toJstHourMinute(store.checkInTime);
      schedule.startTime = toJstHourMinute(store.startTime);
      schedule.endTime = toJstHourMinute(store.endTime);
      return schedule;
    });

  if (newSchedules.length > 0) {
    getRepositories().schedules.addRange(newSchedules);
    console.log("書き込みが完了しました。件数: " + newSchedules.length);
  } else if (transferred.size > 0) {
    console.log("明日の勤務はすでに転記済みのため、追加しませんでした。");
  }
  return true;
}
