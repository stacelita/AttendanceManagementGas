/**
 * 処理時間の測定（診断用。読み取りのみで、シートへの書き込みやLINEの送信は行わない）
 *
 * エディタから実行し、実行ログを確認する。
 *   measurePerformance       ：DEPARTMENTS の先頭の部署
 *   measurePerformanceSales1 ：SALES1（DEPARTMENTS に入れていなくても、SALES1_SPREADSHEET_ID があれば測れる）
 */
function measurePerformance() {
  const props = PropertiesService.getScriptProperties().getProperties();
  measurePerformanceFor_((props[PROPERTY_KEY.DEPARTMENTS] || "").split(",")[0].trim());
}

function measurePerformanceSales1() {
  measurePerformanceFor_("SALES1");
}

function measurePerformanceFor_(departmentCode) {
  const results = [];
  const time = (label, fn) => {
    const start = Date.now();
    const value = fn();
    results.push(`${String(Date.now() - start).padStart(5)} ms  ${label}`);
    return value;
  };

  // 設定・スプレッドシート
  const props = time("スクリプトプロパティの読み込み", () => PropertiesService.getScriptProperties().getProperties());
  const spreadsheetId = (props[`${departmentCode}_${PROPERTY_KEY.SPREADSHEET_ID}`] || "").trim();
  if (!spreadsheetId) {
    console.error(`スクリプトプロパティ ${departmentCode}_${PROPERTY_KEY.SPREADSHEET_ID} が設定されていません。`);
    return;
  }
  results.push(`         （部署 ${departmentCode}）`);

  const spreadsheet = time("スプレッドシートを開く（openById）", () => SpreadsheetApp.openById(spreadsheetId));
  results.push(`         ファイル名：${spreadsheet.getName()}`);
  results.push(`         シート一覧：${spreadsheet.getSheets().map(sh => `${sh.getName()}(${sh.getMaxRows()}行×${sh.getMaxColumns()}列)`).join("、")}`);

  // 各シートの読み込み（1回目・2回目）とデータ量
  Object.keys(SHEETS).forEach(key => {
    const name = SHEETS[key];
    const sheet = time(`シート取得（getSheetByName）: ${name}`, () => spreadsheet.getSheetByName(name));
    if (!sheet) {
      results.push(`         ${name}：シートが見つかりません`);
      return;
    }
    const values = time(`全データ読み込み 1回目: ${name}`, () => sheet.getDataRange().getValues());
    time(`全データ読み込み 2回目: ${name}`, () => sheet.getDataRange().getValues());
    const jsonSize = JSON.stringify(values).length;
    results.push(`         ${name}：${values.length} 行 × ${values[0] ? values[0].length : 0} 列、JSON ${Math.round(jsonSize / 1024)} KB${jsonSize > 100 * 1024 ? "（キャッシュの上限100KBを超える）" : ""}`);
  });

  // 勤務管理：全件読み込みと TextFinder の比較（将来の高速化の判断用）
  const scheduleSheet = spreadsheet.getSheetByName(SHEETS.SCHEDULE);
  if (scheduleSheet && scheduleSheet.getLastRow() > 1) {
    const sampleUserId = scheduleSheet.getRange(scheduleSheet.getLastRow(), 1).getValue();
    time("勤務管理：TextFinder で userId を検索", () =>
      scheduleSheet.createTextFinder(String(sampleUserId)).matchEntireCell(true).findAll().length
    );
  }

  // キャッシュ（CacheService）
  const cache = CacheService.getScriptCache();
  const sample = JSON.stringify(spreadsheet.getSheetByName(SHEETS.CONST).getDataRange().getValues());
  time(`キャッシュへの書き込み（定数 ${Math.round(sample.length / 1024)} KB）`, () => cache.put("__measure_performance__", sample, 60));
  time("キャッシュからの読み込み", () => cache.get("__measure_performance__"));
  cache.remove("__measure_performance__");

  // LINE API（読み取りのみ。トークンが未設定ならスキップ）
  const token = (props[`${departmentCode}_${PROPERTY_KEY.LINE_CHANNEL_ACCESS_TOKEN}`] || "").trim();
  if (token) {
    time("LINE API：Bot情報の取得（GET）", () =>
      UrlFetchApp.fetch(LINE_API_URL.BOT_INFO, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true }).getResponseCode()
    );
  }
  time("LINE API：IDトークンの検証（ダミーのため失敗するが時間は測れる）", () =>
    UrlFetchApp.fetch(LINE_API_URL.VERIFY_ID_TOKEN, {
      method: "post",
      payload: { id_token: "dummy", client_id: (props[PROPERTY_KEY.LIFF_CHANNEL_ID] || "0").trim() },
      muteHttpExceptions: true,
    }).getResponseCode()
  );

  console.log("処理時間の測定結果\n" + results.join("\n"));
}

/**
 * まとめ読み（BATCH_READ）の確認（診断用。読み取りのみ）
 * 本物のシートで、従来の読み方（getValues）と、まとめ読み（Sheets API の batchGet）の結果が
 * 1セルずつ一致するかを比べ、あわせて読み込み時間を比べる。
 *   verifyBatchRead       ：DEPARTMENTS の先頭の部署
 *   verifyBatchReadSales1 ：SALES1（DEPARTMENTS に入れていなくても、SALES1_SPREADSHEET_ID があれば確認できる）
 */
