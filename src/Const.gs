/**
 * 定数
 *
 * ※部署ごと・環境ごとに異なる値はスクリプトプロパティ（Config.gs）で、
 *   各シートの列の位置は各リポジトリ（○○Repository.gs）で管理する
 */

// --- シート名 ---

const SHEETS = {
  STAFF: "スタッフマスタ",
  ACHIEVEMENT: "勤務実績",
  SCHEDULE: "勤務管理",
  CONST: "定数",
  STORE: "店舗詳細",
  ADMIN: "管理者",
  SYSTEM_STATUS: "システムステータス",
  SHIFT_TABLE: "シフト表(編集)",
  HOLIDAY: "希望休(編集)",
  LOG: "LOG",
};

// --- シートに入る値 ---

/** システムステータスの稼働状態（B1） */
const OPERATION_STATUS = {
  ACTIVE: "稼働中",
  MAINTENANCE: "メンテナンス中",
};

/** システムステータスの来月のシフト（B2） */
const NEXT_SHIFT = {
  CONFIRMED: "確定",
  UNCONFIRMED: "未確定",
};

/** 勤務管理の前日確認・当日確認 */
const CHECK_STATUS = {
  DONE: "確認済み",
};

/** 店舗詳細のアラートフラグ */
const STORE_ALERT_FLAG = {
  ON: "ON",
  OFF: "OFF",
};

// --- LINE ---

const LINE_API_URL = {
  REPLY: "https://api.line.me/v2/bot/message/reply",
  PUSH: "https://api.line.me/v2/bot/message/push",
  PROFILE: "https://api.line.me/v2/bot/profile/",
  BOT_INFO: "https://api.line.me/v2/bot/info",
  VERIFY_ID_TOKEN: "https://api.line.me/oauth2/v2.1/verify",
};

/** LIFF アプリの URL（末尾に LIFF ID を付ける） */
const LIFF_URL_BASE = "https://liff.line.me/";

/** Webhook のイベントの種類 */
const LINE_EVENT = {
  FOLLOW: "follow",
  MESSAGE: "message",
};

const LINE_MESSAGE_TYPE = {
  TEXT: "text",
};

/** スタッフから届くメッセージの先頭（通知のボタン・リッチメニュー・LIFF が送る文言） */
const MESSAGE_PREFIX = {
  PREV_DONE: "前日確認済み:",
  TODAY_DONE: "当日確認済み:",
  ACHIEVE_DONE: "【勤務実績登録】",
  PROFILE_DONE: "【スタッフ情報登録】",
  SHOP_LIST: "> 店舗の確認",
  SHOP_DETAIL: "店舗詳細:",
  GET_ASSIGNED_STORE: "> シフトの確認",
};

/** メンテナンス中の返信・レスポンスの文言 */
const MAINTENANCE_MESSAGE = "メンテナンス中です。しばらくお待ちください。";

/** スタッフ情報（氏名）が未登録の人が「シフトの確認」をしたときの返信 */
const UNREGISTERED_STAFF_MESSAGE = "スタッフ情報が登録されていないため、シフトを表示できません。\nスタッフ情報の登録をお願いします。";

// --- LIFF からのリクエスト（ActionController） ---

/** LIFF から送られる action */
const ACTIONS = {
  GET_ASSIGNED_STORE: "get_assigned_store",
  RECORD_ACHIEVE: "record_achieve",
  GET_CATEGORY: "get_category",
  RECORD_PROFILE: "record_profile",
  GET_PROFILE: "get_profile",
  IS_MAINTENANCE: "is_maintenance",
};

/** 個人のデータを扱う action（LIFF の ID トークンで本人確認する） */
const ACTIONS_WITH_USER = [
  ACTIONS.GET_ASSIGNED_STORE,
  ACTIONS.RECORD_ACHIEVE,
  ACTIONS.RECORD_PROFILE,
  ACTIONS.GET_PROFILE,
];

/** 本人確認に失敗したときの文言（LIFF の画面に表示される） */
const AUTH_ERROR_MESSAGE = "本人確認ができませんでした。画面を閉じて、もう一度開いてください。";

// --- 通知（Notifications.gs） ---

/**
 * 通知の種類
 * ※値は定数シートの通知テンプレート（区分ID=3）の項目値と対応しているため変えないこと
 */
const ALERT_TYPE = {
  PREVIOUS: 1,          // 前日確認
  PREVIOUS_RE: 2,       // 【再】前日確認
  TODAY: 3,             // 当日確認
  TODAY_RE: 4,          // 【再】当日確認
  ACHIEVE: 5,           // 実績報告のお願い
  ACHIEVE_RE: 6,        // 【再】実績報告のお願い
  PREVIOUS_ADMIN: 90,   // 前日確認の未実施者リスト（管理者向け）
  TODAY_ADMIN: 91,      // 当日確認の未実施者リスト（管理者向け）
  ACHIEVE_ADMIN: 92,    // 実績の未入力者リスト（管理者向け）
};

// --- テストモード ---

/** テストモードの送信内容を記録するシート */
const TEST_LOG_SHEET_NAME = "TEST_LOG";

/** テストモードで操作できるスプレッドシートのファイル名の先頭 */
const TEST_SPREADSHEET_NAME_PREFIX = "【TEST】";
