/*
此文件为Node.js专用。其他用户请忽略
 */
// 账号凭据仅从青龙环境变量 JD_COOKIE 读取。
const { parseCookies, filterCookies } = require('./function/cookie');
const scriptName = process.argv[1] || '';
let CookieJDs = filterCookies(parseCookies(process.env.JD_COOKIE), process.env, scriptName);
if (process.env.JD_DEBUG === 'false') console.log = () => {};
console.log(`\n====================共${CookieJDs.length}个京东账号Cookie=================`);
console.log(`===========脚本执行时间：${formatdate(new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60 * 1000 + 8 * 60 * 60 * 1000))}============`);
console.log('>>>>>>>>>>>>jdpro 维护版（原作者：6dylan6 等）>>>>>>>>>>>>>\n');
console.log(`Tips：‼️mck没法跑了，appck还能行，总之g了\n`);

for (let i = 0; i < CookieJDs.length; i++) {
    if (!CookieJDs[i].match(/pt_pin=(.+?);/) || !CookieJDs[i].match(/pt_key=(.+?);/)) console.log(`\n提示:第 ${i + 1} 个京东账号 Cookie 填写不规范,可能会影响部分脚本正常使用。正确格式为: pt_key=xxx;pt_pin=xxx;（分号;不可少）\n`);
    CookieJDs[i] = CookieJDs[i].replace(/[\u4e00-\u9fa5]/g, (str) => encodeURI(str));
    const index = (i + 1 === 1) ? '' : (i + 1);
    exports['CookieJD' + index] = CookieJDs[i].trim();
}
const permit = (process.env.PERMIT_JS || '').split('&').map(item => item.trim()).filter(Boolean);

if (process.env.DP_POOL) {
    if (permit.length === 0 || permit.some(keyword => scriptName.includes(keyword))) {
        try {
            require("global-agent").bootstrap();
            global.GLOBAL_AGENT.HTTP_PROXY = process.env.DP_POOL;
            global.GLOBAL_AGENT.NO_PROXY = process.env.NO_PROXY || '127.0.0.1,localhost';
            console.log(`\n---------------使用代理池模式---------------\n`);
        } catch {
            throw new Error(`请安装global-agent依赖，才能启用代理！`);

        }
    } else {

    }
}
function getIP() {
    const https = require('https');
    return new Promise((resolve, reject) => {
        let opt = {
            hostname: "www.cip.cc",
            port: 443,
            path: "/",
            method: "GET",
            headers: {
                "User-Agent": 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36',
            },
            timeout: 5000
        }
        const req = https.request(opt, (res) => {
            res.setEncoding('utf-8');
            let tmp = '';
            res.on('error', reject);
            res.on('data', d => tmp += d);
            res.on('end', () => resolve(tmp));
        });

        req.on('error', reject);
        req.end();
    });
}
// 以下为注入互助码环境变量（仅nodejs内起效）的代码
function SetShareCodesEnv(nameChinese = "", nameConfig = "", envName = "") {
    let rawCodeConfig = {}
    let fs = require('fs')
    // 读取互助码
    let shareCodeLogPath = fs.existsSync(`${process.env.QL_DIR}/data`) ? `${process.env.QL_DIR}/data/log/.ShareCode/${nameConfig}.log` : `${process.env.QL_DIR}/log/.ShareCode/${nameConfig}.log`;
    if (fs.existsSync(shareCodeLogPath)) {
        // 因为faker2目前没有自带ini，改用已有的dotenv来解析
        // // 利用ini模块读取原始互助码和互助组信息
        // let ini = require('ini')
        // rawCodeConfig = ini.parse(fs.readFileSync(shareCodeLogPath, 'utf-8'))

        // 使用env模块
        require('dotenv').config({ path: shareCodeLogPath })
        rawCodeConfig = process.env
    }

    // 解析每个用户的互助码
    let codes = {}
    Object.keys(rawCodeConfig).forEach(function (key) {
        if (key.startsWith(`My${nameConfig}`)) {
            codes[key] = rawCodeConfig[key]
        }
    });

    // 解析每个用户要帮助的互助码组，将用户实际的互助码填充进去
    let helpOtherCodes = {}
    Object.keys(rawCodeConfig).forEach(function (key) {
        if (key.startsWith(`ForOther${nameConfig}`)) {
            let helpCode = rawCodeConfig[key]
            for (const [codeEnv, codeVal] of Object.entries(codes)) {
                helpCode = helpCode.replace("${" + codeEnv + "}", codeVal)
            }

            helpOtherCodes[key] = helpCode
        }
    });

    // 按顺序用&拼凑到一起，并放入环境变量，供目标脚本使用
    let shareCodes = []
    let leftIndex = 1, rightIndex = Object.keys(helpOtherCodes).length

    // 判断是否是ptask并行触发，若是，则修改实际需要设置的互助码范围
    let ptaskLeft = process.env.PTASK_LEFT
    let ptaskRight = process.env.PTASK_RIGHT
    if (ptaskLeft && ptaskRight) {
        leftIndex = Number(ptaskLeft)
        rightIndex = Number(ptaskRight)
    }

    for (let idx = leftIndex; idx <= rightIndex; idx++) {
        shareCodes.push(helpOtherCodes[`ForOther${nameConfig}${idx}`])
    }
    let shareCodesStr = shareCodes.join('&')
    process.env[envName] = shareCodesStr

    let totalCodeCount = rightIndex - leftIndex + 1
    //console.info(`${nameChinese}的 互助码环境变量 ${envName}，共计 ${totalCodeCount} 组互助码，总大小为 ${shareCodesStr.length} 字节`)
}

// 判断当前活动脚本是否在互助脚本列表中
function IsShareJsFile() {
    // 尝试获取在task_before.sh中设置的 互助活动的脚本文件名的关键部分 列表
    let rawJsNameList = process.env.ShareCodeJSNameList
    if (!rawJsNameList) {
        return false
    }

    // 转换为list
    let jsNameList = process.env.ShareCodeJSNameList.split(" ")

    // 判断当前
    let currentActivityScriptFileName = GetCurrentActivityScriptFileName()

    let isShareJsFile = false
    for (let idx = 0; idx < jsNameList.length; idx++) {
        if (currentActivityScriptFileName.includes(jsNameList[idx])) {
            isShareJsFile = true
            break
        }
    }

    return isShareJsFile
}

// 获取当前活动脚本的文件名
function GetCurrentActivityScriptFileName() {
    const path = require('path')
    return path.basename(process.argv[1] || '')
}

// 若在task_before.sh 中设置了要设置互助码环境变量的活动名称和环境变量名称信息，则在nodejs中处理，供活动使用
let nameChinese = process.env.ShareCodeConfigChineseName
let nameConfig = process.env.ShareCodeConfigName
let envName = process.env.ShareCodeEnvName
if (nameChinese && nameConfig && envName) {
    SetShareCodesEnv(nameChinese, nameConfig, envName)
}
function formatdate(date) {
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    const hours = ('0' + date.getHours()).slice(-2);
    const minutes = ('0' + date.getMinutes()).slice(-2);
    const seconds = ('0' + date.getSeconds()).slice(-2);
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}
