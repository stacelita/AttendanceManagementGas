/**
 * WebHookの操作
 */
class LineWebhookController {
  /**
   * コンストラクタ
   */
  constructor(params) {
    this.params = params;
    this.event = params.events?.[0];
  }

  /**
   * 分岐処理
   */
  handle() {
    try {
      if (!this.event) return;

      switch (this.event.type) {
        // フォロー
        case LINE_EVENT.FOLLOW:
          this.handleFollow();
          break;
        // メッセージ
        case LINE_EVENT.MESSAGE:
          this.handleMessage();
          break;
      }
    } catch (e) {
      const errorDetail = {
        message: e.message,
        stack: e.stack,
        fileName: e.fileName,
        lineNumber: e.lineNumber,
        eventData: JSON.stringify(this.event)
      };  
      writeLog(this.event.source.userId, this.event.type, 'ERROR', errorDetail);
    }
  }

  /**
   * フォロー操作
   */
  handleFollow() {
    const userId = this.event.source.userId;
    const staffs = getRepositories().staffs;

    // 既に登録されている場合処理終了
    if (staffs.findByUserId(userId)) return;

    // LINEプロフィール情報を取得
    const profile = this.getProfile(userId);

    // シートに追加（A〜C列）
    const staff = new Staff();
    staff.userId = userId;
    staff.lineName = profile.displayName;
    staff.followedAt = new Date();
    staffs.add(staff);

    writeLog(userId, "follow", 'SUCCESS', {message : "SUCCESS" });
  }

  /**
   * LINEプロフィール取得
   */
  getProfile(userId) {
    try {
      return getLineClient().getProfile(userId);
    } catch {
      return { displayName: "名前取得不可" };
    }
  }

