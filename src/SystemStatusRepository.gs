/**
 * システムステータスシート
 *
 * ヘッダー行なし。A列：項目名、B列：値（プルダウン）
 *   1行目：稼働状態（稼働中 / メンテナンス中）
 *   2行目：来月のシフト（確定 / 未確定）
 */

// 値の位置（0始まり）
const SYSTEM_STATUS_CELL = {
  OPERATION_STATUS: { row: 0, col: 1 },  // B1
  NEXT_SHIFT_STATUS: { row: 1, col: 1 }, // B2
};

/**
 * システムステータス（シート全体で1件）
 */
class SystemStatus {
  constructor() {
    this.operationStatus = "";  // B1: 稼働状態
    this.nextShiftStatus = "";  // B2: 来月のシフト
  }

  /** メンテナンス中か（「稼働中」以外はすべてメンテナンス中扱い） */
  get isMaintenance() {
    return this.operationStatus !== OPERATION_STATUS.ACTIVE;
  }

  /** 来月のシフトが未確定か */
  get isNextShiftUnconfirmed() {
    return this.nextShiftStatus === NEXT_SHIFT.UNCONFIRMED;
  }

  static fromValues(values) {
    const status = new SystemStatus();
    status.operationStatus = SystemStatus._cell(values, SYSTEM_STATUS_CELL.OPERATION_STATUS);
    status.nextShiftStatus = SystemStatus._cell(values, SYSTEM_STATUS_CELL.NEXT_SHIFT_STATUS);
    return status;
  }

  // データ範囲外のセルは空文字（getRange().getValue() と同じ結果）
  static _cell(values, pos) {
    const row = values[pos.row];
    return row && row[pos.col] !== undefined ? row[pos.col] : "";
  }
}

class SystemStatusRepository {
  /**
   * コンストラクタ
   * @param {string} spreadsheetId
   */
  constructor(spreadsheetId) {
    this.spreadsheetId = spreadsheetId;
    this._status = null;
  }

  /**
   * システムステータスを取得
   * @return {SystemStatus}
   */
  get() {
    if (!this._status) {
      const values = readSheetValues(this.spreadsheetId, SHEETS.SYSTEM_STATUS);
      this._status = SystemStatus.fromValues(values);
    }
    return this._status;
  }
}
