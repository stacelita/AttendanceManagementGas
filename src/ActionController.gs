/**
 * LIFF からのリクエスト（action ごとの処理）
 *
 * ※レスポンスの形・文言は LIFF の画面（Cloudflare）と合わせているため変えないこと
 */
class ActionController {
  constructor(params) {
    this.params = params;
  }

  handle() {
    // 例外を LOG に記録するときのユーザー・処理名（本人確認で userId が書き換わる前の値）
    const logUserId = this.params.userId || "UNKNOWN_USER";
    const logAction = this.params.action || "UNKNOWN_ACTION";

    try {
      const authError = this._authenticate();
      if (authError) return authError;

      // 複数のシートを読む action は、1回でまとめて読んでおく（BATCH_READ=true のときだけ）
      prefetchSheetValues(getAppConfig().spreadsheetId, this._sheetsToRead());

      const handler = this._handlers()[this.params.action];
      return handler ? handler() : jsonResponse({ error: "unknown action" });
    } catch (e) {
      // 例外のときはレスポンスを返さない（従来どおり）
      writeLog(logUserId, logAction, "ERROR", errorLogContent(e, undefined));
    }
  }

  _handlers() {
    return {
      [ACTIONS.GET_ASSIGNED_STORE]: () => this.getAssignedStore(),
      [ACTIONS.RECORD_ACHIEVE]: () => this.recordAchieve(),
      [ACTIONS.GET_CATEGORY]: () => this.getCategory(),
      [ACTIONS.RECORD_PROFILE]: () => this.recordProfile(),
      [ACTIONS.GET_PROFILE]: () => this.getProfile(),
      [ACTIONS.IS_MAINTENANCE]: () => this.getMaintenanceStatus(),
      [ACTIONS.GET_PAGE_DATA]: () => this.getPageData(),
    };
  }

  /** 処理で読むシート（まとめて読むため。1枚しか読まない action はまとめても速くならないので空） */
  _sheetsToRead() {
    switch (this.params.action) {
      case ACTIONS.RECORD_ACHIEVE:
        return [SHEETS.SYSTEM_STATUS, SHEETS.SCHEDULE, SHEETS.STAFF, { sheetName: SHEETS.ACHIEVEMENT, a1: achievementKeysA1() }];
      case ACTIONS.RECORD_PROFILE:
      case ACTIONS.GET_PROFILE:
        return [SHEETS.SYSTEM_STATUS, SHEETS.STAFF];
      case ACTIONS.GET_PAGE_DATA:
        return [SHEETS.SYSTEM_STATUS, SHEETS.CONST];
      default:
        return [];
    }
  }

  // --- action ごとの処理 ---

  /** 指定日の勤務場所 */
  getAssignedStore() {
    const missing = this._missingParamsResponse(["userId", "targetDate"]);
    if (missing) return missing;

    const userId = this.params.userId;
    const targetDate = toJstCompactDate(this.params.targetDate);
    const schedule = getRepositories().schedules.findAll()
      .find(x => x.userId === userId && toJstCompactDate(x.workDate) === targetDate);

    // 読み取りだけの処理なので LOG には書かない
    return jsonResponse({ location: schedule ? schedule.storeName : "シフトなし" });
  }

  /** 勤務実績の登録（同じ勤務日の実績があれば、isOverwrite のときだけ上書き） */
  recordAchieve() {
    const repos = getRepositories();
    if (repos.systemStatus.get().isMaintenance) return errorResponse_(MAINTENANCE_MESSAGE);

    const missing = this._missingParamsResponse(["userId", "userName", "date", "categoryValue", "items"]);
    if (missing) return missing;

    const p = this.params;
    if (!Array.isArray(p.items)) return errorResponse_("items must be array");

    const workDate = toJstCompactDate(p.date);
    const isWorkDay = repos.schedules.findAll()
      .some(x => x.userId === p.userId && toJstCompactDate(x.workDate) === workDate);
    if (!isWorkDay) return errorResponse_("勤務日ではありません。");

    const existing = repos.achievements.findAllKeys()
      .find(x => String(x.userId) === String(p.userId) && toJstCompactDate(x.workDate) === workDate);
    if (existing && !p.isOverwrite) {
      return errorResponse_("既に情報が登録されています。更新する場合はチェックボックスを選択してください。");
    }

    const staffName = repos.staffs.findRegisteredName(p.userId);
    if (staffName === undefined) return errorResponse_("該当のスタッフは存在しません。");

    const achievement = new Achievement();
    if (existing) achievement.rowNumber = existing.rowNumber;
    achievement.registeredAt = new Date();
    achievement.userId = p.userId;
    achievement.staffName = staffName;
    achievement.workDate = p.date;
    achievement.storeName = p.store;
    achievement.categoryValue = p.categoryValue;
    achievement.items = JSON.stringify(p.items);
    achievement.uniqueProducts = p.uniqueProducts.trim() || "なし";
    achievement.memo = p.memo.trim() || "なし";

    if (existing) {
      repos.achievements.update(achievement);
    } else {
      repos.achievements.add(achievement);
    }

    // 勤務管理の実績入力状況を「入力済み」にする（勤務日のセルと yyyy/MM/dd の文字列をそのまま比べる）
    const schedule = repos.schedules.findAll()
      .find(x => x.userId === p.userId && x.workDate === toJstSlashDate(p.date));
    if (schedule) {
      schedule.achieveStatus = SCHEDULE_ACHIEVE_STATUS.DONE;
      repos.schedules.updateAchieveStatus(schedule);
    }

    writeLog(p.userId, p.action, "SUCCESS", { savedData: achievement.toRow() });
    return jsonResponse({ status: "success" });
  }

