/**
 * 共通ユーティリティ
 */

// 同一実行中は openById を1回だけ行う（キー：スプレッドシートID）
const _spreadsheetCache = new Map();

/**
 * スプレッドシートをIDで取得
 */
function openSpreadsheetById(spreadsheetId) {
  if (!_spreadsheetCache.has(spreadsheetId)) {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    if (getAppConfig().isTestMode) assertTestSpreadsheet(spreadsheet);
    _spreadsheetCache.set(spreadsheetId, spreadsheet);
  }
  return _spreadsheetCache.get(spreadsheetId);
}

/**
 * 設定（<部署コード>_SPREADSHEET_ID）のスプレッドシートを取得
 */
function getSpreadsheet() {
  return openSpreadsheetById(getAppConfig().spreadsheetId);
}

/**
 * テストモードでは、ファイル名が【TEST】で始まるスプレッドシート（テスト用コピー）以外を操作させない
 * （テストモードのまま本番のスプレッドシートIDを設定してしまう事故の防止）
 */
function assertTestSpreadsheet(spreadsheet) {
  if (!String(spreadsheet.getName()).startsWith(TEST_SPREADSHEET_NAME_PREFIX)) {
    throw new Error(`テストモードでは、ファイル名が「${TEST_SPREADSHEET_NAME_PREFIX}」で始まるスプレッドシートしか操作できません。スプレッドシートIDとファイル名を確認してください。`);
  }
}

/**
 * スプレッドシートIDとシート名からシートを取得（リポジトリ用）
 */
function getSheet(spreadsheetId, sheetName) {
  return openSpreadsheetById(spreadsheetId).getSheetByName(sheetName);
}

/**
 * 行末の空セルを取り除く（appendRow で書き込む列数を必要な分だけにする）
 */
function trimTrailingEmpty(row) {
  const result = row.slice();
  while (result.length > 0 && (result[result.length - 1] === "" || result[result.length - 1] === null || result[result.length - 1] === undefined)) {
    result.pop();
  }
  return result;
}

/**
 * 列番号（1始まり）を列記号に変換（例：10 → "J"）
 */
function columnNumberToLetter(colNum) {
  let letter = '';
  while (colNum > 0) {
    const mod = (colNum - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    colNum = Math.floor((colNum - mod - 1) / 26);
  }
  return letter;
}

/**
 * LOGシートに1行追加
 * @param {Object|string} content オブジェクトはJSON文字列にして記録
 */
function writeLog(userId, action,level, content) {
  try {
    const entry = new LogEntry();
    entry.loggedAt = new Date();
    entry.userId = userId;
    entry.action = action;
    entry.level = level;
    entry.content = typeof content === 'object' ? JSON.stringify(content) : content;

    getRepositories().logs.add(entry);

  } catch (logError) {
    // ログ書き込み自体が失敗した場合（スプレッドシートの権限エラーなど）
    console.error('Failed to write log to sheet:', logError);
  }
}

/**
 * JSTの日付文字列に変換
 */
function formatDateJst(dateValue, format) {
  let dateObj;

  if (typeof dateValue === 'string') {
    // ハイフンやスラッシュを除去して数字のみにする (例: "2026/04/21" -> "20260421")
    const cleanStr = dateValue.replace(/[-/]/g, '');
    
    // yyyyMMdd 形式の文字列を Date オブジェクトに変換
    if (cleanStr.length === 8) {
      const year = cleanStr.substring(0, 4);
      const month = cleanStr.substring(4, 6) - 1; // 月は 0-11 で指定
      const day = cleanStr.substring(6, 8);
      dateObj = new Date(year, month, day);
    } else {
      // それ以外の形式（ISO 8601など）はそのまま new Date に渡す
      dateObj = new Date(dateValue);
    }
  } else {
    // すでに Date オブジェクトや数値（ミリ秒）の場合
    dateObj = new Date(dateValue);
  }

  // 無効な日付（Invalid Date）のチェック
  if (isNaN(dateObj.getTime())) {
    return dateValue; // 変換できなかった場合は元の値を返す
  }

  return Utilities.formatDate(dateObj, "JST", format);
}

/**
 * JSTのyyyy-MM-dd形式に変換
 */
function toJstYmd(dateValue) {
  return formatDateJst(dateValue, DATE_FORMAT.YMD_HYPHEN);
}

/**
 * JSTのyyyy/MM/dd形式に変換
 */
function toJstYmdSlash(dateValue) {
  return formatDateJst(dateValue, DATE_FORMAT.YMD_SLASH);
}

/**
 * JSTのyyyyMMdd形式に変換
 */
function toJstYmd(dateValue) {
  return formatDateJst(dateValue, DATE_FORMAT.YMD);
}

function formatTimeOnly(timeValue, format) {
  // すでに文字列の場合はそのまま返す
  if (typeof timeValue === 'string') {
    return timeValue;
  }

  // 値が空、またはDateオブジェクトとして無効な場合はそのまま返す
  if (!timeValue || isNaN(new Date(timeValue).getTime())) {
    return timeValue;
  }

  try {
    // タイムゾーンはJST固定、指定されたフォーマットで時刻部分のみ抽出
    return Utilities.formatDate(new Date(timeValue), "JST", format);
  } catch (e) {
    return timeValue;
  }
}


function toJstTimeHM(timeValue) {
  return formatTimeOnly(timeValue, TIME_FORMAT.HM_COLON);
}

/**
 * 指定プレフィックスで始まるか判定
 */
function startsWithPrefix(text, prefix) {
  return String(text || "").startsWith(prefix);
}

/**
 * 勤務確認メッセージか判定
 */
function isWorkConfirmMessage(text) {
  return (
    startsWithPrefix(text, MESSAGE_PREFIX.PREV_DONE) ||
    startsWithPrefix(text, MESSAGE_PREFIX.TODAY_DONE)
  );
}

/**
 * 前日確認メッセージか判定
 */
function isPrevConfirmMessage(text) {
  return startsWithPrefix(text, MESSAGE_PREFIX.PREV_DONE);
}

/**
 * 当日確認メッセージか判定
 */
function isTodayConfirmMessage(text) {
  return startsWithPrefix(text, MESSAGE_PREFIX.TODAY_DONE);
}

/**
 * 必須パラメータの不足キー一覧を取得
 */
function getMissingParams(params, requiredKeys) {
  return requiredKeys.filter(key => {
    const value = params ? params[key] : undefined;
    return value === undefined || value === null || value === "";
  });
}

