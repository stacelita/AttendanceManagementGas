/**
 * リポジトリの生成
 *
 * 1シート = 1リポジトリ。スプレッドシートIDは設定（AppConfig）から渡す。
 * 同一実行中は同じインスタンスを使い回し、シートの読み込みを1回にする。
 * （各リポジトリは最初にデータを要求されるまでシートを開かないので、生成だけならAPI呼び出しは発生しない）
 */

/**
 * リポジトリ一式を生成
 * @param {string} spreadsheetId
 */
function createRepositories(spreadsheetId) {
  return {
    systemStatus: new SystemStatusRepository(spreadsheetId), // システムステータス
    consts: new ConstRepository(spreadsheetId),              // 定数
    stores: new StoreRepository(spreadsheetId),              // 店舗詳細
    admins: new AdminRepository(spreadsheetId),              // 管理者
    staffs: new StaffRepository(spreadsheetId),              // スタッフマスタ
    schedules: new ScheduleRepository(spreadsheetId),        // 勤務管理
    achievements: new AchievementRepository(spreadsheetId),  // 勤務実績
    shiftTable: new ShiftTableRepository(spreadsheetId),     // シフト表(編集)
    holidays: new HolidayRepository(spreadsheetId),          // 希望休(編集)
    logs: new LogRepository(spreadsheetId),                  // LOG
  };
}

let _repositoriesCache = null;

/**
 * 設定（SPREADSHEET_ID）のリポジトリ一式を取得
 */
function getRepositories() {
  if (!_repositoriesCache) {
    _repositoriesCache = createRepositories(getAppConfig().spreadsheetId);
  }
  return _repositoriesCache;
}

/**
 * 読み込み済みのデータを破棄し、次回はシートを読み直す
 * （1回の実行で同じ処理を続けて呼ぶ場合に、毎回最新のシートを読むため）
 */
function clearRepositories() {
  _repositoriesCache = null;
  clearSheetValues();
}
