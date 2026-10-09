'use strict';

function taskItems(response) {
    return response?.success && Array.isArray(response.data?.taskItemList) ? response.data.taskItemList : [];
}

function pendingTasks(data) {
    return Array.isArray(data) ? data.filter(task => task && (task.taskFinished === false || Number(task.canDrawAwardNum) > 0)) : [];
}

async function selectTaskItemId(task, { details, runtime, random = Math.random }) {
    if (runtime?.state().stopped || !task) return null;
    if (typeof task.taskSourceUrl === 'string' && task.taskSourceUrl.trim()) return task.taskSourceUrl;
    let items;
    try { items = task.taskItemList == null ? await details() : task.taskItemList; }
    catch { return null; }
    if (runtime?.state().stopped || !Array.isArray(items)) return null;
    const ids = items.map(item => item?.pipeExt?.itemId).filter(id =>
        (typeof id === 'string' && id.trim().length > 0) || (typeof id === 'number' && Number.isFinite(id)));
    if (!ids.length) return null;
    const sample = random();
    return ids[Math.floor((Number.isFinite(sample) && sample >= 0 && sample < 1 ? sample : 0) * ids.length)];
}

async function assignWorkers(joys, workers, { assign, refresh, log = () => {}, now = Date.now, maxAssignments = 20, maxDurationMs = 120000 }) {
    const started = now(), seen = new Set();
    for (let count = 0; count < maxAssignments && now() - started < maxDurationMs; count++) {
        if (!Array.isArray(joys) || !Array.isArray(workers)) return { reason: '庄园列表缺失', count };
        const empty = workers.find(w => w?.unlock && w.joyDTO === null);
        const joy = joys.filter(j => j && Number.isFinite(j.level) && j.id != null).sort((a, b) => b.level - a.level)[0];
        if (!empty || !joy) return { reason: '没有可分配的工位或宠物', count };
        const key = String(joy.id) + ':' + String(empty.location);
        if (seen.has(key)) return { reason: '分配后状态未变化；停止重复操作', count };
        seen.add(key);
        const response = await assign(joy.id, empty.location);
        if (response?.success !== true) return { reason: '分配未明确成功', count };
        log('工位分配成功');
        const next = await refresh();
        if (!next || !Array.isArray(next.activityJoyList) || !Array.isArray(next.workJoyInfoList)) return { reason: '刷新响应缺失', count: count + 1 };
        joys = next.activityJoyList; workers = next.workJoyInfoList;
    }
    return { reason: '达到操作次数或时间上限', count: seen.size };
}
module.exports = { taskItems, pendingTasks, selectTaskItemId, assignWorkers };
