// ==UserScript==
// @name            Twitch ModPanel - Full
// @namespace       TMP
// @description     Панель модератора для Twitch (полная версия)
// @version         1.0.0
//
// @grant           GM_getValue
// @grant           GM_setValue
// @grant           GM_xmlhttpRequest
// @grant           GM_openInTab
// @grant           GM_registerMenuCommand
// @grant           GM_notification
//
// @match           https://*.twitch.tv/*
//
// @connect         api.twitch.tv
// @connect         id.twitch.tv
// @connect         irc-ws.chat.twitch.tv
//
// @run-at          document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // КОНСТАНТЫ
    // ============================================================================

    const CLIENT_ID = 'qz89rtnd3uz3v7k3rnh5hffx3b97mu';
    const STORAGE_KEY_TOKEN = 'tmod_access_token';
    const STORAGE_KEY_USER = 'tmod_user_info';

    // ============================================================================
    // ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
    // ============================================================================

    let panelOpen = false;
    let panelElement = null;
    let panelPosition = null;
    let ws = null;
    let connected = false;
    let currentChannel = null;

    // ============================================================================
    // УТИЛИТЫ
    // ============================================================================

    function isStreamPage() {
        return /^\/[a-zA-Z0-9_]+$/.test(window.location.pathname);
    }

    function getToken() {
        return new Promise(resolve => {
            const token = GM_getValue(STORAGE_KEY_TOKEN, null);
            resolve(token);
        });
    }

    function setToken(token) {
        GM_setValue(STORAGE_KEY_TOKEN, token);
    }

    function getUserInfo() {
        return new Promise(resolve => {
            const user = GM_getValue(STORAGE_KEY_USER, null);
            resolve(user);
        });
    }

    function setUserInfo(user) {
        GM_setValue(STORAGE_KEY_USER, user);
    }

    // ============================================================================
    // API ФУНКЦИИ
    // ============================================================================

    async function getCurrentUserId(token) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://api.twitch.tv/helix/users',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID
                },
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.responseText);
                        resolve(data.data[0]?.id || null);
                    } catch (e) {
                        resolve(null);
                    }
                },
                onerror: () => resolve(null)
            });
        });
    }

    async function getChannelId(channelName, token) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.twitch.tv/helix/users?login=${channelName}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID
                },
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.responseText);
                        resolve(data.data[0]?.id || null);
                    } catch (e) {
                        resolve(null);
                    }
                },
                onerror: () => resolve(null)
            });
        });
    }

    async function sendAnnouncement(channelName, message, color = 'primary') {
        const token = await getToken();
        if (!token) return { success: false, error: 'No token' };

        const broadcasterId = await getChannelId(channelName, token);
        const userId = await getCurrentUserId(token);

        if (!broadcasterId || !userId) {
            return { success: false, error: 'Could not get IDs' };
        }

        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `https://api.twitch.tv/helix/chat/announcements?broadcaster_id=${broadcasterId}&moderator_id=${userId}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({ message, color }),
                onload: (response) => {
                    if (response.status === 204) {
                        resolve({ success: true });
                    } else {
                        try {
                            const error = JSON.parse(response.responseText);
                            resolve({ success: false, error: error.message || `API Error: ${response.status}` });
                        } catch (e) {
                            resolve({ success: false, error: `API Error: ${response.status}` });
                        }
                    }
                },
                onerror: (error) => resolve({ success: false, error: error.message })
            });
        });
    }

    async function getChatSettings(channelName) {
        const token = await getToken();
        if (!token) return null;

        const broadcasterId = await getChannelId(channelName, token);
        const userId = await getCurrentUserId(token);

        if (!broadcasterId || !userId) return null;

        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${userId}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID
                },
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.responseText);
                        const settings = data.data[0];
                        resolve({
                            slowMode: settings.slow_mode,
                            slowModeWaitTime: settings.slow_mode_wait_time,
                            followerMode: settings.follower_mode,
                            followerModeWaitTime: settings.follower_mode_wait_time,
                            subscriberMode: settings.subscriber_mode,
                            emoteMode: settings.emote_mode
                        });
                    } catch (e) {
                        resolve(null);
                    }
                },
                onerror: () => resolve(null)
            });
        });
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

        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'PATCH',
                url: `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${userId}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify(body),
                onload: (response) => {
                    if (response.status === 200) {
                        resolve({ success: true });
                    } else {
                        try {
                            const error = JSON.parse(response.responseText);
                            resolve({ success: false, error: error.message || `API Error: ${response.status}` });
                        } catch (e) {
                            resolve({ success: false, error: `API Error: ${response.status}` });
                        }
                    }
                },
                onerror: (error) => resolve({ success: false, error: error.message })
            });
        });
    }

    // ============================================================================
    // IRC WEBSOCKET
    // ============================================================================

    function connectIRC(token, username) {
        return new Promise((resolve, reject) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                console.log('[ModPanel] Already connected');
                resolve(true);
                return;
            }

            console.log('[ModPanel] Connecting to irc-ws.chat.twitch.tv...');
            ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

            ws.onopen = () => {
                console.log('[ModPanel] WebSocket connected');
                const pass = `PASS oauth:${token}`;
                const nick = `NICK ${username.toLowerCase()}`;
                console.log('[ModPanel] Sending PASS and NICK');
                ws.send(pass);
                ws.send(nick);
            };

            ws.onmessage = (event) => {
                console.log('[ModPanel] Received:', event.data.substring(0, 100));

                if (event.data.includes('004')) {
                    connected = true;
                    console.log('[ModPanel] Authentication successful');
                    resolve(true);
                }

                if (event.data.includes('043') || event.data.includes('Login authentication failed')) {
                    console.error('[ModPanel] Authentication failed');
                    reject(new Error('Invalid OAuth token'));
                }

                if (event.data.includes('PING')) {
                    ws.send('PONG :tmi.twitch.tv');
                    console.log('[ModPanel] PONG sent');
                }
            };

            ws.onerror = (error) => {
                console.error('[ModPanel] WebSocket error:', error);
                reject(error);
            };

            ws.onclose = () => {
                console.log('[ModPanel] Disconnected');
                connected = false;
                ws = null;
            };

            setTimeout(() => {
                if (!connected) reject(new Error('Connection timeout'));
            }, 10000);
        });
    }

    function joinChannel(channel) {
        return new Promise((resolve, reject) => {
            if (!connected || !ws) {
                reject(new Error('Not connected'));
                return;
            }

            currentChannel = channel.toLowerCase();
            ws.send(`JOIN #${currentChannel}`);
            console.log('[ModPanel] Joined #' + currentChannel);

            setTimeout(resolve, 500);
        });
    }

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            if (!connected || !ws || !currentChannel) {
                reject(new Error('Not connected or no channel'));
                return;
            }

            ws.send(`PRIVMSG #${currentChannel} :${message}`);
            console.log('[ModPanel] Sent:', message);
            resolve(true);
        });
    }

    // ============================================================================
    // ОТПРАВКА В ЧАТ ЧЕРЕЗ REACT FIBER
    // ============================================================================

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
        try {
            if (callback(fiber)) return fiber;
        } catch (e) {}
        if (fiber.return) {
            return findFiberParent(fiber.return, callback, maxDepth, depth + 1);
        }
        return null;
    }

    function getChatComponent() {
        const chatElement = document.querySelector('section[data-test-selector="chat-room-component-layout"]');
        if (!chatElement) return null;

        const fiber = getReactFiber(chatElement);
        if (!fiber) return null;

        const chatFiber = findFiberParent(fiber, (f) => {
            return f.stateNode && f.stateNode.props && f.stateNode.props.onSendMessage;
        });

        return chatFiber?.stateNode;
    }

    function sendToChatInput(message) {
        const chatComponent = getChatComponent();
        if (!chatComponent) {
            console.error('[ModPanel] Chat component not found');
            return false;
        }

        console.log('[ModPanel] Sending to chat:', message);
        chatComponent.props.onSendMessage(message);
        return true;
    }

    // ============================================================================
    // OAUTH
    // ============================================================================

    function startOAuth() {
        return new Promise((resolve) => {
            const redirectUri = 'http://localhost:3000';
            const scopes = [
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
                'chat:edit'
            ].join(' ');

            const authUrl = `https://id.twitch.tv/oauth2/authorize` +
                `?client_id=${CLIENT_ID}` +
                `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                `&response_type=token` +
                `&scope=${encodeURIComponent(scopes)}` +
                `&force_verify=true`;

            console.log('[ModPanel] Opening OAuth:', authUrl);

            // Открываем в новом окне через GM_openInTab
            const authWindow = GM_openInTab(authUrl, {
                active: true,
                insert: true,
                setParent: true
            });

            let completed = false;
            let checkCount = 0;

            // Создаваем iframe для перехвата redirect
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);

            // Проверяем закрытие окна
            const checkWindow = setInterval(() => {
                if (authWindow.closed) {
                    clearInterval(checkWindow);
                    if (!completed) {
                        completed = true;
                        document.body.removeChild(iframe);
                        resolve({ success: false, error: 'Window closed' });
                    }
                }
                checkCount++;
                if (checkCount > 240) { // 2 минуты
                    clearInterval(checkWindow);
                    completed = true;
                    authWindow.close();
                    document.body.removeChild(iframe);
                    resolve({ success: false, error: 'Timeout' });
                }
            }, 500);

            // Слушаем сообщения от iframe
            window.addEventListener('message', function handler(event) {
                if (event.data?.type === 'TMOD_OAUTH_SUCCESS' && !completed) {
                    completed = true;
                    clearInterval(checkWindow);
                    authWindow.close();
                    document.body.removeChild(iframe);
                    window.removeEventListener('message', handler);
                    resolve({ success: true, token: event.data.token, user: event.data.user });
                }
            });
        });
    }

    // ============================================================================
    // UI ФУНКЦИИ
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
            width: max-content;
            min-width: 320px;
            background: #0e0e10;
            border: 1px solid #3a3a3d;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            animation: tmod-slide-in 0.3s ease-out;
            user-select: none;
            -webkit-user-select: none;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes tmod-slide-in {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .tmod-no-select { user-select: none !important; -webkit-user-select: none !important; }
            .tmod-feature-btn {
                background: #18181b !important;
                border: 1px solid #3a3a3d !important;
                border-radius: 8px !important;
                cursor: pointer !important;
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                gap: 8px !important;
                text-align: left !important;
                padding: 18px 16px !important;
                min-width: 120px !important;
                margin: 0 !important;
                box-sizing: border-box !important;
                color: #efeff1 !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                font-size: 14px !important;
                font-weight: 600 !important;
            }
            .tmod-feature-btn:hover {
                background: #26262c !important;
                border-color: #4f4f52 !important;
            }
            .tmod-feature-btn img {
                width: 24px !important;
                height: 24px !important;
                flex-shrink: 0 !important;
                filter: brightness(0) invert(1) !important;
            }
            .tmod-feature-btn .tmod-label {
                font-size: 14px !important;
                font-weight: 600 !important;
                color: #efeff1 !important;
                white-space: nowrap !important;
            }
        `;
        panel.appendChild(style);

        const iconUrl = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTggMTZWMTEgTTEyIDE2VjggTTE2IDE2VjEzIE00IDE2LjhMNC03LjJDNCA2LjA3OTkgNCA1LjUxOTg0IDQuMjE3OTkgNS4wOTIwMiBDNC40MDk3MyA0LjcxNTcgNC43MTU2OSA0LjQwOTczIDUuMDkyMDIgNC4yMTc5OSBDNS41MTk4NCA0IDYuMDc5OSA0IDcuMiA0SDE2LjhDMTcuOTIwMSA0IDE4LjQ4MDIgNCAxOC45MDggNC4yMTc5OSBDMTkuMjg0MyA0LjQwOTczIDE5LjU5MDMgNC43MTU3IDE5Ljc4MiA1LjA5MjAyIEMyMCA1LjUxOTg0IDIwIDYuMDc5OSAyMCA3LjJWMTYuOEMyMCAxNy45MjAxIDIwIDE4LjQ4MDIgMTkuNzgyIDE4LjkwOCBDMTkuNTkwMyAxOS4yODQzIDE5LjI4NDMgMTkuNTkwMyAxOC45MDggMTkuNzgyIEMxOC40ODAyIDIwIDE3LjkyMDEgMjAgMTYuOCAyMEg3LjJDNi4wNzk5IDIwIDUuNTE5ODQgMjAgNS4wOTIwMiAxOS43ODIgQzQuNzE1NjkgMTkuNTkwMyA0LjQwOTczIDE5LjI4NDMgNC4yMTc5OSAxOC45MDggQzQgMTguNDgwMiA0IDE3LjkyMDEgNCAxNi44WiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9zdmc+';

        panel.innerHTML = `
            <style>
                @keyframes tmod-slide-in {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .tmod-no-select { user-select: none !important; -webkit-user-select: none !important; }
            </style>
            <div class="tmod-no-select" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #18181b; border-bottom: 1px solid #3a3a3d; cursor: move; border-radius: 8px 8px 0 0;" id="tmod-panel-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <img src="${iconUrl}" style="width: 24px; height: 24px; filter: brightness(0) invert(1);" alt="">
                    <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #efeff1; pointer-events: none;">Панель модератора</h3>
                </div>
                <button id="tmod-panel-close" style="background: none; border: none; color: #adadb8; cursor: pointer; padding: 4px; font-size: 18px;">✕</button>
            </div>
            <div style="padding: 8px; border-radius: 0 0 8px 8px;" id="tmod-panel-content">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                    <button class="tmod-feature-btn" data-feature="announce">
                        <img src="${iconUrl}" alt="">
                        <span class="tmod-label">Анонс</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="chat">
                        <img src="${iconUrl}" alt="">
                        <span class="tmod-label">Чат</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="poll">
                        <img src="${iconUrl}" alt="">
                        <span class="tmod-label">Опрос</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="prediction">
                        <img src="${iconUrl}" alt="">
                        <span class="tmod-label">Прогноз</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="clip">
                        <img src="${iconUrl}" alt="">
                        <span class="tmod-label">Клип</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="rewards">
                        <img src="${iconUrl}" alt="">
                        <span class="tmod-label">Награды</span>
                    </button>
                </div>
            </div>
        `;

        const header = panel.querySelector('#tmod-panel-header');
        let isDragging = false;
        let startX, startY, startRight, startBottom;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startRight = window.innerWidth - rect.right;
            startBottom = window.innerHeight - rect.bottom;
            header.style.cursor = 'grabbing';

            document.addEventListener('mousemove', handleDragMove);
            document.addEventListener('mouseup', handleDragEnd);
        });

        function handleDragMove(e) {
            if (!isDragging) return;
            e.preventDefault();

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newRight = startRight - dx;
            let newBottom = startBottom - dy;

            const panelRect = panel.getBoundingClientRect();
            const maxRight = window.innerWidth - panelRect.width - 10;
            const maxBottom = window.innerHeight - panelRect.height - 10;
            const minBottom = 10;

            newRight = Math.max(10, Math.min(newRight, maxRight));
            newBottom = Math.max(minBottom, Math.min(newBottom, maxBottom));

            panel.style.right = `${newRight}px`;
            panel.style.bottom = `${newBottom}px`;
            panel.style.left = 'auto';
            panel.style.top = 'auto';
        }

        function handleDragEnd() {
            if (isDragging) {
                isDragging = false;
                header.style.cursor = 'move';

                const rect = panel.getBoundingClientRect();
                panelPosition = {
                    right: window.innerWidth - rect.right,
                    bottom: window.innerHeight - rect.bottom
                };

                document.removeEventListener('mousemove', handleDragMove);
                document.removeEventListener('mouseup', handleDragEnd);
            }
        }

        panel.querySelector('#tmod-panel-close').addEventListener('click', () => {
            panel.remove();
            panelOpen = false;
            panelPosition = null;
        });

        panel.querySelectorAll('.tmod-feature-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const feature = this.dataset.feature;
                console.log('[ModPanel] Feature button clicked:', feature);

                const rect = panel.getBoundingClientRect();
                panelPosition = {
                    right: window.innerWidth - rect.right,
                    bottom: window.innerHeight - rect.bottom
                };

                if (feature === 'announce') {
                    console.log('[ModPanel] Opening announce section');
                    showAnnounceSection(panel);
                } else if (feature === 'chat') {
                    console.log('[ModPanel] Opening chat section');
                    showChatSection(panel);
                } else if (feature === 'poll') {
                    console.log('[ModPanel] Sending /poll to chat input');
                    sendToChatInput('/poll');
                } else if (feature === 'prediction') {
                    console.log('[ModPanel] Sending /prediction to chat input');
                    sendToChatInput('/prediction');
                } else if (feature === 'rewards') {
                    console.log('[ModPanel] Sending /requests to chat input');
                    sendToChatInput('/requests');
                } else if (feature === 'clip') {
                    console.log('[ModPanel] Creating clip');
                    showClipSection(panel);
                }
            });
        });

        document.documentElement.appendChild(panel);
        panelOpen = true;
        panelElement = panel;
    }

    function showAnnounceSection(panel) {
        const channelName = window.location.pathname.slice(1);
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        content.innerHTML = `
            <button id="tmod-back" class="tmod-no-select" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;">
                <span>←</span> <span>Назад</span>
            </button>
            <textarea id="tmod-announce-text" placeholder="Текст анонса (макс. 500 символов)" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px; resize: vertical; font-family: inherit;" rows="4"></textarea>
            <select id="tmod-announce-color" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px; margin-top: 10px; font-family: inherit;">
                <option value="primary">🔴 Красный (Primary)</option>
                <option value="blue">🔵 Синий</option>
                <option value="green">🟢 Зелёный</option>
                <option value="orange">🟠 Оранжевый</option>
                <option value="purple">🟣 Фиолетовый</option>
            </select>
            <button id="tmod-send-announce" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 10px;">Отправить</button>
            <div id="tmod-announce-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        content.querySelector('#tmod-back').addEventListener('click', function() {
            panel.remove();
            panelOpen = false;
            setTimeout(() => createPanel(), 10);
        });

        content.querySelector('#tmod-send-announce').addEventListener('click', async () => {
            const textInput = content.querySelector('#tmod-announce-text');
            const colorSelect = content.querySelector('#tmod-announce-color');
            const statusDiv = content.querySelector('#tmod-announce-status');

            const text = textInput.value.trim();
            const color = colorSelect.value;

            if (!text) {
                statusDiv.style.color = '#ff6b6b';
                statusDiv.textContent = 'Введите текст анонса';
                return;
            }

            if (text.length > 500) {
                statusDiv.style.color = '#ff6b6b';
                statusDiv.textContent = 'Текст слишком длинный';
                return;
            }

            statusDiv.style.color = '#adadb8';
            statusDiv.textContent = 'Отправка...';

            const result = await sendAnnouncement(channelName, text, color);

            if (result.success) {
                statusDiv.style.color = '#00ff00';
                statusDiv.textContent = '✅ Анонс отправлен!';
                setTimeout(() => {
                    panel.remove();
                    createPanel();
                }, 1500);
            } else {
                statusDiv.style.color = '#ff6b6b';
                statusDiv.textContent = '❌ Ошибка: ' + result.error;
            }
        });
    }

    function showChatSection(panel) {
        const channelName = window.location.pathname.slice(1);
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        content.innerHTML = `
            <button id="tmod-back" class="tmod-no-select" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;">
                <span>←</span> <span>Назад</span>
            </button>
            <div id="tmod-chat-loading" style="text-align: center; color: #adadb8; padding: 20px;">Загрузка настроек...</div>
            <div id="tmod-chat-settings" style="display: none;">
                <div class="tmod-no-select tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;">
                    <span style="font-size: 14px; color: #efeff1;">Только для подписчиков</span>
                    <label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;">
                        <input type="checkbox" id="tmod-sub-only" style="opacity: 0; width: 0; height: 0;">
                        <span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span>
                        <span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span>
                    </label>
                </div>
                <div class="tmod-no-select tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;">
                    <span style="font-size: 14px; color: #efeff1;">Только для фолловеров</span>
                    <label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;">
                        <input type="checkbox" id="tmod-follower-only" style="opacity: 0; width: 0; height: 0;">
                        <span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span>
                        <span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span>
                    </label>
                </div>
                <div class="tmod-no-select tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;">
                    <span style="font-size: 14px; color: #efeff1;">Только эмодзи</span>
                    <label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;">
                        <input type="checkbox" id="tmod-emote-only" style="opacity: 0; width: 0; height: 0;">
                        <span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span>
                        <span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span>
                    </label>
                </div>
                <div class="tmod-no-select tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;">
                    <span style="font-size: 14px; color: #efeff1;">Slow Mode</span>
                    <label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;">
                        <input type="checkbox" id="tmod-slow-mode" style="opacity: 0; width: 0; height: 0;">
                        <span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span>
                        <span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span>
                    </label>
                </div>
                <div id="tmod-slow-wait" style="display: none; margin-top: 15px; padding: 12px; background: #18181b; border-radius: 4px;">
                    <input type="number" id="tmod-slow-time" min="0" max="120" value="30" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px;">
                    <span style="font-size: 12px; color: #adadb8; margin-top: 5px; display: block;">секунд между сообщениями</span>
                </div>
                <div class="tmod-no-select tmod-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;">
                    <span style="font-size: 14px; color: #efeff1;">Shield Mode</span>
                    <label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;">
                        <input type="checkbox" id="tmod-shield-mode" style="opacity: 0; width: 0; height: 0;">
                        <span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span>
                        <span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span>
                    </label>
                </div>
                <button id="tmod-clear-chat" style="width: 100%; background: #ff4444; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 15px;">🗑️ Очистить чат</button>
                <button id="tmod-save-chat" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 10px;">Сохранить</button>
                <div id="tmod-chat-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
            </div>
        `;

        const toggleStyle = document.createElement('style');
        toggleStyle.textContent = `
            .tmod-toggle-active span:first-of-type {
                background-color: #9146FF !important;
            }
            .tmod-toggle-active span:last-of-type {
                transform: translateX(20px) !important;
                background-color: #fff !important;
            }
            .tmod-toggle label:hover span:first-of-type {
                background-color: #4f4f52;
            }
            .tmod-toggle-active label:hover span:first-of-type {
                background-color: #772ce8 !important;
            }
        `;
        panel.appendChild(toggleStyle);

        const rect = panel.getBoundingClientRect();
        if (rect.top < 0) {
            const newBottom = panelPosition.bottom + rect.top;
            panel.style.bottom = `${Math.max(10, newBottom)}px`;
        }

        getChatSettings(channelName).then((settings) => {
            const loadingDiv = content.querySelector('#tmod-chat-loading');
            const settingsDiv = content.querySelector('#tmod-chat-settings');

            if (!settings) {
                loadingDiv.style.color = '#ff6b6b';
                loadingDiv.textContent = 'Ошибка: проверьте консоль (F12)';
                return;
            }

            loadingDiv.style.display = 'none';
            settingsDiv.style.display = 'block';

            function updateToggleStyle(checkbox) {
                const label = checkbox.closest('label');
                if (checkbox.checked) {
                    label.classList.add('tmod-toggle-active');
                } else {
                    label.classList.remove('tmod-toggle-active');
                }
            }

            const subCheckbox = content.querySelector('#tmod-sub-only');
            const followerCheckbox = content.querySelector('#tmod-follower-only');
            const emoteCheckbox = content.querySelector('#tmod-emote-only');
            const slowCheckbox = content.querySelector('#tmod-slow-mode');
            const shieldCheckbox = content.querySelector('#tmod-shield-mode');

            subCheckbox.checked = settings.subscriberMode;
            followerCheckbox.checked = settings.followerMode;
            emoteCheckbox.checked = settings.emoteMode;
            slowCheckbox.checked = settings.slowMode;

            updateToggleStyle(subCheckbox);
            updateToggleStyle(followerCheckbox);
            updateToggleStyle(emoteCheckbox);
            updateToggleStyle(slowCheckbox);

            subCheckbox.addEventListener('change', () => updateToggleStyle(subCheckbox));
            followerCheckbox.addEventListener('change', () => updateToggleStyle(followerCheckbox));
            emoteCheckbox.addEventListener('change', () => updateToggleStyle(emoteCheckbox));
            slowCheckbox.addEventListener('change', () => {
                updateToggleStyle(slowCheckbox);
                content.querySelector('#tmod-slow-wait').style.display = slowCheckbox.checked ? 'block' : 'none';
            });

            content.querySelector('#tmod-back').addEventListener('click', function() {
                panel.remove();
                panelOpen = false;
                setTimeout(() => createPanel(), 10);
            });

            content.querySelector('#tmod-save-chat').addEventListener('click', async () => {
                const statusDiv = content.querySelector('#tmod-chat-status');

                const settings = {
                    subscriberMode: subCheckbox.checked,
                    followerMode: followerCheckbox.checked,
                    emoteMode: emoteCheckbox.checked,
                    slowMode: slowCheckbox.checked,
                    slowModeWaitTime: parseInt(content.querySelector('#tmod-slow-time').value) || 30
                };

                statusDiv.style.color = '#adadb8';
                statusDiv.textContent = 'Сохранение...';

                const result = await updateChatSettings(channelName, settings);

                if (result.success) {
                    statusDiv.style.color = '#00ff00';
                    statusDiv.textContent = '✅ Сохранено!';
                    setTimeout(() => {
                        panel.remove();
                        createPanel();
                    }, 1500);
                } else {
                    statusDiv.style.color = '#ff6b6b';
                    statusDiv.textContent = '❌ Ошибка: ' + result.error;
                }
            });

            content.querySelector('#tmod-clear-chat').addEventListener('click', () => {
                if (confirm('Вы уверены, что хотите очистить чат?')) {
                    sendToChatInput('/clear');
                    const statusDiv = content.querySelector('#tmod-chat-status');
                    statusDiv.style.color = '#00ff00';
                    statusDiv.textContent = '✅ Чат очищен!';
                    setTimeout(() => {
                        statusDiv.textContent = '';
                    }, 2000);
                }
            });
        });
    }

    function showClipSection(panel) {
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        content.innerHTML = `
            <button id="tmod-back" class="tmod-no-select" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;">
                <span>←</span> <span>Назад</span>
            </button>
            <div style="text-align: center; color: #adadb8; font-size: 13px; margin-bottom: 15px;">
                Создание клипа из текущего момента стрима
            </div>
            <input type="text" id="tmod-clip-title" placeholder="Название клипа (необязательно)" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px; margin-bottom: 10px;">
            <button id="tmod-create-clip" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer;">🎬 Создать клип</button>
            <div id="tmod-clip-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        content.querySelector('#tmod-back').addEventListener('click', function() {
            panel.remove();
            panelOpen = false;
            setTimeout(() => createPanel(), 10);
        });

        content.querySelector('#tmod-create-clip').addEventListener('click', async () => {
            const titleInput = content.querySelector('#tmod-clip-title');
            const statusDiv = content.querySelector('#tmod-clip-status');
            const title = titleInput.value.trim();

            statusDiv.style.color = '#adadb8';
            statusDiv.textContent = 'Создание клипа...';

            const command = title ? `/clip "${title}"` : '/clip';
            sendToChatInput(command);

            statusDiv.style.color = '#00ff00';
            statusDiv.textContent = '✅ Клик создан! Проверьте чат.';
            setTimeout(() => {
                panel.remove();
                createPanel();
            }, 1500);
        });
    }

    function injectButton() {
        if (!isStreamPage()) return;

        const selectors = ['[data-a-target="chat-input"]', '.chat-input'];
        let chatContainer = null;

        for (const selector of selectors) {
            chatContainer = document.querySelector(selector);
            if (chatContainer) break;
        }

        if (!chatContainer) {
            setTimeout(injectButton, 1000);
            return;
        }

        if (document.getElementById('tmod-btn')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'tmod-btn-wrapper';
        wrapper.style.cssText = `padding: 10px 0; margin-top: 10px; border-top: 1px solid #3a3a3d; display: flex; justify-content: center;`;

        const btn = document.createElement('button');
        btn.id = 'tmod-btn';
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="white" focusable="false" aria-hidden="true" role="presentation"><path fill-rule="evenodd" d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z" clip-rule="evenodd"></path></svg> <span>Панель модератора</span>`;
        btn.style.cssText = `
            width: 200px; height: 36px;
            background: linear-gradient(90deg, #9146FF, #772ce8);
            color: white; border: none; border-radius: 4px;
            cursor: pointer; font-size: 14px; font-weight: 600;
            display: flex; align-items: center; justify-content: center; gap: 8px;
            transition: all 0.2s; box-shadow: 0 2px 8px rgba(145, 70, 255, 0.3);
        `;

        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'linear-gradient(90deg, #772ce8, #5b21b6)';
            btn.style.transform = 'scale(1.02)';
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'linear-gradient(90deg, #9146FF, #772ce8)';
            btn.style.transform = 'scale(1)';
        });

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            console.log('[ModPanel] Button clicked');

            const token = await getToken();

            if (!token) {
                console.log('[ModPanel] No token, starting OAuth');
                const result = await startOAuth();
                if (result.success) {
                    setToken(result.token);
                    setUserInfo(result.user);
                    GM_notification({
                        title: 'Twitch ModPanel',
                        text: `✅ Успешный вход как ${result.user.login}!`,
                        timeout: 5000
                    });
                } else {
                    GM_notification({
                        title: 'Twitch ModPanel',
                        text: `❌ Ошибка: ${result.error}`,
                        timeout: 5000
                    });
                }
                return;
            }

            console.log('[ModPanel] Token exists, toggling panel');
            if (panelOpen && panelElement) {
                panelElement.remove();
                panelOpen = false;
            } else {
                createPanel();
            }
        });

        wrapper.appendChild(btn);

        const chatRoom = chatContainer.closest('[class*="chat-room"]') || chatContainer.parentElement;
        if (chatRoom) chatRoom.appendChild(wrapper);
        else chatContainer.appendChild(wrapper);

        console.log('[ModPanel] Button injected');
    }

    // ============================================================================
    // ЗАПУСК
    // ============================================================================

    if (isStreamPage()) {
        console.log('[ModPanel] Starting on stream page:', window.location.pathname);
        injectButton();
    }

    // Меню Tampermonkey
    GM_registerMenuCommand('🔐 Войти', async () => {
        const result = await startOAuth();
        if (result.success) {
            setToken(result.token);
            setUserInfo(result.user);
            GM_notification({
                title: 'Twitch ModPanel',
                text: `✅ Успешный вход как ${result.user.login}!`,
                timeout: 5000
            });
        } else {
            GM_notification({
                title: 'Twitch ModPanel',
                text: `❌ Ошибка: ${result.error}`,
                timeout: 5000
            });
        }
    });

    GM_registerMenuCommand('🚪 Выйти', () => {
        setToken(null);
        setUserInfo(null);
        GM_notification({
            title: 'Twitch ModPanel',
            text: 'Вы вышли',
            timeout: 3000
        });
    });

    GM_registerMenuCommand('ℹ️ О скрипте', () => {
        GM_notification({
            title: 'Twitch ModPanel',
            text: 'v1.0.0 | Панель модератора для Twitch',
            timeout: 5000
        });
    });

})();