  /**
   * メッセージ操作
   */
  handleMessage() { 
    // テキストのみ処理
    if (this.event.message.type !== LINE_MESSAGE_TYPE.TEXT) return;

    let replyText = "";

    const userMsg = this.event.message.text;
    const userId = this.event.source.userId;

    // 送信者の氏名（氏名が登録済みのスタッフのみ。未登録なら undefined）
    // スタッフマスタの読み込みに時間がかかるため、氏名を使う処理のときだけ読む
    const getStaffName = () => getRepositories().staffs.findAll().find(x => x.userId === userId && x.name)?.name;

    // この後で読むシートを1回でまとめて読んでおく（BATCH_READ=true のときだけ）
    prefetchSheetValues(getAppConfig().spreadsheetId, this._sheetsNeededFor(userMsg));

    if (getRepositories().systemStatus.get().isMaintenance) {
      replyToUser(this.event.replyToken, "メンテナンス中です。しばらくお待ちください。");
      return;
    }

    // 勤務確認
    if (isWorkConfirmMessage(userMsg)) {
      replyText = this.confirmWork(userId, userMsg);
    }
    // 実績入力
    else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.ACHIEVE_DONE)) {
      replyText = "お疲れさまでした！";
    }
    // スタッフ情報入力
    else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.PROFILE_DONE)) {
      replyText = "スタッフ情報の登録が完了しました！";
    }
    // 店舗一覧クイックリプライ作成
    else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.SHOP_LIST)) {
      this.createShopQuickReplies(getStaffName());
      return;
    }
    // 店舗詳細(userMsgは店舗名)
    else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.SHOP_DETAIL)) {
      replyText = this.getShopDetail(userMsg, getStaffName());
    }
    else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.GET_ASSIGNED_STORE)) {
      replyText = this.getShift(userId, getStaffName());
    }
    else if(userMsg.length >= 10){
      this.notifyAdminOfFreeMessage(userId, getStaffName(), userMsg)
    }
    
    // 返信メッセージが設定されていた場合
    if (replyText) {
      replyToUser(this.event.replyToken, replyText);
    }

    writeLog(userId, "message", 'SUCCESS', {message : userMsg });
  }

  /**
   * メッセージの処理で読むシート（まとめて読むため）
   * ※ handleMessage の分岐と同じ順番・条件にすること
   */
  _sheetsNeededFor(userMsg) {
    const sheets = [SHEETS.SYSTEM_STATUS];
    if (isWorkConfirmMessage(userMsg)) {
      sheets.push(SHEETS.SCHEDULE);
    } else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.ACHIEVE_DONE) || startsWithPrefix(userMsg, MESSAGE_PREFIX.PROFILE_DONE)) {
      // シートは読まない
    } else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.SHOP_LIST)) {
      sheets.push(SHEETS.STAFF, SHEETS.SHIFT_TABLE);
    } else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.SHOP_DETAIL)) {
      sheets.push(SHEETS.STAFF, SHEETS.SHIFT_TABLE, SHEETS.STORE);
    } else if (startsWithPrefix(userMsg, MESSAGE_PREFIX.GET_ASSIGNED_STORE)) {
      sheets.push(SHEETS.STAFF, SHEETS.ADMIN, SHEETS.SHIFT_TABLE, SHEETS.HOLIDAY);
    } else if (userMsg.length >= 10) {
      sheets.push(SHEETS.STAFF, SHEETS.ADMIN);
    }
    return sheets;
  }

  /**
   * 勤務アラート確認
   */
  confirmWork(userId, userMsg) {
    const schedules = getRepositories().schedules;

    const targetDate = userMsg.split(":")[1];
    for (const schedule of schedules.findAll()) {
      if (schedule.userId !== userId) continue;

      const d = new Date(schedule.workDate);
      if (isNaN(d)) continue;

      const rowDate = toJstYmdSlash(d);
      if (rowDate === targetDate) {
        if (isPrevConfirmMessage(userMsg)) {
          schedule.prevCheck = CHECK_STATUS.DONE;
          schedules.updatePrevCheck(schedule);
          return "明日の勤務確認ありがとうございます。";
        } else if (isTodayConfirmMessage(userMsg)) {
          schedule.todayCheck = CHECK_STATUS.DONE;
          schedules.updateTodayCheck(schedule);
          return "当日の勤務確認ありがとうございます。";
        }
      }
    }

    return "該当する勤務データが見つかりませんでした。";
  }

  /**
   * 店舗クイックリプライ作成
   */
  createShopQuickReplies(staffName) {
    // 指定した氏名がシフトに入っている店舗一覧を取得
    const assignedStores = getRepositories().shiftTable.findStoreNamesByStaffName(staffName);

    if (assignedStores.length === 0) {
      // 割り当て店舗がない場合の処理
      const noStorePayload = {
        replyToken: this.event.replyToken,
        messages: [{ type: "text", text: "担当店舗が見つかりませんでした。" }]
      };
      lineApiFetch(LINE_API_URL.REPLY, noStorePayload);
      return;
    }
    // 取得した店舗リスト（配列）からボタンのアイテムを生成
    const quickReplyItems = assignedStores.map(storeName => {
      return {
        type: "action",
        action: {
          type: "message",
          label: storeName, // ボタンに表示される文字
          text: MESSAGE_PREFIX.SHOP_DETAIL + storeName   // タップした時に送信される文字
        }
      };
    });

    // ペイロード作成
    const payload = {
      replyToken: this.event.replyToken,
      messages: [
        {
          type: "text",
          text: "以下から店舗を選択してください。",
          quickReply: {
            items: quickReplyItems
          }
        }
      ]
    };

    // 送信
    lineApiFetch(LINE_API_URL.REPLY, payload);
  }

  /**
   * 店舗詳細取得
   */
  getShopDetail(userMsg, staffName){
    const storeName = userMsg.replace(MESSAGE_PREFIX.SHOP_DETAIL, "");
  
    // 1. 担当店舗一覧（配列）を取得
    const assignedStores = getRepositories().shiftTable.findStoreNamesByStaffName(staffName);
    
    // 担当店舗に含まれている、かつ店舗詳細にデータが存在する場合のみ詳細を返す
    return assignedStores.includes(storeName)
      ? (getRepositories().stores.findByStoreName(storeName)?.detail ?? "")
      : "この店舗の詳細は参照することができません。";
  }

  getAssignedSchedules(staffName ,isStaff = true) {
    const shiftTable = getRepositories().shiftTable;
    const shiftDates = shiftTable.findAllDates();
    if (shiftDates.length === 0) return "データがありません";

    const isUnconfirmed = getRepositories().systemStatus.get().isNextShiftUnconfirmed;

    const now = new Date();
    const currentYearMonth = Utilities.formatDate(now, "JST", "yyyy/MM"); // "2026/04" 形式

    const scheduleMap = new Map();

    // まず、A列にあるすべての日付をMapに登録する（初期値は空）
    shiftDates.forEach(shiftDate => {
      const rawDate = shiftDate.date;

      if (!rawDate || isNaN(new Date(rawDate).getTime())) {
        return;
      }
      const date = toJstYmdSlash(rawDate);
      if (date && isStaff) {
        scheduleMap.set(date, "");
      }
    });

    // シフト表を走査して予定を埋める（1日に複数箇所ある場合はカンマ区切りで追加）
    shiftTable.findAll()
      .filter(x => x.staffName === staffName)
      .forEach(x => {
        const date = toJstYmdSlash(x.date);
        if (!date) return;

        const current = scheduleMap.get(date);
        scheduleMap.set(date, current ? `${current}, ${x.storeName}` : x.storeName);
      });

    // 希望休を走査して予定を埋める（シフト表にない日付は無視）
    getRepositories().holidays.findAll()
      .filter(x => x.staffName === staffName)
      .forEach(x => {
        const date = toJstYmdSlash(x.date);
        if (!date || !scheduleMap.has(date)) return;

        const current = scheduleMap.get(date);
        scheduleMap.set(date, current ? `${current}, 希望休` : "希望休");
      });

    // 予定がない場合は「yyyy/MM/dd：」だけになる
    const sortedDates = Array.from(scheduleMap.keys()).sort();
    // --- 修正：フィルタ処理を加えてリスト化 ---
    const resultList = sortedDates
      .filter(date => {
        if (isUnconfirmed) {
          // 未確定の場合、日付の先頭(yyyy/MM)が今月と一致するかチェック
          return date.startsWith(currentYearMonth);
        }
        return true; // 確定済みならすべて通す
      })
      .map(date => {
        const detail = scheduleMap.get(date);
        return `${date}：${detail}`;
      });

    return resultList.length > 0 ? resultList.join("\n") : "予定はありません";
  }

  getShift(userId, staffName){
    let replyText = "";
    let isStaff = true;

    // 1. 管理者シートから対象のユーザーIDを持つデータを探す
    const adminData = getRepositories().admins.findByUserId(userId);

    // 2. データが存在し、かつ担当範囲が "ALL" ではない場合
    if (adminData && !adminData.isAllScope) {
      isStaff = false;
      const allowedTantoCodes = adminData.tantoshaCodes;

      // 3. 担当範囲のスタッフ（氏名登録済み）を抽出
      //    数値の担当者コードを文字列に変換して比較する
      const targetStaffs = getRepositories().staffs.findAll().filter(x =>
        x.userId && x.name && allowedTantoCodes.includes(String(x.tantoshaCode))
      );

      // 4. スタッフごとにシフトを組み立て
      targetStaffs.forEach(staff => {
        const schedules = this.getAssignedSchedules(staff.name, isStaff);

        replyText += `${staff.name}のシフト\n`;
        replyText += `${schedules}\n\n`; // 見やすさのために最後に空行を追加
      });
    }
    replyText += `${staffName}のシフト\n`;
    replyText += `${this.getAssignedSchedules(staffName, isStaff)}`;
    return replyText;
  }

  notifyAdminOfFreeMessage(userId, staffName, userMsg){
    const tantoshaCode = getRepositories().staffs.findByUserId(userId)?.tantoshaCode;

    // 全員担当 or 担当者コードが一致する管理者
    const targetAdmins = getRepositories().admins.findAll().filter(admin => admin.isInCharge(tantoshaCode));

    const message = `${staffName}さんから問い合わせがありました。\n【内容】\n${userMsg}`;

    let payload = "";
    targetAdmins.forEach(admin => {
      payload = {
        to: admin.userId,
        messages: [{ type: 'text', text: message }]
      };
      lineApiFetch(LINE_API_URL.PUSH, payload);
    });
  }
}
