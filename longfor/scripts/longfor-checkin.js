/**
 * 龙湖APP自动签到脚本 - Surge优化版
 *
 * 功能：
 * 1. 自动完成龙湖APP每日签到，获取积分
 * 2. 自动完成抽奖活动签到和抽奖
 * 兼容：Surge (优化), Quantumult X, Loon, Shadowrocket
 * 
 * Surge优化内容：
 * - 优化HTTP客户端适配，正确处理超时时间单位
 * - 改进存储函数的错误处理和日志记录
 * - 优化通知函数参数格式，适配Surge的$notification.post
 * - 增强Token获取逻辑，支持多种header字段名格式
 * - 添加环境检测功能，提供更好的调试信息
 * - 改进错误处理和重试机制
 * - 优化日志系统，区分不同环境的日志格式
 * 
 * v2.0 更新内容（基于Python实现对比）：
 * - 更新活动号 activity_no 为最新值
 * - 支持小程序和APP双渠道模式（默认使用小程序模式，与Python版本一致）
 * - 更新请求头参数：X-LF-DXRisk-Source、X-LF-Bu-Code、X-LF-Channel
 * - 更新 Accept-Language 为 Python 版本格式
 * - 优化渠道配置，可通过 CHANNEL_MODE 切换小程序/APP模式
 */

// 配置常量
const CONFIG = {
    SCRIPT_NAME: '龙湖签到',
    TOKEN_KEY: 'longfor_token',
    DEBUG_MODE: false,
    RETRY_COUNT: 3,
    RETRY_DELAY: 2000,
    REQUEST_TIMEOUT: 10000,
    
    // API 配置
    API: {
        SIGN_IN: "https://gw2c-hw-open.longfor.com/lmarketing-task-api-mvc-prod/openapi/task/v1/signature/clock",
        LOTTERY_SIGN: "https://gw2c-hw-open.longfor.com/llt-gateway-prod/api/v1/activity/auth/lottery/sign",
        LOTTERY_DRAW: "https://gw2c-hw-open.longfor.com/llt-gateway-prod/api/v1/activity/auth/lottery/click"
    },
    
    // 活动配置（易于更新）
    ACTIVITY: {
        SIGN_IN_NO: "11111111111736501868255956070000", // 更新为Python版本使用的活动号
        LOTTERY_COMPONENT: "CC16D30B58Y4B15D",
        LOTTERY_ACTIVITY: "AP26N042T9O1TTQC"
    },
    
    // 渠道配置（支持小程序和APP两种模式）
    CHANNEL: {
        // 小程序渠道（微信小程序，Python版本使用）
        MINIPROGRAM: {
            'X-LF-DXRisk-Source': '5',
            'X-LF-Bu-Code': 'C20400',
            'X-LF-Channel': 'C2',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Mac MacWechat/WMPF MacWechat/3.8.7(0x13080712) UnifiedPCMacWechat(0xf2641411) XWEB/16990'
        },
        // APP渠道（龙湖APP，原JS版本使用）
        APP: {
            'X-LF-DXRisk-Source': '2',
            'X-LF-Bu-Code': 'L00602',
            'X-LF-Channel': 'L0',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 &MAIAWebKit_iOS_com.longfor.supera_1.14.0_202506052233_Default_3.2.4.8'
        }
    },
    
    // 当前使用的渠道模式（'miniprogram' 或 'app'）
    CHANNEL_MODE: 'miniprogram', // 默认使用小程序模式（与Python版本一致）
    
    // 通用请求头（基础头，会根据渠道模式动态调整）
    COMMON_HEADERS: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9', // 更新为Python版本格式
        'Content-Type': 'application/json',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site'
    }
}

// 工具函数 - 优化Surge日志输出
function log(message, level = 'INFO') {
    const timestamp = new Date().toLocaleTimeString()
    const prefix = CONFIG.DEBUG_MODE ? `[${timestamp}][${level}] ` : ''
    
    // 在 Surge 环境中优化日志输出格式
    if (typeof $notification !== 'undefined') {
        // Surge 环境
        console.log(`${prefix}🐉 龙湖签到 | ${message}`)
    } else {
        // 其他环境
        console.log(`${prefix}██ ${message}`)
    }
}

