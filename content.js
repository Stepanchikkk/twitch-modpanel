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
    const GITHUB_RAW_ICONS = 'https://raw.githubusercontent.com/Stepanchikkk/twitch-modpanel/main/icons/';

    // Права, необходимые функциям панели. Держим в синхроне со списками scopes
    // в authorize() (ниже) и в background.js. Если у старого токена чего-то нет —
    // разово сбрасываем его (см. ensureScopesFresh), чтобы пользователь один раз
    // пере-авторизовался и получил все права.
    const REQUIRED_SCOPES = [
        'moderation:read',
        'moderator:manage:announcements',
        'moderator:manage:chat_settings',
        'moderator:manage:chat_messages',
        'moderator:manage:banned_users',
        'channel:manage:polls',
        'channel:manage:predictions',
        'channel:read:redemptions',
        'channel:manage:redemptions',
        'user:read:moderated_channels',
        'chat:read',
        'chat:edit',
        'channel:manage:broadcast',
        'moderator:manage:shoutouts',
        'moderator:read:chatters',
        'channel:manage:raids',
        'channel:manage:vips',
        'channel:read:vips',
        'channel:manage:moderators',
        'moderator:manage:warnings',
        'user:manage:blocked_users',
        'user:read:blocked_users'
    ];

    let panelOpen = false;
    let panelElement = null;
    let panelPosition = null;
    // Меню действий модератора: можно отключить в настройках панели (шестерёнка в шапке).
    let tmodContextMenuEnabled = true;
    // Автофокус чата: печать в любом месте страницы переводит фокус в чат (как в мессенджерах).
    let tmodChatAutofocus = true;

    function getPanelSettings() {
        return storageGet('tmod_settings').then((raw) => {
            try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
        });
    }
    function savePanelSettings(s) {
        return storageSet('tmod_settings', JSON.stringify(s));
    }

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
        const parts = window.location.pathname.slice(1).split('/');
        if (parts[0] === 'moderator' && parts[1]) return parts[1];
        return parts[0] || null;
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

    // После добавления в панель новых прав (VIP/мод/варны/блокировки) старые
    // токены их не содержат, и действия падают с 401/403. Проверяем токен один
    // раз при загрузке страницы: не хватает scopes → чистим, пользователь один
    // раз пере-авторизуется (клик по «Панель модератора»). Повторной очистки
    // нет — новый токен содержит все права, дальше проверка проходит тихо.
    async function ensureScopesFresh() {
        const token = await getToken();
        if (!token) return;
        const res = await apiRequest('https://id.twitch.tv/oauth2/validate', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.error) return;              // сеть — не считаем поводом для выхода
        if (res.status === 401) {
            // Токен протух/отозван — он и так не работает, чистим, чтобы панель
            // не спотыкалась и предложила войти заново.
            await setToken(null);
            await setUserInfo(null);
            modTokenCache = false;
            return;
        }
        if (!res.ok) return;
        let scopes;
        try { scopes = JSON.parse(res.text).scopes || []; } catch { return; }
        const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
        if (missing.length) {
            debugLog('scopes-fresh', { missing });
            await setToken(null);
            await setUserInfo(null);
            modTokenCache = false;
            try {
                modToast('Панель обновилась: войдите ещё раз, чтобы получить новые права');
            } catch (e) {}
        }
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
            return new Promise((resolve) => {
                const done = (ok) => { cleanup(); resolve(ok); };
                const onMsg = (ev) => {
                    if (ev.source !== window) return;
                    if (ev.data?.type === 'TMOD_CHAT_SUCCESS' && ev.data.message === message) done(true);
                    else if (ev.data?.type === 'TMOD_CHAT_ERROR' && ev.data.message === message) done(false);
                };
                window.addEventListener('message', onMsg);
                window.postMessage({ type: 'TMOD_SEND_CHAT', message: message }, '*');
                setTimeout(() => done(false), 2500);
                function cleanup() { window.removeEventListener('message', onMsg); }
            });
        }
        const chatComponent = getChatComponent();
        if (!chatComponent) { console.error('[ModPanel] Chat component not found'); return Promise.resolve(false); }
        try {
            chatComponent.props.onSendMessage(message);
            return Promise.resolve(true);
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    // ============================================================================
    // OAuth
    // ============================================================================

    // Юзерскрипт: окно + GitHub Pages callback + postMessage.
    async function startOAuthUserscript() {
        return new Promise((resolve) => {
            const redirectUri = 'https://stepanchikkk.github.io/twitch-modpanel/';
            const scopes = [
                'moderation:read',
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
                'channel:manage:raids',
                'channel:manage:vips',
                'channel:read:vips',
                'channel:manage:moderators',
                'moderator:manage:warnings',
                'user:manage:blocked_users',
                'user:read:blocked_users'
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
        const p = window.location.pathname;
        return /^\/[a-zA-Z0-9_]+$/.test(p) || /^\/moderator\/[a-zA-Z0-9_]+$/.test(p);
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
            box-shadow: none;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            animation: tmod-slide-in 0.12s ease-out;
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

        const TILE_ICONS = {
            announce: `<img src="${announceIconUrl}" alt="">`,
            chat: `<img src="${chatIconUrl}" alt="">`,
            poll: `<img src="${pollIconUrl}" alt="">`,
            prediction: `<img src="${predictionIconUrl}" alt="">`,
            clip: `<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="m19.613 2-1.912.585.584 1.912 1.913-.584L19.613 2Zm-5.737 1.754 1.912-.585.585 1.913-1.913.585-.584-1.913Zm-1.913.585-1.913.585.585 1.912 1.913-.584-.585-1.913ZM8.138 5.508l-1.913.585.585 1.913 1.912-.585-.584-1.913Zm-3.825 1.17L2.4 7.263l.585 1.912 1.912-.584-.584-1.913ZM5 11H3v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9h-2v9H5v-9Z"></path><path d="M9 11H7v2h2v-2Zm2 0h2v2h-2v-2Zm6 0h-2v2h2v-2Z"></path></svg>`,
            rewards: `<img src="${rewardsIconUrl}" alt="">`,
            stream: `<svg width="24" height="24" viewBox="0 0 24 24"><path fill="white" fill-rule="evenodd" d="M13.207 7.621 4 16.828V20h3.172l9.207-9.207-3.172-3.172Zm4.586 1.758L14.62 6.207l1.88-1.879L19.672 7.5l-1.88 1.879ZM8 21.999H2v-6L15.086 2.915a2 2 0 0 1 2.828 0l3.172 3.172a2 2 0 0 1 0 2.828L8 22Z" clip-rule="evenodd"></path></svg>`,
            shoutout: `<svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm0-4h-2V6h2v4z"/></svg>`,
            raid: `<svg width="24" height="24" viewBox="0 0 24 24"><path fill="white" fill-rule="evenodd" d="M9.364 16.849A1.99 1.99 0 0 0 9 18v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2a1.99 1.99 0 0 0-.364-1.15l2.796-4.196A4.62 4.62 0 0 1 22 12a9.95 9.95 0 0 0-.235-2.163C20.777 5.354 16.78 2 12 2S3.223 5.354 2.234 9.837C2.081 10.534 2 11.257 2 12a4.618 4.618 0 0 1 4.568.655l2.796 4.194Zm-2.18-6.199a6.62 6.62 0 0 0-2.848-.95 8.004 8.004 0 0 1 15.328 0c-1 .094-1.976.415-2.848.951a11.72 11.72 0 0 0-9.632 0Zm8.145 1.553a9.722 9.722 0 0 0-6.659 0L11.202 16h1.596l2.531-3.797Z" clip-rule="evenodd"></path></svg>`,
        };
        const TILE_LABELS = {
            announce: 'Анонс', chat: 'Чат', poll: 'Опрос', prediction: 'Прогноз',
            clip: 'Клип', rewards: 'Награды', stream: 'Стрим', shoutout: 'Отметить', raid: 'Рейд'
        };
        const DEFAULT_TILE_ORDER = ['announce', 'chat', 'poll', 'prediction', 'clip', 'rewards', 'stream', 'shoutout', 'raid'];

        panel.innerHTML = `
            <style>
                @keyframes tmod-slide-in { from { opacity: 0; } to { opacity: 1; } }
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
                .tmod-edit-mode .tmod-tile-wrapper {
                    transform: scale(0.92);
                    opacity: 0.85;
                    transition: transform 0.2s, opacity 0.2s;
                    cursor: move;
                }
                .tmod-edit-mode .tmod-tile-wrapper:hover {
                    transform: scale(0.92);
                    opacity: 0.85;
                }
                .tmod-edit-mode .tmod-tile-action {
                    opacity: 1 !important;
                    pointer-events: auto !important;
                }
                .tmod-drag-ghost {
                    transform: scale(1.06) !important;
                    opacity: 1 !important;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important;
                    position: fixed !important;
                    z-index: 1000000;
                    pointer-events: none !important;
                    margin: 0 !important;
                }
                .tmod-edit-mode #tmod-tiles-grid {
                    min-height: 60px;
                }
                .tmod-tt-track { width: 36px; height: 20px; background: #3a3a3d; border-radius: 10px; position: relative; cursor: pointer; transition: background 0.25s; flex-shrink: 0; }
                .tmod-tt-track.on { background: #00f593; }
                .tmod-tt-thumb { width: 16px; height: 16px; background: #fff; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: transform 0.25s; display: flex; align-items: center; justify-content: center; }
                .tmod-tt-track.on .tmod-tt-thumb { transform: translateX(16px); }
            </style>
            <div class="tmod-no-select" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #18181b; border-bottom: 1px solid #3a3a3d; cursor: move; border-radius: 8px 8px 0 0;" id="tmod-panel-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${headerIcon}
                    <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #efeff1; pointer-events: none;">Панель модератора</h3>
                </div>
                <div style="display: flex; align-items: center; gap: 2px;">
                    <button id="tmod-panel-edit" title="Настроить панель" style="background: none; border: none; color: #adadb8; cursor: pointer; padding: 4px; display: flex;"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg></button>
                    <button id="tmod-panel-settings" title="Настройки" style="background: none; border: none; color: #adadb8; cursor: pointer; padding: 4px; display: flex;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.63l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 13.98 2h-4a.5.5 0 0 0-.49.42l-.38 2.65c-.6.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.63l2.11 1.65c-.04.32-.07.66-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.63l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.09.73 1.69.98l.38 2.65a.5.5 0 0 0 .49.42h4a.5.5 0 0 0 .49-.42l.38-2.65c.6-.25 1.17-.58 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.63l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"/></svg></button>
                    <button id="tmod-panel-close" style="background: none; border: none; color: #adadb8; cursor: pointer; padding: 4px; font-size: 18px;">✕</button>
                </div>
            </div>
            <div style="padding: 8px; border-radius: 0 0 8px 8px; min-width: 360px; box-sizing: border-box;" id="tmod-panel-content">
                <div id="tmod-tiles-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;"></div>
                <div id="tmod-tiles-hidden-zone" style="display: none; margin-top: 12px; border-top: 1px dashed #3a3a3d; padding-top: 8px;">
                    <div style="position: relative; min-height: 60px;">
                        <div id="tmod-tiles-hidden" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;"></div>
                        <div id="tmod-tiles-hidden-label" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 12px; color: #adadb8; pointer-events: none; text-align: center;">Перетащи сюда,<br>чтобы скрыть плитку</div>
                    </div>
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
        panel.querySelector('#tmod-panel-settings').addEventListener('click', () => showSettingsSection(panel));

        const content = panel.querySelector('#tmod-panel-content');
        const grid = panel.querySelector('#tmod-tiles-grid');
        const hiddenZone = panel.querySelector('#tmod-tiles-hidden-zone');
        const hiddenGrid = panel.querySelector('#tmod-tiles-hidden');
        const hiddenLabel = panel.querySelector('#tmod-tiles-hidden-label');
        const editBtn = panel.querySelector('#tmod-panel-edit');

        let tileOrder = null;
        let tileHidden = [];
        let tileEditing = false;
        let dragState = null;

        function tileHtml(feature, hidden) {
            if (!TILE_ICONS[feature]) return '';
            const actionBtn = hidden
                ? `<button class="tmod-tile-action tmod-tile-add" data-feature="${feature}" title="Показать" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:transparent;border:2px solid #9146FF;color:#9146FF;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10;opacity:0;pointer-events:none;transition:opacity 0.2s;">+</button>`
                : `<button class="tmod-tile-action tmod-tile-remove" data-feature="${feature}" title="Скрыть" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:transparent;border:2px solid #ff6b6b;color:#ff6b6b;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10;opacity:0;pointer-events:none;transition:opacity 0.2s;">−</button>`;
            return `<div class="tmod-tile-wrapper" style="position:relative;width:100%;height:100%;">${actionBtn}<button class="tmod-feature-btn" data-feature="${feature}" style="width:100%;height:100%;">${TILE_ICONS[feature]}<span class="tmod-label">${TILE_LABELS[feature]}</span></button></div>`;
        }

        function renderTiles() {
            const visible = (tileOrder || []).filter(f => !tileHidden.includes(f));
            grid.innerHTML = visible.map(f => tileHtml(f, false)).join('');
        }

        function renderHidden() {
            hiddenGrid.innerHTML = tileHidden.map(f => tileHtml(f, true)).join('');
            hiddenLabel.style.display = tileHidden.length ? 'none' : 'block';
        }

        function saveTilesConfig() {
            storageSet('tmod_tiles_config', JSON.stringify({ order: tileOrder, hidden: tileHidden }));
        }

        function activate(feature) {
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
        }

        function startTileDrag(e, btn, fromHidden) {
            const feature = btn.dataset.feature;
            const rect = btn.getBoundingClientRect();
            const ghost = btn.cloneNode(true);
            ghost.classList.add('tmod-drag-ghost');
            ghost.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:${e.clientX - rect.width/2}px;top:${e.clientY - rect.height/2}px;position:fixed;z-index:1000000;pointer-events:none;transform:scale(1.06);box-shadow:0 8px 24px rgba(0,0,0,0.6);margin:0;opacity:1;`;
            document.body.appendChild(ghost);
            btn.style.opacity = '0.4';
            dragState = { feature, ghost, fromHidden, offsetX: rect.width/2, offsetY: rect.height/2, btn, placeholder: null };
        }

        function moveTileDrag(e) {
            if (!dragState) return;
            const g = dragState.ghost;
            g.style.left = (e.clientX - dragState.offsetX) + 'px';
            g.style.top = (e.clientY - dragState.offsetY) + 'px';
            g.style.transform = 'scale(1.06)';
            // временно скрываем призрак для корректного elementFromPoint
            const ghostDisplay = g.style.display;
            g.style.display = 'none';
            const over = document.elementFromPoint(e.clientX, e.clientY);
            g.style.display = ghostDisplay;
            if (over) {
                const inHidden = over.closest('#tmod-tiles-hidden-zone');
                if (inHidden) {
                    hiddenZone.style.background = '#1a1a1e';
                    hiddenZone.style.borderColor = '#9146FF';
                } else {
                    hiddenZone.style.background = '';
                    hiddenZone.style.borderColor = '';
                }
                const target = over.closest('.tmod-feature-btn');
                if (target && target !== dragState.btn) {
                    const wrapper = target.closest('.tmod-tile-wrapper');
                    const inGrid = wrapper && wrapper.parentNode === grid;
                    if (dragState.fromHidden === false && inGrid) {
                        const fromIdx = tileOrder.indexOf(dragState.feature);
                        const toIdx = tileOrder.indexOf(target.dataset.feature);
                        if (fromIdx !== -1 && toIdx !== -1) {
                            tileOrder.splice(fromIdx, 1);
                            tileOrder.splice(toIdx, 0, dragState.feature);
                            renderTiles();
                            const newBtn = grid.querySelector(`[data-feature="${dragState.feature}"]`);
                            if (newBtn) { newBtn.style.opacity = '0.4'; dragState.btn = newBtn; }
                        }
                        if (dragState.placeholder) { dragState.placeholder.remove(); dragState.placeholder = null; }
                    } else if (dragState.fromHidden && inGrid) {
                        if (dragState.placeholder) dragState.placeholder.remove();
                        const ph = document.createElement('div');
                        ph.className = 'tmod-drag-placeholder';
                        ph.style.cssText = 'width:100%;height:100%;border:2px dashed #9146FF;border-radius:8px;background:rgba(145,70,255,0.1);pointer-events:none;box-sizing:border-box;';
                        wrapper.parentNode.insertBefore(ph, wrapper);
                        dragState.placeholder = ph;
                        const toIdx = tileOrder.indexOf(target.dataset.feature);
                        const fromIdx = tileOrder.indexOf(dragState.feature);
                        if (fromIdx !== -1) {
                            tileOrder.splice(fromIdx, 1);
                            tileOrder.splice(toIdx, 0, dragState.feature);
                        } else if (toIdx !== -1) {
                            tileOrder.splice(toIdx, 0, dragState.feature);
                        }
                        renderTiles();
                    } else if (dragState.fromHidden && !target && over.closest('#tmod-tiles-grid')) {
                        if (dragState.placeholder) dragState.placeholder.remove();
                        const ph = document.createElement('div');
                        ph.className = 'tmod-drag-placeholder';
                        ph.style.cssText = 'width:100%;height:100%;border:2px dashed #9146FF;border-radius:8px;background:rgba(145,70,255,0.1);pointer-events:none;box-sizing:border-box;';
                        grid.appendChild(ph);
                        dragState.placeholder = ph;
                        if (tileOrder.includes(dragState.feature)) {
                            tileOrder = tileOrder.filter(f => f !== dragState.feature);
                            tileOrder.push(dragState.feature);
                        } else {
                            tileOrder.push(dragState.feature);
                        }
                        renderTiles();
                    } else {
                        if (dragState.placeholder) { dragState.placeholder.remove(); dragState.placeholder = null; }
                    }
                }
            }
        }

        function endTileDrag(e) {
            if (!dragState) return;
            const wasHidden = dragState.fromHidden;
            const feature = dragState.feature;
            let dropHidden = false;
            if (dragState.ghost) {
                const g = dragState.ghost;
                const ghostDisplay = g.style.display;
                g.style.display = 'none';
                const over = document.elementFromPoint(e.clientX, e.clientY);
                g.style.display = ghostDisplay;
                dropHidden = !!(over && over.closest('#tmod-tiles-hidden-zone'));
                g.remove();
                dragState.btn.style.opacity = '';
                if (dragState.placeholder) { dragState.placeholder.remove(); dragState.placeholder = null; }
                hiddenZone.style.background = '';
                hiddenZone.style.borderColor = '';
            }

            if (wasHidden) {
                if (!dropHidden) {
                    tileHidden = tileHidden.filter(f => f !== feature);
                    if (!tileOrder.includes(feature)) tileOrder.push(feature);
                } else {
                    tileOrder = tileOrder.filter(f => f !== feature);
                }
            } else if (dropHidden && !tileHidden.includes(feature)) {
                tileHidden.push(feature);
                tileOrder = tileOrder.filter(f => f !== feature);
            }
            renderTiles();
            renderHidden();
            dragState = null;
        }

        function setEditBtnIcon(editing) {
            editBtn.innerHTML = editing
                ? '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>'
                : '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg>';
            editBtn.style.color = editing ? '#9146FF' : '#adadb8';
        }
        editBtn.addEventListener('click', () => {
            tileEditing = !tileEditing;
            panel.classList.toggle('tmod-edit-mode', tileEditing);
            hiddenZone.style.display = tileEditing ? 'block' : 'none';
            setEditBtnIcon(tileEditing);
            if (!tileEditing) saveTilesConfig();
        });
        setEditBtnIcon(false);

        grid.addEventListener('mousedown', (e) => {
            if (!tileEditing) return;
            if (e.button !== 0) return;
            const btn = e.target.closest('.tmod-feature-btn');
            if (!btn) return;
            e.preventDefault();
            startTileDrag(e, btn, false);
            document.addEventListener('mousemove', moveTileDrag);
            document.addEventListener('mouseup', endTileDrag, { once: true });
        });

        hiddenGrid.addEventListener('mousedown', (e) => {
            if (!tileEditing) return;
            if (e.button !== 0) return;
            const btn = e.target.closest('.tmod-feature-btn');
            if (!btn) return;
            e.preventDefault();
            startTileDrag(e, btn, true);
            document.addEventListener('mousemove', moveTileDrag);
            document.addEventListener('mouseup', endTileDrag, { once: true });
        });

        grid.addEventListener('click', (e) => {
            if (tileEditing) return;
            const btn = e.target.closest('.tmod-feature-btn');
            if (btn) activate(btn.dataset.feature);
        });

        content.addEventListener('click', (e) => {
            const addBtn = e.target.closest('.tmod-tile-add');
            if (addBtn) {
                const f = addBtn.dataset.feature;
                tileHidden = tileHidden.filter(x => x !== f);
                if (!tileOrder.includes(f)) tileOrder.push(f);
                renderTiles(); renderHidden();
                return;
            }
            const remBtn = e.target.closest('.tmod-tile-remove');
            if (remBtn) {
                const f = remBtn.dataset.feature;
                if (!tileHidden.includes(f)) tileHidden.push(f);
                renderTiles(); renderHidden();
                return;
            }
        });

        storageGet('tmod_tiles_config').then(saved => {
            try {
                const cfg = JSON.parse(saved || 'null');
                if (cfg && Array.isArray(cfg.order) && cfg.order.length) {
                    tileOrder = cfg.order;
                    tileHidden = Array.isArray(cfg.hidden) ? cfg.hidden : [];
                } else {
                    tileOrder = [...DEFAULT_TILE_ORDER];
                }
            } catch { tileOrder = [...DEFAULT_TILE_ORDER]; }
            if (!tileOrder || !tileOrder.length) tileOrder = [...DEFAULT_TILE_ORDER];
            // Восстанавливаем плитки, потерянные между order и hidden (баги старых версий)
            (Object.keys(TILE_ICONS)).forEach(f => {
                if (tileOrder.indexOf(f) === -1 && tileHidden.indexOf(f) === -1) {
                    tileOrder.push(f);
                }
            });
            renderTiles(); renderHidden();
        });

        document.documentElement.appendChild(panel);
        panelOpen = true;
        panelElement = panel;
    }

    function showSettingsSection(panel) {
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;
        // В настройках кнопки «Настроить панель» (редактор плиток) и «Настройки» (шестерёнка) не нужны.
        const editBtn = panel.querySelector('#tmod-panel-edit');
        if (editBtn) editBtn.style.display = 'none';
        const settingsBtn = panel.querySelector('#tmod-panel-settings');
        if (settingsBtn) settingsBtn.style.display = 'none';
        const sectionStyle = 'font-size: 11px; font-weight: 600; color: #adadb8; text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 8px;';
        const dangerBtnStyle = 'display: block; width: 100%; background: #0e0e10; border: 1px solid #5c2323; color: #ff6b6b; border-radius: 6px; padding: 9px 12px; font-size: 14px; font-weight: 600; cursor: pointer; text-align: left; margin-top: 6px;';
        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>←</span> <span>Назад</span></button>
            <h3 style="margin: 0 0 10px; font-size: 14px; font-weight: 600; color: #efeff1;">Настройки</h3>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #18181b; border: 1px solid #3a3a3d; border-radius: 8px; padding: 12px;">
                <div>
                    <div style="font-size: 14px; color: #efeff1; font-weight: 600;">Меню действий модератора</div>
                    <div style="font-size: 12px; color: #adadb8; margin-top: 3px;">Меню по правому клику на сообщение в чате</div>
                </div>
                <div class="tmod-tt-track" id="tmod-sett-ctxmenu"><div class="tmod-tt-thumb"></div></div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #18181b; border: 1px solid #3a3a3d; border-radius: 8px; padding: 12px; margin-top: 8px;">
                <div>
                    <div style="font-size: 14px; color: #efeff1; font-weight: 600;">Автофокус чата</div>
                    <div style="font-size: 12px; color: #adadb8; margin-top: 3px;">Начни печатать в любом месте страницы — фокус сразу перейдёт в чат</div>
                </div>
                <div class="tmod-tt-track" id="tmod-sett-autofocus"><div class="tmod-tt-thumb"></div></div>
            </div>
            <div style="${sectionStyle}">Аккаунт</div>
            <button id="tmod-sett-logout" data-label="Выйти из аккаунта" style="${dangerBtnStyle}">Выйти из аккаунта</button>
            <div style="${sectionStyle}">Сброс данных</div>
            <button id="tmod-sett-reset-tiles" data-label="Сбросить плитки к дефолту" style="${dangerBtnStyle}">Сбросить плитки к дефолту</button>
            <button id="tmod-sett-clear-history" data-label="Очистить историю анонсов" style="${dangerBtnStyle}">Очистить историю анонсов</button>
            <div id="tmod-sett-status" style="margin-top: 12px; font-size: 13px; text-align: center;"></div>
        `;
        content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };

        const setStatus = (text, ok) => {
            const el = content.querySelector('#tmod-sett-status');
            el.textContent = text;
            el.style.color = ok ? '#00f593' : '#ff6b6b';
        };

        // Двухшаговое подтверждение опасных действий: клик → «Точно?» на 2,5 сек → повторный клик выполняет.
        const makeConfirm = (btn, fn) => {
            let armed = false, timer = null;
            btn.addEventListener('click', () => {
                if (!armed) {
                    armed = true;
                    btn.textContent = 'Точно?';
                    timer = setTimeout(() => { armed = false; btn.textContent = btn.dataset.label; }, 2500);
                    return;
                }
                clearTimeout(timer);
                armed = false;
                btn.textContent = btn.dataset.label;
                fn();
            });
        };

        const track = content.querySelector('#tmod-sett-ctxmenu');
        getPanelSettings().then((s) => {
            const on = s.contextMenu !== false;
            tmodContextMenuEnabled = on;
            track.classList.toggle('on', on);
        });
        track.onclick = () => {
            const next = !track.classList.contains('on');
            track.classList.toggle('on', next);
            tmodContextMenuEnabled = next;
            getPanelSettings().then((s) => {
                s.contextMenu = next;
                savePanelSettings(s);
            });
        };

        const autoTrack = content.querySelector('#tmod-sett-autofocus');
        getPanelSettings().then((s) => {
            const on = s.chatAutofocus !== false;
            tmodChatAutofocus = on;
            autoTrack.classList.toggle('on', on);
        });
        autoTrack.onclick = () => {
            const next = !autoTrack.classList.contains('on');
            autoTrack.classList.toggle('on', next);
            tmodChatAutofocus = next;
            getPanelSettings().then((s) => {
                s.chatAutofocus = next;
                savePanelSettings(s);
            });
        };

        makeConfirm(content.querySelector('#tmod-sett-logout'), async () => {
            await setToken(null);
            await setUserInfo(null);
            modTokenCache = false;
            setStatus('Выход выполнен. Токен сброшен', true);
        });

        makeConfirm(content.querySelector('#tmod-sett-reset-tiles'), () => {
            storageSet('tmod_tiles_config', null).then(() => {
                setStatus('Готово: панель откроется с плитками по умолчанию', true);
            });
        });

        makeConfirm(content.querySelector('#tmod-sett-clear-history'), () => {
            const channel = window.location.pathname.slice(1);
            storageSet('tmod_history_' + channel, null).then(() => {
                setStatus('История анонсов очищена', true);
            });
        });
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
    // Отметить
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
                    <button id="tmod-so-send-manual" style="background: #9146FF; color: white; border: none; border-radius: 4px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">Отметить</button>
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
                        <span style="font-size: 12px; color: #9146FF; white-space: nowrap; flex-shrink: 0;">Отметить</span>
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
            <div style="position: relative; margin-bottom: 10px;">
                <label style="font-size: 12px; color: #adadb8; display: block; margin-bottom: 4px;">Канал для рейда</label>
                <input type="text" id="tmod-raid-input" placeholder="логин или ссылка..." autocomplete="off" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px 10px; font-size: 13px; box-sizing: border-box;">
                <div id="tmod-raid-results" style="background: #1a1a1e; border: 1px solid #3a3a3d; border-radius: 0 0 4px 4px; display: none; max-height: 250px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #3a3a3d transparent;"></div>
            </div>
            <button id="tmod-raid-btn" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer;">Начать рейд</button>
            <div id="tmod-raid-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };

        const raidInput = content.querySelector('#tmod-raid-input');
        const raidBtn = content.querySelector('#tmod-raid-btn');
        const statusDiv = content.querySelector('#tmod-raid-status');
        const raidResults = content.querySelector('#tmod-raid-results');

        function parseTwitchLogin(value) {
            const v = value.trim();
            if (!v) return '';
            const urlMatch = v.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
            if (urlMatch) return urlMatch[1].toLowerCase();
            return v.replace(/^@/, '').toLowerCase();
        }

        let raidSearchTimeout = null;
        raidInput.addEventListener('input', () => {
            clearTimeout(raidSearchTimeout);
            const q = parseTwitchLogin(raidInput.value);
            if (q.length < 2) { raidResults.style.display = 'none'; raidResults.innerHTML = ''; return; }
            raidSearchTimeout = setTimeout(async () => {
                const token = await getToken();
                if (!token) return;
                const resp = await apiRequest(`https://api.twitch.tv/helix/search/channels?query=${encodeURIComponent(q)}&first=5`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID }
                });
                if (resp.error || !resp.ok) return;
                try {
                    const data = JSON.parse(resp.text);
                    if (!data.data || !data.data.length) { raidResults.style.display = 'none'; return; }
                    raidResults.innerHTML = data.data.reverse().map(c => {
                        const live = c.is_live ? '<span style="color:#ff4444; font-size: 11px; margin-left: 4px;">LIVE</span>' : '';
                        return `<div class="tmod-raid-item" data-login="${c.broadcaster_login}" style="padding: 6px 10px; font-size: 13px; color: #efeff1; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.1s;">
                            <img src="${c.thumbnail_url || ''}" style="width: 28px; height: 28px; border-radius: 50%; background: #26262c; flex-shrink: 0;" onerror="this.style.display='none'">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.display_name}${live}</span>
                        </div>`;
                    }).join('');
                    raidResults.style.display = 'block';
                    raidResults.querySelectorAll('.tmod-raid-item').forEach(item => {
                        item.onmouseenter = () => item.style.background = '#26262c';
                        item.onmouseleave = () => item.style.background = '';
                        item.onclick = () => {
                            raidInput.value = item.dataset.login;
                            raidResults.style.display = 'none';
                        };
                    });
                } catch { raidResults.style.display = 'none'; }
            }, 300);
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#tmod-raid-input') && !e.target.closest('#tmod-raid-results')) {
                raidResults.style.display = 'none';
            }
        });

        async function doRaid() {
            const target = parseTwitchLogin(raidInput.value);
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
    // Меню модерации (ПКМ по сообщению в чате)
    // ============================================================================

    // Ищет объект юзера рекурсивно по поддереву фибера (предки + дети + сиблинги).
    function isUserObj(o) {
        return !!(o && typeof o === 'object' && o.id != null &&
            (typeof o.login === 'string' || typeof o.displayName === 'string' || typeof o.userName === 'string'));
    }

    // Прямые пользовательские поля сообщения (в новых версиях Twitch fiber).
    function userFromMessage(m) {
        if (!m) return null;
        const uid = m.userId ?? m.user_id ?? m.senderId ?? m.sender_id ?? null;
        const ulogin = m.userLogin ?? m.user_login ?? m.senderLogin ?? m.sender_login ?? null;
        const uname = m.userDisplayName ?? m.user_display_name ?? m.displayName ?? m.senderDisplayName ?? null;
        if (uid || ulogin) {
            return { id: uid, login: ulogin, displayName: uname };
        }
        return null;
    }

    function collectUserCandidate(f) {
        const p = f.memoizedProps || f.pendingProps;
        if (!p) return null;
        const keys = ['user', 'userInfo', 'chatter', 'sender', 'chatUser', 'author', 'owner'];
        for (const k of keys) {
            const v = p[k];
            if (isUserObj(v)) return v;
            if (v && typeof v === 'object') {
                const inner = v.user || v.chatter || v.sender;
                if (isUserObj(inner)) return inner;
            }
        }
        const m = p.message || p.chatMessage || p.translatedMessage || p.messageData;
        if (m) {
            const direct = userFromMessage(m);
            if (direct) return direct;
            for (const k of keys) {
                const v = m[k];
                if (isUserObj(v)) return v;
                if (v && typeof v === 'object') {
                    const inner = v.user || v.chatter || v.sender;
                    if (isUserObj(inner)) return inner;
                }
            }
        }
        return null;
    }

    // Обходит дерево fiber вверх (через return) и вниз (children/siblings).
    function searchFiberForUser(fiber, maxNodes = 600) {
        const seen = new Set();
        let count = 0;
        const check = (f) => {
            if (!f || count >= maxNodes || seen.has(f)) return null;
            seen.add(f); count++;
            return collectUserCandidate(f);
        };
        const scanDown = (root) => {
            const stack = [{ f: root.child, sib: root.sibling }];
            while (stack.length) {
                const { f, sib } = stack.pop();
                if (f) {
                    const u = check(f);
                    if (u) return u;
                    stack.push({ f: f.child, sib: f.sibling });
                }
                if (sib) {
                    const u = check(sib);
                    if (u) return u;
                    stack.push({ f: sib.child, sib: sib.sibling });
                }
            }
            return null;
        };
        let cur = fiber;
        let depth = 0;
        while (cur && depth < 80) {
            const u = check(cur);
            if (u) return u;
            const d = scanDown(cur);
            if (d) return d;
            cur = cur.return;
            depth++;
        }
        return null;
    }

    // Данные сообщения из React Fiber.
    // Расширение: postMessage-мост в twitch-api.js (изолированный мир).
    // Юзерскрипт: прямой доступ к fiber (исполняется на странице).
    function readMessageDataFromFiber(el) {
        const fiber = getReactFiber(el);
        if (!fiber) return null;
        const found = findFiberParent(fiber, (f) => {
            const p = f.memoizedProps || f.pendingProps;
            if (!p) return false;
            const m = p.message || p.chatMessage || p.translatedMessage || p.messageData;
            return !!(m && typeof m.id === 'string');
        }, 60);
        if (!found) return null;
        const p = found.memoizedProps || found.pendingProps;
        const m = p.message || p.chatMessage || p.translatedMessage || p.messageData;

        // Прямые поля сообщения, затем поиск по дереву (предки + дети).
        // Авторитетный логин/имя — видимый ник сообщения в DOM (как в чате).
        const norm = (v) => String(v || '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        let login = null;
        let displayName = null;
        if (el) {
            const nick = el.querySelector('[data-a-target="chat-line-username"]')
                || el.querySelector('.chat-line__username, [data-a-target="chat-line-username"] a');
            if (nick) {
                const text = (nick.textContent || '').trim().replace(/^@/, '');
                if (text && text.length < 40) displayName = text;
                const title = (nick.getAttribute('title') || '').replace(/^@/, '');
                if (title && title.length < 40) displayName = displayName || title;
                const href = nick.getAttribute('href') || '';
                const m2 = href.match(/^\/([^/?]+)$/);
                if (m2) login = m2[1];
                if (!login && displayName) login = displayName.toLowerCase();
            }
        }

        // Прямые поля сообщения, затем поиск по дереву (предки + дети).
        // Fiber-юзеру доверяем, только если его логин совпал с видимым ником
        // сообщения; иначе id не берём — резолвится по логину через Helix.
        const matchesLogin = (cand) => {
            if (!cand || !login) return true;
            const l = norm(cand.login || cand.userLogin || cand.userName || cand.displayName || '');
            return !l || l === norm(login);
        };
        let u = userFromMessage(m);
        if (!matchesLogin(u)) u = null;
        if (!u) u = searchFiberForUser(found);
        if (!matchesLogin(u)) u = null;
        if (!u) u = searchFiberForUser(fiber);
        if (!matchesLogin(u)) u = null;
        u = u || {};
        const flag2 = (v) => (v === true || v === false ? !!v : null);
        const isVip = flag2(u.isVip ?? u.isVIP ?? u.vip ?? (m && (m.isVip ?? m.vip)));
        const isModerator = flag2(u.isModerator ?? u.isMod ?? u.moderator ?? (m && (m.isModerator ?? m.isMod ?? m.moderator)));
        const isBroadcaster = flag2(u.isBroadcaster ?? u.isBROADCASTER ?? (u.role === 'BROADCASTER') ?? (m && m.isBroadcaster));

        return {
            messageId: m.id || null,
            userId: (u && u.id != null ? String(u.id) : null),
            userLogin: login || (u && (u.login || u.userLogin)) || null,
            userName: displayName || (u && (u.displayName || u.userName)) || login || null,
            isBroadcaster,
            isModerator,
            isVip
        };
    }

    async function getMessageData(el) {
        if (!IS_EXTENSION) return readMessageDataFromFiber(el);
        const nonce = 'm' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        return new Promise((resolve) => {
            let settled = false;
            const finish = (val) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                window.removeEventListener('message', handler);
                el.removeAttribute('data-tmod-probe');
                resolve(val);
            };
            const timer = setTimeout(() => finish(null), 1200);
            const handler = (event) => {
                if (event.source !== window) return;
                if (event.data?.type === 'TMOD_GET_MSG_RESULT' && event.data.nonce === nonce) {
                    finish(event.data.data || null);
                }
            };
            window.addEventListener('message', handler);
            el.setAttribute('data-tmod-probe', '1');
            window.postMessage({ type: 'TMOD_GET_MSG', nonce }, '*');
        });
    }

    // Helix-вызов с токеном: возвращает { success } или { success:false, error }.
    async function helixCall(url, options = {}) {
        const token = await getToken();
        if (!token) return { success: false, error: 'Нет токена — войдите в панель' };
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Client-Id': CLIENT_ID
        };
        if (options.body) headers['Content-Type'] = 'application/json';
        const response = await apiRequest(url, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        if (response.error) return { success: false, error: response.error };
        if (response.ok || response.status === 200 || response.status === 204) {
            let data = null;
            try { if (response.text) data = JSON.parse(response.text); } catch (e) {}
            return { success: true, status: response.status, data };
        }
        let msg = 'Ошибка API (' + response.status + ')';
        try {
            const j = JSON.parse(response.text);
            if (j && j.message) msg = String(j.message);
        } catch (e) {}
        return { success: false, status: response.status, error: msg };
    }

    async function getModeratorContext() {
        const token = await getToken();
        if (!token) return null;
        const channel = getChannelName();
        if (!channel) return null;
        const broadcasterId = await getChannelId(channel, token);
        const moderatorId = await getCurrentUserId(token);
        if (!broadcasterId || !moderatorId) return null;
        return { broadcasterId, moderatorId };
    }

    function sanitizeLogin(value) {
        return String(value || '').replace(/[^a-zA-Z0-9_]/g, '');
    }

    // Считывает бейджи прямо с DOM-элемента сообщения (img[alt]) — живой статус
    // VIP/мод/стример без API. Alt локализован, поэтому ловим RU и EN.
    function readBadgesFromMessage(msgEl) {
        const out = { isVip: null, isMod: null, isBroadcaster: null, _alts: [] };
        if (!msgEl) return out;
        const alts = [];
        try {
            msgEl.querySelectorAll('img[alt]').forEach((im) => {
                const a = String(im.getAttribute('alt') || '').trim();
                if (a) alts.push(a);
            });
        } catch (e) {}
        out._alts = alts;
        const joined = alts.join(' ').toLowerCase();
        if (/(\bvip\b|вип)/.test(joined)) out.isVip = true;
        if (/(мод|moderator|\bmod\b)/.test(joined)) out.isMod = true;
        if (/(broadcast|стример|владелец)/.test(joined)) out.isBroadcaster = true;
        return out;
    }

    // Логин цели из текущего меню (для чат-команд).
    function modUserLogin() {
        const s = modMenuState;
        return sanitizeLogin(s && s.userLogin) || sanitizeLogin((s && s.userName || '').toLowerCase());
    }

    // Helix-запрос; если Twitch отвечает отказом по правам (401/must match) —
    // выполняем то же действие чат-командой (команды чата доступны модератору без
    // прав стримера, в отличие от многих Helix-read/write).
    async function runHelixWithChatFallback(helixFn, chatText) {
        const res = await helixFn();
        if (res.success) return res;
        const isAuth = res.status === 401
            || /authorization|must match|incorrect user|not allowed|forbidden|must be/i.test(res.error || '');
        if (!isAuth || !chatText) return res;
        try {
            const ok = await sendToChatInput(chatText);
            return ok
                ? { success: true, viaChat: chatText }
                : { success: false, status: res.status, error: res.error };
        } catch (e) {
            return res;
        }
    }

    async function actionDeleteMessage(messageId) {
        const ctx = await getModeratorContext();
        if (!ctx) return { success: false, error: 'Не удалось определить канал' };
        const url = `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${ctx.broadcasterId}&moderator_id=${ctx.moderatorId}&message_id=${encodeURIComponent(messageId)}`;
        return runHelixWithChatFallback(
            () => helixCall(url, { method: 'DELETE' }),
            '/delete ' + messageId
        );
    }

    async function actionTimeout(userId, seconds, reason) {
        const ctx = await getModeratorContext();
        if (!ctx) return { success: false, error: 'Не удалось определить канал' };
        if (String(userId) === String(ctx.broadcasterId)) {
            return { success: false, error: 'Нельзя выдать таймаут/бан владельцу канала' };
        }
        if (String(userId) === String(ctx.moderatorId)) {
            return { success: false, error: 'Нельзя выдать таймаут/бан самому себе' };
        }
        const data = { user_id: userId };
        if (seconds) data.duration = Math.round(seconds);
        if (reason) data.reason = reason;
        const login = modUserLogin();
        const chatText = login
            ? (seconds
                ? `/timeout ${login} ${Math.round(seconds)}${reason ? ' ' + reason : ''}`
                : `/ban ${login}${reason ? ' ' + reason : ''}`)
            : null;
        const res = await runHelixWithChatFallback(
            () => helixCall(
                `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${ctx.broadcasterId}&moderator_id=${ctx.moderatorId}`,
                { method: 'POST', body: { data } }
            ),
            chatText
        );
        if (res.success) {
            if (seconds) await modLocalAdd(userId, 'timeout', Date.now() + Math.round(seconds) * 1000, Date.now(), ctx.broadcasterId);
            else await modLocalAdd(userId, 'ban', null, Date.now(), ctx.broadcasterId);
        }
        return res;
    }

    async function actionUnban(userId) {
        const ctx = await getModeratorContext();
        if (!ctx) return { success: false, error: 'Не удалось определить канал' };
        const login = modUserLogin();
        const res = await runHelixWithChatFallback(
            () => helixCall(
                `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${ctx.broadcasterId}&moderator_id=${ctx.moderatorId}&user_id=${userId}`,
                { method: 'DELETE' }
            ),
            login ? `/unban ${login}` : null
        );
        if (res.success) {
            await modLocalRemove(userId, ctx.broadcasterId, 'ban');
            await modLocalRemove(userId, ctx.broadcasterId, 'timeout');
        }
        return res;
    }

    async function actionWarn(userId, reason) {
        const ctx = await getModeratorContext();
        if (!ctx) return { success: false, error: 'Не удалось определить канал' };
        return helixCall(
            `https://api.twitch.tv/helix/moderation/warnings?broadcaster_id=${ctx.broadcasterId}&moderator_id=${ctx.moderatorId}`,
            { method: 'POST', body: { data: { user_id: userId, reason: reason || 'Warning' } } }
        );
    }

    async function actionGiveVip(userId) {
        const ctx = await getModeratorContext();
        if (!ctx) return { success: false, error: 'Не удалось определить канал' };
        const login = modUserLogin();
        return runHelixWithChatFallback(
            () => helixCall(`https://api.twitch.tv/helix/channels/vips?broadcaster_id=${ctx.broadcasterId}&user_id=${userId}`, { method: 'POST' }),
            login ? `/vip ${login}` : null
        );
    }

    async function actionRemoveVip(userId) {
        const ctx = await getModeratorContext();
        if (!ctx) return { success: false, error: 'Не удалось определить канал' };
        const login = modUserLogin();
        return runHelixWithChatFallback(
            () => helixCall(`https://api.twitch.tv/helix/channels/vips?broadcaster_id=${ctx.broadcasterId}&user_id=${userId}`, { method: 'DELETE' }),
            login ? `/unvip ${login}` : null
        );
    }

    async function actionAddMod(userId) {
        const ctx = await getModeratorContext();
        if (!ctx) return { success: false, error: 'Не удалось определить канал' };
        const login = modUserLogin();
        return runHelixWithChatFallback(
            () => helixCall(`https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${ctx.broadcasterId}&user_id=${userId}`, { method: 'POST' }),
            login ? `/mod ${login}` : null
        );
    }

    async function actionRemoveMod(userId) {
        const ctx = await getModeratorContext();
        if (!ctx) return { success: false, error: 'Не удалось определить канал' };
        const login = modUserLogin();
        return runHelixWithChatFallback(
            () => helixCall(`https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${ctx.broadcasterId}&user_id=${userId}`, { method: 'DELETE' }),
            login ? `/unmod ${login}` : null
        );
    }

    async function actionBlock(userId, unblock) {
        return helixCall(`https://api.twitch.tv/helix/users/blocks?target_user_id=${userId}`, { method: unblock ? 'DELETE' : 'PUT' });
    }

    // Клик по нику юзера в чате открывает карточку Mod View (то же действие,
    // что делает пользователь вручную).
    function openModViewCardFor(login) {
        const lg = sanitizeLogin(login);
        if (!lg) return false;
        const selector = `a[href="/${CSS.escape(lg)}"]`;
        const link = document.querySelector('.chat-line__message ' + selector) || document.querySelector(selector);
        if (!link) return false;
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, composed: true }));
        return true;
    }

    // Запрашивает у страницы выжимку Fiber-данных открытой карточки Mod View.
    function requestModViewFiberProbe(timeoutMs) {
        return new Promise((resolve) => {
            const nonce = 'modprobe' + Date.now() + Math.random().toString(36).slice(2, 8);
            let done = false;
            const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs || 1500);
            const handler = (ev) => {
                if (ev.source !== window || !ev.data || ev.data.type !== 'TMOD_GET_MODSTATUS_RESULT' || ev.data.nonce !== nonce) return;
                if (done) return;
                done = true;
                clearTimeout(timer);
                window.removeEventListener('message', handler);
                resolve(ev.data.data);
            };
            window.addEventListener('message', handler);
            window.postMessage({ type: 'TMOD_GET_MODSTATUS', nonce }, '*');
        });
    }

    // Читает статус из mod-view карточки юзера Twitch (открывается при клике на ник
    // в режиме модератора: data-a-target="mod-view-user-details"). Twitch сам знает,
    // в таймауте ли юзер сейчас — по кнопке «Снять временную блокировку».
    function readModViewStatus(userId, login) {
        const drawer = document.querySelector('[data-a-target="mod-view-user-details"]');
        if (!drawer) return null;
        const lg = sanitizeLogin(login);
        if (!lg) return null;
        const isTarget = !!drawer.querySelector(`a[href="/${CSS.escape(lg)}"]`);
        if (!isTarget) return null;
        const out = {};
        if (drawer.querySelector('button[aria-label*="Снять временную блокировку"]')) {
            // Таймаут активен. Считаем конец: последняя запись «отстраняет пользователя
            // <login> на N секунд» + её ISO-время старта из id.
            let exp = null, created = null;
            drawer.querySelectorAll('.targeted-mod-action [id]').forEach((el) => {
                const t = el.textContent || '';
                if (!/отстраняет пользователя/i.test(t)) return;
                const iso = (el.id || '').match(/targeted-mod-action-line-(.+)/);
                let start = iso ? Date.parse(iso[1].replace(/\.(\d{3})\d+Z$/, '.$1Z')) : NaN;
                if (isNaN(start)) return;
                const m = t.match(/на\s+([\d\s]+)\s+секунд/);
                const durSec = m ? parseInt(String(m[1]).replace(/\s/g, ''), 10) || 0 : 0;
                if (created === null || start > created) { created = start; exp = start + durSec * 1000; }
            });
            if (exp && exp > Date.now()) {
                out.isTimedOut = true;
                out.banCreatedAt = created ? new Date(created).toISOString() : null;
                out.banExpiresAt = new Date(exp).toISOString();
            }
        }
        if (drawer.querySelector('button[aria-label*="Разбанить"]') && drawer.querySelector(`button[aria-label*="${lg}"]`)) {
            out.isBanned = true;
        }
        return out;
    }

    // Статусы юзера (ban/vip/mod берутся только стримером — у мода 401, остаются null).
    async function fetchModStatus(userId) {
        const channel = getChannelName();
        const token = await getToken();
        if (!token) return { isBanned: null, isTimedOut: null, isVip: null, isMod: null, isBlocked: null, banExpiresAt: null, banCreatedAt: null };
        const status = { isBanned: null, isTimedOut: null, isVip: null, isMod: null, isBlocked: null, banExpiresAt: null, banCreatedAt: null };
        let statusChannelId = null;
        if (channel) {
            const [broadcasterId, me] = await Promise.all([getChannelId(channel, token), getCurrentUserId(token)]);
            if (broadcasterId) {
                statusChannelId = broadcasterId;
                debugLog('mod-ctx', { channel, broadcasterId, me });
                const banned = await helixCall(`https://api.twitch.tv/helix/moderation/banned?broadcaster_id=${broadcasterId}&user_id=${userId}`);
                debugLog('mod-banned-resp', { ok: banned.success, status: banned.status, error: banned.error });
                if (banned.success) {
                    const b = banned.data?.data?.[0] || null;
                    // expires_at установлен → таймаут; null → перманентный бан.
                    status.isBanned = !!b && !b.expires_at;
                    status.isTimedOut = !!b && !!b.expires_at;
                    status.banExpiresAt = b ? (b.expires_at || null) : null;
                    status.banCreatedAt = b ? (b.created_at || null) : null;
                }
                const isBroadcaster = me && String(me) === String(broadcasterId);
                if (isBroadcaster) {
                    // Стримеру Helix отдаёт VIP/модов напрямую.
                    const vips = await helixCall(`https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&user_id=${userId}`);
                    debugLog('mod-vips-resp', { ok: vips.success, status: vips.status, error: vips.error });
                    if (vips.success) status.isVip = !!(vips.data?.data?.length);
                    const mods = await helixCall(`https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${broadcasterId}&user_id=${userId}`);
                    debugLog('mod-mods-resp', { ok: mods.success, status: mods.status, error: mods.error });
                    if (mods.success) status.isMod = !!(mods.data?.data?.length);
                } else {
                    // Модератору vips/moderators (401). Chatters доступен моду для VIP/мод-бейджей.
                    // Внимание: затаймаутенный юзер остаётся в списке чатеров (соединение живо),
                    // поэтому присутствие в чате НЕ означает «не в бане/таймауте».
                    const chatters = await helixCall(`https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${broadcasterId}&moderator_id=${me}&first=1000`);
                    debugLog('mod-chatters-resp', { ok: chatters.success, status: chatters.status, error: chatters.error, count: chatters.data?.data?.length });
                    if (chatters.success && Array.isArray(chatters.data?.data)) {
                        const found = chatters.data.data.find((u) => String(u.user_id) === String(userId));
                        if (found) {
                            status.isVip = !!found.is_vip;
                            status.isMod = !!found.is_moderator;
                        }
                    }
                }
            }
        }
        // Локальный архив: таймауты/баны, выданные через саму панель. Helix-чтение
        // модератору недоступно (401), поэтому свой недавний таймаут знаем локально.
        const local = await getModLocalRecords().catch(() => []);
        const localRec = local.find(
            (r) => r.userId === String(userId)
                && (!statusChannelId || String(r.channel) === String(statusChannelId))
                && (r.kind === 'ban' || r.kind === 'timeout')
        );
        if (localRec) {
            if (localRec.kind === 'ban') {
                if (status.isBanned == null) { status.isBanned = true; status.banExpiresAt = null; status.banCreatedAt = localRec.createdAt; }
            } else {
                if (localRec.expiresAt > Date.now()) {
                    if (status.isTimedOut == null) { status.isTimedOut = true; status.banExpiresAt = localRec.expiresAt; status.banCreatedAt = localRec.createdAt; }
                } else {
                    await modLocalRemove(userId, statusChannelId, 'timeout');
                }
            }
        }
        // Бейджи/флаги с самого сообщения (VIP/мод/стример) — живой статус без API.
        const ms2 = modMenuState || {};
        const badges = readBadgesFromMessage(ms2.msgEl);
        debugLog('mod-badges', { alts: badges._alts, fiberVip: ms2.isVip, fiberMod: ms2.isModerator, badges });
        if (status.isVip !== true && (ms2.isVip === true || badges.isVip === true)) status.isVip = true;
        if (status.isMod !== true && (ms2.isModerator === true || badges.isMod === true)) status.isMod = true;
        // Роли, назначенные/снятые через панель в текущем сеансе меню: юзер может не
        // быть в чате (chatters не найдёт), но результат своего действия мы знаем точно.
        if (ms2.sessionVip === true) status.isVip = true;
        if (ms2.sessionMod === true) status.isMod = true;
        // Карточка юзера в Mod View: Twitch сам показывает текущий таймаут/бан.
        // Если карточка ещё не открыта — открываем её сами кликом по нику и читаем.
        const targetLogin = modMenuState && modMenuState.userLogin;
        let mv = readModViewStatus(userId, targetLogin);
        if (!mv && targetLogin) {
            const opened = openModViewCardFor(targetLogin);
            debugLog('mod-open-card', { opened, login: targetLogin });
            if (opened) {
                await new Promise((r) => setTimeout(r, 900));
                mv = readModViewStatus(userId, targetLogin);
            }
        }
        debugLog('mod-modview-resp', mv);
        if (TMOD_DEBUG) {
            const probe = await requestModViewFiberProbe(1200);
            debugLog('mod-fiber-probe', probe);
        }
        if (mv) {
            if (mv.isTimedOut && status.isTimedOut == null) {
                status.isTimedOut = true;
                status.banExpiresAt = mv.banExpiresAt;
                status.banCreatedAt = mv.banCreatedAt;
            }
            if (mv.isBanned && status.isBanned == null) {
                status.isBanned = true;
                status.banExpiresAt = null;
                status.banCreatedAt = null;
            }
        }
        const blocks = await helixCall('https://api.twitch.tv/helix/users/blocks?first=100');
        if (blocks.success && blocks.data?.data) {
            status.isBlocked = !!blocks.data.data.some((u) => String(u.user_id) === String(userId));
        }
        debugLog('mod-status', { userId, status });
        return status;
    }

    // --- Состояние меню ---
    let modMenuEl = null;
    let modMenuState = null;
    let modBusy = false;
    // Кэш токена для синхронной проверки в contextmenu (preventDefault должен
    // решаться синхронно, а storageGet асинхронный).
    let modTokenCache = null;

    // --- Локальный архив таймаутов/банов, выданных через панель ---
    // Helix-чтение модератору недоступно (401), поэтому свои действия отслеживаем сами.
    const TMOD_MOD_LOCAL_KEY = 'tmod_mod_local_v1';
    let modLocalRecordsCache = null;

    async function getModLocalRecords() {
        if (modLocalRecordsCache) return modLocalRecordsCache;
        const raw = await storageGet(TMOD_MOD_LOCAL_KEY);
        modLocalRecordsCache = Array.isArray(raw) ? raw : [];
        return modLocalRecordsCache;
    }

    async function modLocalAdd(userId, kind, expiresAt, createdAt, channel) {
        const list = await getModLocalRecords();
        list.push({ userId: String(userId), kind: kind, expiresAt, createdAt, channel: String(channel) });
        modLocalRecordsCache = list;
        await storageSet(TMOD_MOD_LOCAL_KEY, list);
    }

    async function modLocalRemove(userId, channel, kind) {
        const list = await getModLocalRecords();
        const next = list.filter((r) => !(
            r.userId === String(userId)
            && (!channel || String(r.channel) === String(channel))
            && (!kind || r.kind === kind)
        ));
        if (next.length !== list.length) {
            modLocalRecordsCache = next;
            await storageSet(TMOD_MOD_LOCAL_KEY, next);
        }
    }

    // Всплывающая подсказка для диагностики (в расширении GM_notification нет).
    function modToast(text) {
        try {
            const old = document.getElementById('tmod-mod-toast');
            if (old) old.remove();
            const div = document.createElement('div');
            div.id = 'tmod-mod-toast';
            div.textContent = text;
            div.style.cssText = 'position:fixed;top:16px;right:16px;z-index:1000001;background:#18181b;color:#efeff1;' +
                'border:1px solid #9147ff;border-radius:8px;padding:10px 14px;font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;' +
                'box-shadow:0 4px 20px rgba(0,0,0,.5);max-width:400px;word-break:break-word;user-select:text;' +
                'cursor:text;white-space:pre-wrap;';
            document.body.appendChild(div);
            setTimeout(() => div.remove(), 8000);
        } catch (err) {}
    }

    function closeModMenu() {
        if (modTimeoutTimer) { clearInterval(modTimeoutTimer); modTimeoutTimer = null; }
        if (modMenuEl) modMenuEl.remove();
        modMenuEl = null;
        modMenuState = null;
        modBusy = false;
    }

    // Пережимает позицию меню в границы окна (после того, как оно дорастёт).
    function clampModMenuPosition() {
        if (!modMenuEl) return;
        const r = modMenuEl.getBoundingClientRect();
        const maxTop = window.innerHeight - r.height - 8;
        const maxLeft = window.innerWidth - r.width - 8;
        let top = parseFloat(modMenuEl.style.top) || 0;
        let left = parseFloat(modMenuEl.style.left) || 0;
        modMenuEl.style.top = Math.max(8, Math.min(top, maxTop)) + 'px';
        modMenuEl.style.left = Math.max(8, Math.min(left, maxLeft)) + 'px';
    }

    function setMenuStatus(text, kind) {
        const el = modMenuEl && modMenuEl.querySelector('.mm-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'mm-status' + (kind ? ' ' + kind : '');
        clampModMenuPosition();
    }

    function setMenuBusy(busy) {
        modBusy = busy;
        if (!modMenuEl) return;
        modMenuEl.querySelectorAll('.mm-btn').forEach((b) => {
            if (b.dataset.alwaysOff) return;
            b.disabled = busy;
        });
    }

    async function runModAction(label, actionFn) {
        if (modBusy || !modMenuEl) return;
        setMenuBusy(true);
        setMenuStatus('Выполняется…');
        const res = await actionFn();
        debugLog('mod-action-res', { label, userId: modMenuState && modMenuState.userId, login: modUserLogin(), res });
        if (!modMenuEl) return;
        setMenuBusy(false);
        if (res.success) {
            setMenuStatus(res.viaChat ? `✓ ${label} — команда отправлена \`${res.viaChat}\`` : '✓ ' + label + ' — готово', 'ok');
            refreshModMenuStatus();
        } else {
            setMenuStatus('✗ ' + label + ': ' + res.error, 'err');
        }
    }

    // Мгновенно собираемый статус: VIP/мод видны по бейджам сообщения и флагам
    // сессии без единого запроса к API. Рендерим первым делом — переключатели
    // ролей не должны ждать долгую цепочку Helix.
    function applyInstantModStatus() {
        if (!modMenuEl || !modMenuState) return;
        const s = modMenuState.status = modMenuState.status || {};
        const st = modMenuState;
        const badges = readBadgesFromMessage(st.msgEl);
        if (s.isVip !== true && (st.isVip === true || badges.isVip === true)) s.isVip = true;
        if (s.isMod !== true && (st.isModerator === true || badges.isMod === true)) s.isMod = true;
        if (st.sessionVip === true) s.isVip = true;
        if (st.sessionMod === true) s.isMod = true;
        renderModMenuToggles();
    }

    async function refreshModMenuStatus() {
        if (!modMenuEl || !modMenuState || !modMenuState.userId) return;
        applyInstantModStatus();
        const status = await fetchModStatus(modMenuState.userId);
        if (!modMenuEl || !modMenuState) return;
        modMenuState.status = status;
        renderModMenuChips();
        renderModMenuToggles();
        renderModMenuTimeout();
        renderModMenuBan();
        clampModMenuPosition();
    }

    // Собирает картинки бейджей юзера из DOM сообщения (src с /badges/).
    function collectUserBadges(msgEl) {
        const out = [];
        if (!msgEl) return out;
        try {
            msgEl.querySelectorAll('img[src]').forEach((im) => {
                const src = im.currentSrc || im.getAttribute('src') || '';
                if (src.indexOf('/badges/') === -1) return;
                out.push({ src, alt: String(im.getAttribute('alt') || '').trim() });
            });
        } catch (e) {}
        return out;
    }

    function renderModMenuUserBadges() {
        const host = modMenuEl && modMenuEl.querySelector('.mm-badges');
        if (!host) return;
        const badges = (modMenuState && modMenuState.badges) || [];
        host.innerHTML = badges
            .map((b) => `<img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}" title="${escapeHtml(b.alt)}">`)
            .join('');
    }

    function renderModMenuChips() {
        const host = modMenuEl && modMenuEl.querySelector('.mm-chips');
        if (!host) return;
        const s = modMenuState?.status || {};
        const chips = [];
        if (s.isTimedOut === true) chips.push(['timedout', 'Отстранён']);
        if (s.isBanned === true) chips.push(['banned', 'Забанен']);
        if (s.isBlocked === true) chips.push(['blocked', 'В блоке']);
        host.innerHTML = chips.map(([cls, label]) => `<span class="mm-chip ${cls}">${label}</span>`).join('');
    }

    // Блок статуса модерации: таймаут (с отсчётом), бан, либо «нет ограничений».
    let modTimeoutTimer = null;

    function renderModMenuTimeout() {
        if (!modMenuEl) return;
        const s = modMenuState?.status || {};
        const row = modMenuEl.querySelector('.mm-timeout-row');
        const info = modMenuEl.querySelector('.mm-timeout-info');
        const btn = modMenuEl.querySelector('[data-action="untimeout"]');
        if (!row || !info) return;
        if (modTimeoutTimer) { clearInterval(modTimeoutTimer); modTimeoutTimer = null; }
        const fmt = (ms) => {
            const total = Math.max(0, Math.round(ms / 1000));
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const sec = total % 60;
            let out = '';
            if (h > 0) out += h + ' ч ';
            if (h > 0 || m > 0) out += m + ' мин ';
            if (out === '') out = sec + ' с'; else if (sec > 0) out += sec + ' с';
            return out.trim();
        };
        const clean = () => {
            row.hidden = false;
            info.textContent = 'Не отстранён — без ограничений';
            info.style.color = '#8fe3a0';
            btn.hidden = true;
        };
        if (s.isTimedOut !== true || !s.banExpiresAt) {
            if (s.isBanned === false) { clean(); return; }
            row.hidden = true;
            return;
        }
        const expires = new Date(s.banExpiresAt).getTime();
        const created = s.banCreatedAt ? new Date(s.banCreatedAt).getTime() : null;
        const render = () => {
            if (!modMenuEl || !row) return;
            const remain = expires - Date.now();
            if (remain <= 0) {
                row.hidden = true;
                if (modTimeoutTimer) { clearInterval(modTimeoutTimer); modTimeoutTimer = null; }
                refreshModMenuStatus();
                return;
            }
            const given = created ? fmt(expires - created) : '?';
            info.style.color = '#ffb3b3';
            info.textContent = `Отстранён. Дано: ${given}. До конца: ${fmt(remain)}`;
            row.hidden = false;
            if (btn) btn.hidden = false;
        };
        render();
        modTimeoutTimer = setInterval(render, 1000);
    }

    // Статус бана (постоянный) — в секции «Бан».
    function renderModMenuBan() {
        if (!modMenuEl) return;
        const s = modMenuState?.status || {};
        const row = modMenuEl.querySelector('.mm-ban-row');
        const info = modMenuEl.querySelector('.mm-ban-info');
        if (!row || !info) return;
        if (s.isBanned !== true) {
            row.hidden = true;
            return;
        }
        row.hidden = false;
        info.textContent = 'Забанен (постоянный бан)';
        info.style.color = '#ff6b6b';
    }

    // Держит роль (vip/mod) в памяти открытого меню после своего успешного действия.
    // Никакого localStorage — живёт до закрытия меню, но гарантирует, что кнопку
    // «забрать/разжаловать» можно будет нажать сразу, даже если юзер не в чате.
    function setSessionRole(kind, value) {
        if (!modMenuState) return;
        const isVipFlag = kind === 'vip';
        modMenuState.status = modMenuState.status || {};
        if (isVipFlag) {
            modMenuState.status.isVip = value;
            modMenuState.sessionVip = value;
        } else {
            modMenuState.status.isMod = value;
            modMenuState.sessionMod = value;
        }
        renderModMenuToggles();
    }

    function renderModMenuToggles() {
        if (!modMenuEl) return;
        const s = modMenuState?.status || {};
        const vipBtn = modMenuEl.querySelector('[data-action="vip"]');
        const modBtn = modMenuEl.querySelector('[data-action="mod"]');
        const blockBtn = modMenuEl.querySelector('[data-action="block"]');
        const banBtn = modMenuEl.querySelector('[data-action="ban"]');
        const unbanBtn = modMenuEl.querySelector('[data-action="unban"]');
        if (vipBtn) {
            const lbl = vipBtn.querySelector('.mm-lbl');
            if (lbl) lbl.textContent = s.isVip === true ? 'Забрать VIP' : 'Дать VIP';
            vipBtn.classList.toggle('danger', s.isVip === true);
        }
        if (modBtn) {
            const lbl = modBtn.querySelector('.mm-lbl');
            if (lbl) lbl.textContent = s.isMod === true ? 'Разжаловать модератора' : 'Сделать модератором';
            const ic = modBtn.querySelector('.mm-ic');
            if (ic) ic.innerHTML = s.isMod === true ? MOD_ICONS.unmod : MOD_ICONS.mod;
            modBtn.classList.toggle('danger', s.isMod === true);
        }
        if (blockBtn) {
            const lbl = blockBtn.querySelector('.mm-lbl');
            if (lbl) lbl.textContent = s.isBlocked === true ? 'Разблокировать' : 'Заблокировать';
        }
        if (banBtn && unbanBtn) {
            const lbl = unbanBtn.querySelector('.mm-lbl');
            if (lbl) lbl.textContent = 'Разбанить';
            if (modBusy) return;
            banBtn.disabled = s.isBanned === true;
            unbanBtn.disabled = s.isBanned === false;
        }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    const MOD_TIMEOUT_PRESETS = [
        [60, '1м'], [300, '5м'], [600, '10м'], [1800, '30м'], [3600, '1ч'], [86400, '24ч']
    ];

    // Иконки (SVG в стиле Twitch), fill: currentColor — наследуют цвет кнопки.
    const MOD_ICONS = {
        delete:   '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 2h4v2h7v2H3V4h7V2ZM5 8h2v12h10V8h2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8Z"/><path d="M11 8h2v10h-2V8Z"/></svg>',
        warn:     '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M13.226 2.72a1.404 1.404 0 0 0-2.452 0L2.192 17.84c-.545.96.136 2.16 1.226 2.16h17.164c1.09 0 1.771-1.2 1.226-2.16L13.226 2.72ZM13 7h-2v7h2V7Zm0 9h-2v2h2v-2Z" clip-rule="evenodd"/></svg>',
        timeout:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 11.586V5h-2v7.414l3.293 3.293 1.414-1.414L13 11.586Z"/><path fill-rule="evenodd" d="M1 12C1 5.925 5.925 1 12 1s11 4.925 11 11-4.925 11-11 11S1 18.075 1 12Zm11 9a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" clip-rule="evenodd"/></svg>',
        ban:      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M1 12C1 5.925 5.925 1 12 1s11 4.925 11 11-4.925 11-11 11S1 18.075 1 12Zm11 9A9 9 0 0 1 4.968 6.382l12.65 12.65A8.962 8.962 0 0 1 12 21Zm7.032-3.382a9 9 0 0 0-12.65-12.65l12.65 12.65Z" clip-rule="evenodd"/></svg>',
        mod:      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 7a5 5 0 1 1 6 4.9v.1a1 1 0 0 0 1 1h1a3 3 0 0 1 3 3v6h-2v-6a1 1 0 0 0-1-1h-1a2.99 2.99 0 0 1-2-.764A2.99 2.99 0 0 1 6 15H5a1 1 0 0 0-1 1v6H2v-6a3 3 0 0 1 3-3h1a1 1 0 0 0 1-1v-.1A5.002 5.002 0 0 1 3 7Zm5 3a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" clip-rule="evenodd"/><path d="m18 8 4 4-4 4-1.5-1.5L18 13h-4v-2h4l-1.5-1.5L18 8Z"/></svg>',
        unmod:    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 7a5 5 0 1 1 6 4.9v.1a1 1 0 0 0 1 1h1a3 3 0 0 1 3 3v6h-2v-6a1 1 0 0 0-1-1h-1a2.99 2.99 0 0 1-2-.764A2.99 2.99 0 0 1 6 15H5a1 1 0 0 0-1 1v6H2v-6a3 3 0 0 1 3-3h1a1 1 0 0 0 1-1v-.1A5.002 5.002 0 0 1 3 7Zm5 3a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" clip-rule="evenodd"/><path d="M17.5 6.5 16 8l2 2-2 2 1.5 1.5 2-2 2 2L23 12l-2-2 2-2-1.5-1.5-2 2-2-2Z"/></svg>',
        vip:      '<svg viewBox="8 8 48 36" fill="currentColor" aria-hidden="true"><path d="M10 18 18 10h28l8 8-22 24L10 18z"/></svg>'
    };

    function showModMenu(data, msgEl) {
        closeModMenu();
        modMenuState = {
            ...data,
            msgEl: msgEl || null,
            status: { isBanned: null, isVip: null, isMod: null, isBlocked: null }
        };

        const menu = document.createElement('div');
        menu.id = 'tmod-mod-menu';

        const name = escapeHtml(data.userName || data.userLogin || '?');
        const login = data.userLogin && data.userLogin !== name ? '@' + escapeHtml(data.userLogin) : '';
        const delDisabled = !data.canDelete
            ? ' data-always-off="1" disabled title="Нельзя удалить это сообщение"'
            : '';

        const presetsHtml = MOD_TIMEOUT_PRESETS
            .map(([sec, label]) => `<button class="mm-btn preset" data-action="preset" data-seconds="${sec}" data-label="${label}">${label}</button>`)
            .join('');

        menu.innerHTML = `
            <style>
                #tmod-mod-menu {
                    position: fixed; z-index: 1000000; background: #18181b;
                    border: 1px solid #3a3a3d; border-radius: 10px;
                    box-shadow: 0 8px 30px rgba(0,0,0,.6);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: #efeff1; width: 320px; visibility: hidden;
                    user-select: none; -webkit-user-select: none; overflow: hidden;
                    max-height: calc(100vh - 16px);
                }
                #tmod-mod-menu .mm-header { padding: 10px 12px; border-bottom: 1px solid #2f2f33; background: #0e0e10; cursor: grab; }
                #tmod-mod-menu .mm-header.dragging { cursor: grabbing; }
                #tmod-mod-menu .mm-header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
                #tmod-mod-menu .mm-close { background: none; border: none; color: #adadb8; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; flex: 0 0 auto; }
                #tmod-mod-menu .mm-close:hover { color: #fff; background: #2f2f33; }
                #tmod-mod-menu .mm-name { font-weight: 700; font-size: 13px; color: #fff; display: inline-flex; align-items: center; flex-wrap: wrap; min-width: 0; }
                #tmod-mod-menu .mm-login { font-weight: 400; font-size: 11px; color: #9147ff; margin-left: 4px; }
                #tmod-mod-menu .mm-preview { font-size: 11.5px; line-height: 1.35; color: #adadb8; margin-top: 2px; word-break: break-word; max-height: 34px; overflow: hidden; }
                #tmod-mod-menu .mm-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; min-height: 20px; }
                #tmod-mod-menu .mm-chip { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: #2f2f33; color: #adadb8; }
                #tmod-mod-menu .mm-badges { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-right: 6px; min-width: 0; }
                #tmod-mod-menu .mm-badges:empty { display: none; }
                #tmod-mod-menu .mm-badges img { width: 16px; height: 16px; border-radius: 2px; }
                #tmod-mod-menu .mm-chip.vip { background: #d4af37; color: #1a1100; }
                #tmod-mod-menu .mm-chip.mod { background: #1f69ff; color: #fff; }
                #tmod-mod-menu .mm-chip.banned { background: #eb0400; color: #fff; }
                #tmod-mod-menu .mm-chip.timedout { background: #e68100; color: #fff; }
                #tmod-mod-menu .mm-chip.blocked { background: #5b21b6; color: #fff; }
                #tmod-mod-menu .mm-body { padding: 6px 10px 10px; max-height: calc(100vh - 70px); overflow-y: auto; }
                #tmod-mod-menu .mm-section { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: #9147ff; margin: 8px 0 3px; font-weight: 600; }
#tmod-mod-menu .mm-row { display: flex; gap: 5px; margin: 4px 0; flex-wrap: wrap; align-items: stretch; }
                #tmod-mod-menu .mm-btn {
                    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
                    background: #26262c; border: 1px solid #3a3a3d; border-radius: 6px;
                    color: #efeff1; padding: 5px 8px; font-size: 12px; cursor: pointer; text-align: center;
                    min-height: 28px;
                }
                #tmod-mod-menu .mm-lbl { white-space: nowrap; }
                #tmod-mod-menu .mm-ic { display: inline-flex; flex: 0 0 14px; width: 14px; height: 14px; }
                #tmod-mod-menu .mm-ic svg { width: 14px; height: 14px; display: block; }
                #tmod-mod-menu [data-action="vip"] .mm-ic { flex: 0 0 16px; width: 16px; height: 16px; }
                #tmod-mod-menu [data-action="vip"] .mm-ic svg { width: 16px; height: 16px; }
                #tmod-mod-menu .mm-btn:hover:not(:disabled) { background: #3a3a3d; }
                #tmod-mod-menu .mm-btn.danger { color: #ff6b6b; border-color: #5c2323; }
                #tmod-mod-menu .mm-btn.danger:hover:not(:disabled) { background: #3a1414; }
                #tmod-mod-menu .mm-btn.wide { flex: 1 1 100%; }
                #tmod-mod-menu .mm-btn.preset { flex: 0 0 auto; min-height: 24px; padding: 3px 10px; border-radius: 12px; font-size: 11px; color: #bf94ff; }
                #tmod-mod-menu .mm-btn.preset:hover:not(:disabled) { background: #9147ff; color: #fff; }
                #tmod-mod-menu .mm-input {
                    flex: 1 1 100%; width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 6px;
                    color: #efeff1; padding: 5px 8px; font-size: 12px; box-sizing: border-box;
                }
                #tmod-mod-menu .mm-input::placeholder { color: #6f6f78; }
                #tmod-mod-menu .mm-status { font-size: 11.5px; color: #adadb8; padding: 6px 10px; border-top: 1px solid #2f2f33; min-height: 16px; user-select: text; -webkit-user-select: text; word-break: break-word; }
                #tmod-mod-menu .mm-status.err { color: #ff6b6b; }
                #tmod-mod-menu .mm-status.ok { color: #00d66a; }
                #tmod-mod-menu .mm-timeout-row { margin: 6px 0 2px; padding: 6px 10px; border: 1px solid #5c2323; border-radius: 6px; background: #261414; }
                #tmod-mod-menu .mm-timeout-info { font-size: 11.5px; color: #ffb3b3; margin-bottom: 4px; user-select: text; -webkit-user-select: text; word-break: break-word; }
                #tmod-mod-menu .mm-ban-row { margin: 6px 0 2px; padding: 6px 10px; border: 1px solid #3a3a3d; border-radius: 6px; background: #101014; }
                #tmod-mod-menu .mm-ban-info { font-size: 11.5px; color: #adadb8; user-select: text; -webkit-user-select: text; word-break: break-word; }
            </style>
            <div class="mm-header">
                <div class="mm-header-top">
                    <div class="mm-name"><span class="mm-badges"></span>${name}<span class="mm-login">${login}</span></div>
                    <button class="mm-close" data-action="close" title="Закрыть">✕</button>
                </div>
                <div class="mm-preview"></div>
                <div class="mm-chips"></div>
            </div>
            <div class="mm-body">
                <div class="mm-section">Сообщение</div>
                <button class="mm-btn wide" data-action="delete"${delDisabled}><span class="mm-ic">${MOD_ICONS.delete}</span><span class="mm-lbl">Удалить сообщение</span></button>

                <div class="mm-section">Предупреждение</div>
                <input class="mm-input" type="text" maxlength="500" placeholder="Причина (варн / таймаут / бан)">
                <div class="mm-row">
                    <button class="mm-btn" data-action="warn"><span class="mm-ic">${MOD_ICONS.warn}</span><span class="mm-lbl">Предупредить</span></button>
                    <button class="mm-btn" data-action="purge"><span class="mm-ic">${MOD_ICONS.timeout}</span><span class="mm-lbl">Отстранить (1с)</span></button>
                </div>

                <div class="mm-section">Таймаут</div>
                <div class="mm-row">${presetsHtml}</div>
                <div class="mm-row">
                    <input class="mm-input" type="number" min="1" max="20160" placeholder="Минуты" style="flex:1;">
                    <button class="mm-btn" data-action="timeout-custom"><span class="mm-lbl">Ок</span></button>
                </div>
                <div class="mm-timeout-row" hidden>
                    <div class="mm-timeout-info"></div>
                    <button class="mm-btn wide" data-action="untimeout"><span class="mm-ic">${MOD_ICONS.timeout}</span><span class="mm-lbl">Прервать отстранение</span></button>
                </div>

                <div class="mm-section">Бан</div>
                <div class="mm-row">
                    <button class="mm-btn danger" data-action="ban"><span class="mm-ic">${MOD_ICONS.ban}</span><span class="mm-lbl">Бан</span></button>
                    <button class="mm-btn" data-action="unban"><span class="mm-lbl">Разбанить</span></button>
                </div>
                <div class="mm-ban-row" hidden>
                    <div class="mm-ban-info"></div>
                </div>

                <div class="mm-section">Роли</div>
                <div class="mm-row">
                    <button class="mm-btn" data-action="vip"><span class="mm-ic">${MOD_ICONS.vip}</span><span class="mm-lbl">Дать VIP</span></button>
                    <button class="mm-btn" data-action="mod"><span class="mm-ic">${MOD_ICONS.mod}</span><span class="mm-lbl">Сделать модератором</span></button>
                </div>

                <div class="mm-section">Блокировка (личная)</div>
                <div class="mm-row">
                    <button class="mm-btn" data-action="block"><span class="mm-ic">${MOD_ICONS.ban}</span><span class="mm-lbl">Заблокировать</span></button>
                </div>
            </div>
            <div class="mm-status"></div>
        `;

        menu.style.left = '0px';
        menu.style.top = '0px';
        document.body.appendChild(menu);
        modMenuEl = menu;
        modMenuState.badges = collectUserBadges(msgEl);
        renderModMenuUserBadges();

        // Резервируем место под строки таймаута/бана, которые появятся после загрузки
        // статуса, чтобы меню не «подпрыгивало», дорастая вниз. Элементы уже в DOM,
        // меню ещё невидимо, поэтому можно замерить без мигания.
        const reservedHeight =
            (() => {
                const rows = Array.prototype.slice.call(menu.querySelectorAll('.mm-timeout-row[hidden], .mm-ban-row[hidden]'));
                if (!rows.length) return 0;
                const hBefore = menu.offsetHeight;
                rows.forEach((row) => row.removeAttribute('hidden'));
                const grown = menu.offsetHeight - hBefore;
                rows.forEach((row) => row.setAttribute('hidden', ''));
                return Math.max(0, grown);
            })();

        // Позиционирование: слева от кликнутого сообщения (т.е. левее колонки чата,
        // по вертикали напротив начала сообщения). Если слева нет места — справа от сообщения.
        const r = menu.getBoundingClientRect();
        const msgRect = msgEl ? msgEl.getBoundingClientRect() : null;
        const totalH = r.height + reservedHeight;
        const gap = 12;
        let left;
        if (msgRect) {
            const leftSpace = msgRect.left - gap;
            const rightSpace = window.innerWidth - (msgRect.right + gap);
            if (leftSpace >= r.width || leftSpace >= rightSpace) {
                left = msgRect.left - r.width - gap;
            } else {
                left = msgRect.right + gap;
            }
        } else {
            left = (window.innerWidth - r.width) / 2;
        }
        // Прижимаем к позиции сообщения по вертикали, не выходя за экран.
        let top = msgRect
            ? Math.max(8, Math.min(msgRect.top, window.innerHeight - totalH - 8))
            : Math.max(8, (window.innerHeight - totalH) / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.visibility = 'visible';

        // Закрытие по крестику
        const closeBtn = menu.querySelector('.mm-close');
        if (closeBtn) closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeModMenu();
        });

        // Перетаскивание за шапку
        const header = menu.querySelector('.mm-header');
        if (header) {
            header.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || e.target.closest('.mm-close')) return;
                e.preventDefault();
                const startX = e.clientX;
                const startY = e.clientY;
                const startLeft = parseInt(menu.style.left, 10) || left;
                const startTop = parseInt(menu.style.top, 10) || top;
                header.classList.add('dragging');
                const onMove = (ev) => {
                    const nl = startLeft + ev.clientX - startX;
                    const nt = startTop + ev.clientY - startY;
                    menu.style.left = nl + 'px';
                    menu.style.top = nt + 'px';
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    header.classList.remove('dragging');
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }

        const preview = menu.querySelector('.mm-preview');
        if (data.preview) preview.textContent = data.preview;

        const reasonInput = menu.querySelector('.mm-input[type="text"]');
        menu.querySelectorAll('.mm-btn[data-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const s = modMenuState;
                if (!s || !s.userId) return;
                const reason = reasonInput ? reasonInput.value.trim() : '';
                switch (action) {
                    case 'close':
                        closeModMenu();
                        break;
                    case 'delete':
                        if (s.messageId) runModAction('Удалить сообщение', () => actionDeleteMessage(s.messageId));
                        break;
                    case 'warn':
                        runModAction('Предупредить', () => actionWarn(s.userId, reason));
                        break;
                    case 'purge':
                        runModAction('Отстранить (1с)', () => actionTimeout(s.userId, 1, reason));
                        break;
                    case 'preset': {
                        const sec = parseInt(btn.dataset.seconds, 10);
                        runModAction(`Таймаут ${btn.dataset.label}`, () => actionTimeout(s.userId, sec, reason));
                        break;
                    }
                    case 'timeout-custom': {
                        const numInput = menu.querySelector('.mm-input[type="number"]');
                        const val = parseFloat(numInput && numInput.value);
                        if (!val || val < 1) { setMenuStatus('Укажите минуты (1–20160)', 'err'); return; }
                        const sec = Math.max(60, Math.min(1209600, Math.round(val) * 60));
                        runModAction(`Таймаут ${Math.round(val)} мин`, () => actionTimeout(s.userId, sec, reason));
                        break;
                    }
                    case 'ban':
                        runModAction('Бан', () => actionTimeout(s.userId, null, reason));
                        break;
                    case 'unban':
                        runModAction('Разбан', () => actionUnban(s.userId));
                        break;
                    case 'untimeout':
                        runModAction('Прервать отстранение', () => actionUnban(s.userId));
                        break;
                    case 'vip':
                        if (s.status.isVip === true) {
                            runModAction('Забрать VIP', async () => {
                                const res = await actionRemoveVip(s.userId);
                                if (res && res.success) setSessionRole('vip', false);
                                return res;
                            });
                        } else {
                            runModAction('Дать VIP', async () => {
                                const res = await actionGiveVip(s.userId);
                                if (res && res.success) setSessionRole('vip', true);
                                return res;
                            });
                        }
                        break;
                    case 'mod':
                        if (s.status.isMod === true) {
                            runModAction('Разжаловать модератора', async () => {
                                const res = await actionRemoveMod(s.userId);
                                if (res && res.success) setSessionRole('mod', false);
                                return res;
                            });
                        } else {
                            runModAction('Сделать модератором', async () => {
                                const res = await actionAddMod(s.userId);
                                if (res && res.success) setSessionRole('mod', true);
                                return res;
                            });
                        }
                        break;
                    case 'block':
                        if (s.status.isBlocked === true) {
                            runModAction('Разблокировать', () => actionBlock(s.userId, true));
                        } else {
                            runModAction('Заблокировать', () => actionBlock(s.userId, false));
                        }
                        break;
                }
            });
        });

        renderModMenuChips();
        renderModMenuToggles();
        renderModMenuTimeout();
        renderModMenuBan();
        refreshModMenuStatus();
    }

    function initChatAutofocus() {
        getPanelSettings().then((s) => { tmodChatAutofocus = s.chatAutofocus !== false; });

        const FOCUSABLE_SELECTOR = 'input, textarea, [contenteditable], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

        function isFocusableElement(el) {
            if (!el || el === document.body || el === document.documentElement) return false;
            if (el.closest(FOCUSABLE_SELECTOR)) return true;
            return false;
        }

        document.addEventListener('keydown', (e) => {
            if (!tmodChatAutofocus) return;
            // Только печатные одинарные символы, без модификаторов.
            if (e.key.length !== 1) return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            // Не мешаем, когда фокус уже в каком-то поле ввода.
            if (isFocusableElement(document.activeElement)) return;
            // Twitch — SPA: ищем поле на каждый keydown, не кэшируем.
            const chatInput = document.querySelector('[data-a-target="chat-input"]');
            if (!chatInput) return;
            // Блокируем одиночные хоткеи Twitch.
            e.preventDefault();
            e.stopImmediatePropagation();
            chatInput.focus();
            // Чат Twitch — Slate.js: execCommand пишет «сырой» DOM, которого нет в
            // состоянии редактора. Пусть сам Slate обработает символ через beforeinput.
            setTimeout(() => {
                if (document.activeElement !== chatInput) return;
                const evt = new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: e.key,
                });
                const handled = !chatInput.dispatchEvent(evt) || evt.defaultPrevented;
                if (!handled) {
                    document.execCommand('insertText', false, e.key);
                }
            }, 0);
        }, true);
    }

    function initModerationMenu() {
        getPanelSettings().then((s) => { tmodContextMenuEnabled = s.contextMenu !== false; });
        const gqlCaptureCache = new Map();

        // Ответы GQL-операций, которыми сама страница тянет данные модерации.
        window.addEventListener('message', (ev) => {
            if (ev.source !== window || ev.data?.type !== 'TMOD_GQL_CAPTURE') return;
            const op = ev.data.operationName || '?';
            gqlCaptureCache.set(op, ev.data);
            if (TMOD_DEBUG && /mod|user|ban|timeout|vip|channel/i.test(op)) {
                console.log('[ModPanel][accent] gql-capture', op, {
                    variables: ev.data.variables,
                    response: (ev.data.response || '').slice(0, 1500)
                });
            }
        });
        getToken().then((t) => {
            modTokenCache = !!t;
            debugLog('mod-token-cache', modTokenCache);
            if (TMOD_DEBUG && t) {
                fetch('https://id.twitch.tv/oauth2/validate', { headers: { 'Authorization': 'Bearer ' + t } })
                    .then((r) => r.json().catch(() => ({})))
                    .then((j) => debugLog('token-validate', { scopes: j.scopes, error: j.message }))
                    .catch((e) => debugLog('token-validate-error', e.message));
            }
        });

        document.addEventListener('contextmenu', (e) => {
            if (!tmodContextMenuEnabled) return;
            if (modMenuEl && !e.target.closest('#tmod-mod-menu')) closeModMenu();
            if (!isStreamPage()) { console.log('[ModPanel] contextmenu: not stream page'); return; }
            if (e.target.closest('#tmod-mod-menu')) return;
            if (!modTokenCache) { console.log('[ModPanel] contextmenu: no token'); modToast('Нет токена — нажмите «Панель модератора» и войдите'); return; }
            const selectors = [
                '[data-test-selector="chat-line-message"]',
                '.chat-line__message',
                '[data-test-selector="chat-message-holder"]',
                '.chat-line__message--centered'
            ];
            let msgEl = null;
            for (const sel of selectors) {
                msgEl = e.target.closest(sel);
                if (msgEl) break;
            }
            if (!msgEl) {
                const uname = e.target.closest('[data-a-target="chat-line-username"]');
                if (uname) {
                    for (const sel of selectors) {
                        msgEl = uname.closest(sel);
                        if (msgEl) break;
                    }
                }
            }
            if (!msgEl) { console.log('[ModPanel] contextmenu: no message element', e.target); return; }
            // preventDefault должен быть синхронным, иначе появится нативный ПКМ-меню
            e.preventDefault();
            e.stopPropagation();
            (async () => {
                if (!modTokenCache) { console.log('[ModPanel] contextmenu: token lost'); return; }
                const data = await getMessageData(msgEl);
                // Если fiber дал только login (id не извлёкся), резолвим id через Helix.
                if (data && data.userLogin && !data.userId) {
                    const r = await helixCall('https://api.twitch.tv/helix/users?login=' + encodeURIComponent(data.userLogin));
                    if (r.success && r.data && r.data.data && r.data.data[0]) {
                        data.userId = String(r.data.data[0].id);
                    }
                }
                if (!data || !data.userId) { console.log('[ModPanel] no fiber data', data); modToast('Не удалось прочитать данные сообщения (fiber)'); return; }
                const userInfo = await getUserInfo();
                const myId = userInfo && (userInfo.id || userInfo.user_id) ? String(userInfo.id || userInfo.user_id) : null;
                // Стримера или чужого модератора удалить нельзя; своё сообщение модератора — можно.
                const isOtherMod = data.isModerator && (!myId || myId !== data.userId);
                data.canDelete = !!data.messageId && !data.isBroadcaster && !isOtherMod;
                // Превью: простые фрагменты текста сообщения (без ника и бейджей).
                let preview = '';
                const frags = msgEl.querySelectorAll('.text-fragment, .chat-line__text-fragment, [data-a-target="chat-message-text"]');
                if (frags.length) {
                    preview = Array.from(frags).map((f) => f.textContent).join(' ').trim();
                }
                if (!preview) {
                    // Фолбэк: вырезаем элемент ника из текста сообщения.
                    preview = (msgEl.textContent || '').trim();
                    const nickEl = msgEl.querySelector('[data-a-target="chat-line-username"]');
                    if (nickEl) preview = preview.replace(nickEl.textContent || '', '').replace(/^\s*[:：]\s*/, '').trim();
                }
                data.preview = preview.slice(0, 80);
                debugLog('mod-context', 'data', data);
                showModMenu(data, msgEl);
            })();
        }, true);

        document.addEventListener('click', (e) => {
            if (e.button === 0 && modMenuEl && !e.target.closest('#tmod-mod-menu')) closeModMenu();
        }, true);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modMenuEl) closeModMenu();
        }, true);

        // Закрываем только при реальном скролле самой страницы. Чат скроллится во
        // внутреннем контейнере (в т.ч. автоскролл при новых сообщениях) — его
        // прокрутка не должна закрывать меню.
        let modMenuScrollBase = window.scrollY;
        window.addEventListener('scroll', () => {
            if (!modMenuEl) return;
            if (Math.abs(window.scrollY - modMenuScrollBase) > 2) closeModMenu();
            modMenuScrollBase = window.scrollY;
        }, true);
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
        btn.style.cssText = 'width: 200px; height: 36px; background: linear-gradient(90deg, #9146FF, #772ce8); color: white; border: none; border-radius: 999px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s;';

        btn.onmouseenter = () => { btn.style.background = 'linear-gradient(90deg, #772ce8, #5b21b6)'; btn.style.transform = 'scale(1.02)'; };
        btn.onmouseleave = () => { btn.style.background = 'linear-gradient(90deg, #9146FF, #772ce8)'; btn.style.transform = 'scale(1)'; };

        btn.onclick = async (e) => {
            e.preventDefault(); e.stopPropagation();
            const token = await getToken();
            if (!token) {
                const result = await authorize();
                if (result.success) {
                    modTokenCache = true;
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

    function watchChannelChanges() {
        let lastPath = window.location.pathname;
        setInterval(() => {
            if (window.location.pathname !== lastPath) {
                lastPath = window.location.pathname;
                const btnWrapper = document.getElementById('tmod-btn-wrapper');
                if (btnWrapper) btnWrapper.remove();
                if (panelOpen && panelElement) { panelElement.remove(); panelOpen = false; }
                closeModMenu();
                if (isStreamPage()) {
                    setTimeout(injectButton, 500);
                    warmAccentCache();
                    setTimeout(getChannelAccentColor, 3000);
                    setTimeout(getChannelAccentColor, 12000);
                }
            }
        }, 1000);
    }

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
    watchChannelChanges();
    initModerationMenu();
    initChatAutofocus();
    // Разовый дожимающий вход для пользователей со старыми правами. Отложен,
    // чтобы не спорить с остальным стартом и не мешать первому рендеру.
    setTimeout(ensureScopesFresh, 1500);

    // Меню Tampermonkey (в расширении эту роль играет popup/)
    if (!IS_EXTENSION && typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Войти', async () => {
            const result = await authorize();
            if (result.success) modTokenCache = true;
            notify(result.success ? 'Вход: ' + ((result.user && result.user.login) || 'выполнен') : 'Ошибка: ' + (result.error || 'не удалось войти'));
        });
        GM_registerMenuCommand('Выйти', async () => {
            await setToken(null);
            await setUserInfo(null);
            modTokenCache = false;
            notify('Выход выполнен');
        });
    }

})();
