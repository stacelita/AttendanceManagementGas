/**
 * LIFFからのactionを操作
 */
class ActionController {
  /**
   * コンストラクタ
   */
  constructor(params) {
    this.params = params;
  }

  /**
   * 必須パラメータ検証
   */
  _validateRequired(requiredKeys) {
    const missing = getMissingParams(this.params, requiredKeys);
    if (missing.length === 0) return null;
    return jsonResponse({
      status: "error",
      message: "missing parameters",
      missing: missing,
    });
  }

  /**
   * 本人確認：LIFF の ID トークンを LINE で検証し、検証できた userId を使う
   * （個人のデータを扱う action のみ。送られてきた userId はそのまま信用しない）
   *
   * ・ID トークンあり：検証に失敗、または送られてきた userId と一致しなければエラー
   * ・ID トークンなし：REQUIRE_ID_TOKEN=true ならエラー。そうでなければ従来どおり（移行期間用）
   * @return {TextOutput|null} エラー時のレスポンス。問題なければ null
   */
  _authenticate() {
    if (!ACTIONS_WITH_USER.includes(this.params.action)) return null;

    const config = getAppConfig();
    const idToken = this.params.idToken;
    if (!idToken) {
      return config.requireIdToken ? this._authErrorResponse() : null;
    }

    const verified = config.liffChannelId
      ? getLineClient().verifyIdToken(idToken, config.liffChannelId)
      : null;
    if (!verified || !verified.sub || (this.params.userId && verified.sub !== this.params.userId)) {
      return this._authErrorResponse();
    }

    this.params.userId = verified.sub;
    return null;
  }

  /**
   * action の処理で読むシート（まとめて読むため。1枚だけの action はまとめても速くならないので対象外）
   */
  _sheetsNeeded() {
    switch (this.params.action) {
      case ACTIONS.RECORD_ARCHIVE:
        return [SHEETS.SYSTEM_STATUS, SHEETS.SCHEDULE, SHEETS.STAFF, { sheetName: SHEETS.ARCHIVE, a1: achievementKeysA1() }];
      case ACTIONS.RECORD_PROFILE:
        return [SHEETS.SYSTEM_STATUS, SHEETS.STAFF];
      default:
        return [];
    }
  }

  _authErrorResponse() {
    return jsonResponse({ status: "error", message: AUTH_ERROR_MESSAGE });
  }

  /**
   * 分岐処理
   */
  handle() {
    // `doGet` 経由で `items` を文字列(JSON)として受け取るケースがあるため、配列に戻す
    if (this.params.action === ACTIONS.ARCHIVE && typeof this.params.items === "string") {
      try {
        this.params.items = JSON.parse(this.params.items);
      } catch {
        // パースできない場合はそのまま（recordAchieve側で型チェックしてエラー返却）
      }
    }
    let userId = 'UNKNOWN_USER';
    let action = 'UNKNOWN_ACTION';
    if (this.params) {
      userId = this.params.userId || 'UNKNOWN_USER';
      action = this.params.action || 'UNKNOWN_ACTION';
    }

    try {
      // 本人確認（個人のデータを扱う action のみ）
      const authError = this._authenticate();
      if (authError) return authError;

      // 複数のシートを読む action は、1回でまとめて読んでおく（BATCH_READ=true のときだけ）
      prefetchSheetValues(getAppConfig().spreadsheetId, this._sheetsNeeded());

      switch (this.params.action) {
        // 勤務場所取得
        case ACTIONS.GET_ASSIGNED_STORE :
          return this.getAssignedStore();

        // 実績入力
        case ACTIONS.RECORD_ARCHIVE:
          return this.recordAchieve();

        // 定数取得
        case ACTIONS.GET_CATEGORY:
          return this.getCategory();

        // スタッフ情報入力
        case ACTIONS.RECORD_PROFILE:
          return this.recordProfile();

        // スタッフ情報取得
        case ACTIONS.GET_PROFILE:
          return this.getProfile();

        // メンテナンス状態取得
        case ACTIONS.IS_MAINTENANCE:
          return this.getMaintenanceStatus();
          
        default:
          return jsonResponse({ error: "unknown action" });
      }
    } catch (e) {
      const errorDetail = {
        message: e.message,
        stack: e.stack,
        fileName: e.fileName,
        lineNumber: e.lineNumber,
        eventData: JSON.stringify(this.event)
      };  
      writeLog(userId, action, 'ERROR', errorDetail);
    }
  }

  /**
   * 勤務場所検索
   */
  getAssignedStore() {
    const validationError = this._validateRequired(["userId", "targetDate"]);
    if (validationError) return validationError;

    const userId = this.params.userId;
    const target = toJstYmd(this.params.targetDate);

    const schedule = getRepositories().schedules.findAll()
      .find(x => x.userId === userId && toJstYmd(x.workDate) === target);

    const result = schedule ? schedule.storeName : "シフトなし";

    // 読み取りだけの処理なので LOG には書かない（応答を速くするため。エラー時は handle() で記録する）
    return jsonResponse({ location: result });
  }

