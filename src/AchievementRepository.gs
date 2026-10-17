/**
 * 勤務実績シート
 *
 * 1〜9行目：別マクロ用の条件（このリポジトリでは扱わない）
 * 10行目  ：ヘッダー（J列以降は商品名）
 * 11行目〜：データ
 * J列以降 ：G列（items のJSON）から商品ごとの数量を取り出す数式
 */

// 列の位置（0始まり）
const ACHIEVEMENT_COLUMN = {
  REGISTERED_AT: 0,    // A: 登録日時
  USER_ID: 1,          // B: LINEユーザーID
  STAFF_NAME: 2,       // C: 氏名
  WORK_DATE: 3,        // D: 勤務日
  STORE_NAME: 4,       // E: 店舗名
  CATEGORY_VALUE: 5,   // F: 区分値
  ITEMS: 6,            // G: 実績明細（JSON文字列）
  UNIQUE_PRODUCTS: 7,  // H: 独自商品
  MEMO: 8,             // I: メモ
  PRODUCT_START: 9,    // J: ここから右は商品ごとの数量（数式）
};
const ACHIEVEMENT_HEADER_ROW = 10;
const ACHIEVEMENT_DATA_START_ROW = ACHIEVEMENT_HEADER_ROW + 1;

/**
 * 勤務実績 1行
 */
class Achievement {
  constructor() {
    this.rowNumber = null;      // シート上の行番号（更新用）
    this.registeredAt = "";     // A: 登録日時
    this.userId = "";           // B: LINEユーザーID
    this.staffName = "";        // C: 氏名
    this.workDate = "";         // D: 勤務日
    this.storeName = "";        // E: 店舗名
    this.categoryValue = "";    // F: 区分値
    this.items = "";            // G: 実績明細（JSON文字列）
    this.uniqueProducts = "";   // H: 独自商品
    this.memo = "";             // I: メモ
    this.productCounts = {};    // J〜: 商品名 → 数量（数式の計算結果。読み取り専用）
  }

  static fromRow(row, rowNumber, productNames) {
    const achievement = new Achievement();
    achievement.rowNumber = rowNumber;
    achievement.registeredAt = row[ACHIEVEMENT_COLUMN.REGISTERED_AT];
    achievement.userId = row[ACHIEVEMENT_COLUMN.USER_ID];
    achievement.staffName = row[ACHIEVEMENT_COLUMN.STAFF_NAME];
    achievement.workDate = row[ACHIEVEMENT_COLUMN.WORK_DATE];
    achievement.storeName = row[ACHIEVEMENT_COLUMN.STORE_NAME];
    achievement.categoryValue = row[ACHIEVEMENT_COLUMN.CATEGORY_VALUE];
    achievement.items = row[ACHIEVEMENT_COLUMN.ITEMS];
    achievement.uniqueProducts = row[ACHIEVEMENT_COLUMN.UNIQUE_PRODUCTS];
    achievement.memo = row[ACHIEVEMENT_COLUMN.MEMO];
    productNames.forEach((name, i) => {
      achievement.productCounts[name] = row[ACHIEVEMENT_COLUMN.PRODUCT_START + i];
    });
    return achievement;
  }

  /** 書き込み対象の列（A〜I） */
  toRow() {
    return [
      this.registeredAt,
      this.userId,
      this.staffName,
      this.workDate,
      this.storeName,
      this.categoryValue,
      this.items,
      this.uniqueProducts,
      this.memo,
    ];
  }
}

/**
 * 「登録済みか」の確認で読む範囲（B11:D：userId〜勤務日）
 */
function achievementKeysA1() {
  const firstCol = ACHIEVEMENT_COLUMN.USER_ID + 1;
  const lastCol = ACHIEVEMENT_COLUMN.WORK_DATE + 1;
  return `${columnNumberToLetter(firstCol)}${ACHIEVEMENT_DATA_START_ROW}:${columnNumberToLetter(lastCol)}`;
}