function logError(message, error) {
    const errorMsg = typeof error === 'object' ? (error.message || JSON.stringify(error)) : error
    log(`❌ ${message}: ${errorMsg}`, 'ERROR')
}

function logDebug(message) {
    if (CONFIG.DEBUG_MODE) {
        log(`🔍 ${message}`, 'DEBUG')
    }
}

function isEmpty(obj) {
    return typeof obj === "undefined" || obj === null || obj === "" || obj.length === 0
}

function getVal(key, defaultValue = '') {
    try {
        let value
        // Surge 环境优先使用 $persistentStore
        if (typeof $persistentStore !== 'undefined') {
            value = $persistentStore.read(key)
        } else if (typeof $prefs !== 'undefined') {
            // Quantumult X 环境
            value = $prefs.valueForKey(key)
        }
        
        // 确保返回值不为 undefined 或 null
        const result = (value !== undefined && value !== null && value !== '') ? value : defaultValue
        logDebug(`获取存储值 ${key}: ${result ? '已获取' : '使用默认值'}`)
        return result
    } catch (e) {
        logError('获取存储值失败', e)
        return defaultValue
    }
}

function setVal(key, val) {
    try {
        let success = false
        // Surge 环境优先使用 $persistentStore
        if (typeof $persistentStore !== 'undefined') {
            success = $persistentStore.write(val, key)
        } else if (typeof $prefs !== 'undefined') {
            // Quantumult X 环境
            success = $prefs.setValueForKey(val, key)
        }
        
        if (success) {
            logDebug(`设置存储值成功 ${key}`)
        } else {
            logError('设置存储值失败', `key: ${key}, val: ${val}`)
        }
        return success
    } catch (e) {
        logError('设置存储值失败', e)
        return false
    }
}

