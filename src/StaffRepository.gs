/**
 * スタッフマスタシート
 *
 * ヘッダー：1行目
 */

// 列の位置（0始まり）
const STAFF_COLUMN = {
  USER_ID: 0,        // A: LINEユーザーID
  LINE_NAME: 1,      // B: LINE表示名
  FOLLOWED_AT: 2,    // C: 友だち追加日時
  TANTOSHA_CODE: 3,  // D: 担当者コード
  NAME: 4,           // E: 氏名
  NAME_KANA: 5,      // F: フリガナ
  BIRTHDAY: 6,       // G: 生年月日
  STATION: 7,        // H: 最寄駅
  TEL: 8,            // I: 電話番号
  STATUS: 9,         // J: 有効/無効（プルダウン）
};
const STAFF_HEADER_ROWS = 1;

// 状態（J列）のプルダウン
const STAFF_STATUS = {
  ACTIVE: "有効",
  INACTIVE: "無効",
};

/**
 * スタッフ 1行
 */
class Staff {
  constructor() {
    this.rowNumber = null;    // シート上の行番号（更新用）
    this.userId = "";         // A: LINEユーザーID
    this.lineName = "";       // B: LINE表示名
    this.followedAt = "";     // C: 友だち追加日時
    this.tantoshaCode = "";   // D: 担当者コード
    this.name = "";           // E: 氏名
    this.nameKana = "";       // F: フリガナ
    this.birthday = "";       // G: 生年月日
    this.station = "";        // H: 最寄駅
    this.tel = "";            // I: 電話番号
    this.status = "";         // J: 有効/無効
  }

  static fromRow(row, rowNumber) {
    const staff = new Staff();
    staff.rowNumber = rowNumber;
    staff.userId = row[STAFF_COLUMN.USER_ID];
    staff.lineName = row[STAFF_COLUMN.LINE_NAME];
    staff.followedAt = row[STAFF_COLUMN.FOLLOWED_AT];
    staff.tantoshaCode = row[STAFF_COLUMN.TANTOSHA_CODE];
    staff.name = row[STAFF_COLUMN.NAME];
    staff.nameKana = row[STAFF_COLUMN.NAME_KANA];
    staff.birthday = row[STAFF_COLUMN.BIRTHDAY];
    staff.station = row[STAFF_COLUMN.STATION];
    staff.tel = row[STAFF_COLUMN.TEL];
    staff.status = row[STAFF_COLUMN.STATUS];
    return staff;
  }

  toRow() {
    const row = [];
    row[STAFF_COLUMN.USER_ID] = this.userId;
    row[STAFF_COLUMN.LINE_NAME] = this.lineName;
    row[STAFF_COLUMN.FOLLOWED_AT] = this.followedAt;
    row[STAFF_COLUMN.TANTOSHA_CODE] = this.tantoshaCode;
    row[STAFF_COLUMN.NAME] = this.name;
    row[STAFF_COLUMN.NAME_KANA] = this.nameKana;
    row[STAFF_COLUMN.BIRTHDAY] = this.birthday;
    row[STAFF_COLUMN.STATION] = this.station;
    row[STAFF_COLUMN.TEL] = this.tel;
    row[STAFF_COLUMN.STATUS] = this.status;
    return row;
  }
}

class StaffRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._all = null;
  }

  /**
   * 全件取得
   * @return {Staff[]}
   */
  findAll() {
    if (!this._all) {
      this._all = readSheetValues(this.spreadsheetId, SHEETS.STAFF)
        .slice(STAFF_HEADER_ROWS)
        .map((row, i) => Staff.fromRow(row, i + STAFF_HEADER_ROWS + 1));
    }
    return this._all;
  }

  /**
   * LINEユーザーIDで取得
   * @return {Staff|null}
   */
  findByUserId(userId) {
    return this.findAll().find(x => x.userId === userId) ?? null;
  }

  /**
   * 氏名で取得
   * @return {Staff|null}
   */
  findByName(name) {
    return this.findAll().find(x => x.name === name) ?? null;
  }

  /**
   * 追加（最終行の後ろに追記。値のない末尾の列は書き込まない）
   */
  add(staff) {
    this._sheet().appendRow(trimTrailingEmpty(staff.toRow()));
    this._all = null;
    forgetSheetValues(this.spreadsheetId, SHEETS.STAFF);
  }

  /**
   * スタッフ情報（E〜I列：テキスト書式）と状態（J列：プルダウン設定）を更新
   */
  updateProfile(staff) {
    const sheet = this._sheet();

    const profileRange = sheet.getRange(staff.rowNumber, STAFF_COLUMN.NAME + 1, 1, 5);
    profileRange.setNumberFormat("@");
    profileRange.setValues([[staff.name, staff.nameKana, staff.birthday, staff.station, staff.tel]]);

    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList([STAFF_STATUS.ACTIVE, STAFF_STATUS.INACTIVE], true)
      .setAllowInvalid(false)
      .build();
    const statusCell = sheet.getRange(staff.rowNumber, STAFF_COLUMN.STATUS + 1);
    statusCell.setDataValidation(statusRule);
    statusCell.setValue(staff.status);

    this._all = null;
    forgetSheetValues(this.spreadsheetId, SHEETS.STAFF);
  }

  _sheet() {
    return getSheet(this.spreadsheetId, SHEETS.STAFF);
  }
}
