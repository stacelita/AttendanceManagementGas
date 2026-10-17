/**
 * シートの値の読み込み
 *
 * ・リポジトリはシートの値をここから読む（同一実行中は1回だけ読み、結果を使い回す）
 * ・prefetchSheetValues で、複数のシートを Sheets API の batchGet により1回でまとめて読める
 *   （シートを1枚読むたびに0.3〜1秒かかるため、読む枚数が多い処理で使う）
 *   スクリプトプロパティ BATCH_READ=true のときだけ有効。失敗したら従来の読み方に戻す
 *
 * まとめて読む場合、日付・時刻のセルは数値（シリアル値）で返ってくるため、
 * 日付・時刻が入る列（sheetDateColumns_）だけ、従来の getValues() と同じ Date に変換する。
 * 変換結果が従来と一致することは verifyBatchRead（Diagnostics.gs）で確認できる。
 */

/**
 * 日付・時刻が入る列（0始まり）。まとめて読んだときに数値を Date に戻す
 * ※ほかのファイルの定数を使うため、ファイルの読み込み順に影響されないよう関数で返す
 */
function sheetDateColumns_() {
  return {
    [SHEETS.STAFF]: [STAFF_COLUMN.FOLLOWED_AT, STAFF_COLUMN.BIRTHDAY],
    [SHEETS.SCHEDULE]: [SCHEDULE_COLUMN.WORK_DATE, SCHEDULE_COLUMN.CHECK_IN_TIME, SCHEDULE_COLUMN.START_TIME, SCHEDULE_COLUMN.END_TIME],
    [SHEETS.STORE]: [STORE_COLUMN.CHECK_IN_TIME, STORE_COLUMN.START_TIME, STORE_COLUMN.END_TIME],
    [SHEETS.ACHIEVEMENT]: [ACHIEVEMENT_COLUMN.REGISTERED_AT, ACHIEVEMENT_COLUMN.WORK_DATE],
    [SHEETS.SHIFT_TABLE]: [SHIFT_TABLE_DATE_COLUMN],
    [SHEETS.HOLIDAY]: [HOLIDAY_DATE_COLUMN],
    [SHEETS.LOG]: [LOG_COLUMN.LOGGED_AT],
  };
}

/**
 * コードが使う列数。まとめて読んだときは、少なくともこの列数までを "" で埋める
 * （行の末尾で数式が空文字を返す列は、まとめ読みでは省かれ「値なし」になるため）
 */
function sheetMinWidths_() {
  return {
    [SHEETS.STAFF]: STAFF_COLUMN.STATUS + 1,
    [SHEETS.SCHEDULE]: SCHEDULE_COLUMN.ACHIEVE_STATUS + 1,
    [SHEETS.STORE]: STORE_COLUMN.DETAIL + 1,
    [SHEETS.ADMIN]: ADMIN_COLUMN.TANTOSHA_SCOPE + 1,
    [SHEETS.CONST]: CONST_COLUMN.ITEM_NAME + 1,
    [SHEETS.SYSTEM_STATUS]: SYSTEM_STATUS_CELL.NEXT_SHIFT_STATUS.col + 1,
    [SHEETS.ACHIEVEMENT]: ACHIEVEMENT_COLUMN.MEMO + 1,
    [SHEETS.LOG]: LOG_COLUMN.CONTENT + 1,
  };
}

