/**
 * 共通の処理（スプレッドシートの取得・ログ・日付と時刻・配列）
 */

// --- スプレッドシート ---

// 同一実行中は openById を1回だけ行う（キー：スプレッドシートID）
const _spreadsheetCache = new Map();

/**
 * スプレッドシートを ID で取得
 * テストモードでは、ファイル名が【TEST】で始まるもの（テスト用コピー）しか開かない
 */
function openSpreadsheetById(spreadsheetId) {
  if (!_spreadsheetCache.has(spreadsheetId)) {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    if (getAppConfig().isTestMode) assertTestSpreadsheet(spreadsheet);
    _spreadsheetCache.set(spreadsheetId, spreadsheet);
  }
  return _spreadsheetCache.get(spreadsheetId);
}

/** 処理中の部署のスプレッドシート */
function getSpreadsheet() {
  return openSpreadsheetById(getAppConfig().spreadsheetId);
}

/** スプレッドシート ID とシート名からシートを取得 */
function getSheet(spreadsheetId, sheetName) {
  return openSpreadsheetById(spreadsheetId).getSheetByName(sheetName);
}

/**
 * テストモードのまま本番のスプレッドシートを操作してしまう事故を防ぐ
 */
function assertTestSpreadsheet(spreadsheet) {
  if (!String(spreadsheet.getName()).startsWith(TEST_SPREADSHEET_NAME_PREFIX)) {
    throw new Error(`テストモードでは、ファイル名が「${TEST_SPREADSHEET_NAME_PREFIX}」で始まるスプレッドシートしか操作できません。スプレッドシートIDとファイル名を確認してください。`);
  }
}

// --- ログ ---

/**
 * 処理中の部署の LOG シートに1行追加する（書き込みに失敗しても処理は止めない）
 * @param {Object|string} content オブジェクトは JSON 文字列にして記録
 */
function writeLog(userId, action, level, content) {
  try {
    const entry = new LogEntry();
    entry.loggedAt = new Date();
    entry.userId = userId;
    entry.action = action;
    entry.level = level;
    entry.content = typeof content === "object" ? JSON.stringify(content) : content;
    getRepositories().logs.add(entry);
  } catch (logError) {
    console.error("Failed to write log to sheet:", logError);
  }
}

/** 例外を LOG に記録するときの内容 */
function errorLogContent(error, eventData) {
  return {
    message: error.message,
    stack: error.stack,
    fileName: error.fileName,
    lineNumber: error.lineNumber,
    eventData: JSON.stringify(eventData),
  };
}

// --- 日付と時刻（日本時間） ---

const JST_FORMAT = {
  SLASH_DATE: "yyyy/MM/dd",
  COMPACT_DATE: "yyyyMMdd",
  HOUR_MINUTE: "H:mm",
};

/** yyyy/MM/dd 形式の文字列（日付として解釈できなければ元の値をそのまま返す） */
function toJstSlashDate(value) {
  return formatJstDate(value, JST_FORMAT.SLASH_DATE);
}

/** yyyyMMdd 形式の文字列（日付として解釈できなければ元の値をそのまま返す） */
function toJstCompactDate(value) {
  return formatJstDate(value, JST_FORMAT.COMPACT_DATE);
}

/** H:mm 形式の時刻（文字列はそのまま。時刻として解釈できなければ元の値をそのまま返す） */
function toJstHourMinute(value) {
  if (typeof value === "string") return value;
  if (!value || isNaN(new Date(value).getTime())) return value;
  try {
    return Utilities.formatDate(new Date(value), "JST", JST_FORMAT.HOUR_MINUTE);
  } catch {
    return value;
  }
}

/**
 * 日付を日本時間の指定形式の文字列にする（日付として解釈できなければ元の値をそのまま返す）
 * 文字列は「-」「/」を除いて数字8桁なら yyyyMMdd として読む（例："2026/04/21" "2026-04-21"）
 */
function formatJstDate(value, format) {
  const date = parseDateValue_(value);
  if (isNaN(date.getTime())) return value;
  return Utilities.formatDate(date, "JST", format);
}

function parseDateValue_(value) {
  if (typeof value !== "string") return new Date(value);
  const digits = value.replace(/[-/]/g, "");
  if (digits.length === 8) {
    return new Date(digits.slice(0, 4), digits.slice(4, 6) - 1, digits.slice(6, 8));
  }
  return new Date(value);
}

// --- 配列・セル ---

/** 行末の空セルを取り除く（appendRow で書き込む列数を必要な分だけにする） */
function trimTrailingEmpty(row) {
  const isEmpty = value => value === "" || value === null || value === undefined;
  const result = row.slice();
  while (result.length > 0 && isEmpty(result[result.length - 1])) result.pop();
  return result;
}

/** 列番号（1始まり）を列記号に変換（例：10 → "J"） */
function columnNumberToLetter(columnNumber) {
  let letters = "";
  for (let n = columnNumber; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  }
  return letters;
}
