// ※LINEトークン・LIFF IDなどはスクリプトプロパティで管理（Config.gas参照）

// LIFF URL（末尾にLIFF IDを付ける）
const LIFF_URL_BASE = "https://liff.line.me/";

// テストモードの送信内容を記録するシート
const TEST_LOG_SHEET_NAME = "TEST_LOG";

// テストモードで操作できるスプレッドシートのファイル名の先頭
const TEST_SPREADSHEET_NAME_PREFIX = "【TEST】";

// 日付フォーマット
const DATE_FORMAT = {
  YMD_HYPHEN: "yyyy-MM-dd",
  YMD_SLASH: "yyyy/MM/dd",
  YMD: "yyyyMMdd",
};

const TIME_FORMAT = {
  HM_COLON: "H:mm",         // 14:30
  HMS_COLON: "H:mm:ss",      // 14:30:05
  HM_JP: "H時mm分",          // 14時30分
  HMS_JP: "H時mm分ss秒",      // 14時30分05秒
  HM_NO_SEP: "HHmm",          // 1430
  HMS_NO_SEP: "HHmmss",       // 143005
};

// ※各シートの列の位置は、それぞれのリポジトリ（○○Repository.gas）で管理

// LINE API
const LINE_API_URL = {
  REPLY: "https://api.line.me/v2/bot/message/reply",
  PUSH: "https://api.line.me/v2/bot/message/push",
  MULTI: "https://api.line.me/v2/bot/message/multicast",
  PROFILE: "https://api.line.me/v2/bot/profile/",
  BOT_INFO: "https://api.line.me/v2/bot/info",
  VERIFY_ID_TOKEN: "https://api.line.me/oauth2/v2.1/verify",
};

// LINEメッセージ文言
const MESSAGE_PREFIX = {
  PREV_DONE: "前日確認済み:",
  TODAY_DONE: "当日確認済み:",
  ACHIEVE_DONE: "【勤務実績登録】",
  PROFILE_DONE: "【スタッフ情報登録】",
  SHOP_LIST: "> 店舗の確認",
  SHOP_DETAIL: "店舗詳細:",
  GET_ASSIGNED_STORE: "> シフトの確認",
};

const CHECK_STATUS = {
  DONE: "確認済み",
};

const SHEETS = {
  STAFF: 'スタッフマスタ',
  ARCHIVE: '勤務実績',
  SCHEDULE: '勤務管理',
  CONST: '定数',
  STORE: '店舗詳細',
  ADMIN: '管理者',
  SYSTEM_STATUS: 'システムステータス',
  SHIFT_TABLE: 'シフト表(編集)',
  HOLIDAY: '希望休(編集)',
  LOG: 'LOG',
};

/**
 * LINEイベント
 */
const LINE_EVENT = {
  FOLLOW: "follow",
  MESSAGE: "message"
};

// LINEメッセージタイプ
const LINE_MESSAGE_TYPE = {
  TEXT: "text"
};

// システムステータス
const KADO_STATUS = {
  ACTIVE: '稼働中',
  MAINTENANVE: 'メンテナンス中',
};

// 来月のシフト
const NEXT_SHIFT = {
  CONFIRMED: '確定',
  UNCONFIRMED: '未確定',
};

/**
 * LIFF操作種類
 */
const ACTIONS = {
  GET_ASSIGNED_STORE: "get_assigned_store",
  RECORD_ARCHIVE: "record_achieve",
  GET_CATEGORY: "get_category",
  RECORD_PROFILE: "record_profile",
  GET_PROFILE: "get_profile",
  IS_MAINTENANCE: "is_maintenance",
};

/**
 * 個人のデータを扱う action（LIFF の ID トークンで本人確認する）
 */
const ACTIONS_WITH_USER = [
  ACTIONS.GET_ASSIGNED_STORE,
  ACTIONS.RECORD_ARCHIVE,
  ACTIONS.RECORD_PROFILE,
  ACTIONS.GET_PROFILE,
];

// 本人確認に失敗したときのメッセージ（LIFF の画面に表示される）
const AUTH_ERROR_MESSAGE = "本人確認ができませんでした。画面を閉じて、もう一度開いてください。";

/**
 * アラートメッセージ種類
 */
const ALERT_MESSAGE = {
  PREVIOUS: 1,
  PREVIOUS_RE : 2,
  TODAY : 3,
  TODAY_RE: 4,
  ACHIEVE: 5,
  ACHIEVE_RE: 6,
  PREVIOUS_ADMIN: 90,
  TODAY_ADMIN: 91,
  ACHIEVE_ADMIN: 92,
};

const ALERT_FLG = {
  ON: "ON",
  OFF: "OFF",
};