function verifyBatchRead() {
  const props = PropertiesService.getScriptProperties().getProperties();
  verifyBatchReadFor_((props[PROPERTY_KEY.DEPARTMENTS] || "").split(",")[0].trim());
}

function verifyBatchReadSales1() {
  verifyBatchReadFor_("SALES1");
}

function verifyBatchReadFor_(departmentCode) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const spreadsheetId = (props[`${departmentCode}_${PROPERTY_KEY.SPREADSHEET_ID}`] || "").trim();
  if (!spreadsheetId) {
    console.error(`スクリプトプロパティ ${departmentCode}_${PROPERTY_KEY.SPREADSHEET_ID} が設定されていません。`);
    return;
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const lines = [`まとめ読みの確認（部署 ${departmentCode}・${spreadsheet.getName()}・タイムゾーン ${spreadsheet.getSpreadsheetTimeZone()}）`];

  // 確認する範囲：まとめ読みで使う範囲（合否の判定に使う）＋参考（まとめ読みでは使わない範囲）
  const usedSheets = [SHEETS.SYSTEM_STATUS, SHEETS.STAFF, SHEETS.ADMIN, SHEETS.STORE, SHEETS.CONST,
    SHEETS.SCHEDULE, SHEETS.SHIFT_TABLE, SHEETS.HOLIDAY];
  const targets = usedSheets.map(name => ({ sheetName: name, a1: null }))
    .concat([{ sheetName: SHEETS.ARCHIVE, a1: achievementKeysA1() }])
    .concat([SHEETS.ARCHIVE, SHEETS.LOG].map(name => ({ sheetName: name, a1: null, reference: true })));

  const batched = batchReadValues(spreadsheetId, targets);
  let ngCount = 0;
  targets.forEach((t, i) => {
    const sheet = spreadsheet.getSheetByName(t.sheetName);
    const label = t.a1 ? `${t.sheetName}!${t.a1}` : t.sheetName;
    if (!sheet) {
      lines.push(`  -  ${label}：シートなし`);
      return;
    }
    let expected = t.a1 ? sheet.getRange(t.a1).getValues() : sheet.getDataRange().getValues();
    if (t.a1) expected = trimEmptyTailRows_(expected); // 列の範囲の指定では、まとめ読みは末尾の空行を返さない
    const diffs = diffValues_(expected, batched[i]);
    const note = t.reference ? "（参考：まとめ読みでは使わない範囲）" : "";
    if (diffs.length === 0) {
      lines.push(`  OK  ${label}（${expected.length}行×${expected[0] ? expected[0].length : 0}列）${note}`);
    } else {
      if (!t.reference) ngCount++;
      lines.push(`  ${t.reference ? "参考" : "NG"}  ${label}：${diffs.length}件の不一致${note}。例）${diffs.slice(0, 3).join(" / ")}`);
    }
  });

  // 読み込み時間の比較：「シフトの確認」で読む5枚
  const shiftCheck = [SHEETS.SYSTEM_STATUS, SHEETS.STAFF, SHEETS.ADMIN, SHEETS.SHIFT_TABLE, SHEETS.HOLIDAY];
  let start = Date.now();
  shiftCheck.forEach(name => spreadsheet.getSheetByName(name).getDataRange().getValues());
  const separateMs = Date.now() - start;
  start = Date.now();
  batchReadValues(spreadsheetId, shiftCheck.map(name => ({ sheetName: name, a1: null })));
  const batchMs = Date.now() - start;
  lines.push(`読み込み時間（「シフトの確認」で読む5枚）：1枚ずつ ${separateMs} ms ／ まとめ読み ${batchMs} ms`);

  lines.push(ngCount === 0
    ? "結果：すべて一致しました。BATCH_READ=true にしても動作は変わりません。"
    : "結果：不一致があります。BATCH_READ は有効にしないでください。");
  console.log(lines.join("\n"));
}

// 1セルずつ比較し、不一致の説明を返す（日付は時刻まで比較）
function diffValues_(expected, actual) {
  const diffs = [];
  const rows = Math.max(expected.length, actual.length);
  for (let r = 0; r < rows; r++) {
    const width = Math.max((expected[r] || []).length, (actual[r] || []).length);
    for (let c = 0; c < width; c++) {
      const a = expected[r] ? expected[r][c] : undefined;
      const b = actual[r] ? actual[r][c] : undefined;
      const same = isDate_(a) && isDate_(b) ? a.getTime() === b.getTime() : a === b;
      if (!same) diffs.push(`${columnNumberToLetter(c + 1)}${r + 1}: 従来=${describeValue_(a)} まとめ=${describeValue_(b)}`);
    }
  }
  return diffs;
}

function describeValue_(value) {
  if (isDate_(value)) return `Date(${Utilities.formatDate(value, "JST", "yyyy/MM/dd HH:mm:ss")})`;
  return `${typeof value}(${String(value).slice(0, 20)})`;
}

function isDate_(value) {
  return Object.prototype.toString.call(value) === "[object Date]";
}

function trimEmptyTailRows_(values) {
  const result = values.slice();
  while (result.length > 0 && result[result.length - 1].every(v => v === "" || v === null)) result.pop();
  return result;
}
