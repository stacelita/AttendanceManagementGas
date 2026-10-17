/**
 * 希望休(編集)シート
 *
 * 縦横の表：1行目 = ヘッダー、A列 = 日付（2行目〜）、各セル = スタッフ氏名（プルダウン）
 * 1セル = 1件（HolidayRequest）として平らな配列に展開して扱う
 */

const HOLIDAY_HEADER_ROWS = 1;
const HOLIDAY_DATE_COLUMN = 0;  // A: 日付

/**
 * 希望休（表の1セル）
 */
class HolidayRequest {
  constructor() {
    this.rowNumber = null;     // シート上の行番号
    this.columnNumber = null;  // シート上の列番号
    this.date = "";            // A列の日付（セルの値そのまま）
    this.staffName = "";       // セルの氏名
  }
}

class HolidayRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._all = null;
  }

  /**
   * 氏名が入っているセルを全件取得
   * @return {HolidayRequest[]}
   */
  findAll() {
    if (!this._all) {
      const values = readSheetValues(this.spreadsheetId, SHEETS.HOLIDAY);
      const requests = [];

      values.slice(HOLIDAY_HEADER_ROWS).forEach((row, i) => {
        for (let col = HOLIDAY_DATE_COLUMN + 1; col < row.length; col++) {
          if (row[col] === "" || row[col] === null) continue;
          const request = new HolidayRequest();
          request.rowNumber = i + HOLIDAY_HEADER_ROWS + 1;
          request.columnNumber = col + 1;
          request.date = row[HOLIDAY_DATE_COLUMN];
          request.staffName = row[col];
          requests.push(request);
        }
      });
      this._all = requests;
    }
    return this._all;
  }
}
