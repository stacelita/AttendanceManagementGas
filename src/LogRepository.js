/**
 * LOGシート
 *
 * ヘッダー：1行目
 */

// 列の位置（0始まり）
const LOG_COLUMN = {
  LOGGED_AT: 0,  // A: 日時
  USER_ID: 1,    // B: LINEユーザーID
  ACTION: 2,     // C: 処理名
  LEVEL: 3,      // D: レベル（SUCCESS / ERROR）
  CONTENT: 4,    // E: 内容
};
const LOG_HEADER_ROWS = 1;

/**
 * ログ 1行
 */
class LogEntry {
  constructor() {
    this.rowNumber = null;  // シート上の行番号
    this.loggedAt = "";     // A: 日時
    this.userId = "";       // B: LINEユーザーID
    this.action = "";       // C: 処理名
    this.level = "";        // D: レベル
    this.content = "";      // E: 内容
  }

  static fromRow(row, rowNumber) {
    const entry = new LogEntry();
    entry.rowNumber = rowNumber;
    entry.loggedAt = row[LOG_COLUMN.LOGGED_AT];
    entry.userId = row[LOG_COLUMN.USER_ID];
    entry.action = row[LOG_COLUMN.ACTION];
    entry.level = row[LOG_COLUMN.LEVEL];
    entry.content = row[LOG_COLUMN.CONTENT];
    return entry;
  }

  toRow() {
    return [this.loggedAt, this.userId, this.action, this.level, this.content];
  }
}

class LogRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
  }

  /**
   * 全件取得（件数が多くなるシートのため、必要なときだけ使う）
   * @return {LogEntry[]}
   */
  findAll() {
    return this._sheet().getDataRange().getValues()
      .slice(LOG_HEADER_ROWS)
      .map((row, i) => LogEntry.fromRow(row, i + LOG_HEADER_ROWS + 1));
  }

  /**
   * 追加（最終行の後ろに追記）
   */
  add(entry) {
    this._sheet().appendRow(entry.toRow());
  }

  _sheet() {
    return getSheet(this.spreadsheetId, SHEETS.LOG);
  }
}
