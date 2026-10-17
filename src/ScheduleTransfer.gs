/**
 * シフトの転記（トリガーから呼ばれる）
 * 「シフト表(編集)」の明日の行から、勤務管理に明日の勤務予定を追加する
 */

// スタッフマスタに氏名が見つからないスタッフの、勤務管理の LINEユーザーID 欄
const UNREGISTERED_USER_ID = "未登録";

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

  const tomorrowRow = findShiftRowOfDate_(tomorrow);
  if (!tomorrowRow) {
    console.error("明日の日付がシフト表に見つかりませんでした。");
    return false;
  }
  const workDate = toJstSlashDate(tomorrow);

  // 勤務管理に転記済みの明日の勤務（2回実行しても同じ行を重ねて追加しないため）
  const scheduleKey = (staffName, storeName) => `${staffName}\t${storeName}`;
  const transferred = new Set(findSchedulesOfDate_(workDate).map(x => scheduleKey(x.staffName, x.storeName)));

  // 明日の行のセルを左の列から順に（まだ転記していないもの）
  const newSchedules = findShiftAssignmentsOfRow_(tomorrowRow)
    .filter(x => !transferred.has(scheduleKey(x.staffName, x.storeName)))
    .map(assignment => scheduleFromAssignment_(assignment, workDate));

  if (newSchedules.length > 0) {
    getRepositories().schedules.addRange(newSchedules);
    console.log("書き込みが完了しました。件数: " + newSchedules.length);
  } else if (transferred.size > 0) {
    console.log("明日の勤務はすでに転記済みのため、追加しませんでした。");
  }
  return true;
}

// --- シフト表と勤務管理の共通処理（シフト変更の再送でも使う） ---

/** シフト表の指定日の行（同じ日付が複数行あれば最初の行）。なければ undefined */
function findShiftRowOfDate_(date) {
  return getRepositories().shiftTable.findAllDates()
    .find(x => toJstCompactDate(new Date(x.date)) === toJstCompactDate(date));
}

/** シフト表の指定の行の割り当て（店舗名と氏名の両方があるもの。左の列から順） */
function findShiftAssignmentsOfRow_(shiftRow) {
  return getRepositories().shiftTable.findAll()
    .filter(x => x.rowNumber === shiftRow.rowNumber && x.storeName && x.staffName);
}

/** 勤務管理の指定日（yyyy/MM/dd）の行 */
function findSchedulesOfDate_(workDate) {
  return getRepositories().schedules.findAll()
    .filter(x => x.workDate && toJstSlashDate(x.workDate) === workDate);
}

/**
 * シフト表の割り当てから、勤務管理の1行を作る（時刻は店舗詳細のもの）
 * 店舗詳細にない店舗名だと例外になる（既知の不具合 #7）
 */
function scheduleFromAssignment_(assignment, workDate) {
  const repos = getRepositories();
  const store = repos.stores.findByStoreName(assignment.storeName);
  const schedule = new Schedule();
  schedule.userId = repos.staffs.findAll().find(x => x.name === assignment.staffName && x.userId)?.userId || UNREGISTERED_USER_ID;
  schedule.staffName = assignment.staffName;
  schedule.workDate = workDate;
  schedule.storeName = assignment.storeName;
  schedule.checkInTime = toJstHourMinute(store.checkInTime);
  schedule.startTime = toJstHourMinute(store.startTime);
  schedule.endTime = toJstHourMinute(store.endTime);
  return schedule;
}
