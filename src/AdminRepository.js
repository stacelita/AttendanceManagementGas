/**
 * 管理者シート
 *
 * ヘッダー：1行目
 */

// 列の位置（0始まり）
const ADMIN_COLUMN = {
  ADMIN_NAME: 0,      // A: 管理者氏名（プルダウン）
  USER_ID: 1,         // B: LINEユーザーID
  TANTOSHA_SCOPE: 2,  // C: 担当範囲（ALL またはカンマ区切りの担当者コード）
};
const ADMIN_HEADER_ROWS = 1;

// 担当範囲：全員
const ADMIN_SCOPE_ALL = "ALL";

/**
 * 管理者 1行
 */
class Admin {
  constructor() {
    this.rowNumber = null;    // シート上の行番号
    this.adminName = "";      // A: 管理者氏名
    this.userId = "";         // B: LINEユーザーID
    this.tantoshaScope = "";  // C: 担当範囲（セルの値そのまま）
  }

  /** 全スタッフ担当か（大文字小文字を区別しない） */
  get isAllScope() {
    return String(this.tantoshaScope || "").toUpperCase() === ADMIN_SCOPE_ALL;
  }

  /** 担当者コードの一覧（全員担当の場合は空配列） */
  get tantoshaCodes() {
    return this.isAllScope ? [] : String(this.tantoshaScope || "").split(",");
  }

  /** 指定の担当者コードのスタッフを担当しているか */
  isInCharge(tantoshaCode) {
    return this.isAllScope || this.tantoshaCodes.includes(String(tantoshaCode));
  }

  static fromRow(row, rowNumber) {
    const admin = new Admin();
    admin.rowNumber = rowNumber;
    admin.adminName = row[ADMIN_COLUMN.ADMIN_NAME];
    admin.userId = row[ADMIN_COLUMN.USER_ID];
    admin.tantoshaScope = row[ADMIN_COLUMN.TANTOSHA_SCOPE];
    return admin;
  }
}

class AdminRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._all = null;
  }

  /**
   * 全件取得
   * @return {Admin[]}
   */
  findAll() {
    if (!this._all) {
      this._all = readSheetValues(this.spreadsheetId, SHEETS.ADMIN)
        .slice(ADMIN_HEADER_ROWS)
        .map((row, i) => Admin.fromRow(row, i + ADMIN_HEADER_ROWS + 1));
    }
    return this._all;
  }

  /**
   * LINEユーザーIDで取得
   * @return {Admin|null}
   */
  findByUserId(userId) {
    return this.findAll().find(x => x.userId === userId) ?? null;
  }
}
