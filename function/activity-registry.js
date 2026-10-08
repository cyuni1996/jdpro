'use strict';

function activityKey(activity) {
    const url = new URL(activity.url);
    url.hash = ''; url.search = '';
    return [String(activity.name).trim(), url.href.replace(/\/$/, ''), String(activity.activityId || '')].join('|');
}

function evaluateActivity(activity, now = Date.now()) {
    let url;
    try { url = new URL(activity.url); } catch { return { state: '未验证', reason: '入口无效', enabled: false }; }
    if (url.protocol !== 'https:' || !(url.hostname === 'jd.com' || url.hostname.endsWith('.jd.com'))) return { state: '未验证', reason: '缺少京东官方入口', enabled: false };
    const start = Date.parse(activity.start), end = Date.parse(activity.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return { state: '未验证', reason: '起止日期未核实', enabled: false };
    if (end < now) return { state: '活动结束', reason: '官方规则有效期已结束', enabled: false };
    if (start > now) return { state: '未验证', reason: '活动尚未开始', enabled: false };
    if (!activity.freeDaily || !activity.eligibilityVerified || !activity.liveSuccess) return { state: '未验证', reason: '免费日常范围、账号资格或实时业务证据不足', enabled: false };
    return { state: '可用', reason: '规则及单账号业务成功已验证；新脚本默认关闭', enabled: false };
}

function deduplicateActivities(activities) {
    return [...new Map(activities.map(activity => [activityKey(activity), activity])).values()];
}
module.exports = { activityKey, evaluateActivity, deduplicateActivities };
