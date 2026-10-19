/**
 * Web アプリの入口（LINE の Webhook と、LIFF からのリクエスト）
 *
 * ※ URL・パラメータ・レスポンスの形は Cloudflare（Worker・LIFF）と合わせているため変えないこと
 *   ・パラメータ action がある → LIFF からのリクエスト（GET / POST）
 *   ・action がない          → LINE の Webhook（Worker から POST で転送される）
 */

function doPost(e) {
  const params = parseRequestBody_(e);
  // Webhook の合言葉は、Worker（lineauth）が URL のパラメータ key に付けて送ってくる
  const proxyKey = e && e.parameter ? e.parameter.key : undefined;
  return dispatchRequest(params, proxyKey);
}

function doGet(e) {
  const params = e.parameter || {};
  return dispatchRequest(params, params.key);
}

/**
 * リクエストの振り分け
 * @param {Object} params リクエストの内容
 * @param {string} proxyKey Worker（lineauth）が付けた合言葉（Webhook のみ使用）
 */
function dispatchRequest(params, proxyKey) {
  return params.action ? handleLiffRequest_(params) : handleWebhook_(params, proxyKey);
}

/** LIFF からのリクエスト（部署は dept パラメータで指定する。省略・未登録の部署はエラー） */
function handleLiffRequest_(params) {
  const departmentCode = params.dept;
  if (!departmentCode || !isDepartmentCode(departmentCode)) {
    return jsonResponse({ status: "error", message: "unknown department" });
  }
  useDepartment(departmentCode);
  return new ActionController(params).handle();
}

/** LINE の Webhook（部署は、受信した公式アカウントの destination で判別する） */
function handleWebhook_(params, proxyKey) {
  if (!params.events?.[0]) return;

  // Worker（署名を検証済み）を通ってきたリクエストか確認する（PROXY_SECRET 設定時のみ）
  // 部署が決まる前なので LOG シートには書けない。GAS の「実行数」の画面にエラーとして残す
  if (!isValidProxyKey(proxyKey)) {
    console.error("WEBHOOK：合言葉（key）が一致しないため処理しません（署名検証を通っていない可能性）", params.destination);
    return;
  }

  const departmentCode = findDepartmentByBotUserId(params.destination);
  if (!departmentCode) {
    console.error("WEBHOOK：destination がどの部署の BOT_USER_ID とも一致しないため処理しません", params.destination);
    return;
  }
  useDepartment(departmentCode);

  new LineWebhookController(params).handle();
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

/** JSON のレスポンス */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
