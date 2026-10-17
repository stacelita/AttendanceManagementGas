/**
 * トリガーの作成・削除
 *
 * 毎日、次の流れでトリガーを作り直す（関数名はトリガーに登録されているため変えないこと）
 *   0:05  setupTrigger               … 全トリガーを削除し、0:15 と 11:30 のトリガーを作る
 *   0:15  createTriggerDayAlert      … 今日の勤務開始の 120・45・30 分前に dayAlert を作る
 *  11:30  createTriggerPM            … 全トリガーを削除し、午後の通知と翌日 0:05 のトリガーを作る
 *  13:00  createTriggerAchieveRemind … 今日の勤務終了時刻に sendAchieveRemind を作る
 * ※11:30 に全トリガーを削除するため、11:30 より後の dayAlert も消える（既知の不具合 #5）
 */

/** 午後に作るトリガー（関数・何日後・時・分） */
function afternoonTriggers_() {
  return [
    [updateWorkManagement, 0, 11, 45],
    [sendPreRemind, 0, 12, 0],
    [createTriggerAchieveRemind, 0, 13, 0],
    [reSendPreRemind, 0, 20, 0],
    [reSendAchieveRemind, 0, 21, 0],
    [sendAlertPreRemind, 0, 22, 0],
    [sendAlertAchieve, 0, 22, 0],
    [setupTrigger, 1, 0, 5],
  ];
}

/** 1日の最初のトリガーを作る */
function setupTrigger() {
  deleteAllTriggers_();
  createTriggerAtTime(createTriggerDayAlert.name, 0, 0, 15, 0);
  createTriggerAtTime(createTriggerPM.name, 0, 11, 30, 0);
}

/** 午後のトリガーを作る */
function createTriggerPM() {
  deleteAllTriggers_();
  afternoonTriggers_().forEach(([handler, addDays, hours, minutes]) =>
    createTriggerAtTime(handler.name, addDays, hours, minutes, 0)
  );
}

/** 今日の勤務開始の 120・45・30 分前に、当日のアラート（dayAlert）を作る */
function createTriggerDayAlert() {
  const { times, errors } = collectTodayScheduleTimes_(schedule => schedule.startTime);
  createTriggersBefore_(dayAlert.name, times, [120, 45, 30]);

  // 時刻を取得できなかった部署があれば、取得できた部署の分だけ作ったうえで失敗として記録する（自身は削除しない）
  throwDepartmentErrors(errors);
  deleteTrigger(createTriggerDayAlert.name);
}

/** 当日のアラート（当日確認・再送・管理者向け） */
function dayAlert() {
  sendDayRemind();
  reSendDayRemind();
  sendAlertDayRemind();
}

/** 今日の勤務終了時刻に、実績報告のお願い（sendAchieveRemind）を作る */
function createTriggerAchieveRemind() {
  const { times, errors } = collectTodayScheduleTimes_(schedule => schedule.endTime);
  createTriggersBefore_(sendAchieveRemind.name, times, [0]);

  // 時刻を取得できなかった部署があれば、取得できた部署の分だけ作ったうえで失敗として記録する
  throwDepartmentErrors(errors);
}

// --- 内部処理 ---

/**
 * 全部署の勤務管理から、今日の勤務の時刻（H:mm）を重複なしで集める
 * @param {function(Schedule): *} timeOf 勤務予定から時刻を取り出す
 */
function collectTodayScheduleTimes_(timeOf) {
  const today = toJstSlashDate(new Date());
  const { results, errors } = forEachDepartment(() =>
    getRepositories().schedules.findAll()
      .filter(x => x.workDate && toJstSlashDate(x.workDate) === today)
      .map(x => toJstHourMinute(timeOf(x)))
  );
  return { times: [...new Set(results.flatMap(x => x.value))], errors };
}

/**
 * 各時刻の指定分前にトリガーを作る（同じ時刻のトリガーは1つにまとめる）
 * @param {string[]} times "H:mm"
 * @param {number[]} minutesBeforeList 何分前に作るか
 */
function createTriggersBefore_(handlerName, times, minutesBeforeList) {
  const triggerTimes = new Set();
  times.forEach(time => {
    if (!time || typeof time !== "string") return;
    const [hours, minutes] = time.split(":").map(Number);
    minutesBeforeList.forEach(minutesBefore => {
      const at = new Date();
      at.setHours(hours, minutes, 0, 0);
      at.setMinutes(at.getMinutes() - minutesBefore);
      triggerTimes.add(`${at.getHours()}:${at.getMinutes()}`);
    });
  });

  triggerTimes.forEach(time => {
    const [hours, minutes] = time.split(":").map(Number);
    createTriggerAtTime(handlerName, 0, hours, minutes, 0);
  });
}

/** 指定の日時に1回だけ動くトリガーを作る */
function createTriggerAtTime(handlerName, addDays, hours, minutes, seconds) {
  const at = new Date();
  at.setDate(at.getDate() + addDays);
  at.setHours(hours);
  at.setMinutes(minutes);
  at.setSeconds(seconds);
  ScriptApp.newTrigger(handlerName).timeBased().at(at).create();
}

/** 指定の関数のトリガーをすべて削除する */
function deleteTrigger(handlerName) {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === handlerName);
  if (triggers.length === 0) {
    console.log("No matching triggers found.");
    return;
  }
  triggers.forEach(t => {
    ScriptApp.deleteTrigger(t);
    console.log(`Trigger for ${handlerName} deleted.`);
  });
}

function deleteAllTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}
