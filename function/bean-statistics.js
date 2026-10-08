'use strict';

// A failed or incomplete query never becomes a zero balance/income.
async function collectBeanDetails(fetchPage, { now = Date.now, maxPages = 40, maxDurationMs = 180000 } = {}) {
    const started = now(), today = Math.floor((started + 28800000) / 86400000) * 86400000 - 28800000;
    const result = { todayIncome: 0, todayExpense: 0, yesterdayIncome: 0, yesterdayExpense: 0, events: {} };
    let previous = Infinity;
    const unknown = reason => ({ known: false, reason });
    for (let page = 1; page <= maxPages && now() - started < maxDurationMs; page++) {
        const response = await fetchPage(page);
        if (!response?.ok) return unknown(response?.reason || '查询失败');
        const list = response.data?.detailList ?? response.data?.jingDetailList;
        if (!Array.isArray(list)) return unknown('明细字段缺失');
        if (!list.length) return { known: true, ...result, pages: page };
        for (const item of list) {
            const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(item.date || '') ? Date.parse(item.date.replace(' ', 'T') + '+08:00') : NaN;
            const amount = Number(item.amount);
            if (!Number.isFinite(date) || item.amount === '' || item.amount == null || !Number.isFinite(amount) || typeof item.eventMassage !== 'string') return unknown('明细数据格式异常');
            if (date > previous) return unknown('明细顺序变化；不能保证分页完整');
            previous = date;
            if (date < today - 86400000) return { known: true, ...result, pages: page };
            const isToday = date >= today;
            if (/退还|扣赠/.test(item.eventMassage) || (isToday && /物流/.test(item.eventMassage))) continue;
            const prefix = isToday ? 'today' : 'yesterday';
            if (amount > 0) { result[prefix + 'Income'] += amount; if (isToday) result.events[item.eventMassage] = (result.events[item.eventMassage] || 0) + amount; }
            else result[prefix + 'Expense'] -= amount;
        }
    }
    return unknown('达到分页或时间上限；统计不完整');
}

function formatBeanIncome(result) {
    return result.known ? `今日收入总计：${result.todayIncome}京豆\n` + Object.entries(result.events).map(([name, amount]) => `【${amount}豆】 ${name}`).join('\n') : `今日收入：未知（${result.reason}）`;
}
module.exports = { collectBeanDetails, formatBeanIncome };
