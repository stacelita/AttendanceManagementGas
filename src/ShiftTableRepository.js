/**
 * シフト表(編集)シート
 *
 * 縦横の表：1行目 = 店舗名（B列〜）、A列 = 日付（2行目〜）、各セル = スタッフ氏名（プルダウン）
 * 1セル = 1件（ShiftAssignment）として平らな配列に展開して扱う
 */

const SHIFT_TABLE_HEADER_ROWS = 1;
const SHIFT_TABLE_DATE_COLUMN = 0;  // A: 日付

/**
 * シフト割り当て（表の1セル）
 */
class ShiftAssignment {
  constructor() {
    this.rowNumber = null;     // シート上の行番号
    this.columnNumber = null;  // シート上の列番号
    this.date = "";            // A列の日付（セルの値そのまま）
    this.storeName = "";       // 1行目の店舗名
    this.staffName = "";       // セルの氏名
  }
}

/**
 * シフト表の日付行（A列）
 */
class ShiftDate {
  constructor() {
    this.rowNumber = null;  // シート上の行番号
    this.date = "";         // A列の日付（セルの値そのまま）
  }
}

class ShiftTableRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._values = null;
    this._all = null;
  }

  /**
   * 氏名が入っているセルを全件取得
   * @return {ShiftAssignment[]}
   */
  findAll() {
    if (!this._all) {
      const values = this._getValues();
      const storeNames = values[0] || [];
      const assignments = [];

      values.slice(SHIFT_TABLE_HEADER_ROWS).forEach((row, i) => {
        for (let col = SHIFT_TABLE_DATE_COLUMN + 1; col < row.length; col++) {
          if (row[col] === "" || row[col] === null) continue;
          const assignment = new ShiftAssignment();
          assignment.rowNumber = i + SHIFT_TABLE_HEADER_ROWS + 1;
          assignment.columnNumber = col + 1;
          assignment.date = row[SHIFT_TABLE_DATE_COLUMN];
          assignment.storeName = storeNames[col];
          assignment.staffName = row[col];
          assignments.push(assignment);
        }
      });
      this._all = assignments;
    }
    return this._all;
  }

  /**
   * A列の日付行を全件取得（シフトが空の日・日付が空の行も含む）
   * @return {ShiftDate[]}
   */
  findAllDates() {
    return this._getValues().slice(SHIFT_TABLE_HEADER_ROWS).map((row, i) => {
      const shiftDate = new ShiftDate();
      shiftDate.rowNumber = i + SHIFT_TABLE_HEADER_ROWS + 1;
      shiftDate.date = row[SHIFT_TABLE_DATE_COLUMN];
      return shiftDate;
    });
  }

  /**
   * 指定の氏名がシフトに入っている店舗名の一覧（重複なし、表の上の行・左の列から順）
   * @return {string[]}
   */
  findStoreNamesByStaffName(staffName) {
    return [...new Set(
      this.findAll()
        .filter(x => x.staffName === staffName && x.storeName)
        .map(x => x.storeName)
    )];
  }

  /**
   * 1行目の店舗名を取得（B列〜）
   * @return {string[]}
   */
  findStoreNames() {
    return (this._getValues()[0] || []).slice(SHIFT_TABLE_DATE_COLUMN + 1);
  }

  _getValues() {
    if (!this._values) {
      this._values = readSheetValues(this.spreadsheetId, SHEETS.SHIFT_TABLE);
    }
    return this._values;
  }
}
