
/**
 * トリガー作成
 */
function createTriggerAtTime(trrigerName, addDays, hours, minutes, secounds) {
  var triggerDay = new Date();
  triggerDay.setDate(triggerDay.getDate() + addDays);
  triggerDay.setHours(hours);
  triggerDay.setMinutes(minutes);
  triggerDay.setSeconds(secounds);

  ScriptApp.newTrigger(trrigerName)
    .timeBased()
    .at(triggerDay)
    .create();
}

/**
 * トリガー削除
 */
function deleteTrigger(targetTriggerName) {
  var allTriggers = ScriptApp.getProjectTriggers();
  // 一致する関数名を持つトリガーをすべて抽出
  const triggers = allTriggers.filter(t => t.getHandlerFunction() === targetTriggerName);
  
  if (triggers.length > 0) {
    triggers.forEach(t => {
      ScriptApp.deleteTrigger(t);
      console.log(`Trigger for ${targetTriggerName} deleted.`);
    });
  } else {
    console.log("No matching triggers found.");
  }
}

/**
 * １日のトリガーを作成
 */
function setupTrigger(){
  var allTriggers = ScriptApp.getProjectTriggers();

  allTriggers.forEach(t => {
    ScriptApp.deleteTrigger(t);
  });

  createTriggerAtTime(createTriggerDayAlert.name, 0, 0, 15 ,0);
  createTriggerAtTime(createTriggerPM.name, 0, 11, 30 ,0);
}

/**
 * 午後のトリガーを作成
 */
function createTriggerPM() {
  var allTriggers = ScriptApp.getProjectTriggers();

  allTriggers.forEach(t => {
    ScriptApp.deleteTrigger(t);
  });
  createTriggerAtTime(updateWorkManagement.name, 0, 11, 45, 0);
  createTriggerAtTime(sendPreRemind.name, 0, 12, 0, 0);
  createTriggerAtTime(createTriggerAchieveRemind.name, 0, 13, 0 ,0);
  createTriggerAtTime(reSendPreRemind.name, 0, 20, 0, 0);
  createTriggerAtTime(reSendAchieveRemind.name, 0, 21, 0, 0);
  createTriggerAtTime(sendAlertPreRemind.name, 0, 22, 0, 0);
  createTriggerAtTime(sendAlertAchieve.name, 0, 22, 0, 0);
  createTriggerAtTime(setupTrigger.name, 1, 0, 5, 0);
}


/**
 * 当日確認のトリガーを作成
 */
function createTriggerDayAlert() {

  const todayStr = toJstYmdSlash(new Date());

  // 全部署の本日の開始時刻をh:mm形式で取得（同じ時刻は1つにまとめる）
  const { results, errors } = forEachDepartment(() =>
    getRepositories().schedules.findAll()
      .filter(x => x.workDate && toJstYmdSlash(x.workDate) === todayStr)
      .map(x => toJstTimeHM(x.startTime))
  );
  const startTimes = [...new Set(results.flatMap(x => x.value))];

  const triggerTimesSet = new Set();

  startTimes.forEach(timeStr => {
    if (!timeStr || typeof timeStr !== 'string') return;

    const [hours, minutes] = timeStr.split(':').map(Number);
    const baseDate = new Date();
    baseDate.setHours(hours, minutes, 0, 0);

    const offsets = [120, 45, 30];

    offsets.forEach(offset => {
      const targetTime = new Date(baseDate.getTime());
      targetTime.setMinutes(targetTime.getMinutes() - offset);
      
      // "HH:mm" 形式
      const timeKey = `${targetTime.getHours()}:${targetTime.getMinutes()}`;
      triggerTimesSet.add(timeKey);
    });
  });

  // トリガー作成
  triggerTimesSet.forEach(timeStr => {
    const [h, m] = timeStr.split(':').map(Number);
    createTriggerAtTime("dayAlert", 0, h, m, 0);
  });

  // 取得に失敗した部署があれば、取得できた部署の分だけ作成したうえで失敗として記録（自身は削除しない）
  throwDepartmentErrors(errors);

  // 自身を削除
  deleteTrigger(createTriggerDayAlert.name);
}

/**
 * 当日のアラート
 */
function dayAlert() {
  sendDayRemind();
  reSendDayRemind();
  sendAlertDayRemind();
}

/**
 * 実績入力リマインド作成
*/
function createTriggerAchieveRemind() {

  const todayStr = toJstYmdSlash(new Date());

  // 全部署の本日の終了時刻をh:mm形式で取得（同じ時刻は1つにまとめる）
  const { results, errors } = forEachDepartment(() =>
    getRepositories().schedules.findAll()
      .filter(x => x.workDate && toJstYmdSlash(x.workDate) === todayStr)
      .map(x => toJstTimeHM(x.endTime))
  );
  const endTimes = [...new Set(results.flatMap(x => x.value))];

  const triggerTimesSet = new Set();

  endTimes.forEach(timeStr => {
    if (!timeStr || typeof timeStr !== 'string') return;

    const [hours, minutes] = timeStr.split(':').map(Number);
    const baseDate = new Date();
    baseDate.setHours(hours, minutes, 0, 0);

    const offsets = [0];

    offsets.forEach(offset => {
      const targetTime = new Date(baseDate.getTime());
      targetTime.setMinutes(targetTime.getMinutes() - offset);
      
      // "HH:mm" 形式
      const timeKey = `${targetTime.getHours()}:${targetTime.getMinutes()}`;
      triggerTimesSet.add(timeKey);
    });
  });

  // トリガー作成
  triggerTimesSet.forEach(timeStr => {
    const [h, m] = timeStr.split(':').map(Number);
    createTriggerAtTime("sendAchieveRemind", 0, h, m, 0);
  });

  // 取得に失敗した部署があれば、取得できた部署の分だけ作成したうえで失敗として記録
  throwDepartmentErrors(errors);
}

