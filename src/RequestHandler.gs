
/**
 * POSTリクエスト処理
 */
function doPost(e) {
  const params = parseRequestBody(e);
  // Webhook用の合言葉は、Worker（lineauth）が URL のパラメータ key に付けて送ってくる
  const proxyKey = e && e.parameter ? e.parameter.key : undefined;
  return dispatchRequest(params, proxyKey);
}

/**
 * GETリクエスト処理
 */
function doGet(e) {
  const params = e.parameter || {};
  return dispatchRequest(params, params.key);
}

/**
 * リクエスト振り分け
 * @param {Object} params リクエストの内容
 * @param {string} proxyKey Worker（lineauth）が付けた合言葉（Webhookのみ使用）
 */
function dispatchRequest(params, proxyKey) {
  // パラメータアクションが存在する場合（LIFF）
  if (params.action) {
    // 部署は dept パラメータで指定（省略時は既定の部署）
    const departmentCode = params.dept || getDepartmentCodes()[0];
    if (!isDepartmentCode(departmentCode)) {
      return jsonResponse({ status: "error", message: "unknown department" });
    }
    useDepartment(departmentCode);
    return new ActionController(params).handle();
  }

  // LINE Webhook（イベントがなければ何もしない）
  if (!params.events?.[0]) return;

  // Worker（署名検証済み）を通ってきたリクエストか確認（PROXY_SECRET 設定時のみ）
  if (!isValidProxyKey(proxyKey)) {
    writeLog("SYSTEM", "WEBHOOK", "ERROR", {
      message: "合言葉（key）が一致しないため処理しません（署名検証を通っていない可能性）",
      destination: params.destination,
    });
    return;
  }

  // 受信した公式アカウント（destination）で部署を判別
  const departmentCode = findDepartmentByBotUserId(params.destination);
  if (!departmentCode) {
    writeLog("SYSTEM", "WEBHOOK", "ERROR", {
      message: "destination がどの部署の BOT_USER_ID とも一致しないため処理しません",
      destination: params.destination,
    });
    return;
  }
  useDepartment(departmentCode);

  new LineWebhookController(params).handle();
  return;
}

/**
 * POSTボディの安全なパース
 */
function parseRequestBody(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }
  return JSON.parse(e.postData.contents);
}