// エラー値（#N/A など）。まとめ読みでは「#N/A (Did not find value ...)」のように説明が付くので、記号だけに戻す
const SHEET_ERROR_VALUE_PATTERN = /^(#(?:N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)) \(.*\)$/s;

// スプレッドシートのタイムゾーンの時差（日本時間）。シリアル値は「その地域の日時」を表す
const SPREADSHEET_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
// シリアル値 0 = 1899/12/30、1970/1/1 = 25569
const SERIAL_UNIX_EPOCH = 25569;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 同一実行中に読んだ値（キー：スプレッドシートID と範囲）
const _sheetValuesCache = new Map();

function sheetValuesKey_(spreadsheetId, range) {
  return `${spreadsheetId}\n${range}`;
}

/**
 * シート全体の値（getDataRange().getValues() と同じ形）
 */
function readSheetValues(spreadsheetId, sheetName) {
  const key = sheetValuesKey_(spreadsheetId, sheetName);
  if (!_sheetValuesCache.has(key)) {
    _sheetValuesCache.set(key, getSheet(spreadsheetId, sheetName).getDataRange().getValues());
  }
  return _sheetValuesCache.get(key);
}

/**
 * シートの一部の列の値（getRange(a1).getValues() と同じ形。a1 例："B11:D"）
 * まとめて読んだ場合は、末尾の空行が含まれないことがある
 */
function readRangeValues(spreadsheetId, sheetName, a1) {
  const key = sheetValuesKey_(spreadsheetId, `${sheetName}!${a1}`);
  if (!_sheetValuesCache.has(key)) {
    _sheetValuesCache.set(key, getSheet(spreadsheetId, sheetName).getRange(a1).getValues());
  }
  return _sheetValuesCache.get(key);
}

/** 書き込んだシートの値を破棄する（次に読むときはシートから読み直す） */
function forgetSheetValues(spreadsheetId, sheetName) {
  const prefix = sheetValuesKey_(spreadsheetId, sheetName);
  Array.from(_sheetValuesCache.keys())
    .filter(key => key === prefix || key.startsWith(`${prefix}!`))
    .forEach(key => _sheetValuesCache.delete(key));
}

/** 読んだ値をすべて破棄する */
function clearSheetValues() {
  _sheetValuesCache.clear();
}

/**
 * これから使うシートを1回でまとめて読んでおく（BATCH_READ=true のときだけ）
 * @param {string} spreadsheetId
 * @param {Array<string|{sheetName: string, a1: string}>} targets シート名、または列の範囲
 */
function prefetchSheetValues(spreadsheetId, targets) {
  if (!isBatchReadEnabled()) return;

  const pending = targets
    .map(t => (typeof t === "string" ? { sheetName: t, a1: null } : t))
    .filter(t => !_sheetValuesCache.has(sheetValuesKey_(spreadsheetId, t.a1 ? `${t.sheetName}!${t.a1}` : t.sheetName)));
  if (pending.length < 2) return; // 1枚だけなら従来の読み方と変わらない

  try {
    batchReadValues(spreadsheetId, pending).forEach((values, i) => {
      const t = pending[i];
      _sheetValuesCache.set(sheetValuesKey_(spreadsheetId, t.a1 ? `${t.sheetName}!${t.a1}` : t.sheetName), values);
    });
  } catch (e) {
    // まとめて読めなかった場合は、各リポジトリが従来どおり1枚ずつ読む
    console.error("シートのまとめ読みに失敗しました（従来の読み方で続行）：" + e.message);
  }
}

/** まとめ読みが有効か（スクリプトプロパティ BATCH_READ=true） */
function isBatchReadEnabled() {
  return (getScriptProperties_()[PROPERTY_KEY.BATCH_READ] || "").trim().toLowerCase() === "true";
}

/**
 * Sheets API の batchGet で複数の範囲を1回で読み、getValues() と同じ形に変換して返す
 * @param {Array<{sheetName: string, a1: string|null}>} targets
 * @return {Array<Array<Array<*>>>} targets と同じ順番の値
 */
function batchReadValues(spreadsheetId, targets) {
  const quote = name => `'${name.replace(/'/g, "''")}'`;
  const response = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, {
    ranges: targets.map(t => (t.a1 ? `${quote(t.sheetName)}!${t.a1}` : quote(t.sheetName))),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });

  const dateColumnsBySheet = sheetDateColumns_();
  const minWidths = sheetMinWidths_();
  return targets.map((t, i) => {
    // 列の範囲（例：B11:D）の場合は、その範囲の列数・列位置に合わせる
    let firstColumn = 0;
    let minWidth = minWidths[t.sheetName] || 0;
    if (t.a1) {
      const [, startLetters, endLetters] = /^([A-Z]+)\d*:([A-Z]+)/.exec(t.a1);
      firstColumn = columnLetterToNumber_(startLetters) - 1;
      minWidth = columnLetterToNumber_(endLetters) - firstColumn;
    }
    const dateColumns = (dateColumnsBySheet[t.sheetName] || []).map(c => c - firstColumn);
    return toGetValuesFormat_(response.valueRanges[i].values || [], dateColumns, minWidth);
  });
}

/**
 * batchGet の値を getValues() と同じ形にする
 * ・各行の長さをそろえ（少なくとも minWidth 列）、足りないセルは ""（batchGet は行末の空セルを省くため）
 * ・日付・時刻の列の数値を Date に変換
 * ・エラー値の説明を取り除く（"#N/A (Did not find value ...)" → "#N/A"）
 */
function toGetValuesFormat_(rows, dateColumns, minWidth = 0) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), minWidth);
  return rows.map(row => {
    const values = [];
    for (let c = 0; c < width; c++) {
      let value = row[c] === undefined ? "" : row[c];
      if (dateColumns.includes(c) && typeof value === "number") {
        value = serialToDate_(value);
      } else if (typeof value === "string" && value.startsWith("#")) {
        value = value.replace(SHEET_ERROR_VALUE_PATTERN, "$1");
      }
      values.push(value);
    }
    return values;
  });
}

/** シリアル値（スプレッドシートの日時）を Date に変換 */
function serialToDate_(serial) {
  return new Date(Math.round((serial - SERIAL_UNIX_EPOCH) * MS_PER_DAY) - SPREADSHEET_UTC_OFFSET_MS);
}

/** 列記号を列番号に変換（例："B" → 2） */
function columnLetterToNumber_(letters) {
  return letters.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}
