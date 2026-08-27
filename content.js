/**
 * content.js — единый код Twitch ModPanel.
 * Работает и как Content Script Chrome-расширения (MV3), и как код,
 * загружаемый лоадером twitch-modpanel.user.js в Tampermonkey (через eval).
 * Платформа определяется автоматически, вся логика одна.
 */

(function () {
    'use strict';

    // ============================================================================
    // Платформа и константы
    // ============================================================================

    const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

    const CLIENT_ID = 'qz89rtnd3uz3v7k3rnh5hffx3b97mu';
    const STORAGE_KEY_TOKEN = 'tmod_access_token';
    const STORAGE_KEY_USER = 'tmod_user_info';
    const GITHUB_RAW_ICONS = 'https://raw.githubusercontent.com/Stepanchikkk/twitch-modpanel/unified-core/icons/';

    let panelOpen = false;
    let panelElement = null;
    let panelPosition = null;

    const ICON_OK = '<svg style="vertical-align:-2px;margin-right:4px;" width="13" height="13" viewBox="0 0 24 24" fill="#00ff00"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    const ICON_ERR = '<svg style="vertical-align:-2px;margin-right:4px;" width="13" height="13" viewBox="0 0 24 24" fill="#ff6b6b"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    const ICON_TRASH = '<svg style="vertical-align:-3px;margin-right:6px;" width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
    const ICON_CLIP = '<svg style="vertical-align:-3px;margin-right:6px;" width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>';

    // Цвета анонсов: градиенты полосок — как у .announcement-line в чате Твича.
    const DEFAULT_TWITCH_PURPLE = '#9147ff';
    const ANNOUNCE_COLORS = [
        { value: 'primary', label: 'Цвет канала', stripe: null },
        { value: 'blue', label: 'Синий', stripe: `linear-gradient(#00d6d6, ${DEFAULT_TWITCH_PURPLE})` },
        { value: 'green', label: 'Зелёный', stripe: 'linear-gradient(#00db84, #57bee6)' },
        { value: 'orange', label: 'Оранжевый', stripe: 'linear-gradient(#ffb31a, #e0e000)' },
        { value: 'purple', label: 'Фиолетовый', stripe: `linear-gradient(${DEFAULT_TWITCH_PURPLE}, #ff75e6)` }
    ];

    // Акцент канала определяем каскадом (первый удачный источник побеждает):
    // 1) CSS-переменная --color-accent из обёрток ScAccentRegionCssVars
    // 2) фон декоративной полоски карточек (.tw-hover-accent-effect → ScEdgeLeft)
    // 3) инлайн border-color у primary-анонса в чате (.announcement-line без модификатора)
    // Если ничего не нашлось — null, рисуем дефолтный фиолетовый градиент.
    function isValidColor(value) {
        return !!value && value !== 'rgba(0, 0, 0, 0)' && value.trim() !== '' && !value.startsWith('url(');
    }

    // Отладка поиска акцента: включается через localStorage
    // (в консоли страницы: localStorage.setItem('TMOD_DEBUG','1')),
    // потому что консоль не видит переменные контент-скрипта/песочницы TM.
    const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let TMOD_DEBUG = false;
    try {
        TMOD_DEBUG = localStorage.getItem('TMOD_DEBUG') === '1'
            || window.TMOD_DEBUG === true
            || PAGE_WINDOW.TMOD_DEBUG === true;
    } catch (e) {}
    function debugLog(label, value) {
        if (TMOD_DEBUG) console.log('[ModPanel][accent]', label, value);
    }

    let cachedAccentColor = null;
    let cachedAccentChannel = null;
    let accentProbedAt = 0;

    function getChannelName() {
        return window.location.pathname.slice(1).split('/')[0] || null;
    }

    // Приоритет источников: 1) реальные primary-анонсы в чате (инлайн border-color —
    // ровно то, чем рисует Твитч), 2) ореол аватара канала, 3) CSS-переменные
    // --color-accent, 4) полоски карточек. Ничего не нашли — null (фолбэк-градиент).
    function getChannelAccentColor() {
        const channel = getChannelName();
        // Twitch — SPA: при переходе на другой канал кэш сбрасываем.
        if (cachedAccentColor && channel && cachedAccentChannel !== channel) {
            cachedAccentColor = null;
            accentProbedAt = 0;
        }
        if (channel) cachedAccentChannel = channel;

        if (cachedAccentColor) { debugLog('cache', cachedAccentColor); return cachedAccentColor; }
        // Неудачные попытки повторяем не чаще раза в 30 секунд,
        // чтобы не дёргать DOM при каждом открытии списка.
        if (accentProbedAt && Date.now() - accentProbedAt < 30000) return null;
        accentProbedAt = Date.now();

        let result = null;

        try {
            const lines = document.querySelectorAll('.announcement-line');
            debugLog('announcements', lines.length + ' found');
            for (const line of lines) {
                if (/announcement-line--/.test(line.className)) continue;
                const style = getComputedStyle(line);
                const color = style.borderInlineStartColor || style.borderLeftColor;
                if (isValidColor(color)) { result = color; break; }
            }
        } catch (e) {}

        if (!result) {
            try {
                const halo = document.querySelector('[class*="intermediateHalo"]')
                    || document.querySelector('[class*="avatarHaloContainer"] div');
                if (halo) {
                    const st = getComputedStyle(halo);
                    const cand = st.backgroundColor && st.backgroundColor !== 'rgba(0, 0, 0, 0)'
                        ? st.backgroundColor : null;
                    const grad = st.backgroundImage && st.backgroundImage !== 'none' ? st.backgroundImage : null;
                    debugLog('avatar-halo', { backgroundColor: cand, backgroundImage: grad });
                    if (isValidColor(cand)) result = cand;
                    else if (grad && grad.includes('gradient')) result = grad;
                } else {
                    debugLog('avatar-halo', 'no element');
                }
            } catch (e) {}
        }

        if (!result) {
            try {
                for (const el of [
                    document.querySelector('[class*="ScAccentRegionCssVars"]'),
                    document.body,
                    document.documentElement
                ]) {
                    if (!el) continue;
                    const cssVar = getComputedStyle(el).getPropertyValue('--color-accent').trim();
                    debugLog('css-var ' + (el.className || el.tagName).toString().slice(0, 40), cssVar);
                    if (isValidColor(cssVar)) { result = cssVar; break; }
                }
            } catch (e) {}
        }

        if (!result) {
            try {
                const edge = document.querySelector('.tw-hover-accent-effect [class*="ScEdgeLeft"]');
                if (edge) {
                    const bg = getComputedStyle(edge).backgroundColor;
                    debugLog('edge-card', bg);
                    if (isValidColor(bg)) result = bg;
                } else {
                    debugLog('edge-card', 'no element');
                }
            } catch (e) {}
        }

        if (!result) debugLog('result', 'fallback');
        if (result) cachedAccentColor = result;
        return result;
    }

    // Самообучение: после отправки нашего primary-анонса он появляется в чате,
    // считываем с него точный цвет (authoritative) и сохраняем по каналу навсегда.
    function learnAccentFromChat() {
        setTimeout(() => {
            try {
                const lines = document.querySelectorAll('.announcement-line');
                for (const line of lines) {
                    if (/announcement-line--/.test(line.className)) continue;
                    const style = getComputedStyle(line);
                    const color = style.borderInlineStartColor || style.borderLeftColor;
                    if (isValidColor(color)) {
                        cachedAccentColor = color;
                        const ch = getChannelName();
                        if (ch) storageSet('tmod_accent_' + ch, color);
                        debugLog('learned', color);
                        return;
                    }
                }
            } catch (e) {}
        }, 2500);
    }

    // Подхват сохранённого цвета канала из хранилища (переживает перезагрузки).
    async function warmAccentCache() {
        const ch = getChannelName();
        if (!ch || cachedAccentColor) return;
        const stored = await storageGet('tmod_accent_' + ch);
        if (stored && isValidColor(stored)) {
            cachedAccentColor = stored;
            debugLog('from-storage', stored);
        }
    }

    // Ручной вызов из консоли страницы: PAGE_WINDOW.getTMODAccent()
    try { PAGE_WINDOW.getTMODAccent = getChannelAccentColor; } catch (e) {}

    // ============================================================================
    // Адаптеры платформы (хранилище / HTTP / иконки / уведомления)
    // ============================================================================

    async function storageGet(key) {
        if (IS_EXTENSION) {
            return new Promise((resolve) => {
                chrome.storage.local.get([key], (result) => resolve(result[key] ?? null));
            });
        }
        return GM_getValue(key, null);
    }

    async function storageSet(key, value) {
        if (IS_EXTENSION) {
            return new Promise((resolve) => {
                chrome.storage.local.set({ [key]: value }, resolve);
            });
        }
        GM_setValue(key, value);
    }

    /**
     * Универсальный HTTP-запрос.
     * Расширение: fetch (host_permissions уже дают доступ к twitch.tv).
     * Юзерскрипт: GM_xmlhttpRequest (обходит CORS).
     * @returns {Promise<{status:number, ok:boolean, text:string}|{error:string}>}
     */
    function apiRequest(url, options = {}) {
        if (IS_EXTENSION) {
            return fetch(url, {
                method: options.method || 'GET',
                headers: options.headers,
                body: options.body
            })
                .then(async (r) => ({ status: r.status, ok: r.ok, text: await r.text() }))
                .catch((e) => ({ error: e.message }));
        }
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers,
                data: options.body,
                onload: (response) => resolve({
                    status: response.status,
                    ok: response.status >= 200 && response.status < 300,
                    text: response.responseText
                }),
                onerror: () => resolve({ error: 'Network error' })
            });
        });
    }

    /** URL файла иконки: расширение берёт из пакета, юзерскрипт — с GitHub raw. */
    function iconUrl(file) {
        if (IS_EXTENSION) return chrome.runtime.getURL('icons/' + file);
        return GITHUB_RAW_ICONS + file;
    }

    function notify(text) {
        if (!IS_EXTENSION && typeof GM_notification === 'function') {
            GM_notification({ title: 'Twitch ModPanel', text: text, timeout: 5000 });
        }
    }

    // Инжект twitch-api.js нужен только расширению: контент-скрипт живёт
    // в изолированном мире и достаёт до React Fiber через postMessage-мост.
    function injectTwitchAPI() {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('twitch-api.js');
        script.onload = function () { script.remove(); };
        (document.head || document.documentElement).appendChild(script);
    }

    if (IS_EXTENSION) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectTwitchAPI);
        } else {
            injectTwitchAPI();
        }
    }

    // ============================================================================
    // Токен и пользователь
    // ============================================================================

    async function getToken() {
        return storageGet(STORAGE_KEY_TOKEN);
    }

    async function setToken(token) {
        return storageSet(STORAGE_KEY_TOKEN, token);
    }

    async function getUserInfo() {
        return storageGet(STORAGE_KEY_USER);
    }

    async function setUserInfo(user) {
        return storageSet(STORAGE_KEY_USER, user);
    }

    // ============================================================================
    // Twitch Helix API
    // ============================================================================

    async function getCurrentUserId(token) {
        const response = await apiRequest('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': CLIENT_ID
            }
        });
        if (response.error) return null;
        try {
            const data = JSON.parse(response.text);
            return data.data[0]?.id || null;
        } catch (e) {
            return null;
        }
    }

    async function getChannelId(channelName, token) {
        const response = await apiRequest(`https://api.twitch.tv/helix/users?login=${channelName}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': CLIENT_ID
            }
        });
        if (response.error) return null;
        try {
            const data = JSON.parse(response.text);
            return data.data[0]?.id || null;
        } catch (e) {
            return null;
        }
    }

    async function sendAnnouncement(channelName, message, color = 'primary') {
        const token = await getToken();
        if (!token) return { success: false, error: 'No token' };

        const broadcasterId = await getChannelId(channelName, token);
        const userId = await getCurrentUserId(token);

        if (!broadcasterId || !userId) {
            return { success: false, error: 'Could not get IDs' };
        }

        const response = await apiRequest(
            `https://api.twitch.tv/helix/chat/announcements?broadcaster_id=${broadcasterId}&moderator_id=${userId}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message, color })
            }
        );

        if (response.error) return { success: false, error: response.error };
        if (response.status === 204) return { success: true };

        try {
            const error = JSON.parse(response.text);
            return { success: false, error: error.message || `API Error: ${response.status}` };
        } catch (e) {
            return { success: false, error: `API Error: ${response.status}` };
        }
    }

    async function getChatSettings(channelName) {
        const token = await getToken();
        if (!token) return null;

        const broadcasterId = await getChannelId(channelName, token);
        const userId = await getCurrentUserId(token);

        if (!broadcasterId || !userId) return null;

        const response = await apiRequest(
            `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${userId}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID
                }
            }
        );

        if (response.error || !response.ok) return null;
        try {
            const data = JSON.parse(response.text);
            const settings = data.data[0];
            return {
                slowMode: settings.slow_mode,
                slowModeWaitTime: settings.slow_mode_wait_time,
                followerMode: settings.follower_mode,
                followerModeWaitTime: settings.follower_mode_wait_time,
                subscriberMode: settings.subscriber_mode,
                emoteMode: settings.emote_mode
            };
        } catch (e) {
            return null;
        }
    }

    async function updateChatSettings(channelName, settings) {
        const token = await getToken();
        if (!token) return { success: false, error: 'No token' };

        const broadcasterId = await getChannelId(channelName, token);
        const userId = await getCurrentUserId(token);

        if (!broadcasterId || !userId) {
            return { success: false, error: 'Could not get IDs' };
        }

        const body = {};
        if (settings.slowMode !== undefined) {
            body.slow_mode = settings.slowMode;
            body.slow_mode_wait_time = settings.slowModeWaitTime || 30;
        }
        if (settings.followerMode !== undefined) {
            body.follower_mode = settings.followerMode;
            body.follower_mode_wait_time = settings.followerModeWaitTime || 0;
        }
        if (settings.subscriberMode !== undefined) {
            body.subscriber_mode = settings.subscriberMode;
        }
        if (settings.emoteMode !== undefined) {
            body.emote_mode = settings.emoteMode;
        }

        const response = await apiRequest(
            `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${userId}`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            }
        );

        if (response.error) return { success: false, error: response.error };
        if (response.status === 200) return { success: true };

        try {
            const error = JSON.parse(response.text);
            return { success: false, error: error.message || `API Error: ${response.status}` };
        } catch (e) {
            return { success: false, error: `API Error: ${response.status}` };
        }
    }

    // ============================================================================
    // Отправка в чат
    // ============================================================================

    // Расширение: postMessage-мост через инжектированный twitch-api.js.
    // Юзерскрипт: прямой доступ к React Fiber (код исполняется на странице).
    function getReactFiber(element) {
        for (const key in element) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
                return element[key];
            }
        }
        return null;
    }

    function findFiberParent(fiber, callback, maxDepth = 15, depth = 0) {
        if (!fiber || depth > maxDepth) return null;
        try { if (callback(fiber)) return fiber; } catch (e) {}
        if (fiber.return) return findFiberParent(fiber.return, callback, maxDepth, depth + 1);
        return null;
    }

    function getChatComponent() {
        const chatElement = document.querySelector('section[data-test-selector="chat-room-component-layout"]');
        if (!chatElement) return null;
        const fiber = getReactFiber(chatElement);
        if (!fiber) return null;
        const chatFiber = findFiberParent(fiber, (f) => f.stateNode && f.stateNode.props && f.stateNode.props.onSendMessage);
        return chatFiber?.stateNode;
    }

    function sendToChatInput(message) {
        if (IS_EXTENSION) {
            window.postMessage({ type: 'TMOD_SEND_CHAT', message: message }, '*');
            return true;
        }
        const chatComponent = getChatComponent();
        if (!chatComponent) { console.error('[ModPanel] Chat component not found'); return false; }
        chatComponent.props.onSendMessage(message);
        return true;
    }

    // ============================================================================
    // OAuth
    // ============================================================================

    // Юзерскрипт: окно + GitHub Pages callback + postMessage.
    async function startOAuthUserscript() {
        return new Promise((resolve) => {
            const redirectUri = 'https://stepanchikkk.github.io/twitch-modpanel/';
            const scopes = [
                'moderator:manage:announcements',
                'moderator:manage:chat_settings',
                'moderator:manage:chat_messages',
                'moderator:manage:banned_users',
                'channel:manage:polls',
                'channel:manage:predictions',
                'channel:read:redemptions',
                'channel:manage:redemptions',
                'channel:read:redemptions',
                'channel:manage:redemptions',
                'user:read:moderated_channels',
                'chat:read',
                'chat:edit',
                'user:write:chat',
                'channel:manage:broadcast',
                'moderator:manage:shoutouts',
                'moderator:read:chatters',
                'channel:manage:raids'
            ].join(' ');

            const authUrl = `https://id.twitch.tv/oauth2/authorize` +
                `?client_id=${CLIENT_ID}` +
                `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                `&response_type=token` +
                `&scope=${encodeURIComponent(scopes)}` +
                `&force_verify=true`;

            const width = 600;
            const height = 700;
            const left = Math.round((window.screen.width - width) / 2);
            const top = Math.round((window.screen.height - height) / 2);

            const authWindow = window.open(authUrl, 'TwitchOAuth', `width=${width},height=${height},left=${left},top=${top}`);

            if (!authWindow) { resolve({ success: false, error: 'Popup blocked' }); return; }

            let completed = false;
            let checkCount = 0;

            const messageHandler = (event) => {
                if (event.data?.type === 'TMOD_OAUTH_SUCCESS' && !completed) {
                    completed = true;
                    window.removeEventListener('message', messageHandler);
                    try { authWindow.close(); } catch (e) {}

                    apiRequest('https://api.twitch.tv/helix/users', {
                        headers: { 'Authorization': `Bearer ${event.data.token}`, 'Client-Id': CLIENT_ID }
                    }).then((r) => {
                        try {
                            const d = JSON.parse(r.text);
                            resolve({ success: true, token: event.data.token, user: d.data[0] });
                        } catch (e) { resolve({ success: true, token: event.data.token, user: { login: 'user' } }); }
                    });
                }
            };

            window.addEventListener('message', messageHandler);

            const checkWindow = setInterval(() => {
                if (authWindow.closed) {
                    clearInterval(checkWindow);
                    if (!completed) {
                        completed = true;
                        window.removeEventListener('message', messageHandler);
                        resolve({ success: false, error: 'Closed by user' });
                    }
                }
                checkCount++;
                if (checkCount > 240) {
                    clearInterval(checkWindow);
                    completed = true;
                    try { authWindow.close(); } catch (e) {}
                    window.removeEventListener('message', messageHandler);
                    resolve({ success: false, error: 'Timeout' });
                }
            }, 500);
        });
    }

    // Единая точка входа авторизации: расширение шлёт сообщение в background.js,
    // юзерскрипт открывает окно сам и сохраняет токен здесь же.
    async function authorize() {
        if (IS_EXTENSION) {
            return new Promise((resolve) => {
                try {
                    chrome.runtime.sendMessage({ type: 'OAUTH_START' }, (result) => {
                        if (chrome.runtime.lastError) {
                            resolve({ success: false, error: chrome.runtime.lastError.message });
                            return;
                        }
                        resolve(result || { success: false, error: 'No response' });
                    });
                } catch (e) {
                    resolve({ success: false, error: String(e) });
                }
            });
        }
        const result = await startOAuthUserscript();
        if (result.success) {
            await setToken(result.token);
            await setUserInfo(result.user);
        }
        return result;
    }

    // ============================================================================
    // Утилиты
    // ============================================================================

    function isStreamPage() {
        return /^\/[a-zA-Z0-9_]+$/.test(window.location.pathname);
    }

    // ============================================================================
    // Панель
    // ============================================================================

    function createPanel() {
        if (panelElement) panelElement.remove();

        const panel = document.createElement('div');
        panel.id = 'tmod-panel';

        let rightPos, bottomPos;

        if (!panelPosition) {
            const btnWrapper = document.getElementById('tmod-btn-wrapper');
            const btn = document.getElementById('tmod-btn');

            if (btnWrapper) {
                const wrapperRect = btnWrapper.getBoundingClientRect();
                const btnRect = btn.getBoundingClientRect();
                rightPos = window.innerWidth - wrapperRect.left + 10;
                bottomPos = window.innerHeight - btnRect.bottom;
            } else if (btn) {
                const btnRect = btn.getBoundingClientRect();
                rightPos = window.innerWidth - btnRect.left + 10;
                bottomPos = window.innerHeight - btnRect.bottom;
            } else {
                rightPos = 20;
                bottomPos = 20;
            }
        } else {
            rightPos = panelPosition?.right || 20;
            bottomPos = panelPosition?.bottom || 20;
        }

        panel.style.cssText = `
            position: fixed;
            right: ${rightPos}px;
            bottom: ${bottomPos}px;
            z-index: 999999;
            background: #0e0e10;
            border: 1px solid #3a3a3d;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            animation: tmod-slide-in 0.3s ease-out;
            user-select: none;
            -webkit-user-select: none;
            width: fit-content;
            min-width: 360px;
        `;

        const headerIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path fill-rule="evenodd" d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z" clip-rule="evenodd"></path></svg>';
        const announceIconUrl = iconUrl('icon-announce.svg');
        const chatIconUrl = iconUrl('icon-chat.svg');
        const pollIconUrl = iconUrl('icon-poll.svg');
        const predictionIconUrl = iconUrl('icon-prediction.svg');
        const clipIconUrl = iconUrl('icon-clip.svg');
        const rewardsIconUrl = iconUrl('icon-rewards.svg');
        const streamIconUrl = iconUrl('icon-stream.svg');

        panel.innerHTML = `
            <style>
                @keyframes tmod-slide-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
                .tmod-no-select { user-select: none !important; -webkit-user-select: none !important; }
                .tmod-feature-btn {
                    background: #18181b !important; border: 1px solid #3a3a3d !important; border-radius: 8px !important;
                    cursor: pointer !important; display: flex !important; flex-direction: row !important;
                    align-items: center !important; gap: 8px !important; text-align: left !important;
                    padding: 18px 16px !important; min-width: 120px !important; margin: 0 !important;
                    box-sizing: border-box !important; color: #efeff1 !important;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                    font-size: 14px !important; font-weight: 600 !important;
                }
                .tmod-feature-btn:hover { background: #26262c !important; border-color: #4f4f52 !important; }
                .tmod-feature-btn img { width: 24px !important; height: 24px !important; object-fit: contain !important; flex-shrink: 0 !important; filter: brightness(0) invert(1) !important; }
                .tmod-feature-btn .tmod-label { font-size: 14px !important; font-weight: 600 !important; color: #efeff1 !important; white-space: nowrap !important; }
                .tmod-toggle-active span:first-of-type { background-color: #9146FF !important; }
                .tmod-toggle-active span:last-of-type { transform: translateX(20px) !important; background-color: #fff !important; }
                .tmod-select-btn {
                    width: 100%; display: flex; align-items: center; gap: 10px;
                    background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px;
                    color: #efeff1; padding: 8px 10px; font-size: 14px; cursor: pointer;
                    font-family: inherit; text-align: left;
                }
                .tmod-select-btn:hover { border-color: #4f4f52; }
                .tmod-color-list {
                    margin-top: 6px; background: #18181b; border: 1px solid #3a3a3d;
                    border-radius: 8px; overflow: hidden;
                }
                .tmod-option {
                    display: flex; align-items: center; gap: 10px; padding: 9px 12px;
                    cursor: pointer; font-size: 14px; color: #efeff1;
                    border-inline-start: 8px solid transparent;
                    border-inline-end: 8px solid transparent;
                    border-image-slice: 1;
                }
                .tmod-option:hover { background: #26262c !important; }
                .tmod-option-selected { background: #1f1f23 !important; }
                #tmod-ccl-dropdown::-webkit-scrollbar { width: 4px; }
                #tmod-ccl-dropdown::-webkit-scrollbar-track { background: transparent; }
                #tmod-ccl-dropdown::-webkit-scrollbar-thumb { background: #3a3a3d; border-radius: 2px; }
                #tmod-ccl-dropdown::-webkit-scrollbar-thumb:hover { background: #555; }
                #tmod-ccl-dropdown { scrollbar-width: thin; scrollbar-color: #3a3a3d transparent; }
                #tmod-cat-results::-webkit-scrollbar { width: 4px; }
                #tmod-cat-results::-webkit-scrollbar-track { background: transparent; }
                #tmod-cat-results::-webkit-scrollbar-thumb { background: #3a3a3d; border-radius: 2px; }
                #tmod-cat-results::-webkit-scrollbar-thumb:hover { background: #555; }
            </style>
            <div class="tmod-no-select" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #18181b; border-bottom: 1px solid #3a3a3d; cursor: move; border-radius: 8px 8px 0 0;" id="tmod-panel-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${headerIcon}
                    <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #efeff1; pointer-events: none;">Панель модератора</h3>
                </div>
                <button id="tmod-panel-close" style="background: none; border: none; color: #adadb8; cursor: pointer; padding: 4px; font-size: 18px;">✕</button>
            </div>
            <div style="padding: 8px; border-radius: 0 0 8px 8px; min-width: 360px; box-sizing: border-box;" id="tmod-panel-content">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                    <button class="tmod-feature-btn" data-feature="announce"><img src="${announceIconUrl}" alt=""><span class="tmod-label">Анонс</span></button>
                    <button class="tmod-feature-btn" data-feature="chat"><img src="${chatIconUrl}" alt=""><span class="tmod-label">Чат</span></button>
                    <button class="tmod-feature-btn" data-feature="poll"><img src="${pollIconUrl}" alt=""><span class="tmod-label">Опрос</span></button>
                    <button class="tmod-feature-btn" data-feature="prediction"><img src="${predictionIconUrl}" alt=""><span class="tmod-label">Прогноз</span></button>
                    <button class="tmod-feature-btn" data-feature="clip"><img src="${clipIconUrl}" alt=""><span class="tmod-label">Клип</span></button>
                    <button class="tmod-feature-btn" data-feature="rewards"><img src="${rewardsIconUrl}" alt=""><span class="tmod-label">Награды</span></button>
                    <button class="tmod-feature-btn" data-feature="stream"><img src="${streamIconUrl}" alt=""><span class="tmod-label">Стрим</span></button>
                    <button class="tmod-feature-btn" data-feature="shoutout"><svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm0-4h-2V6h2v4z"/></svg><span class="tmod-label">Шаутаут</span></button>
                    <button class="tmod-feature-btn" data-feature="raid"><svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg><span class="tmod-label">Рейд</span></button>
                </div>
            </div>
        `;

        const header = panel.querySelector('#tmod-panel-header');
        let isDragging = false, startX, startY, startRight, startBottom;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startRight = window.innerWidth - rect.right; startBottom = window.innerHeight - rect.bottom;
            header.style.cursor = 'grabbing';
            document.addEventListener('mousemove', handleDragMove);
            document.addEventListener('mouseup', handleDragEnd);
        });

        function handleDragMove(e) {
            if (!isDragging) return;
            e.preventDefault();
            const dx = e.clientX - startX, dy = e.clientY - startY;
            let newRight = startRight - dx, newBottom = startBottom - dy;
            const panelRect = panel.getBoundingClientRect();
            newRight = Math.max(10, Math.min(newRight, window.innerWidth - panelRect.width - 10));
            newBottom = Math.max(10, Math.min(newBottom, window.innerHeight - panelRect.height - 10));
            panel.style.right = newRight + 'px'; panel.style.bottom = newBottom + 'px';
        }

        function handleDragEnd() {
            if (!isDragging) return;
            isDragging = false;
            header.style.cursor = 'move';
            const rect = panel.getBoundingClientRect();
            panelPosition = { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom };
            document.removeEventListener('mousemove', handleDragMove);
            document.removeEventListener('mouseup', handleDragEnd);
        }

        panel.querySelector('#tmod-panel-close').addEventListener('click', () => { panel.remove(); panelOpen = false; panelPosition = null; });

        panel.querySelectorAll('.tmod-feature-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const feature = this.dataset.feature;
                const rect = panel.getBoundingClientRect();
                panelPosition = { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom };
                if (feature === 'announce') showAnnounceSection(panel);
                else if (feature === 'chat') showChatSection(panel);
                else if (feature === 'poll') sendToChatInput('/poll');
                else if (feature === 'prediction') sendToChatInput('/prediction');
                else if (feature === 'clip') showClipSection(panel);
                else if (feature === 'rewards') sendToChatInput('/requests');
                else if (feature === 'stream') showStreamSection(panel);
                else if (feature === 'shoutout') showShoutoutSection(panel);
                else if (feature === 'raid') showRaidSection(panel);
            });
        });

        document.documentElement.appendChild(panel);
        panelOpen = true;
        panelElement = panel;
    }

    function showAnnounceSection(panel) {
        const channelName = window.location.pathname.slice(1);
        warmAccentCache();
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        const savedWidth = panel.getBoundingClientRect().width + 'px';
        panel.style.minWidth = savedWidth;
        panel.style.width = savedWidth;

        const historyKey = 'tmod_history_' + channelName;

        function loadHistory() {
            return storageGet(historyKey).then(history => {
                try { return JSON.parse(history || '[]'); } catch { return []; }
            });
        }

        function saveHistory(history) {
            return storageSet(historyKey, JSON.stringify(history));
        }

        function addToHistory(text, color) {
            loadHistory().then(history => {
                // Дедуп: если такой же текст уже есть — убираем старый, новый идёт вперёд
                const idx = history.findIndex(h => h.text === text && h.color === color);
                if (idx !== -1) {
                    history.splice(idx, 1);
                }
                const entry = { text, color, time: Date.now() };
                history.unshift(entry);
                if (history.length > 10) history.pop();
                saveHistory(history);
            });
        }

function renderHistory() {
            return loadHistory().then(history => {
                if (!history.length) return '';
                const arrowSvg = `<svg width="16" height="16" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m14.207 5 1.414 1.414-5.793 5.793L15.621 18l-1.414 1.414L7 12.207 14.207 5Z" fill="currentColor"></path></svg>`;
                const arrowBtn = (cls, rotated) => `
                    <button type="button" class="tmod-history-nav ${cls}" aria-label="${rotated ? 'Предыдущие' : 'Следующие'} анонсы"
                        style="flex: 0 0 auto; max-width: 0; height: 28px; border-radius: 999px; background: #18181b; border: 1px solid #3a3a3d; color: #efeff1; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0; overflow: hidden; pointer-events: none; transition: max-width 0.2s ease, opacity 0.2s ease;">
                        <span style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: 0 0 28px;">
                        ${rotated ? `<svg width="16" height="16" viewBox="0 0 24 24" focusable="false" aria-hidden="true" style="transform: rotate(180deg);"><path d="m14.207 5 1.414 1.414-5.793 5.793L15.621 18l-1.414 1.414L7 12.207 14.207 5Z" fill="currentColor"></path></svg>` : `<svg width="16" height="16" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m14.207 5 1.414 1.414-5.793 5.793L15.621 18l-1.414 1.414L7 12.207 14.207 5Z" fill="currentColor"></path></svg>`}
                        </span>
                    </button>`;

return `
                    <div class="tmod-history-bar" style="display: flex; align-items: center; gap: 0; margin-bottom: 8px; padding: 4px 0; min-width: 0;">
                        ${arrowBtn('tmod-history-prev', false)}
                        <div class="tmod-history-track" style="flex: 1 1 0%; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -ms-overflow-style: none; display: flex; gap: 6px; padding: 2px 4px; min-width: 0; width: 0;">
                            ${history.map((h, i) => {
                                const stripe = h.color === 'primary'
                                    ? (getChannelAccentColor() || '#9147ff')
                                    : (ANNOUNCE_COLORS.find(c => c.value === h.color)?.stripe || '#9147ff');
                                const fullText = h.text;
                                return `
                                    <button type="button" class="tmod-history-item" data-index="${i}" title="${fullText}"
                                        style="flex: 0 0 auto; padding: 5px 10px; border-radius: 999px; color: #efeff1; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px; min-width: 0; display: inline-flex; align-items: center; gap: 8px; border: 1px solid #3a3a3d; background: #18181b;">
                                        <span style="flex: 0 0 auto; width: 10px; height: 10px; border-radius: 999px; ${stripe.includes('gradient(') ? `background-image: ${stripe};` : `background-color: ${stripe};`}"></span>
                                        <span style="overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${h.text.slice(0, 45)}</span>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                        ${arrowBtn('tmod-history-next', true)}
                    </div>
                `;
            });
        }

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>←</span> <span>Назад</span></button>
            <div id="tmod-history-wrap"></div>
            <textarea id="tmod-announce-text" placeholder="Текст анонса (макс. 500 символов)" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px; resize: vertical;" rows="4"></textarea>
            <div id="tmod-color-wrap">
                <button type="button" class="tmod-select-btn" id="tmod-color-btn">
                    <span id="tmod-color-stripe" style="width: 8px; height: 18px; border-radius: 2px; flex-shrink: 0;"></span>
                    <span id="tmod-color-label">Цвет канала</span>
                    <span style="margin-left: auto; color: #adadb8;">▾</span>
                </button>
                <div class="tmod-color-list" id="tmod-color-list" hidden></div>
            </div>
            <button id="tmod-send-announce" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 10px;">Отправить</button>
            <div id="tmod-announce-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        // Загружаем и рендерим историю
        renderHistory().then(html => {
            const wrap = content.querySelector('#tmod-history-wrap');
            if (wrap) wrap.innerHTML = html;
            // Делегирование кликов: пункты истории + навигация + скролл
            if (wrap) {
                const track = wrap.querySelector('.tmod-history-track');
                const prevBtn = wrap.querySelector('.tmod-history-prev');
                const nextBtn = wrap.querySelector('.tmod-history-next');

                function updateNav() {
                    if (!track || !prevBtn || !nextBtn) return;
                    const atStart = track.scrollLeft <= 1;
                    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
                    prevBtn.style.maxWidth = atStart ? '0' : '28px';
                    prevBtn.style.opacity = atStart ? '0' : '1';
                    prevBtn.style.pointerEvents = atStart ? 'none' : 'auto';
                    nextBtn.style.maxWidth = atEnd ? '0' : '28px';
                    nextBtn.style.opacity = atEnd ? '0' : '1';
                    nextBtn.style.pointerEvents = atEnd ? 'none' : 'auto';
                }

                if (track) {
                    track.addEventListener('scroll', updateNav);
                    updateNav();
                }

                wrap.addEventListener('click', (e) => {
                    const item = e.target.closest('.tmod-history-item');
                    if (item) {
                        const idx = parseInt(item.dataset.index, 10);
                        loadHistory().then(history => {
                            const entry = history[idx];
                            if (entry) {
                                const textarea = content.querySelector('#tmod-announce-text');
                                if (textarea) {
                                    textarea.value = entry.text;
                                    textarea.focus();
                                }
                                if (entry.color && ANNOUNCE_COLORS.some(c => c.value === entry.color)) {
                                    selected.value = entry.color;
                                    updateButton();
                                    renderOptions();
                                }
                            }
                        });
                    }
                    const nav = e.target.closest('.tmod-history-nav');
                    if (nav && nav.style.maxWidth !== '0') {
                        const track = wrap.querySelector('.tmod-history-track');
                        if (track) {
                            const scrollAmount = track.clientWidth * 0.8;
                            track.scrollBy({ left: nav.classList.contains('tmod-history-next') ? scrollAmount : -scrollAmount, behavior: 'smooth' });
                        }
                    }
                });
            }
        });

        // Кастомный дропдаун цветов
        const selected = { value: 'primary' };
        const lastColorKey = 'tmod_color_' + channelName;
        const colorBtn = content.querySelector('#tmod-color-btn');
        const colorStripe = content.querySelector('#tmod-color-stripe');
        const colorLabel = content.querySelector('#tmod-color-label');
        const colorList = content.querySelector('#tmod-color-list');

        // Восстанавливаем последний выбранный на этом канале цвет
        storageGet(lastColorKey).then((saved) => {
            if (saved && ANNOUNCE_COLORS.some(c => c.value === saved) && selected.value !== saved) {
                selected.value = saved;
                renderOptions();
                updateButton();
            }
        });

        function rememberColor() {
            storageSet(lastColorKey, selected.value);
        }

        function stripeFor(color) {
            return color.value === 'primary' ? (getChannelAccentColor() || `linear-gradient(${DEFAULT_TWITCH_PURPLE}, #ff75e6)`) : color.stripe;
        }

        function renderOptions() {
            colorList.innerHTML = ANNOUNCE_COLORS.map((c, i) => {
                const stripe = stripeFor(c);
                const isSolid = !stripe.includes('gradient(');
                const borderColorStyle = isSolid
                    ? `border-inline-start-color:${stripe}; border-inline-end-color:${stripe};`
                    : 'border-image-source:' + stripe + ';';
                return `
                <div class="tmod-option${c.value === selected.value ? ' tmod-option-selected' : ''}" data-value="${c.value}"
                     style="${i > 0 ? 'box-shadow: inset 0 1px 0 #26262c;' : ''} ${borderColorStyle}">
                    <span>${c.label}</span>
                </div>`;
            }).join('');
        }

        function updateButton() {
            const current = ANNOUNCE_COLORS.find(c => c.value === selected.value);
            const stripe = stripeFor(current);
            colorLabel.textContent = current.label;
            if (stripe.includes('gradient(')) {
                colorStripe.style.backgroundImage = stripe;
                colorStripe.style.backgroundColor = 'transparent';
            } else {
                colorStripe.style.backgroundImage = 'none';
                colorStripe.style.backgroundColor = stripe;
            }
        }

        renderOptions();
        updateButton();

        let outsideCloser = null;
        colorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            renderOptions();
            colorList.hidden = !colorList.hidden;
            if (!colorList.hidden && !outsideCloser) {
                outsideCloser = (ev) => {
                    if (!colorBtn.parentElement.contains(ev.target)) {
                        colorList.hidden = true;
                        document.removeEventListener('click', outsideCloser);
                        outsideCloser = null;
                    }
                };
                document.addEventListener('click', outsideCloser);
            }
        });

        colorList.addEventListener('click', (e) => {
            const opt = e.target.closest('.tmod-option');
            if (!opt) return;
            e.stopPropagation();
            selected.value = opt.dataset.value;
            updateButton();
            rememberColor();
            colorList.hidden = true;
        });

        const rect = panel.getBoundingClientRect();
        if (rect.top < 0) {
            panel.style.bottom = Math.max(10, panelPosition.bottom + rect.top) + 'px';
        }

        content.querySelector('#tmod-back').addEventListener('click', () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); });

content.querySelector('#tmod-send-announce').addEventListener('click', async () => {
            const text = content.querySelector('#tmod-announce-text').value.trim();
            const color = selected.value;
            const statusDiv = content.querySelector('#tmod-announce-status');
            if (!text) { statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">Введите текст</span>'; return; }
            if (text.length > 500) { statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">Текст слишком длинный</span>'; return; }
            statusDiv.innerHTML = ICON_OK + '<span style="color:#adadb8;">Отправка...</span>';
            const result = await sendAnnouncement(channelName, text, color);
            if (result.success) {
                statusDiv.innerHTML = ICON_OK + '<span style="color:#00ff00;">Анонс отправлен!</span>';
                addToHistory(text, color);
                if (color === 'primary') learnAccentFromChat();
                setTimeout(() => { panel.remove(); createPanel(); }, 1500);
            }
            else { statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">' + result.error + '</span>'; }
        });
    }

    function showChatSection(panel) {
        const channelName = window.location.pathname.slice(1);
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        const savedWidth = panel.getBoundingClientRect().width + 'px';
        panel.style.minWidth = savedWidth;
        panel.style.width = savedWidth;

        if (!panel.querySelector('#tmod-chat-tile-styles')) {
            const s = document.createElement('style');
            s.id = 'tmod-chat-tile-styles';
            s.textContent = `
                @keyframes tmod-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .tmod-tile-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
                .tmod-tile { background: #18181b; border: 1px solid #26262c; border-radius: 8px; padding: 8px 8px 7px; display: flex; flex-direction: column; gap: 4px; transition: border-color 0.15s, background 0.3s; min-width: 0; }
                .tmod-tile:hover { border-color: #3a3a3d; }
                .tmod-tile-icon { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; }
                .tmod-tile-icon svg { width: 22px; height: 22px; }
                .tmod-tile-bottom { display: flex; align-items: flex-end; gap: 4px; margin-top: auto; min-width: 0; }
                .tmod-tile-label { font-size: 12px; color: #efeff1; line-height: 1.3; flex: 1 1 0; min-width: 0; word-wrap: break-word; overflow-wrap: break-word; hyphens: none; }
                .tmod-tt-track { width: 36px; height: 20px; background: #3a3a3d; border-radius: 10px; position: relative; cursor: pointer; transition: background 0.25s; flex-shrink: 0; }
                .tmod-tt-track.on { background: #00f593; }
                .tmod-tt-thumb { width: 16px; height: 16px; background: #fff; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: transform 0.25s; display: flex; align-items: center; justify-content: center; }
                .tmod-tt-track.on .tmod-tt-thumb { transform: translateX(16px); }
                .tmod-tile-spinner { width: 10px; height: 10px; border: 1.5px solid rgba(0,0,0,0.15); border-top-color: #333; border-radius: 50%; animation: tmod-spin 0.6s linear infinite; }
                .tmod-tile-clear { cursor: pointer; }
                .tmod-tile-clear.success { background: #0e3a1e !important; border-color: #00f593 !important; }
                .tmod-dd { position: relative; flex-shrink: 0; }
                .tmod-dd-btn { display: flex; align-items: center; justify-content: space-between; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 10px; padding: 2px 8px; height: 20px; font-size: 11px; color: #efeff1; cursor: pointer; transition: border-color 0.15s; white-space: nowrap; }
                .tmod-dd-btn:hover { border-color: #53535f; }
                .tmod-dd-list { position: absolute; bottom: calc(100% + 4px); left: 0; right: 0; background: #1a1a1e; border: 1px solid #3a3a3d; border-radius: 6px; padding: 4px 0; z-index: 10; display: none; overflow: hidden; }
                .tmod-dd-list.open { display: block; }
                .tmod-dd-item { padding: 5px 8px; font-size: 11px; color: #efeff1; cursor: pointer; transition: background 0.1s; }
                .tmod-dd-item:hover { background: #26262c; }
                .tmod-dd-item.active { color: #9146FF; }
            `;
            panel.appendChild(s);
        }

        const SVG_FOLLOWER = `<svg width="22" height="22" viewBox="0 0 24 24"><path fill="#e040fb" fill-rule="evenodd" d="M10.964 5.422A5.075 5.075 0 0 0 7.429 4H7C4.239 4 2 6.175 2 8.857v.417a4.79 4.79 0 0 0 1.464 3.434L12 21l8.535-8.292A4.788 4.788 0 0 0 22 9.274v-.417C22 6.175 19.761 4 17 4h-.429a5.076 5.076 0 0 0-3.536 1.423L12 6.429l-1.036-1.007Z" clip-rule="evenodd"></path></svg>`;
        const SVG_SUBSCRIBER = `<svg width="22" height="22" viewBox="0 0 24 24"><path fill="#ffc044" fill-rule="evenodd" d="M14.026 9.626 12 5.114 9.974 9.626l-4.909.514 3.666 3.28-1.029 4.815L12 15.775l4.298 2.46-1.03-4.816 3.667-3.279-4.91-.514ZM8.62 7.756l-5.525.58c-1.052.11-1.476 1.405-.69 2.109l4.127 3.691-1.153 5.395c-.22 1.028.89 1.828 1.808 1.303L12 18.08l4.812 2.755c.917.525 2.028-.275 1.808-1.303l-1.153-5.395 4.127-3.691c.787-.704.362-2-.69-2.11l-5.525-.578-2.262-5.037c-.43-.96-1.803-.96-2.234 0L8.62 7.757Z" clip-rule="evenodd"></path></svg>`;
        const SVG_EMOTE = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#9146ff"><path d="M12 19a3 3 0 0 0 3-3H9a3 3 0 0 0 3 3Zm-6-6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM16.5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"></path><path fill-rule="evenodd" d="M1 12C1 5.925 5.925 1 12 1s11 4.925 11 11-4.925 11-11 11S1 18.075 1 12Zm11 9a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" clip-rule="evenodd"></path></svg>`;
        const SVG_SLOW = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#36d7b7"><path fill-rule="evenodd" d="M21 4.47a8 8 0 0 1-3.884 6.86l-.973.584a.1.1 0 0 0 0 .172l.973.584a8.008 8.008 0 0 1 .774.528A8 8 0 0 1 21 19.53V22H3v-2.47a8 8 0 0 1 3.884-6.86l.973-.584a.1.1 0 0 0 0-.172l-.973-.584A7.998 7.998 0 0 1 3 4.47V2h18v2.47ZM18.44 17a5.999 5.999 0 0 0-2.353-2.615l-.973-.584c-1.36-.816-1.36-2.786 0-3.602l.973-.584A6 6 0 0 0 19 4.47V4H5v.47a6 6 0 0 0 2.913 5.145l.973.584c1.36.816 1.36 2.786 0 3.602l-.973.584A5.998 5.998 0 0 0 5.559 17h12.882Z" clip-rule="evenodd"></path></svg>`;
        const SVG_CLEAR = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#ff6b6b"><path d="M9 10h2v2H9v-2Zm6 0h-2v2h2v-2Z"></path><path fill-rule="evenodd" d="m12 22-3-3H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4l-3 3Zm-2.172-5L12 19.172 14.172 17H19V5H5v12h4.828Z" clip-rule="evenodd"></path></svg>`;
        const SVG_SHIELD = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#4d9fff"><path fill-rule="evenodd" d="M19.004 4.867C19.663 4.955 20.329 5 21 5l-.436 4.802a14 14 0 0 1-5.543 9.932L12 22l-3.021-2.266a14 14 0 0 1-5.542-9.932L3 5a15 15 0 0 0 9-3 15 15 0 0 0 7.004 2.867ZM13 10V5a17 17 0 0 0 5.823 1.86l-.251 2.76a12 12 0 0 1-4.751 8.514L13 18.75V10Zm-2 0V5a17.001 17.001 0 0 1-5.823 1.86l.251 2.76a12 12 0 0 0 4.751 8.514l.821.616V10Z" clip-rule="evenodd"></path></svg>`;
        const SVG_CHECK_SM = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
        const SVG_CHECK_LG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00f593" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
        const SVG_CHEVRON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="#adadb8"><path d="M7 10l5 5 5-5z"/></svg>`;

        const SLOW_OPTIONS = [
            { value: 0, label: 'Выкл' },
            { value: 3, label: '3 сек' },
            { value: 5, label: '5 сек' },
            { value: 10, label: '10 сек' },
            { value: 20, label: '20 сек' },
            { value: 30, label: '30 сек' },
            { value: 60, label: '60 сек' }
        ];

        const tile = (id, icon, label, control, extra) =>
            `<div class="tmod-tile ${extra || ''}" id="${id}">
                <div class="tmod-tile-icon">${icon}</div>
                <div class="tmod-tile-bottom">
                    <div class="tmod-tile-label">${label}</div>
                    ${control}
                </div>
            </div>`;

        const toggleCtrl = (id) =>
            `<div class="tmod-tt-track" id="${id}"><div class="tmod-tt-thumb"></div></div>`;

        const dropdownCtrl = (id) => {
            const items = SLOW_OPTIONS.map(o => `<div class="tmod-dd-item" data-value="${o.value}">${o.label}</div>`).join('');
            return `<div class="tmod-dd" id="${id}"><div class="tmod-dd-btn"><span class="tmod-dd-val">...</span>${SVG_CHEVRON}</div><div class="tmod-dd-list">${items}</div></div>`;
        };

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>\u2190</span> <span>Назад</span></button>
            <div id="tmod-chat-loading" style="text-align: center; color: #adadb8; padding: 20px;">Загрузка настроек...</div>
            <div id="tmod-chat-grid" style="display: none;">
                <div class="tmod-tile-grid">
                    ${tile('tmod-tile-follower', SVG_FOLLOWER, 'Только для фолловеров', toggleCtrl('tmod-tt-follower'))}
                    ${tile('tmod-tile-subscriber', SVG_SUBSCRIBER, 'Только для подписчиков', toggleCtrl('tmod-tt-subscriber'))}
                    ${tile('tmod-tile-emote', SVG_EMOTE, 'Только эмодзи', toggleCtrl('tmod-tt-emote'))}
                    ${tile('tmod-tile-slow', SVG_SLOW, 'Медленный режим', dropdownCtrl('tmod-dd-slow'))}
                    ${tile('tmod-tile-clear', SVG_CLEAR, 'Очистить чат', '', 'tmod-tile-clear')}
                    ${tile('tmod-tile-shield', SVG_SHIELD, 'Защитный режим', toggleCtrl('tmod-tt-shield'))}
                </div>
            </div>
        `;

        const rect = panel.getBoundingClientRect();
        if (rect.top < 0) { panel.style.bottom = Math.max(10, panelPosition.bottom + rect.top) + 'px'; }

        const closeDD = (e) => { if (!e.target.closest('.tmod-dd')) content.querySelectorAll('.tmod-dd-list.open').forEach(l => l.classList.remove('open')); };
        document.addEventListener('click', closeDD);

        const cleanup = () => document.removeEventListener('click', closeDD);
        content.querySelector('#tmod-back').onclick = () => { cleanup(); panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };

        getChatSettings(channelName).then(settings => {
            const loadingDiv = content.querySelector('#tmod-chat-loading');
            const gridDiv = content.querySelector('#tmod-chat-grid');
            if (!settings) { loadingDiv.style.color = '#ff6b6b'; loadingDiv.textContent = 'Ошибка загрузки'; return; }
            loadingDiv.style.display = 'none';
            gridDiv.style.display = 'block';

            function ttSet(el, on) { el.classList.toggle('on', on); }
            function ttLoading(el) { el.querySelector('.tmod-tt-thumb').innerHTML = '<div class="tmod-tile-spinner"></div>'; }
            function ttConfirmed(el) { el.querySelector('.tmod-tt-thumb').innerHTML = SVG_CHECK_SM; }
            function ttClear(el) { el.querySelector('.tmod-tt-thumb').innerHTML = ''; }

            function makeToggleHandler(trackEl, settingKey) {
                return async () => {
                    if (trackEl.querySelector('.tmod-tile-spinner')) return;
                    const turningOn = !trackEl.classList.contains('on');
                    ttSet(trackEl, turningOn);
                    ttLoading(trackEl);
                    const body = {};
                    body[settingKey] = turningOn;
                    const result = await updateChatSettings(channelName, body);
                    if (result.success) {
                        if (turningOn) ttConfirmed(trackEl); else ttClear(trackEl);
                    } else {
                        ttSet(trackEl, !turningOn);
                        ttClear(trackEl);
                    }
                };
            }

            const followerTrack = content.querySelector('#tmod-tt-follower');
            ttSet(followerTrack, settings.followerMode);
            if (settings.followerMode) ttConfirmed(followerTrack);
            followerTrack.onclick = makeToggleHandler(followerTrack, 'followerMode');

            const subTrack = content.querySelector('#tmod-tt-subscriber');
            ttSet(subTrack, settings.subscriberMode);
            if (settings.subscriberMode) ttConfirmed(subTrack);
            subTrack.onclick = makeToggleHandler(subTrack, 'subscriberMode');

            const emoteTrack = content.querySelector('#tmod-tt-emote');
            ttSet(emoteTrack, settings.emoteMode);
            if (settings.emoteMode) ttConfirmed(emoteTrack);
            emoteTrack.onclick = makeToggleHandler(emoteTrack, 'emoteMode');

            const dd = content.querySelector('#tmod-dd-slow');
            const ddBtn = dd.querySelector('.tmod-dd-btn');
            const ddList = dd.querySelector('.tmod-dd-list');
            const ddVal = dd.querySelector('.tmod-dd-val');
            let curSlow = settings.slowMode ? (settings.slowModeWaitTime || 30) : 0;

            function ddLabel() {
                const o = SLOW_OPTIONS.find(o => o.value === curSlow);
                ddVal.textContent = o ? o.label : 'Выкл';
            }
            ddLabel();

            ddBtn.onclick = (e) => {
                e.stopPropagation();
                ddList.classList.toggle('open');
                ddList.querySelectorAll('.tmod-dd-item').forEach(i => i.classList.toggle('active', parseInt(i.dataset.value) === curSlow));
            };

            ddList.querySelectorAll('.tmod-dd-item').forEach(item => {
                item.onclick = async (e) => {
                    e.stopPropagation();
                    const val = parseInt(item.dataset.value);
                    if (val === curSlow) { ddList.classList.remove('open'); return; }
                    ddList.classList.remove('open');
                    ddVal.textContent = '...';
                    const result = await updateChatSettings(channelName, { slowMode: val > 0, slowModeWaitTime: val || 30 });
                    if (result.success) { curSlow = val; }
                    ddLabel();
                };
            });

            const clearTile = content.querySelector('#tmod-tile-clear');
            const clearIcon = clearTile.querySelector('.tmod-tile-icon');
            const clearLabel = clearTile.querySelector('.tmod-tile-label');
            const origIcon = clearIcon.innerHTML;
            const origLabel = clearLabel.textContent;

            clearTile.onclick = async () => {
                if (clearTile.style.pointerEvents === 'none') return;
                clearTile.style.pointerEvents = 'none';
                clearIcon.innerHTML = '<div class="tmod-tile-spinner" style="width:18px;height:18px;border-width:2px;"></div>';
                clearLabel.textContent = 'Очистка...';
                sendToChatInput('/clear');
                await new Promise(r => setTimeout(r, 800));
                clearTile.classList.add('success');
                clearIcon.innerHTML = SVG_CHECK_LG;
                clearLabel.textContent = 'Чат очищен';
                await new Promise(r => setTimeout(r, 2000));
                clearTile.classList.remove('success');
                clearIcon.innerHTML = origIcon;
                clearLabel.textContent = origLabel;
                clearTile.style.pointerEvents = '';
            };

            const shieldTrack = content.querySelector('#tmod-tt-shield');
            shieldTrack.onclick = async () => {
                if (shieldTrack.querySelector('.tmod-tile-spinner')) return;
                const turningOn = !shieldTrack.classList.contains('on');
                ttSet(shieldTrack, turningOn);
                ttLoading(shieldTrack);
                if (turningOn) {
                    sendToChatInput('/shield');
                    window.open(
                        'https://www.twitch.tv/popout/moderator/' + channelName + '/_/shield-mode/settings',
                        'tmod-shield',
                        'width=500,height=600,scrollbars=yes,resizable=yes'
                    );
                    ttConfirmed(shieldTrack);
                } else {
                    sendToChatInput('/shieldoff');
                    ttClear(shieldTrack);
                }
            };
        });
    }

    function showClipSection(panel) {
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>←</span> <span>Назад</span></button>
            <div style="text-align: center; color: #adadb8; font-size: 13px; margin-bottom: 15px;">Создание клипа из текущего момента стрима</div>
            <input type="text" id="tmod-clip-title" placeholder="Название клипа (необязательно)" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px; margin-bottom: 10px;">
            <button id="tmod-create-clip" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer;">${ICON_CLIP}Создать клип</button>
            <div id="tmod-clip-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };
        content.querySelector('#tmod-create-clip').onclick = () => {
            const title = content.querySelector('#tmod-clip-title').value.trim();
            sendToChatInput(title ? '/clip "' + title + '"' : '/clip');
            const statusDiv = content.querySelector('#tmod-clip-status');
            statusDiv.innerHTML = ICON_OK + '<span style="color:#00ff00;">Клип создан!</span>';
            setTimeout(() => { panel.remove(); createPanel(); }, 1500);
        };
    }

    function showStreamSection(panel) {
        const channelName = window.location.pathname.slice(1);
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        const savedWidth = panel.getBoundingClientRect().width + 'px';
        panel.style.width = savedWidth;
        panel.style.minWidth = savedWidth;

        const LANGUAGES = [
            { value: '', label: 'Не указан' },
            { value: 'ru', label: 'Русский' },
            { value: 'en', label: 'English' },
            { value: 'uk', label: 'Українська' },
            { value: 'be', label: 'Беларуская' },
            { value: 'kk', label: 'Қазақша' },
            { value: 'de', label: 'Deutsch' },
            { value: 'es', label: 'Español' },
            { value: 'fr', label: 'Français' },
            { value: 'pt', label: 'Português' },
            { value: 'ja', label: '日本語' },
            { value: 'ko', label: '한국어' },
            { value: 'zh', label: '中文' },
            { value: 'pl', label: 'Polski' },
            { value: 'tr', label: 'Türkçe' },
            { value: 'it', label: 'Italiano' },
            { value: 'th', label: 'ไทย' },
            { value: 'vi', label: 'Tiếng Việt' },
            { value: 'ar', label: 'العربية' }
        ];

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>\u2190</span> <span>Назад</span></button>
            <div id="tmod-stream-loading" style="text-align: center; color: #adadb8; padding: 20px;">Загрузка данных стрима...</div>
            <div id="tmod-stream-form" style="display: none;">
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 12px; color: #adadb8; display: block; margin-bottom: 4px;">Название стрима</label>
                    <input type="text" id="tmod-stream-title" maxlength="140" placeholder="Название трансляции" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px 10px; font-size: 13px; box-sizing: border-box;">
                </div>
                <div style="margin-bottom: 4px; position: relative;">
                    <label style="font-size: 12px; color: #adadb8; display: block; margin-bottom: 4px;">Категория / Игра</label>
                    <input type="text" id="tmod-stream-category" placeholder="Поиск категории..." autocomplete="off" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px 10px; font-size: 13px; box-sizing: border-box;">
                    <div id="tmod-cat-results" style="position: absolute; top: 100%; left: 0; right: 0; background: #1a1a1e; border: 1px solid #3a3a3d; border-radius: 0 0 4px 4px; display: none; z-index: 10; max-height: 250px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #3a3a3d transparent;"></div>
                </div>
                <div id="tmod-cat-card" style="margin-bottom: 12px; background: #1a1a1e; border: 1px solid #3a3a3d; border-radius: 6px; padding: 10px; display: none; align-items: center; gap: 12px;"></div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 12px; color: #adadb8; display: block; margin-bottom: 4px;">Язык</label>
                    <select id="tmod-stream-lang" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px 10px; font-size: 13px; box-sizing: border-box;">
                        ${LANGUAGES.map(l => `<option value="${l.value}">${l.label}</option>`).join('')}
                    </select>
                </div>
                <button id="tmod-stream-save" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer;">Сохранить</button>
                <div id="tmod-stream-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
            </div>
        `;

        content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };

        const rect = panel.getBoundingClientRect();
        if (rect.top < 0) { panel.style.bottom = Math.max(10, panelPosition.bottom + rect.top) + 'px'; }

        let selectedGameId = null;

        async function loadChannelData() {
            const token = await getToken();
            if (!token) return null;
            const broadcasterId = await getChannelId(channelName, token);
            if (!broadcasterId) return null;
            const resp = await apiRequest(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
            });
            if (resp.error || !resp.ok) return null;
            try {
                const data = JSON.parse(resp.text);
                return data.data[0];
            } catch { return null; }
        }

        loadChannelData().then(ch => {
            const loadingDiv = content.querySelector('#tmod-stream-loading');
            const formDiv = content.querySelector('#tmod-stream-form');
            if (!ch) { loadingDiv.style.color = '#ff6b6b'; loadingDiv.textContent = 'Ошибка загрузки'; return; }
            loadingDiv.style.display = 'none';
            formDiv.style.display = 'block';

            const titleInput = content.querySelector('#tmod-stream-title');
            const catInput = content.querySelector('#tmod-stream-category');
            const langSelect = content.querySelector('#tmod-stream-lang');
            const catResults = content.querySelector('#tmod-cat-results');
            const catCard = content.querySelector('#tmod-cat-card');

            titleInput.value = ch.title || '';
            catInput.value = ch.game_name || '';
            selectedGameId = ch.game_id || null;
            langSelect.value = ch.broadcaster_language || '';

            function renderCatCard(gameName, gameId, artUrl) {
                if (!gameName) { catCard.style.display = 'none'; return; }
                const thumb = artUrl ? artUrl.replace('{width}', '80').replace('{height}', '112') : '';
                catCard.innerHTML = `
                    ${thumb ? `<img src="${thumb}" style="width: 60px; height: 84px; object-fit: cover; border-radius: 4px; flex-shrink: 0; background: #26262c;" onerror="this.style.display='none'">` : ''}
                    <div style="min-width: 0;">
                        <div style="font-size: 14px; font-weight: 600; color: #efeff1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${gameName}</div>
                    </div>`;
                catCard.style.display = 'flex';
            }

            if (ch.game_name && ch.game_id) {
                (async () => {
                    const token2 = await getToken();
                    if (!token2) return;
                    const gameResp = await apiRequest(`https://api.twitch.tv/helix/games?id=${ch.game_id}`, {
                        headers: { 'Authorization': `Bearer ${token2}`, 'Client-Id': CLIENT_ID }
                    });
                    try {
                        const gd = JSON.parse(gameResp.text);
                        renderCatCard(ch.game_name, ch.game_id, gd.data && gd.data[0] ? gd.data[0].box_art_url : '');
                    } catch { renderCatCard(ch.game_name, ch.game_id, ''); }
                })();
            }

            let searchTimeout = null;
            catInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                const q = catInput.value.trim();
                if (q.length < 2) { catResults.style.display = 'none'; catResults.innerHTML = ''; return; }
                searchTimeout = setTimeout(async () => {
                    const token = await getToken();
                    if (!token) return;
                    const resp = await apiRequest(`https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(q)}&first=5`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
                    });
                    if (resp.error || !resp.ok) return;
                    try {
                        const data = JSON.parse(resp.text);
                        if (!data.data || !data.data.length) { catResults.style.display = 'none'; return; }
                        catResults.innerHTML = data.data.map(c => {
                            const thumb = c.box_art_url ? c.box_art_url.replace('{width}', '40').replace('{height}', '56') : '';
                            return `<div class="tmod-cat-item" data-id="${c.id}" data-name="${c.name}" data-art="${c.box_art_url || ''}" style="padding: 6px 10px; font-size: 13px; color: #efeff1; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.1s;">
                                ${thumb ? `<img src="${thumb}" style="width: 40px; height: 56px; object-fit: cover; border-radius: 4px; flex-shrink: 0; background: #26262c;" onerror="this.style.display='none'">` : ''}
                                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.name}</span>
                            </div>`;
                        }).join('');
                        catResults.style.display = 'block';
                        catResults.querySelectorAll('.tmod-cat-item').forEach(item => {
                            item.onmouseenter = () => item.style.background = '#26262c';
                            item.onmouseleave = () => item.style.background = '';
                            item.onclick = () => {
                                catInput.value = item.dataset.name;
                                selectedGameId = item.dataset.id;
                                catResults.style.display = 'none';
                                renderCatCard(item.dataset.name, item.dataset.id, item.dataset.art || '');
                            };
                        });
                    } catch { catResults.style.display = 'none'; }
                }, 300);
            });

            document.addEventListener('click', (e) => {
                if (!e.target.closest('#tmod-stream-category') && !e.target.closest('#tmod-cat-results')) {
                    catResults.style.display = 'none';
                }
            });

            content.querySelector('#tmod-stream-save').onclick = async () => {
                const statusDiv = content.querySelector('#tmod-stream-status');
                const token = await getToken();
                if (!token) { statusDiv.innerHTML = '<span style="color:#ff6b6b;">Нет токена</span>'; return; }
                const broadcasterId = await getChannelId(channelName, token);
                if (!broadcasterId) { statusDiv.innerHTML = '<span style="color:#ff6b6b;">Ошибка ID</span>'; return; }

                const newTitle = titleInput.value.trim();
                const newGameId = selectedGameId || undefined;
                const newGameName = catInput.value.trim();
                const newLang = langSelect.value || undefined;

                const gqlBody = {};

                if (newTitle !== (ch.title || '')) gqlBody.status = newTitle;
                if (newGameId && newGameId !== ch.game_id) gqlBody.game = newGameName || newGameId;
                if (newLang !== (ch.broadcaster_language || '')) gqlBody.broadcasterLanguage = newLang;

                if (!Object.keys(gqlBody).length) {
                    statusDiv.innerHTML = '<span style="color:#adadb8;">Нет изменений</span>';
                    return;
                }

                statusDiv.style.color = '#adadb8';
                statusDiv.textContent = 'Сохранение...';

                const errors = [];
                const gqlResult = await gqlUpdateBroadcastSettings(token, broadcasterId, gqlBody);
                if (!gqlResult.success) errors.push(gqlResult.error);

                if (errors.length) {
                    statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">' + errors.join('; ') + '</span>';
                } else {
                    statusDiv.innerHTML = ICON_OK + '<span style="color:#00ff00;">Сохранено!</span>';
                    setTimeout(() => { panel.remove(); createPanel(); }, 1500);
                }
            };
        });
    }

    // ============================================================================
    // Шаутаут
    // ============================================================================

    function showShoutoutSection(panel) {
        const channelName = window.location.pathname.slice(1);
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        const savedWidth = panel.getBoundingClientRect().width + 'px';
        panel.style.width = savedWidth;
        panel.style.minWidth = savedWidth;

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>\u2190</span> <span>Назад</span></button>
            <div id="tmod-so-loading" style="text-align: center; color: #adadb8; padding: 20px;">Загрузка зрителей...</div>
            <div id="tmod-so-form" style="display: none;">
                <div style="margin-bottom: 10px; display: flex; gap: 6px;">
                    <input type="text" id="tmod-so-manual" placeholder="Имя пользователя..." autocomplete="off" style="flex: 1; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px 10px; font-size: 13px; box-sizing: border-box;">
                    <button id="tmod-so-send-manual" style="background: #9146FF; color: white; border: none; border-radius: 4px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">Шаутаут</button>
                </div>
                <div style="border-top: 1px solid #26262c; padding-top: 8px; margin-bottom: 8px;">
                    <input type="text" id="tmod-so-search" placeholder="Поиск в чате..." autocomplete="off" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px 10px; font-size: 13px; box-sizing: border-box;">
                </div>
                <div id="tmod-so-list" style="max-height: 350px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #3a3a3d transparent;"></div>
                <div id="tmod-so-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
            </div>
        `;

        content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };

        const rect = panel.getBoundingClientRect();
        if (rect.top < 0) { panel.style.bottom = Math.max(10, panelPosition.bottom + rect.top) + 'px'; }

        async function loadChatters() {
            try {
                const token = await getToken();
                if (!token) return [];
                const broadcasterId = await getChannelId(channelName, token);
                if (!broadcasterId) return [];
                const userId = await getCurrentUserId(token);
                if (!userId) return [];
                const resp = await apiRequest(`https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${broadcasterId}&moderator_id=${userId}&first=1000`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
                });
                if (resp.error || !resp.ok) return [];
                const data = JSON.parse(resp.text);
                const chatters = (data.data || []).map(c => ({ user_login: c.user_login, user_name: c.user_name, profile_image_url: '' }));
                const logins = chatters.map(c => c.user_login);
                for (let i = 0; i < logins.length; i += 100) {
                    const batch = logins.slice(i, i + 100);
                    const uResp = await apiRequest(`https://api.twitch.tv/helix/users?login=${batch.map(l => encodeURIComponent(l)).join('&login=')}`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
                    });
                    if (!uResp.error && uResp.ok) {
                        const users = (JSON.parse(uResp.text).data || []);
                        const avatarMap = {};
                        users.forEach(u => { avatarMap[u.login] = u.profile_image_url; });
                        chatters.forEach(c => { if (avatarMap[c.user_login]) c.profile_image_url = avatarMap[c.user_login]; });
                    }
                }
                return chatters;
            } catch { return []; }
        }

        async function sendShoutout(recipientLogin) {
            const token = await getToken();
            if (!token) return { error: 'Нет токена' };
            const broadcasterId = await getChannelId(channelName, token);
            if (!broadcasterId) return { error: 'Ошибка ID канала' };
            const userId = await getCurrentUserId(token);
            if (!userId) return { error: 'Ошибка ID пользователя' };
            const userResp = await apiRequest(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(recipientLogin)}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
            });
            if (userResp.error || !userResp.ok) return { error: 'Пользователь не найден' };
            let recipientId;
            try { recipientId = JSON.parse(userResp.text).data[0].id; } catch { return { error: 'Ошибка ID получателя' }; }
            const resp = await apiRequest(`https://api.twitch.tv/helix/chat/shoutouts?from_broadcaster_id=${broadcasterId}&to_broadcaster_id=${recipientId}&moderator_id=${userId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
            });
            if (resp.status === 204 || (resp.ok && !resp.error)) return { success: true };
            try { const e = JSON.parse(resp.text); return { error: e.message || e.error || ('HTTP ' + resp.status) }; }
            catch { return { error: 'HTTP ' + resp.status }; }
        }

        loadChatters().then(chatters => {
            const loadingDiv = content.querySelector('#tmod-so-loading');
            const formDiv = content.querySelector('#tmod-so-form');
            const listDiv = content.querySelector('#tmod-so-list');
            const searchInput = content.querySelector('#tmod-so-search');

            if (!chatters.length) {
                loadingDiv.style.color = '#ff6b6b';
                loadingDiv.textContent = 'Нет зрителей или ошибка загрузки';
                return;
            }
            loadingDiv.style.display = 'none';
            formDiv.style.display = 'block';

            function renderList(query) {
                const q = (query || '').toLowerCase();
                const filtered = q ? chatters.filter(c => c.user_name.toLowerCase().includes(q) || c.user_login.toLowerCase().includes(q)) : chatters;
                listDiv.innerHTML = filtered.map(c => `
                    <div class="tmod-so-item" data-login="${c.user_login}" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid #26262c; cursor: pointer; transition: background 0.1s;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            ${c.profile_image_url ? `<img src="${c.profile_image_url}" style="width: 28px; height: 28px; border-radius: 50%; background: #26262c; flex-shrink: 0;">` : `<div style="width: 28px; height: 28px; border-radius: 50%; background: #9146FF; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 13px; font-weight: 600; color: white;">${c.user_name.charAt(0).toUpperCase()}</div>`}
                            <span style="font-size: 13px; color: #efeff1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.user_name}</span>
                        </div>
                        <span style="font-size: 12px; color: #9146FF; white-space: nowrap; flex-shrink: 0;">Шаутаут</span>
                    </div>
                `).join('');

                listDiv.querySelectorAll('.tmod-so-item').forEach(item => {
                    item.onmouseenter = () => item.style.background = '#26262c';
                    item.onmouseleave = () => item.style.background = '';
                    item.onclick = async () => {
                        const statusDiv = content.querySelector('#tmod-so-status');
                        const login = item.dataset.login;
                        item.style.opacity = '0.5';
                        item.style.pointerEvents = 'none';
                        statusDiv.textContent = 'Отправка шаутаута...';
                        statusDiv.style.color = '#adadb8';
                        const result = await sendShoutout(login);
                        if (result.success) {
                            statusDiv.innerHTML = ICON_OK + '<span style="color:#00ff00;">Шаутаут отправлен!</span>';
                        } else {
                            statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">' + result.error + '</span>';
                        }
                        item.style.opacity = '1';
                        item.style.pointerEvents = '';
                    };
                });
            }

            renderList('');
            searchInput.addEventListener('input', () => renderList(searchInput.value.trim()));

            const manualInput = content.querySelector('#tmod-so-manual');
            const manualBtn = content.querySelector('#tmod-so-send-manual');
            async function doManualShoutout() {
                const login = manualInput.value.trim().replace('@', '');
                if (!login) return;
                const statusDiv = content.querySelector('#tmod-so-status');
                manualBtn.disabled = true;
                statusDiv.textContent = 'Отправка шаутаута...';
                statusDiv.style.color = '#adadb8';
                const result = await sendShoutout(login);
                if (result.success) {
                    statusDiv.innerHTML = ICON_OK + '<span style="color:#00ff00;">Шаутаут отправлен!</span>';
                    manualInput.value = '';
                } else {
                    statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">' + result.error + '</span>';
                }
                manualBtn.disabled = false;
            }
            manualBtn.onclick = doManualShoutout;
            manualInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doManualShoutout(); });
        });
    }

    // ============================================================================
    // Рейд
    // ============================================================================

    function showRaidSection(panel) {
        const channelName = window.location.pathname.slice(1);
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        const savedWidth = panel.getBoundingClientRect().width + 'px';
        panel.style.width = savedWidth;
        panel.style.minWidth = savedWidth;

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>\u2190</span> <span>Назад</span></button>
            <div style="margin-bottom: 10px;">
                <label style="font-size: 12px; color: #adadb8; display: block; margin-bottom: 4px;">Канал для рейда</label>
                <input type="text" id="tmod-raid-input" placeholder="логин канала..." autocomplete="off" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px 10px; font-size: 13px; box-sizing: border-box;">
            </div>
            <button id="tmod-raid-btn" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer;">Начать рейд</button>
            <div id="tmod-raid-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };

        const rect = panel.getBoundingClientRect();
        if (rect.top < 0) { panel.style.bottom = Math.max(10, panelPosition.bottom + rect.top) + 'px'; }

        const raidInput = content.querySelector('#tmod-raid-input');
        const raidBtn = content.querySelector('#tmod-raid-btn');
        const statusDiv = content.querySelector('#tmod-raid-status');

        async function doRaid() {
            const target = raidInput.value.trim().replace('@', '');
            if (!target) { statusDiv.innerHTML = '<span style="color:#ff6b6b;">Введите логин канала</span>'; return; }
            raidBtn.disabled = true;
            statusDiv.textContent = 'Поиск канала...';
            statusDiv.style.color = '#adadb8';

            const token = await getToken();
            if (!token) { statusDiv.innerHTML = '<span style="color:#ff6b6b;">Нет токена</span>'; raidBtn.disabled = false; return; }

            const broadcasterId = await getChannelId(channelName, token);
            if (!broadcasterId) { statusDiv.innerHTML = '<span style="color:#ff6b6b;">Ошибка ID канала</span>'; raidBtn.disabled = false; return; }

            const userResp = await apiRequest(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(target)}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
            });
            if (userResp.error || !userResp.ok) { statusDiv.innerHTML = '<span style="color:#ff6b6b;">Канал не найден</span>'; raidBtn.disabled = false; return; }
            let targetId;
            try { targetId = JSON.parse(userResp.text).data[0].id; } catch { statusDiv.innerHTML = '<span style="color:#ff6b6b;">Канал не найден</span>'; raidBtn.disabled = false; return; }

            statusDiv.textContent = 'Запуск рейда...';
            const raidResp = await apiRequest(`https://api.twitch.tv/helix/raids?from_broadcaster_id=${broadcasterId}&to_broadcaster_id=${targetId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
            });
            if (raidResp.status === 200 || (raidResp.ok && !raidResp.error)) {
                statusDiv.innerHTML = ICON_OK + '<span style="color:#00ff00;">Рейд запущен!</span>';
            } else {
                try { const e = JSON.parse(raidResp.text); statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">' + (e.message || e.error || 'Ошибка') + '</span>'; }
                catch { statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">Ошибка: HTTP ' + raidResp.status + '</span>'; }
            }
            raidBtn.disabled = false;
        }

        raidBtn.onclick = doRaid;
        raidInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRaid(); });
    }

    // ============================================================================
    // GQL: UpdateBroadcastSettings (работает для модераторов)
    // ============================================================================

    const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

    async function gqlGetSessionToken(token) {
        let gqlToken = token;
        if (IS_EXTENSION && typeof chrome !== 'undefined' && chrome.runtime) {
            try {
                const resp = await chrome.runtime.sendMessage({ type: 'GET_AUTH_COOKIE' });
                if (resp && resp.success && resp.value) gqlToken = resp.value;
            } catch (e) { console.log('[ModPanel] cookie read failed:', e); }
        }
        return gqlToken;
    }

    async function gqlRequest(query, variables, token) {
        const gqlToken = await gqlGetSessionToken(token);
        const body = JSON.stringify({ query, variables });

        let resp;
        if (IS_EXTENSION) {
            resp = await fetch('https://gql.twitch.tv/gql', {
                method: 'POST',
                headers: {
                    'Client-Id': GQL_CLIENT_ID,
                    'Authorization': 'OAuth ' + gqlToken,
                    'Content-Type': 'application/json'
                },
                body
            }).then(async (r) => ({ status: r.status, ok: r.ok, text: await r.text() }))
              .catch((e) => ({ error: e.message }));
        } else {
            resp = await apiRequest('https://gql.twitch.tv/gql', {
                method: 'POST',
                headers: {
                    'Client-Id': GQL_CLIENT_ID,
                    'Authorization': 'OAuth ' + gqlToken,
                    'Content-Type': 'application/json'
                },
                body
            });
        }

        if (resp.error) return { success: false, error: resp.error };
        if (!resp.ok) {
            try {
                const err = JSON.parse(resp.text);
                return { success: false, error: err.message || err.error || ('HTTP ' + resp.status) };
            } catch {
                return { success: false, error: 'HTTP ' + resp.status };
            }
        }
        try {
            const json = JSON.parse(resp.text);
            if (json.errors && json.errors.length) {
                return { success: false, error: json.errors[0].message };
            }
            return { success: true, data: json.data };
        } catch {
            return { success: false, error: 'Parse error' };
        }
    }

    async function gqlUpdateBroadcastSettings(token, broadcasterUserId, opts) {
        const input = { userID: broadcasterUserId };
        if (opts.status !== undefined) input.status = opts.status;
        if (opts.game !== undefined) input.game = opts.game;
        if (opts.broadcasterLanguage !== undefined) input.broadcasterLanguage = opts.broadcasterLanguage;

        return gqlRequest(
            'mutation UpdateBroadcastSettings($input: UpdateBroadcastSettingsInput!) { updateBroadcastSettings(input: $input) { broadcastSettings { title game { id name } } } }',
            { input },
            token
        );
    }

    async function gqlSearchTags(query, token) {
        const result = await gqlRequest(
            'query SearchContentTags($query: String!) { searchContentTags(query: $query, first: 20) { edges { node { id localizedName } } } }',
            { query },
            token
        );
        if (!result.success) return [];
        try { return result.data.searchContentTags.edges.map(e => e.node); } catch { return []; }
    }

    async function gqlSetContentTags(broadcasterId, tagIds, token) {
        return gqlRequest(
            'mutation SetContentTags($input: SetContentTagsInput!) { setContentTags(input: $input) { content { ... on Stream { contentTags { id localizedName } } } } }',
            {
                input: {
                    authorID: broadcasterId,
                    contentID: broadcasterId,
                    contentType: 'STREAM',
                    tagIDs: tagIds
                }
            },
            token
        );
    }

    // ============================================================================
    // Кнопка под чатом
    // ============================================================================

    function injectButton() {
        if (!isStreamPage()) return;
        const chatInput = document.querySelector('[data-a-target="chat-input"]') || document.querySelector('.chat-input');
        if (!chatInput) { setTimeout(injectButton, 1000); return; }
        if (document.getElementById('tmod-btn')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'tmod-btn-wrapper';
        wrapper.style.cssText = 'padding: 10px 0; margin-top: 10px; border-top: 1px solid #3a3a3d; display: flex; justify-content: center;';

        const btn = document.createElement('button');
        btn.id = 'tmod-btn';
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path fill-rule="evenodd" d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z" clip-rule="evenodd"></path></svg> <span>Панель модератора</span>';
        btn.style.cssText = 'width: 200px; height: 36px; background: linear-gradient(90deg, #9146FF, #772ce8); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s;';

        btn.onmouseenter = () => { btn.style.background = 'linear-gradient(90deg, #772ce8, #5b21b6)'; btn.style.transform = 'scale(1.02)'; };
        btn.onmouseleave = () => { btn.style.background = 'linear-gradient(90deg, #9146FF, #772ce8)'; btn.style.transform = 'scale(1)'; };

        btn.onclick = async (e) => {
            e.preventDefault(); e.stopPropagation();
            const token = await getToken();
            if (!token) {
                const result = await authorize();
                if (result.success) {
                    notify('Вход: ' + ((result.user && result.user.login) || 'выполнен'));
                } else {
                    notify('Ошибка: ' + (result.error || 'авторизация не удалась'));
                }
                return;
            }
            if (panelOpen && panelElement) { panelElement.remove(); panelOpen = false; } else { createPanel(); }
        };

        wrapper.appendChild(btn);
        const chatRoom = chatInput.closest('[class*="chat-room"]') || chatInput.parentElement;
        if (chatRoom) chatRoom.appendChild(wrapper); else chatInput.appendChild(wrapper);
        console.log('[ModPanel] Button injected');
    }

    // ============================================================================
    // Запуск
    // ============================================================================

    if (isStreamPage()) {
        console.log('[ModPanel] Starting on:', window.location.pathname);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectButton);
        } else {
            injectButton();
        }
        // Прогрев кэша акцента канала
        warmAccentCache();
        setTimeout(getChannelAccentColor, 3000);
        setTimeout(getChannelAccentColor, 12000);
    }

    // Меню Tampermonkey (в расширении эту роль играет popup/)
    if (!IS_EXTENSION && typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Войти', async () => {
            const result = await authorize();
            notify(result.success ? 'Вход: ' + ((result.user && result.user.login) || 'выполнен') : 'Ошибка: ' + (result.error || 'не удалось войти'));
        });
        GM_registerMenuCommand('Выйти', async () => {
            await setToken(null);
            await setUserInfo(null);
            notify('Выход выполнен');
        });
    }

})();