function notify(subtitle, message, sound = '') {
    try {
        // Surge 环境优先使用 $notification
        if (typeof $notification !== 'undefined') {
            // Surge 的 $notification.post 参数顺序：title, subtitle, message, options
            const options = sound ? { sound: sound } : {}
            $notification.post(CONFIG.SCRIPT_NAME, subtitle, message, options)
            logDebug(`通知已发送: ${subtitle} - ${message}`)
        } else if (typeof $notify !== 'undefined') {
            // Quantumult X 和 Loon 环境
            $notify(CONFIG.SCRIPT_NAME, subtitle, message)
            logDebug(`通知已发送: ${subtitle} - ${message}`)
        } else {
            // 降级到控制台输出
            log(`📱 通知: ${subtitle} - ${message}`)
        }
    } catch (e) {
        logError('发送通知失败', e)
        // 降级到控制台输出
        log(`📱 通知(降级): ${subtitle} - ${message}`)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function validateToken(token) {
    return !isEmpty(token) && token.length > 10
}

function sanitizeToken(token) {
    return token ? `${token.substring(0, 10)}...` : '无效token'
}

// HTTP请求函数（带重试机制）- 优化Surge适配
async function httpPost(options, retryCount = CONFIG.RETRY_COUNT) {
    return new Promise((resolve, reject) => {
        const attemptRequest = (attempt) => {
            logDebug(`HTTP请求尝试 ${attempt}/${CONFIG.RETRY_COUNT}: ${options.url}`)
            
            const requestOptions = {
                ...options,
                timeout: CONFIG.REQUEST_TIMEOUT
            }
            
            const handleResponse = (error, response, data) => {
                if (error) {
                    logError(`请求失败 (尝试 ${attempt})`, error)
                    if (attempt < retryCount) {
                        log(`等待 ${CONFIG.RETRY_DELAY}ms 后重试...`)
                        setTimeout(() => attemptRequest(attempt + 1), CONFIG.RETRY_DELAY)
                    } else {
                        reject(new Error(`请求失败，已重试 ${retryCount} 次: ${error}`))
                    }
                } else {
                    logDebug(`请求成功: ${data?.substring(0, 100)}...`)
                    resolve({ response, data })
                }
            }
            
            // Surge 环境优先使用 $httpClient
            if (typeof $httpClient !== 'undefined') {
                // Surge 的 $httpClient.post 需要确保正确的参数格式
                const surgeOptions = {
                    url: requestOptions.url,
                    headers: requestOptions.headers,
                    body: requestOptions.body,
                    timeout: requestOptions.timeout / 1000 // Surge 使用秒为单位
                }
                $httpClient.post(surgeOptions, handleResponse)
            } else if (typeof $task !== 'undefined') {
                // Quantumult X 环境
                requestOptions.method = "POST"
                $task.fetch(requestOptions).then(response => {
                    handleResponse(null, response, response.body)
                }, reason => handleResponse(reason.error || reason, null, null))
            } else {
                reject(new Error("HTTP client not available"))
            }
        }
        
        attemptRequest(1)
    })
}

function isRequest() {
    return typeof $request !== "undefined"
}

function isMatch(reg) {
    return !!($request && $request.method !== 'OPTIONS' && $request.url.match(reg))
}

// 环境检测函数
function getEnvironment() {
    if (typeof $httpClient !== 'undefined' && typeof $persistentStore !== 'undefined') {
        return 'Surge'
    } else if (typeof $task !== 'undefined') {
        return 'Quantumult X'
    } else if (typeof $notification !== 'undefined' && typeof $prefs !== 'undefined') {
        return 'Loon'
    } else {
        return 'Unknown'
    }
}

function done(value = {}) {
    if (typeof $done !== 'undefined') {
        $done(value)
    }
}

// 获取当前渠道配置
function getChannelConfig() {
    return CONFIG.CHANNEL[CONFIG.CHANNEL_MODE.toUpperCase()] || CONFIG.CHANNEL.MINIPROGRAM
}

// 创建请求头
function createHeaders(token, extraHeaders = {}) {
    const channelConfig = getChannelConfig()
    return {
        ...CONFIG.COMMON_HEADERS,
        'User-Agent': channelConfig['User-Agent'], // 根据渠道模式设置User-Agent
        'X-LF-DXRisk-Source': channelConfig['X-LF-DXRisk-Source'],
        'X-LF-Bu-Code': channelConfig['X-LF-Bu-Code'],
        'X-LF-Channel': channelConfig['X-LF-Channel'],
        ...extraHeaders,
        'authtoken': token,
        'X-LF-UserToken': token,
        'token': token
    }
}

// 主要功能函数
async function doLotteryCheckIn() {
    const token = getVal(CONFIG.TOKEN_KEY)
    if (!validateToken(token)) {
        notify("抽奖签到失败", "请先打开龙湖APP登录获取token")
        log("抽奖签到失败: token无效")
        done()
        return
    }

    log(`开始执行抽奖签到，token: ${sanitizeToken(token)}`)

    try {
        const headers = createHeaders(token, {
            'Cookie': 'acw_tc=276aede117516477058858009e29e85ba7429dd0c2a1b3c6f8c5a55d36958a',
            'Origin': 'https://llt.longfor.com',
            'Referer': 'https://llt.longfor.com/',
            'X-LF-DXRisk-Source': '2',
            'X-LF-DXRisk-Token': '686808d2zGtwOykELsEwuul5epDPUIFcSTYY0Xr1',
            'bucode': 'L00602',
            'channel': 'L0',
            'x-gaia-api-key': '2f9e3889-91d9-4684-8ff5-24d881438eaf'
        })

        const signInBody = {
            "component_no": CONFIG.ACTIVITY.LOTTERY_COMPONENT,
            "activity_no": CONFIG.ACTIVITY.LOTTERY_ACTIVITY
        }

        const signInOptions = {
            url: CONFIG.API.LOTTERY_SIGN,
            headers: headers,
            body: JSON.stringify(signInBody)
        }

        log("开始执行抽奖活动签到...")
        const signInResult = await httpPost(signInOptions)
        const signInData = JSON.parse(signInResult.data)

        if (signInData.code === "0000") {
            log("抽奖活动签到成功，开始执行抽奖...")
            await performLottery(headers)
        } else if (signInData.code === "863036") {
            log("今日已签到，直接执行抽奖...")
            await performLottery(headers)
        } else {
            notify("抽奖签到异常", `签到返回码: ${signInData.code}, 消息: ${signInData.message || '未知错误'}`)
            log(`抽奖签到返回异常: ${signInResult.data}`)
            done()
        }
    } catch (error) {
        notify("抽奖签到失败", `签到请求失败: ${error.message}`)
        logError("抽奖签到失败", error)
        done()
    }
}

async function performLottery(headers) {
    const lotteryBody = {
        "component_no": CONFIG.ACTIVITY.LOTTERY_COMPONENT,
        "activity_no": CONFIG.ACTIVITY.LOTTERY_ACTIVITY,
        "batch_no": ""
    }

    const lotteryOptions = {
        url: CONFIG.API.LOTTERY_DRAW,
        headers: headers,
        body: JSON.stringify(lotteryBody)
    }

    try {
        log("开始执行抽奖...")
        const lotteryResult = await httpPost(lotteryOptions)
        const lotteryData = JSON.parse(lotteryResult.data)

        if (lotteryData.code === "0000") {
            const prize = lotteryData.data?.prize_name || "未知奖品"
            notify("抽奖成功", `恭喜获得: ${prize}`, "bell")
            log(`抽奖成功，获得奖品: ${prize}`)
        } else if (lotteryData.code === "863033") {
            notify("抽奖提醒", "今日已抽奖，明天再来吧")
            log("今日已抽奖")
        } else {
            notify("抽奖异常", `返回码: ${lotteryData.code}, 消息: ${lotteryData.message || '未知错误'}`)
            log(`抽奖返回异常: ${lotteryResult.data}`)
        }
    } catch (error) {
        notify("抽奖失败", `抽奖请求失败: ${error.message}`)
        logError("抽奖失败", error)
    }
    done()
}

function getToken() {
    if (isMatch(/\/supera\/member\/api\/bff\/pages\/v\d+_\d+_\d+\/v1\/user-info/)) {
        log('🔐 开始获取token')
        
        try {
            const headers = $request.headers
            logDebug(`请求头信息: ${JSON.stringify(headers, null, 2)}`)
            
            // 在 Surge 中，header 字段名可能会被规范化，需要多种方式尝试
            const token = headers["lmToken"] || headers["lmtoken"] || headers["LMTOKEN"] || 
                         headers["LmToken"] || headers["Lmtoken"] || headers["LMToken"] || 
                         headers["LM-Token"] || headers["lm-token"] || ""

            if (!token) {
                const headerKeys = Object.keys(headers).join(', ')
                notify("获取token失败", "请检查请求header中是否包含lmToken")
                logError("获取token失败", `未找到lmToken字段，当前header字段: ${headerKeys}`)
                return
            }

            const currentToken = getVal(CONFIG.TOKEN_KEY)
            if (!currentToken) {
                const success = setVal(CONFIG.TOKEN_KEY, token)
                if (success) {
                    notify("🎉 首次获取token成功", `token: ${sanitizeToken(token)}`)
                    log(`✅ 首次获取token成功: ${token}`)
                } else {
                    notify("token保存失败", "请检查存储权限")
                    logError("token保存失败", "setVal返回false")
                }
            } else if (currentToken !== token) {
                const success = setVal(CONFIG.TOKEN_KEY, token)
                if (success) {
                    notify("🔄 token已更新", `新token: ${sanitizeToken(token)}`)
                    log(`🔄 token已更新: ${token}`)
                } else {
                    notify("token更新失败", "请检查存储权限")
                    logError("token更新失败", "setVal返回false")
                }
            } else {
                logDebug(`token未变化: ${sanitizeToken(token)}`)
            }
        } catch (error) {
            notify("获取token失败", `处理token时出错: ${error.message}`)
            logError("获取token失败", error)
        }
    }
}

async function doSignIn() {
    const token = getVal(CONFIG.TOKEN_KEY)
    if (!validateToken(token)) {
        notify("签到失败", "请先打开龙湖APP登录获取token")
        log("签到失败: token无效")
        return false
    }

    log(`开始执行签到，token: ${sanitizeToken(token)}`)

    try {
        // 根据渠道模式设置不同的DXRisk-Token（如果需要可以后续从配置中读取）
        const channelConfig = getChannelConfig()
        const dxRiskToken = CONFIG.CHANNEL_MODE === 'miniprogram' 
            ? '69241b9d8mO6Xvo671jYFwzDu87Wi49cqnItzOC1' // Python版本使用的token
            : '68673780TZSEnm6nueRfRAziVGwXc5NyaH5z5vo1' // 原APP版本使用的token
        
        const headers = createHeaders(token, {
            'Content-Type': 'application/json;charset=UTF-8',
            'Cookie': 'acw_tc=ac11000117515948134458251e007763cde29cc35ff7b19c704ac2843e03fa',
            'Origin': 'https://longzhu.longfor.com',
            'Referer': 'https://longzhu.longfor.com/',
            'X-GAIA-API-KEY': 'c06753f1-3e68-437d-b592-b94656ea5517',
            'X-LF-DXRisk-Captcha-Token': 'undefined',
            'X-LF-DXRisk-Token': dxRiskToken
            // X-LF-Bu-Code, X-LF-Channel, X-LF-DXRisk-Source 已在 createHeaders 中根据渠道模式设置
        })

        const options = {
            url: CONFIG.API.SIGN_IN,
            headers: headers,
            body: JSON.stringify({"activity_no": CONFIG.ACTIVITY.SIGN_IN_NO})
        }

        const result = await httpPost(options)
        const data = JSON.parse(result.data)
        
        if (data.code === 200 || data.code === "0000") {
            notify("签到成功", `签到完成: ${data.message || '获得积分'}`)
            log(`签到成功: ${result.data}`)
            return true
        } else {
            notify("签到异常", `返回码: ${data.code}, 消息: ${data.message || '未知错误'}`)
            log(`签到返回异常: ${result.data}`)
            return false
        }
    } catch (error) {
        notify("签到失败", `请求失败: ${error.message}`)
        logError("签到失败", error)
        return false
    }
}

// 主执行逻辑
if (isRequest()) {
    // 请求阶段：获取token
    log(`🚀 脚本启动 - 环境: ${getEnvironment()} | 模式: Token获取`)
    getToken()
    done()
} else {
    // 定时任务阶段：执行签到和抽奖
    (async () => {
        try {
            log(`🚀 脚本启动 - 环境: ${getEnvironment()} | 模式: 定时签到`)
            
            const token = getVal(CONFIG.TOKEN_KEY)
            if (!validateToken(token)) {
                notify("请先获取token", "请打开龙湖APP登录")
                log("❌ 请先打开龙湖APP登录获取token")
                done()
                return
            }

            log(`✅ Token验证通过，开始执行签到和抽奖，token: ${sanitizeToken(token)}`)

            // 先执行常规签到
            const signInSuccess = await doSignIn()
            
            if (signInSuccess) {
                log("常规签到完成，等待1秒后开始执行抽奖签到...")
                await sleep(1000)
            } else {
                log("常规签到失败，但仍尝试执行抽奖签到...")
                await sleep(1000)
            }
            
            // 执行抽奖签到和抽奖
            await doLotteryCheckIn()
            
        } catch (error) {
            notify("执行失败", `脚本执行出错: ${error.message}`)
            logError("脚本执行失败", error)
            done()
        }
    })()
}
