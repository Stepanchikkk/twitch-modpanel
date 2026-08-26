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
                'chat:edit'
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
            min-width: 340px;
        `;

        const headerIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path fill-rule="evenodd" d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z" clip-rule="evenodd"></path></svg>';
        const announceIconUrl = iconUrl('icon-announce.svg');
        const chatIconUrl = iconUrl('icon-chat.svg');
        const pollIconUrl = iconUrl('icon-poll.svg');
        const predictionIconUrl = iconUrl('icon-prediction.svg');
        const clipIconUrl = iconUrl('icon-clip.svg');
        const rewardsIconUrl = iconUrl('icon-rewards.svg');

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
            </style>
            <div class="tmod-no-select" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #18181b; border-bottom: 1px solid #3a3a3d; cursor: move; border-radius: 8px 8px 0 0;" id="tmod-panel-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${headerIcon}
                    <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #efeff1; pointer-events: none;">Панель модератора</h3>
                </div>
                <button id="tmod-panel-close" style="background: none; border: none; color: #adadb8; cursor: pointer; padding: 4px; font-size: 18px;">✕</button>
            </div>
            <div style="padding: 8px; border-radius: 0 0 8px 8px;" id="tmod-panel-content">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                    <button class="tmod-feature-btn" data-feature="announce"><img src="${announceIconUrl}" alt=""><span class="tmod-label">Анонс</span></button>
                    <button class="tmod-feature-btn" data-feature="chat"><img src="${chatIconUrl}" alt=""><span class="tmod-label">Чат</span></button>
                    <button class="tmod-feature-btn" data-feature="poll"><img src="${pollIconUrl}" alt=""><span class="tmod-label">Опрос</span></button>
                    <button class="tmod-feature-btn" data-feature="prediction"><img src="${predictionIconUrl}" alt=""><span class="tmod-label">Прогноз</span></button>
                    <button class="tmod-feature-btn" data-feature="clip"><img src="${clipIconUrl}" alt=""><span class="tmod-label">Клип</span></button>
                    <button class="tmod-feature-btn" data-feature="rewards"><img src="${rewardsIconUrl}" alt=""><span class="tmod-label">Награды</span></button>
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

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>←</span> <span>Назад</span></button>
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

        // Кастомный дропдаун цветов
        const selected = { value: 'primary' };
        const colorBtn = content.querySelector('#tmod-color-btn');
        const colorStripe = content.querySelector('#tmod-color-stripe');
        const colorLabel = content.querySelector('#tmod-color-label');
        const colorList = content.querySelector('#tmod-color-list');

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
            if (!text) { statusDiv.style.color = '#ff6b6b'; statusDiv.textContent = 'Введите текст'; return; }
            if (text.length > 500) { statusDiv.style.color = '#ff6b6b'; statusDiv.textContent = 'Текст слишком длинный'; return; }
            statusDiv.style.color = '#adadb8'; statusDiv.textContent = 'Отправка...';
            const result = await sendAnnouncement(channelName, text, color);
            if (result.success) {
                statusDiv.innerHTML = ICON_OK + '<span style="color:#00ff00;">Анонс отправлен!</span>';
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

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>←</span> <span>Назад</span></button>
            <div id="tmod-chat-loading" style="text-align: center; color: #adadb8; padding: 20px;">Загрузка настроек...</div>
            <div id="tmod-chat-settings" style="display: none;">
                <div class="tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Только для подписчиков</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-sub-only" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <div class="tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Только для фолловеров</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-follower-only" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <div class="tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Только эмодзи</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-emote-only" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <div class="tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Slow Mode</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-slow-mode" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <div id="tmod-slow-wait" style="display: none; margin-top: 15px; padding: 12px; background: #18181b; border-radius: 4px;"><input type="number" id="tmod-slow-time" min="0" max="120" value="30" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px;"><span style="font-size: 12px; color: #adadb8; margin-top: 5px; display: block;">секунд между сообщениями</span></div>
                <div class="tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Shield Mode</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-shield-mode" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <button id="tmod-clear-chat" style="width: 100%; background: #ff4444; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 15px;">${ICON_TRASH}Очистить чат</button>
                <button id="tmod-save-chat" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 10px;">Сохранить</button>
                <div id="tmod-chat-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
            </div>
        `;

        const toggleStyle = document.createElement('style');
        toggleStyle.textContent = `.tmod-toggle-active span:first-of-type { background-color: #9146FF !important; } .tmod-toggle-active span:last-of-type { transform: translateX(20px) !important; background-color: #fff !important; } .tmod-toggle label:hover span:first-of-type { background-color: #4f4f52; } .tmod-toggle-active label:hover span:first-of-type { background-color: #772ce8 !important; }`;
        panel.appendChild(toggleStyle);

        const rect = panel.getBoundingClientRect();
        if (rect.top < 0) { panel.style.bottom = Math.max(10, panelPosition.bottom + rect.top) + 'px'; }

        getChatSettings(channelName).then((settings) => {
            const loadingDiv = content.querySelector('#tmod-chat-loading');
            const settingsDiv = content.querySelector('#tmod-chat-settings');
            if (!settings) { loadingDiv.style.color = '#ff6b6b'; loadingDiv.textContent = 'Ошибка'; return; }
            loadingDiv.style.display = 'none'; settingsDiv.style.display = 'block';

            function updateToggle(checkbox) { const label = checkbox.closest('label'); label.classList.toggle('tmod-toggle-active', checkbox.checked); }

            const sub = content.querySelector('#tmod-sub-only'), follower = content.querySelector('#tmod-follower-only');
            const emote = content.querySelector('#tmod-emote-only'), slow = content.querySelector('#tmod-slow-mode');
            const shield = content.querySelector('#tmod-shield-mode');

            sub.checked = settings.subscriberMode; follower.checked = settings.followerMode;
            emote.checked = settings.emoteMode; slow.checked = settings.slowMode;
            content.querySelector('#tmod-slow-time').value = settings.slowModeWaitTime || 30;

            updateToggle(sub); updateToggle(follower); updateToggle(emote); updateToggle(slow);

            sub.onchange = () => updateToggle(sub); follower.onchange = () => updateToggle(follower);
            emote.onchange = () => updateToggle(emote);
            slow.onchange = () => { updateToggle(slow); content.querySelector('#tmod-slow-wait').style.display = slow.checked ? 'block' : 'none'; };
            shield.onchange = () => { updateToggle(shield); sendToChatInput(shield.checked ? '/shield' : '/shieldoff'); };

            content.querySelector('#tmod-clear-chat').onclick = () => { if (confirm('Очистить чат?')) { sendToChatInput('/clear'); const s = content.querySelector('#tmod-chat-status'); s.innerHTML = ICON_OK + '<span style="color:#00ff00;">Чат очищен!</span>'; setTimeout(() => { s.innerHTML = ''; }, 2000); } };
            content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };
            content.querySelector('#tmod-save-chat').onclick = async () => {
                const statusDiv = content.querySelector('#tmod-chat-status');
                const newSettings = { subscriberMode: sub.checked, followerMode: follower.checked, emoteMode: emote.checked, slowMode: slow.checked, slowModeWaitTime: parseInt(content.querySelector('#tmod-slow-time').value) || 30 };
                statusDiv.style.color = '#adadb8'; statusDiv.textContent = 'Сохранение...';
                const result = await updateChatSettings(channelName, newSettings);
                if (result.success) { statusDiv.innerHTML = ICON_OK + '<span style="color:#00ff00;">Сохранено!</span>'; setTimeout(() => { panel.remove(); createPanel(); }, 1500); }
                else { statusDiv.innerHTML = ICON_ERR + '<span style="color:#ff6b6b;">' + result.error + '</span>'; }
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
