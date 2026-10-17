/**
 * 店舗詳細シート
 *
 * ヘッダー：1行目
 */

// 列の位置（0始まり）
const STORE_COLUMN = {
  STORE_NAME: 0,    // A: 店舗名
  CHECK_IN_TIME: 1, // B: 入り時間
  START_TIME: 2,    // C: 開始時間
  END_TIME: 3,      // D: 終了時間
  STORE_ALERT_FLAG: 4,     // E: アラートフラグ（ON/OFF）
  DETAIL: 5,        // F: 詳細
};
const STORE_HEADER_ROWS = 1;

/**
 * 店舗 1行
 */
class Store {
  constructor() {
    this.rowNumber = null;   // シート上の行番号
    this.storeName = "";     // A: 店舗名
    this.checkInTime = "";   // B: 入り時間
    this.startTime = "";     // C: 開始時間
    this.endTime = "";       // D: 終了時間
    this.alertFlg = "";      // E: アラートフラグ（ON/OFF）
    this.detail = "";        // F: 詳細
  }

  /** アラートOFFの店舗か */
  get isAlertOff() {
    return this.alertFlg === STORE_ALERT_FLAG.OFF;
  }

  static fromRow(row, rowNumber) {
    const store = new Store();
    store.rowNumber = rowNumber;
    store.storeName = row[STORE_COLUMN.STORE_NAME];
    store.checkInTime = row[STORE_COLUMN.CHECK_IN_TIME];
    store.startTime = row[STORE_COLUMN.START_TIME];
    store.endTime = row[STORE_COLUMN.END_TIME];
    store.alertFlg = row[STORE_COLUMN.STORE_ALERT_FLAG];
    store.detail = row[STORE_COLUMN.DETAIL];
    return store;
  }
}

class StoreRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._all = null;
  }

  /**
   * 全件取得
   * @return {Store[]}
   */
  findAll() {
    if (!this._all) {
      this._all = readSheetValues(this.spreadsheetId, SHEETS.STORE)
        .slice(STORE_HEADER_ROWS)
        .map((row, i) => Store.fromRow(row, i + STORE_HEADER_ROWS + 1));
    }
    return this._all;
  }

  /**
   * 店舗名で取得（店舗名が空の行は対象外）
   * @return {Store|null}
   */
  findByStoreName(storeName) {
    return this.findAll().find(x => x.storeName && x.storeName === storeName) ?? null;
  }
}
