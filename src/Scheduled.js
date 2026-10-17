
// 各トリガーから呼ばれるエントリーポイント（全部署を順番に処理する。各部署には、その部署の公式アカウントから送る）
function sendPreRemind()       { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.PREVIOUS)); }
function reSendPreRemind()     { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.PREVIOUS_RE)); }
function sendAlertPreRemind()  { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.PREVIOUS_ADMIN)); }
function sendDayRemind()       { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.TODAY)); }
function reSendDayRemind()     { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.TODAY_RE)); }
function sendAlertDayRemind()  { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.TODAY_ADMIN)); }
function sendAchieveRemind()   { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.ACHIEVE)); }
function reSendAchieveRemind() { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.ACHIEVE_RE)); }
function sendAlertAchieve()    { runForAllDepartments(() => processScheduleControl(ALERT_MESSAGE.ACHIEVE_ADMIN)); }

/**
 * 勤務確認の共通ロジック
 * @param {number} mode ALERT_MESSAGE
 * @param {Date} now 基準時刻（テスト用。トリガーからは省略され現在時刻になる）
 */
function processScheduleControl(mode, now = new Date()) {
  // dayAlert から3モード続けて呼ばれるため、モードごとに最新のシートを読む（従来どおり）
  clearRepositories();

  const ADMIN_MODE_LIST = [ALERT_MESSAGE.PREVIOUS_ADMIN, ALERT_MESSAGE.TODAY_ADMIN, ALERT_MESSAGE.ACHIEVE_ADMIN];
  const PRE_MODE_LIST = [ALERT_MESSAGE.PREVIOUS, ALERT_MESSAGE.PREVIOUS_RE, ALERT_MESSAGE.PREVIOUS_ADMIN];
  // 設定の初期化
  const isPreRemind = PRE_MODE_LIST.includes(mode);
  const isAdminAlert = ADMIN_MODE_LIST.includes(mode);
  const targetDate = getTargetDate(isPreRemind, now);

  // データの取得（勤務予定）
  const schedules = getRepositories().schedules.findAll();

  // 送信対象者の抽出
  const targets = filterUnconfirmedTargets(mode, schedules, targetDate, isPreRemind, now);
  if (targets.length === 0) return;

  // 通知の実行
  if (!isAdminAlert) {
    sendToStaffs(targets, mode, targetDate);
  } else {
    sendToAdmins(targets, mode, targetDate);
  }
}

// --- 抽出ロジック ---

/**
 * 送信対象となる未確認者をフィルタリング
 */
function filterUnconfirmedTargets(mode, schedules, targetDate, isPreRemind, now) {
  const stores = getRepositories().stores;
  // userId → スタッフ（同じIDが複数あれば後の行が優先）
  const staffById = new Map(getRepositories().staffs.findAll().map(x => [x.userId, x]));
  const achievements = getRepositories().achievements;
  return schedules.reduce((list, schedule) => {
    const workDate = schedule.workDate;
    const userId = schedule.userId;

    // 対象日以外のシフトを除外
    if (!workDate || toJstYmdSlash(workDate) !== targetDate) return list;

    // アラートOFFの店舗のシフトを除外
    if(stores.findByStoreName(schedule.storeName).isAlertOff) return list;

    // すでに確認済みならスキップ
    if(![ALERT_MESSAGE.ACHIEVE, ALERT_MESSAGE.ACHIEVE_ADMIN].includes(mode)) {
      const checkStatus = isPreRemind ? schedule.prevCheck : schedule.todayCheck;
      if (checkStatus === CHECK_STATUS.DONE) return list;
    }

    // --- 当日の通知タイミング判定 ---
    if ([ALERT_MESSAGE.TODAY, ALERT_MESSAGE.TODAY_RE, ALERT_MESSAGE.TODAY_ADMIN].includes(mode)) {
      const startTime = schedule.startTime;
      if (!startTime) return list;

      // 現在時刻から勤務開始までの「残り分」を計算
      const diffMinutes = getDiffMinutesFromNow(targetDate, startTime, now);

      // 当日確認は2時間前（120分前）
      if (mode === ALERT_MESSAGE.TODAY) {
        if (diffMinutes < 115 || diffMinutes > 125) return list;
      } 
      // 再:当日確認は45分前
      else if (mode === ALERT_MESSAGE.TODAY_RE) {
        if (diffMinutes < 40 || diffMinutes > 50)  return list;
      }
      // 当日管理者アラートは30分前
      else if (mode === ALERT_MESSAGE.TODAY_ADMIN) {
        if (diffMinutes < 25 || diffMinutes > 35) return list;   // 30分前（30分前）
      }
    }
    // 実績入力の通知
    else if(mode === ALERT_MESSAGE.ACHIEVE)
    {
      const endTime = schedule.endTime;
      if (!endTime) return list;
      // 現在時刻から勤務終了までの「残り分」を計算
      const diffMinutes = getDiffMinutesFromNow(targetDate, endTime, now);
      // 勤務終了時刻に送信
      if (diffMinutes < -5 || diffMinutes > 5) return list;
    }
    // 実績入力管理者アラート
    else if(mode === ALERT_MESSAGE.ACHIEVE_ADMIN || mode === ALERT_MESSAGE.ACHIEVE_RE)
    {
      // 入力済みの人は除外
      const isEntered = achievements.findAllKeys().some(x =>
        x.userId === userId && toJstYmdSlash(x.workDate) === targetDate
      );
      if(isEntered) return list;
    }

    const tanto = staffById.get(userId)?.tantoshaCode;
    list.push({
      userId: userId,
      userName: schedule.staffName,
      storeName: schedule.storeName,
      checkInTime: schedule.checkInTime,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      tantosha: tanto ? tanto : 0,
    });
    return list;
  }, []);
}

