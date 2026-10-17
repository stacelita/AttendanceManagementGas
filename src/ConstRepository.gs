/**
 * 定数シート
 *
 * ヘッダー：1行目
 * 区分ID=3 は通知テンプレート（項目値=ALERT_MESSAGE、項目名=本文テンプレート）
 */

// 列の位置（0始まり）
const CONST_COLUMN = {
  CATEGORY_ID: 0,   // A: 区分ID
  CATEGORY_NAME: 1, // B: 区分名
  ITEM_VALUE: 2,    // C: 項目値
  ITEM_NAME: 3,     // D: 項目名
};
const CONST_HEADER_ROWS = 1;

// 区分ID
const CONST_CATEGORY_ID = {
  ALERT_TEMPLATE: 3,  // 通知テンプレート
};

/**
 * 定数 1行
 */
class ConstItem {
  constructor() {
    this.rowNumber = null;   // シート上の行番号
    this.categoryId = "";    // A: 区分ID
    this.categoryName = "";  // B: 区分名
    this.itemValue = "";     // C: 項目値
    this.itemName = "";      // D: 項目名
  }

  static fromRow(row, rowNumber) {
    const item = new ConstItem();
    item.rowNumber = rowNumber;
    item.categoryId = row[CONST_COLUMN.CATEGORY_ID];
    item.categoryName = row[CONST_COLUMN.CATEGORY_NAME];
    item.itemValue = row[CONST_COLUMN.ITEM_VALUE];
    item.itemName = row[CONST_COLUMN.ITEM_NAME];
    return item;
  }
}

class ConstRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._all = null;
  }

  /**
   * 全件取得
   * @return {ConstItem[]}
   */
  findAll() {
    if (!this._all) {
      this._all = readSheetValues(this.spreadsheetId, SHEETS.CONST)
        .slice(CONST_HEADER_ROWS)
        .map((row, i) => ConstItem.fromRow(row, i + CONST_HEADER_ROWS + 1));
    }
    return this._all;
  }
}
