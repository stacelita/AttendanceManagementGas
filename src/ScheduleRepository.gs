/**
 * 勤務管理シート（日ごとの勤務予定）
 *
 * ヘッダー：1行目
 * A〜G列は updateWorkManagement で「シフト表(編集)」からテキスト書式で転記される
 */

// 列の位置（0始まり）
const SCHEDULE_COLUMN = {
  USER_ID: 0,         // A: LINEユーザーID
  STAFF_NAME: 1,      // B: 氏名
  WORK_DATE: 2,       // C: 勤務日（yyyy/MM/dd）
  STORE_NAME: 3,      // D: 店舗名
  CHECK_IN_TIME: 4,   // E: 入り時間
  START_TIME: 5,      // F: 開始時間
  END_TIME: 6,        // G: 終了時間
  PREV_CHECK: 7,      // H: 前日確認
  TODAY_CHECK: 8,     // I: 当日確認
  ACHIEVE_STATUS: 9,  // J: 実績入力状況
};
const SCHEDULE_HEADER_ROWS = 1;

// 実績入力状況（J列）
const SCHEDULE_ACHIEVE_STATUS = {
  DONE: "入力済み",
};

/**
 * 勤務予定 1行
 */
class Schedule {
  constructor() {
    this.rowNumber = null;    // シート上の行番号（更新用）
    this.userId = "";         // A: LINEユーザーID
    this.staffName = "";      // B: 氏名
    this.workDate = "";       // C: 勤務日
    this.storeName = "";      // D: 店舗名
    this.checkInTime = "";    // E: 入り時間
    this.startTime = "";      // F: 開始時間
    this.endTime = "";        // G: 終了時間
    this.prevCheck = "";      // H: 前日確認
    this.todayCheck = "";     // I: 当日確認
    this.achieveStatus = "";  // J: 実績入力状況
  }

  static fromRow(row, rowNumber) {
    const schedule = new Schedule();
    schedule.rowNumber = rowNumber;
    schedule.userId = row[SCHEDULE_COLUMN.USER_ID];
    schedule.staffName = row[SCHEDULE_COLUMN.STAFF_NAME];
    schedule.workDate = row[SCHEDULE_COLUMN.WORK_DATE];
    schedule.storeName = row[SCHEDULE_COLUMN.STORE_NAME];
    schedule.checkInTime = row[SCHEDULE_COLUMN.CHECK_IN_TIME];
    schedule.startTime = row[SCHEDULE_COLUMN.START_TIME];
    schedule.endTime = row[SCHEDULE_COLUMN.END_TIME];
    schedule.prevCheck = row[SCHEDULE_COLUMN.PREV_CHECK];
    schedule.todayCheck = row[SCHEDULE_COLUMN.TODAY_CHECK];
    schedule.achieveStatus = row[SCHEDULE_COLUMN.ACHIEVE_STATUS];
    return schedule;
  }

  /** 新規追加時に書き込む列（A〜G） */
  toNewRow() {
    return [
      this.userId,
      this.staffName,
      this.workDate,
      this.storeName,
      this.checkInTime,
      this.startTime,
      this.endTime,
    ];
  }
}

class ScheduleRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._all = null;
  }

  /**
   * 全件取得
   * @return {Schedule[]}
   */
  findAll() {
    if (!this._all) {
      this._all = readSheetValues(this.spreadsheetId, SHEETS.SCHEDULE)
        .slice(SCHEDULE_HEADER_ROWS)
        .map((row, i) => Schedule.fromRow(row, i + SCHEDULE_HEADER_ROWS + 1));
    }
    return this._all;
  }

  /**
   * まとめて追加（A〜G列をテキスト書式で最終行の後ろに書き込む）
   * @param {Schedule[]} schedules
   */
  addRange(schedules) {
    if (schedules.length === 0) return;
    const sheet = this._sheet();
    const rows = schedules.map(x => x.toNewRow());
    const range = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length);
    range.setNumberFormat("@");
    range.setValues(rows);
    this._all = null;
    forgetSheetValues(this.spreadsheetId, SHEETS.SCHEDULE);
  }

  /** 前日確認（H列）を更新 */
  updatePrevCheck(schedule) {
    this._updateCell(schedule.rowNumber, SCHEDULE_COLUMN.PREV_CHECK, schedule.prevCheck);
  }

  /** 当日確認（I列）を更新 */
  updateTodayCheck(schedule) {
    this._updateCell(schedule.rowNumber, SCHEDULE_COLUMN.TODAY_CHECK, schedule.todayCheck);
  }

  /** 実績入力状況（J列）を更新 */
  updateAchieveStatus(schedule) {
    this._updateCell(schedule.rowNumber, SCHEDULE_COLUMN.ACHIEVE_STATUS, schedule.achieveStatus);
  }

  _updateCell(rowNumber, column, value) {
    this._sheet().getRange(rowNumber, column + 1).setValue(value);
    this._all = null;
    forgetSheetValues(this.spreadsheetId, SHEETS.SCHEDULE);
  }

  _sheet() {
    return getSheet(this.spreadsheetId, SHEETS.SCHEDULE);
  }
}
