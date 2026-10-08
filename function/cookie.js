'use strict';

// Cookie and pin handling stays local and never prints account credentials.
function parseCookies(value = '') {
    return [...new Set(String(value).split(/[&\r\n]+/).map(item => item.trim()).filter(Boolean))];
}

function decodePin(value) {
    try { return decodeURIComponent(value.trim()); } catch { return value.trim(); }
}

function cookiePin(cookie) {
    const match = /(?:^|;)\s*pt_pin=([^;]*)/.exec(cookie);
    return match ? decodePin(match[1]) : '';
}

function matchingPins(rule, scriptName = '') {
    if (!rule) return null;
    const entries = String(rule).split('&').map(item => item.trim()).filter(Boolean);
    const matched = entries.filter(entry => {
        const separator = entry.indexOf('@');
        if (separator < 0) return true;
        return entry.slice(0, separator).split('|').some(task => task.trim() && scriptName.includes(task.trim()));
    });
    if (!matched.length) return null;
    return [...new Set(matched.flatMap(entry => {
        const separator = entry.indexOf('@');
        return (separator < 0 ? entry : entry.slice(separator + 1)).split(',').map(decodePin).filter(Boolean);
    }))];
}

function filterCookies(cookies, { BANPIN, ALLOWPIN } = {}, scriptName = '') {
    const banned = matchingPins(BANPIN, scriptName);
    const allowed = matchingPins(ALLOWPIN, scriptName);
    let result = banned === null ? cookies : cookies.filter(cookie => !banned.includes(cookiePin(cookie)));
    if (allowed !== null) {
        result = [...new Set(allowed.flatMap(pin => result.filter(cookie => cookiePin(cookie) === pin)))];
    }
    return result;
}

module.exports = { parseCookies, cookiePin, matchingPins, filterCookies };
