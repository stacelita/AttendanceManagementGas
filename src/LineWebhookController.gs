/**
 * LINE の Webhook（友だち追加・メッセージ）
 */
class LineWebhookController {
  constructor(params) {
    // 1回の Webhook に複数のイベントがあっても、最初の1件だけ処理する（従来どおり）
    this.event = params.events?.[0];
  }

  handle() {
    try {
      if (!this.event) return;
      if (this.event.type === LINE_EVENT.FOLLOW) this._handleFollow();
      if (this.event.type === LINE_EVENT.MESSAGE) this._handleMessage();
    } catch (e) {
      writeLog(this.event.source.userId, this.event.type, "ERROR", errorLogContent(e, this.event));
    }
  }

  // --- 友だち追加 ---

  /** スタッフマスタに未登録なら、LINE の表示名と追加日時を追加する */
  _handleFollow() {
    const userId = this.event.source.userId;
    const staffs = getRepositories().staffs;
    if (staffs.findByUserId(userId)) return;

    const staff = new Staff();
    staff.userId = userId;
    staff.lineName = this._lineDisplayName(userId);
    staff.followedAt = new Date();
    staffs.add(staff);

    writeLog(userId, "follow", "SUCCESS", { message: "SUCCESS" });
  }

  _lineDisplayName(userId) {
    try {
      return getLineClient().getProfile(userId).displayName;
    } catch {
      return "名前取得不可";
    }
  }

  // --- メッセージ ---

  _handleMessage() {
    if (this.event.message.type !== LINE_MESSAGE_TYPE.TEXT) return;

    const text = this.event.message.text;
    const userId = this.event.source.userId;
    const replyToken = this.event.replyToken;
    const route = this._route(text, userId);

    // このあと読むシートを1回でまとめて読んでおく（BATCH_READ=true のときだけ）
    prefetchSheetValues(getAppConfig().spreadsheetId, [SHEETS.SYSTEM_STATUS].concat(route.sheets));

    if (getRepositories().systemStatus.get().isMaintenance) {
      getLineClient().replyText(replyToken, MAINTENANCE_MESSAGE);
      return;
    }

    const replyText = route.run();
    if (route.repliesItself) return; // 自分で返信する処理は LOG に書かない（従来どおり）

    if (replyText) getLineClient().replyText(replyToken, replyText);
    writeLog(userId, "message", "SUCCESS", { message: text });
  }

  /**
   * メッセージの内容ごとの処理（上から順に判定する）
   *   sheets        ：処理で読むシート（まとめて読むため）
   *   run           ：処理。返信する文言を返す（返信しなければ空）
   *   repliesItself ：run の中で返信まで行う
   */
  _route(text, userId) {
    const startsWith = prefix => String(text || "").startsWith(prefix);
    // 送信者の氏名（スタッフマスタを読むのに時間がかかるため、使う処理のときだけ読む）
    const staffName = () => getRepositories().staffs.findRegisteredName(userId);

    if (startsWith(MESSAGE_PREFIX.PREV_DONE) || startsWith(MESSAGE_PREFIX.TODAY_DONE)) {
      return { sheets: [SHEETS.SCHEDULE], run: () => this._confirmWork(userId, text) };
    }
    if (startsWith(MESSAGE_PREFIX.ACHIEVE_DONE)) {
      return { sheets: [], run: () => "お疲れさまでした！" };
    }
    if (startsWith(MESSAGE_PREFIX.PROFILE_DONE)) {
      return { sheets: [], run: () => "スタッフ情報の登録が完了しました！" };
    }
    if (startsWith(MESSAGE_PREFIX.SHOP_LIST)) {
      return { sheets: [SHEETS.STAFF, SHEETS.SHIFT_TABLE], run: () => this._replyShopList(staffName()), repliesItself: true };
    }
    if (startsWith(MESSAGE_PREFIX.SHOP_DETAIL)) {
      return { sheets: [SHEETS.STAFF, SHEETS.SHIFT_TABLE, SHEETS.STORE], run: () => this._shopDetail(text, staffName()) };
    }
    if (startsWith(MESSAGE_PREFIX.GET_ASSIGNED_STORE)) {
      return { sheets: [SHEETS.STAFF, SHEETS.ADMIN, SHEETS.SHIFT_TABLE, SHEETS.HOLIDAY], run: () => this._shiftText(userId, staffName()) };
    }
    if (text.length >= 10) {
      return { sheets: [SHEETS.STAFF, SHEETS.ADMIN], run: () => this._notifyAdmins(userId, staffName(), text) };
    }
    return { sheets: [], run: () => "" };
  }

  /**
   * 前日確認・当日確認のボタン（"前日確認済み:yyyy/MM/dd"）で、勤務管理の確認欄を「確認済み」にする
   */
  _confirmWork(userId, text) {
    const schedules = getRepositories().schedules;
    const isPrevious = text.startsWith(MESSAGE_PREFIX.PREV_DONE);
    const targetDate = text.split(":")[1];

    const schedule = schedules.findAll().find(x => {
      if (x.userId !== userId) return false;
      const workDate = new Date(x.workDate);
      return !isNaN(workDate) && toJstSlashDate(workDate) === targetDate;
    });
    if (!schedule) return "該当する勤務データが見つかりませんでした。";

    if (isPrevious) {
      schedule.prevCheck = CHECK_STATUS.DONE;
      schedules.updatePrevCheck(schedule);
      return "明日の勤務確認ありがとうございます。";
    }
    schedule.todayCheck = CHECK_STATUS.DONE;
    schedules.updateTodayCheck(schedule);
    return "当日の勤務確認ありがとうございます。";
  }