  /**
   * 実績入力
   */
  recordAchieve() {
    if (getRepositories().systemStatus.get().isMaintenance) {
      return jsonResponse({ status: "error", message: "メンテナンス中です。しばらくお待ちください。" });
    }
    const userId = this.params.userId;
    const validationError = this._validateRequired([
      "userId",
      "userName",
      "date",
      "categoryValue",
      "items",
    ]);
    if (validationError) return validationError;

    if (!Array.isArray(this.params.items)) {
      return jsonResponse({ status: "error", message: "items must be array" });
    }

    const schedule = getRepositories().schedules.findAll()
      .find(x => x.userId === userId && toJstYmd(x.workDate) === toJstYmd(this.params.date));
    if(!schedule){
      return jsonResponse({ status: "error", message: "勤務日ではありません。" });
    }

    // 同じスタッフ・同じ勤務日の実績が登録済みか（userId と勤務日の列だけ読む）
    const achievements = getRepositories().achievements;
    const existing = achievements.findAllKeys().find(x =>
      String(x.userId) === String(userId) &&
      toJstYmd(x.workDate) === toJstYmd(this.params.date)
    );

    if(existing && !this.params.isOverwrite)
        return jsonResponse({ status: "error", message: "既に情報が登録されています。更新する場合はチェックボックスを選択してください。" });

    // 氏名が登録済みのスタッフのみ対象
    const staffName = getRepositories().staffs.findAll().find(x => x.userId === userId && x.name)?.name;
    if(staffName === undefined)
      return jsonResponse({ status: "error", message: "該当のスタッフは存在しません。" });

    // 上書き時は既存の行、それ以外は新規
    const achievement = new Achievement();
    if (existing) achievement.rowNumber = existing.rowNumber;
    achievement.registeredAt = new Date();
    achievement.userId = userId;
    achievement.staffName = staffName;
    achievement.workDate = this.params.date;
    achievement.storeName = this.params.store;
    achievement.categoryValue = this.params.categoryValue;
    achievement.items = JSON.stringify(this.params.items);
    achievement.uniqueProducts = this.params.uniqueProducts.trim() || "なし";
    achievement.memo = this.params.memo.trim() || "なし";

    // A〜I列を書き込み、J列以降に商品ごとの数量の数式を設定
    if (existing) {
      achievements.update(achievement);
    } else {
      achievements.add(achievement);
    }

    // 勤務管理の実績入力状況を更新（勤務日のセル値と yyyy/MM/dd 文字列をそのまま比較）
    const schedules = getRepositories().schedules;
    const workSchedule = schedules.findAll()
      .find(x => x.userId === userId && x.workDate === toJstYmdSlash(this.params.date));

    if (workSchedule) {
      workSchedule.achieveStatus = SCHEDULE_ACHIEVE_STATUS.DONE;
      schedules.updateAchieveStatus(workSchedule);
    }
    // ログ出力
    writeLog(userId, this.params.action, 'SUCCESS', {savedData: achievement.toRow()});
    return jsonResponse({ status: "success" });
  }

  /**
   * スタッフ情報入力
   */
  recordProfile() {
    if (getRepositories().systemStatus.get().isMaintenance) {
      return jsonResponse({ status: "error", message: "メンテナンス中です。しばらくお待ちください。" });
    }

    const validationError = this._validateRequired([
      "userId",
      "userName",
      "userKana",
      "birthDate",
      "station",
      "tel",
    ]);
    if (validationError) return validationError;

    const targetId = this.params.userId;

    // 一致する行を検索（文字列として比較）
    const staff = getRepositories().staffs.findAll().find(x => String(x.userId) === String(targetId));
    if (!staff) {
      return jsonResponse({ status: "error", message: "User ID not found" });
    }

    if (staff.name !== "")
      return jsonResponse({ status: "error", message: "既に情報が登録されています。" });

    staff.name = this.params.userName;
    staff.nameKana = this.params.userKana;
    staff.birthday = this.params.birthDate;
    staff.station = this.params.station;
    staff.tel = this.params.tel;
    staff.status = STAFF_STATUS.ACTIVE; // 初期値として「有効」
    getRepositories().staffs.updateProfile(staff);

    // ログ出力
    const savedData = [[staff.name, staff.nameKana, staff.birthday, staff.station, staff.tel]];
    writeLog(targetId, this.params.action, 'SUCCESS', {savedData: savedData});
    return jsonResponse({ status: "success", message: "Updated successfully" });
  }

  // スタッフ情報取得
  getProfile() {
    const targetUserId = this.params.userId;

    // 条件に一致する最初のスタッフを取得（従来どおり == で比較）
    const staff = getRepositories().staffs.findAll().find(x => x.userId == targetUserId);

    const isRegistered = staff && staff.name !== "" && staff.name !== undefined && staff.name !== null;

    // 氏名が登録済みの場合のみオブジェクトを作成
    const profileData = isRegistered ? {
      name: staff.name,
      furigana: staff.nameKana,
      birthday: staff.birthday,
      station: staff.station,
      phone: staff.tel
    } : null;

    return jsonResponse({
      status: "success",
      profile: profileData
    });
  }

  /**
   * 区分値取得
   */
  getCategory() {
    const validationError = this._validateRequired(["kubunType"]);
    if (validationError) return validationError;

    const data = getRepositories().consts.findAll()
      .filter(x => String(x.categoryId) === this.params.kubunType)
      .map(x => ({
        value: String(x.itemValue),
        name: String(x.itemName)
      }));
    return jsonResponse(data);
  }

  getMaintenanceStatus(){
    return jsonResponse({ status: "success", is_maintenance: getRepositories().systemStatus.get().isMaintenance });
  }
}