// --- 通知ロジック ---

/**
 * スタッフ個人への通知
 */
function sendToStaffs(targets, mode, dateStr) {
  targets.forEach(t => {
    const bodyContents = getFlexBodyContents(mode, dateStr, t.storeName, t.checkInTime, t.startTime, t.endTime);
    sendFlexConfirm(t.userId, bodyContents, dateStr, mode);
  });
}

/**
 * 管理者への一括通知
 */
function sendToAdmins(targets, mode, dateStr) {
  const admins = getRepositories().admins.findAll();
  admins.forEach(admin => {
    if (!admin.userId) return;

    // この管理者が担当するスタッフを抽出（全員担当 or 担当者コードが一致）
    const myTargets = targets.filter(t => admin.isInCharge(t.tantosha));

    // 担当する未実施者がいなければ送信しない
    if (myTargets.length === 0) return;

    // メッセージの組み立て
    const listText = myTargets.map(t => `・${t.userName}`).join("\n");
    const title = 
      mode === ALERT_MESSAGE.PREVIOUS_ADMIN ? "前日確認未実施者リスト" 
    : mode === ALERT_MESSAGE.ACHIEVE_ADMIN ? "実績未入力者リスト" 
    : "当日確認未実施者リスト";
    
    const bodyContents = createAdminListBodyContents(title, dateStr, listText);

    sendFlexConfirm(admin.userId, bodyContents, dateStr, mode, false);
  });
}

// --- ユーティリティ ---

/**
 * 対象日付の文字列を取得
 */
function getTargetDate(isPreRemind, now) {
  const targetDate = new Date(now.getTime());
  if (isPreRemind) targetDate.setDate(targetDate.getDate() + 1);
  return toJstYmdSlash(targetDate);
}

/**
 * Flex Messageのテンプレート作成
 */
function getFlexBodyContents(mode, date, storeName, checkInTime, startTime, endTime) {
  if(mode === ALERT_MESSAGE.ACHIEVE || mode === ALERT_MESSAGE.ACHIEVE_RE) return;
  const templateItem = getRepositories().consts.findAll().find(x =>
    x.categoryId === CONST_CATEGORY_ID.ALERT_TEMPLATE && x.itemValue === mode
  );

  if (!templateItem) return [];

  const template = templateItem.itemName
    .replace(/{{Date}}/g, toJstYmdSlash(date))
    .replace(/{{StoreName}}/g, storeName)
    .replace(/{{CheckInTime}}/g, toJstTimeHM(checkInTime))
    .replace(/{{StartTime}}/g, toJstTimeHM(startTime))
    .replace(/{{EndTime}}/g, toJstTimeHM(endTime))
    .replace(/{{TimeLimit}}/g, getMinutesBefore(startTime, 30));

  const titleMap = {
    [ALERT_MESSAGE.PREVIOUS]: "前日確認",
    [ALERT_MESSAGE.PREVIOUS_RE]: "【再】前日確認",
    [ALERT_MESSAGE.TODAY]: "当日確認",
    [ALERT_MESSAGE.TODAY_RE]: "【再】当日確認",
  };

  return createStaffAlertBodyContents(titleMap[mode] || "通知", template);
}