  /** 担当店舗（シフトに入っている店舗）をボタンで選べるようにして返信する */
  _replyShopList(staffName) {
    const storeNames = getRepositories().shiftTable.findStoreNamesByStaffName(staffName);
    const line = getLineClient();

    if (storeNames.length === 0) {
      line.replyText(this.event.replyToken, "担当店舗が見つかりませんでした。");
      return;
    }
    line.reply(this.event.replyToken, [{
      type: "text",
      text: "以下から店舗を選択してください。",
      quickReply: {
        items: storeNames.map(storeName => ({
          type: "action",
          action: { type: "message", label: storeName, text: MESSAGE_PREFIX.SHOP_DETAIL + storeName },
        })),
      },
    }]);
  }

  /** 店舗詳細（担当店舗のものだけ） */
  _shopDetail(text, staffName) {
    const storeName = text.replace(MESSAGE_PREFIX.SHOP_DETAIL, "");
    const assignedStores = getRepositories().shiftTable.findStoreNamesByStaffName(staffName);
    if (!assignedStores.includes(storeName)) return "この店舗の詳細は参照することができません。";
    return getRepositories().stores.findByStoreName(storeName)?.detail ?? "";
  }

  /**
   * シフトの確認の返信
   * 担当範囲が限られた管理者には、担当スタッフのシフトも並べる（このときは予定のない日を省く）
   */
  _shiftText(userId, staffName) {
    const repos = getRepositories();
    const admin = repos.admins.findByUserId(userId);
    const isScopedAdmin = !!admin && !admin.isAllScope;

    let text = "";
    if (isScopedAdmin) {
      repos.staffs.findAll()
        .filter(x => x.userId && x.name && admin.tantoshaCodes.includes(String(x.tantoshaCode)))
        .forEach(staff => {
          text += `${staff.name}のシフト\n${this._scheduleText(staff.name, false)}\n\n`;
        });
    }
    return text + `${staffName}のシフト\n${this._scheduleText(staffName, !isScopedAdmin)}`;
  }

  /**
   * シフト表・希望休から、1人分の予定を「yyyy/MM/dd：店舗, 店舗, 希望休」の行で並べる
   * 来月のシフトが未確定の間は、今月の分だけ
   * @param {boolean} includeDaysWithoutShift シフト表にある日をすべて並べる（予定のない日は「yyyy/MM/dd：」）
   */
  _scheduleText(staffName, includeDaysWithoutShift) {
    const repos = getRepositories();
    const shiftDates = repos.shiftTable.findAllDates();
    if (shiftDates.length === 0) return "データがありません";

    const plans = new Map(); // yyyy/MM/dd → 予定
    const addPlan = (date, plan) => {
      const current = plans.get(date);
      plans.set(date, current ? `${current}, ${plan}` : plan);
    };

    if (includeDaysWithoutShift) {
      shiftDates.forEach(({ date }) => {
        if (!date || isNaN(new Date(date).getTime())) return;
        const day = toJstSlashDate(date);
        if (day) plans.set(day, "");
      });
    }
    repos.shiftTable.findAll()
      .filter(x => x.staffName === staffName)
      .forEach(x => {
        const day = toJstSlashDate(x.date);
        if (day) addPlan(day, x.storeName);
      });
    // 希望休は、上で並べた日のものだけ
    repos.holidays.findAll()
      .filter(x => x.staffName === staffName)
      .forEach(x => {
        const day = toJstSlashDate(x.date);
        if (day && plans.has(day)) addPlan(day, "希望休");
      });

    const isNextMonthUnconfirmed = repos.systemStatus.get().isNextShiftUnconfirmed;
    const thisMonth = Utilities.formatDate(new Date(), "JST", "yyyy/MM");
    const lines = Array.from(plans.keys()).sort()
      .filter(day => !isNextMonthUnconfirmed || day.startsWith(thisMonth))
      .map(day => `${day}：${plans.get(day)}`);
    return lines.length > 0 ? lines.join("\n") : "予定はありません";
  }

  /** 10文字以上の自由なメッセージを、送信者を担当する管理者へ知らせる */
  _notifyAdmins(userId, staffName, text) {
    const repos = getRepositories();
    const tantoshaCode = repos.staffs.findByUserId(userId)?.tantoshaCode;
    const message = textMessage(`${staffName}さんから問い合わせがありました。\n【内容】\n${text}`);

    const line = getLineClient();
    repos.admins.findAll()
      .filter(admin => admin.isInCharge(tantoshaCode))
      // 宛先が不正な管理者への送信に失敗すると、残りの管理者には送られない（既知の不具合 #6）
      .forEach(admin => line.push(admin.userId, [message]));
    return "";
  }
}