class AchievementRepository {
  /**
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._all = null;
    this._keys = null;
  }

  /**
   * 全件取得（11行目以降）
   * @return {Achievement[]}
   */
  findAll() {
    if (!this._all) {
      const values = readSheetValues(this.spreadsheetId, SHEETS.ARCHIVE);
      const productNames = AchievementRepository._productNames(values[ACHIEVEMENT_HEADER_ROW - 1] || []);
      this._all = values
        .slice(ACHIEVEMENT_DATA_START_ROW - 1)
        .map((row, i) => Achievement.fromRow(row, i + ACHIEVEMENT_DATA_START_ROW, productNames));
    }
    return this._all;
  }

  /**
   * 「同じ人・同じ勤務日の実績があるか」の確認用に、B〜D列（userId〜勤務日）だけを読む
   * （勤務実績は列が多く全件の読み込みに時間がかかるため。末尾の空行も含む）
   * @return {Array<{rowNumber: number, userId: *, workDate: *}>}
   */
  findAllKeys() {
    if (!this._keys) {
      this._keys = readRangeValues(this.spreadsheetId, SHEETS.ARCHIVE, achievementKeysA1()).map((row, i) => ({
        rowNumber: i + ACHIEVEMENT_DATA_START_ROW,
        userId: row[0],
        workDate: row[ACHIEVEMENT_COLUMN.WORK_DATE - ACHIEVEMENT_COLUMN.USER_ID],
      }));
    }
    return this._keys;
  }

  /**
   * 追加（A〜Iを最終行の後ろに追記し、J列以降に数式を設定）
   */
  add(achievement) {
    const sheet = this._sheet();
    sheet.appendRow(achievement.toRow());
    achievement.rowNumber = sheet.getLastRow();
    this._setProductFormulas(sheet, achievement.rowNumber);
    this._all = null;
    this._keys = null;
    forgetSheetValues(this.spreadsheetId, SHEETS.ARCHIVE);
  }

  /**
   * 上書き（A〜Iを書き換え、J列以降の数式を設定し直す）
   */
  update(achievement) {
    const sheet = this._sheet();
    const row = achievement.toRow();
    sheet.getRange(achievement.rowNumber, 1, 1, row.length).setValues([row]);
    this._setProductFormulas(sheet, achievement.rowNumber);
    this._all = null;
    this._keys = null;
    forgetSheetValues(this.spreadsheetId, SHEETS.ARCHIVE);
  }

  /**
   * J列以降に、G列のJSONから商品ごとの数量を取り出す数式を設定
   * （10行目のヘッダーが空になった列で打ち切り。ヘッダーの読み込みと数式の設定で、APIコールは計2回）
   */
  _setProductFormulas(sheet, rowNumber) {
    const startCol = ACHIEVEMENT_COLUMN.PRODUCT_START + 1;
    const headers = sheet.getRange(`${ACHIEVEMENT_HEADER_ROW}:${ACHIEVEMENT_HEADER_ROW}`).getValues()[0]
      .slice(ACHIEVEMENT_COLUMN.PRODUCT_START);

    const formulas = [];
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === "" || headers[i] === null) break;
      const colLetter = columnNumberToLetter(startCol + i);
      formulas.push(
        `=IFERROR(VALUE(REGEXEXTRACT($G${rowNumber}, """"&${colLetter}$10&""",\\s*""count"":\\s*([0-9]+)")), "")`
      );
    }

    if (formulas.length > 0) {
      sheet.getRange(rowNumber, startCol, 1, formulas.length).setFormulas([formulas]);
    }
  }

  // ヘッダー行のJ列以降から商品名を取得（空セルで打ち切り）
  static _productNames(headerRow) {
    const names = [];
    for (let i = ACHIEVEMENT_COLUMN.PRODUCT_START; i < headerRow.length; i++) {
      if (headerRow[i] === "" || headerRow[i] === null) break;
      names.push(headerRow[i]);
    }
    return names;
  }

  _sheet() {
    return getSheet(this.spreadsheetId, SHEETS.ARCHIVE);
  }
}