  /** スタッフ情報の登録（まだ氏名が登録されていない場合だけ） */
  recordProfile() {
    const repos = getRepositories();
    if (repos.systemStatus.get().isMaintenance) return errorResponse_(MAINTENANCE_MESSAGE);

    const missing = this._missingParamsResponse(["userId", "userName", "userKana", "birthDate", "station", "tel"]);
    if (missing) return missing;

    const p = this.params;
    const staff = repos.staffs.findAll().find(x => String(x.userId) === String(p.userId));
    if (!staff) return errorResponse_("User ID not found");
    if (staff.name !== "") return errorResponse_("既に情報が登録されています。");

    staff.name = p.userName;
    staff.nameKana = p.userKana;
    staff.birthday = p.birthDate;
    staff.station = p.station;
    staff.tel = p.tel;
    staff.status = STAFF_STATUS.ACTIVE;
    repos.staffs.updateProfile(staff);

    const savedData = [[staff.name, staff.nameKana, staff.birthday, staff.station, staff.tel]];
    writeLog(p.userId, p.action, "SUCCESS", { savedData: savedData });
    return jsonResponse({ status: "success", message: "Updated successfully" });
  }

  /** 登録済みのスタッフ情報（氏名が未登録なら profile: null）。画面の表示用に、メンテナンス状態も返す */
  getProfile() {
    // 従来どおり == で比べる
    const staff = getRepositories().staffs.findAll().find(x => x.userId == this.params.userId);
    const isRegistered = staff && staff.name !== "" && staff.name !== undefined && staff.name !== null;

    return jsonResponse({
      status: "success",
      profile: isRegistered ? {
        name: staff.name,
        furigana: staff.nameKana,
        birthday: staff.birthday,
        station: staff.station,
        phone: staff.tel,
      } : null,
      is_maintenance: getRepositories().systemStatus.get().isMaintenance,
    });
  }

  /** 定数シートの区分値の一覧 */
  getCategory() {
    const missing = this._missingParamsResponse(["kubunType"]);
    if (missing) return missing;
    return jsonResponse(this._categoryItems(this.params.kubunType));
  }

  getMaintenanceStatus() {
    return jsonResponse({ status: "success", is_maintenance: getRepositories().systemStatus.get().isMaintenance });
  }

  /**
   * 画面の表示に必要なものをまとめて返す（GAS の呼び出しを1回で済ませるため）
   *   kubunTypes：区分ID（カンマ区切り。例 "1,2"）
   * @return {status, is_maintenance, categories: {区分ID: [{value, name}]}}
   */
  getPageData() {
    const missing = this._missingParamsResponse(["kubunTypes"]);
    if (missing) return missing;

    const categories = {};
    String(this.params.kubunTypes).split(",")
      .map(x => x.trim())
      .filter(x => x)
      .forEach(kubunType => { categories[kubunType] = this._categoryItems(kubunType); });

    return jsonResponse({
      status: "success",
      is_maintenance: getRepositories().systemStatus.get().isMaintenance,
      categories,
    });
  }

  /** 区分IDの区分値 [{value, name}]（定数シートの並び順） */
  _categoryItems(kubunType) {
    return getRepositories().consts.findAll()
      .filter(x => String(x.categoryId) === kubunType)
      .map(x => ({ value: String(x.itemValue), name: String(x.itemName) }));
  }

  // --- 本人確認・入力チェック ---

  /**
   * 本人確認：LIFF の ID トークンを LINE で検証し、検証できた userId を使う
   * （個人のデータを扱う action のみ。送られてきた userId はそのまま信用しない）
   *   ・ID トークンあり：検証できない、または送られてきた userId と違えばエラー
   *   ・ID トークンなし：REQUIRE_ID_TOKEN=true ならエラー。そうでなければ従来どおり（移行期間用）
   * @return {TextOutput|null} エラーのレスポンス。問題なければ null
   */
  _authenticate() {
    if (!ACTIONS_WITH_USER.includes(this.params.action)) return null;

    const config = getAppConfig();
    const idToken = this.params.idToken;
    if (!idToken) {
      return config.requireIdToken ? errorResponse_(AUTH_ERROR_MESSAGE) : null;
    }

    const verified = config.liffChannelId ? getLineClient().verifyIdToken(idToken, config.liffChannelId) : null;
    if (!verified || !verified.sub || (this.params.userId && verified.sub !== this.params.userId)) {
      return errorResponse_(AUTH_ERROR_MESSAGE);
    }
    this.params.userId = verified.sub;
    return null;
  }

  /** 必須パラメータが足りなければエラーのレスポンス、足りていれば null */
  _missingParamsResponse(requiredKeys) {
    const missing = requiredKeys.filter(key => {
      const value = this.params[key];
      return value === undefined || value === null || value === "";
    });
    if (missing.length === 0) return null;
    return jsonResponse({ status: "error", message: "missing parameters", missing: missing });
  }
}

/** エラーのレスポンス */
function errorResponse_(message) {
  return jsonResponse({ status: "error", message: message });
}