/**
 * LINE送信実行
 */
function sendFlexConfirm(userId, bodyContents, date, mode, needsFooter = true) {
  let payload;
  if(mode === ALERT_MESSAGE.ACHIEVE){
    payload = createAchieveAlertContents(userId);
  }
  else if(mode === ALERT_MESSAGE.ACHIEVE_RE) {
    payload = createReAchieveAlertContents(userId);
  }
  else{
    payload = createConfirmFlexPayload(userId, bodyContents, getAlertMessageConfig(mode, date), needsFooter);
  }

  lineApiFetch(LINE_API_URL.PUSH, payload);
}

/**
 * シフト抽出（トリガーから呼ばれる。全部署を処理し、すべて完了したら自身のトリガーを削除）
 */
function updateWorkManagement() {
  const results = runForAllDepartments(() => updateWorkManagementForDepartment_());

  // 明日の行が見つからなかった部署があれば、従来どおりトリガーを残す
  if (results.every(x => x.value)) {
    deleteTrigger(updateWorkManagement.name);
  }
}

/**
 * 現在の部署のシフト表から、明日の勤務予定を勤務管理へ転記
 * @return {boolean} 明日の行が見つかり処理したら true
 */
function updateWorkManagementForDepartment_() {
  // 明日の日付を取得
  let tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // 「シフト表(編集)」から明日の行を特定（同じ日付が複数行あれば最初の行）
  const shiftTable = getRepositories().shiftTable;
  const tomorrowRow = shiftTable.findAllDates().find(x => toJstYmd(new Date(x.date)) === toJstYmd(tomorrow));

  if (!tomorrowRow) {
    console.error("明日の日付がシフト表に見つかりませんでした。");
    return false;
  }

  const staffs = getRepositories().staffs.findAll();
  const stores = getRepositories().stores;

  // 追加する勤務予定
  const newSchedules = [];

  // 明日の行のセルを左の列から順に（場所と名前が両方ある場合のみ）
  const tomorrowAssignments = shiftTable.findAll()
    .filter(x => x.rowNumber === tomorrowRow.rowNumber && x.storeName && x.staffName);

  for (const assignment of tomorrowAssignments) {
    const store = stores.findByStoreName(assignment.storeName);
    tomorrow = toJstYmdSlash(tomorrow);

    const schedule = new Schedule();
    schedule.userId = staffs.find(x => x.name === assignment.staffName && x.userId)?.userId || "未登録";
    schedule.staffName = assignment.staffName;
    schedule.workDate = tomorrow;
    schedule.storeName = assignment.storeName;
    schedule.checkInTime = toJstTimeHM(store.checkInTime);
    schedule.startTime = toJstTimeHM(store.startTime);
    schedule.endTime = toJstTimeHM(store.endTime);
    newSchedules.push(schedule);
  }

  // 「勤務管理」シートへの書き込み（A〜G列、テキスト書式）
  if (newSchedules.length > 0) {
    getRepositories().schedules.addRange(newSchedules);

    console.log("書き込みが完了しました。件数: " + newSchedules.length);
  }

  return true;
}

/**
 * 時間差分取得
 */
function getDiffMinutesFromNow(dateStr, timeStr, now) {
  // dateStr: "2024/05/20", timeStr: "10:00" を結合してDateオブジェクト化
  const targetDateTime = new Date(`${dateStr} ${timeStr}`);
  const diffMs = targetDateTime.getTime() - now.getTime();
  return Math.floor(diffMs / (1000 * 60)); // ミリ秒を分に変換
}

function getMinutesBefore(startTime, minutesBefore) {
  const [hours, minutes] = startTime.split(':').map(Number);
  
  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes - minutesBefore); // 引数の分だけ差し引く
  date.setSeconds(0);

  // hh:mm 形式に整形（0埋め）
  const h = ("0" + date.getHours()).slice(-2);
  const m = ("0" + date.getMinutes()).slice(-2);
  
  return `${h}:${m}`;
}
