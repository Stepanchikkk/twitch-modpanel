// ==UserScript==
// @name            Twitch ModPanel - Full
// @namespace       TMP
// @description     Панель модератора для Twitch (полная версия для Tampermonkey)
// @version         1.0.0
// @author          Twitch ModPanel Team
//
// @grant           GM_getValue
// @grant           GM_setValue
// @grant           GM_xmlhttpRequest
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

    const CLIENT_ID = 'qz89rtnd3uz3v7k3rnh5hffx3b97mu';
    const STORAGE_KEY_TOKEN = 'tmod_access_token';
    const STORAGE_KEY_USER = 'tmod_user_info';

    let panelOpen = false;
    let panelElement = null;
    let panelPosition = null;
    let ws = null;
    let connected = false;
    let currentChannel = null;

    function isStreamPage() {
        return /^\/[a-zA-Z0-9_]+$/.test(window.location.pathname);
    }

    function getToken() {
        return new Promise(resolve => {
            resolve(GM_getValue(STORAGE_KEY_TOKEN, null));
        });
    }

    function setToken(token) {
        GM_setValue(STORAGE_KEY_TOKEN, token);
    }

    function getUserInfo() {
        return new Promise(resolve => {
            resolve(GM_getValue(STORAGE_KEY_USER, null));
        });
    }

    function setUserInfo(user) {
        GM_setValue(STORAGE_KEY_USER, user);
    }

    function getCurrentUserId(token) {
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

    function getChannelId(channelName, token) {
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

    function connectIRC(token, username) {
        return new Promise((resolve, reject) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                resolve(true);
                return;
            }

            ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

            ws.onopen = () => {
                ws.send(`PASS oauth:${token}`);
                ws.send(`NICK ${username.toLowerCase()}`);
            };

            ws.onmessage = (event) => {
                if (event.data.includes('004')) {
                    connected = true;
                    resolve(true);
                }
                if (event.data.includes('PING')) {
                    ws.send('PONG :tmi.twitch.tv');
                }
            };

            ws.onerror = (error) => reject(error);
            ws.onclose = () => { connected = false; ws = null; };

            setTimeout(() => { if (!connected) reject(new Error('Timeout')); }, 10000);
        });
    }

    function joinChannel(channel) {
        return new Promise((resolve, reject) => {
            if (!connected || !ws) { reject(new Error('Not connected')); return; }
            currentChannel = channel.toLowerCase();
            ws.send(`JOIN #${currentChannel}`);
            setTimeout(resolve, 500);
        });
    }

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            if (!connected || !ws || !currentChannel) { reject(new Error('Not connected')); return; }
            ws.send(`PRIVMSG #${currentChannel} :${message}`);
            resolve(true);
        });
    }

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
        const chatComponent = getChatComponent();
        if (!chatComponent) { console.error('[ModPanel] Chat component not found'); return false; }
        console.log('[ModPanel] Sending to chat:', message);
        chatComponent.props.onSendMessage(message);
        return true;
    }

    function startOAuth() {
        return new Promise((resolve) => {
            // Создаём data URI который показывает успех и закрывается сам
            const redirectHtml = `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0e0e10;color:#efeff1}</style></head><body><div id="msg"><h1>✅ Успешно!</h1><p>Закрой это окно</p></div><script>
                var h=location.hash.substring(1),p=new URLSearchParams(h),t=p.get('access_token');
                if(t&&window.opener){
                    window.opener.postMessage({type:'TMOD_OAUTH_SUCCESS',token:t},'*');
                    document.getElementById('msg').innerHTML='<h1>✅ Готово!</h1><p>Можешь закрыть это окно</p>';
                }
            <\/script></body></html>`;
            const redirectUri = 'data:text/html;base64,' + btoa(redirectHtml);
            
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

            console.log('[ModPanel] Opening OAuth');

            const width = 600;
            const height = 700;
            const left = Math.round((window.screen.width - width) / 2);
            const top = Math.round((window.screen.height - height) / 2);

            const authWindow = window.open(authUrl, 'TwitchOAuth', `width=${width},height=${height},left=${left},top=${top}`);

            if (!authWindow) { resolve({success:false,error:'Popup blocked'}); return; }

            let completed = false;
            let checkCount = 0;

            const messageHandler = (event) => {
                if (event.data?.type === 'TMOD_OAUTH_SUCCESS' && !completed) {
                    completed = true;
                    window.removeEventListener('message', messageHandler);
                    // Пытаемся закрыть окно
                    try { 
                        authWindow.close(); 
                        console.log('[ModPanel] Close attempted');
                    } catch(e) {
                        console.log('[ModPanel] Close failed:', e);
                    }
                    // Получаем пользователя
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: 'https://api.twitch.tv/helix/users',
                        headers: {'Authorization':`Bearer ${event.data.token}`,'Client-Id':CLIENT_ID},
                        onload: (r) => {
                            try {
                                const d = JSON.parse(r.responseText);
                                resolve({success:true, token:event.data.token, user:d.data[0]});
                            } catch(e) { resolve({success:true, token:event.data.token, user:{login:'user'}}); }
                        },
                        onerror: () => resolve({success:true, token:event.data.token, user:{login:'user'}})
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
                        resolve({success:false,error:'Closed by user'});
                    }
                }
                checkCount++;
                if (checkCount > 240) {
                    clearInterval(checkWindow);
                    completed = true;
                    try { authWindow.close(); } catch(e) {}
                    window.removeEventListener('message', messageHandler);
                    resolve({success:false,error:'Timeout'});
                }
            }, 500);
        });
    }

    function createPanel() {
        // Упрощённая версия - только кнопки
        if (panelElement) panelElement.remove();

        const panel = document.createElement('div');
        panel.id = 'tmod-panel';
        panel.style.cssText = `
            position: fixed; right: 350px; bottom: 10px; z-index: 999999;
            width: max-content; min-width: 320px; background: #0e0e10;
            border: 1px solid #3a3a3d; border-radius: 8px; overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            user-select: none;
        `;

        const iconUrl = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTggMTZWMTEgTTEyIDE2VjggTTE2IDE2VjEzIE00IDE2LjhMNC03LjJDNCA2LjA3OTkgNCA1LjUxOTg0IDQuMjE3OTkgNS4wOTIwMiBDNC40MDk3MyA0LjcxNTcgNC43MTU2OSA0LjQwOTczIDUuMDkyMDIgNC4yMTc5OSBDNS41MTk4NCA0IDYuMDc5OSA0IDcuMiA0SDE2LjhDMTcuOTIwMSA0IDE4LjQ4MDIgNCAxOC45MDggNC4yMTc5OSBDMTkuMjg0MyA0LjQwOTczIDE5LjU5MDMgNC43MTU3IDE5Ljc4MiA1LjA5MjAyIEMyMCA1LjUxOTg0IDIwIDYuMDc5OSAyMCA3LjJWMTYuOEMyMCAxNy45MjAxIDIwIDE4LjQ4MDIgMTkuNzgyIDE4LjkwOCBDMTkuNTkwMyAxOS4yODQzIDE5LjI4NDMgMTkuNTkwMyAxOC45MDggMTkuNzgyIEMxOC40ODAyIDIwIDE3LjkyMDEgMjAgMTYuOCAyMEg3LjJDNi4wNzk5IDIwIDUuNTE5ODQgMjAgNS4wOTIwMiAxOS43ODIgQzQuNzE1NjkgMTkuNTkwMyA0LjQwOTczIDE5LjI4NDMgNC4yMTc5OSAxOC45MDggQzQgMTguNDgwMiA0IDE3LjkyMDEgNCAxNi44WiIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9zdmc+';

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #18181b; border-bottom: 1px solid #3a3a3d; cursor: move;" id="tmod-panel-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <img src="${iconUrl}" style="width: 24px; height: 24px; filter: brightness(0) invert(1);" alt="">
                    <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #efeff1;">Панель модератора</h3>
                </div>
                <button id="tmod-panel-close" style="background: none; border: none; color: #adadb8; cursor: pointer; padding: 4px; font-size: 18px;">✕</button>
            </div>
            <div style="padding: 8px;" id="tmod-panel-content">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                    <button class="tmod-feature-btn" data-feature="announce" style="background: #18181b; border: 1px solid #3a3a3d; border-radius: 8px; padding: 18px 16px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <span style="font-size: 24px;">📢</span>
                        <span style="font-size: 12px; color: #adadb8;">Анонс</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="chat" style="background: #18181b; border: 1px solid #3a3a3d; border-radius: 8px; padding: 18px 16px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <span style="font-size: 24px;">⚙️</span>
                        <span style="font-size: 12px; color: #adadb8;">Чат</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="poll" style="background: #18181b; border: 1px solid #3a3a3d; border-radius: 8px; padding: 18px 16px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <span style="font-size: 24px;">📊</span>
                        <span style="font-size: 12px; color: #adadb8;">Опрос</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="prediction" style="background: #18181b; border: 1px solid #3a3a3d; border-radius: 8px; padding: 18px 16px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <span style="font-size: 24px;">🔮</span>
                        <span style="font-size: 12px; color: #adadb8;">Прогноз</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="clip" style="background: #18181b; border: 1px solid #3a3a3d; border-radius: 8px; padding: 18px 16px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <span style="font-size: 24px;">🎬</span>
                        <span style="font-size: 12px; color: #adadb8;">Клип</span>
                    </button>
                    <button class="tmod-feature-btn" data-feature="rewards" style="background: #18181b; border: 1px solid #3a3a3d; border-radius: 8px; padding: 18px 16px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <span style="font-size: 24px;">🎁</span>
                        <span style="font-size: 12px; color: #adadb8;">Награды</span>
                    </button>
                </div>
            </div>
        `;

        panel.querySelector('#tmod-panel-close').addEventListener('click', () => {
            panel.remove();
            panelOpen = false;
        });

        panel.querySelectorAll('.tmod-feature-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const feature = this.dataset.feature;
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
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;">
                <span>←</span> <span>Назад</span>
            </button>
            <textarea id="tmod-announce-text" placeholder="Текст анонса" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px; resize: vertical;" rows="4"></textarea>
            <select id="tmod-announce-color" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px; margin-top: 10px;">
                <option value="primary">🔴 Красный</option>
                <option value="blue">🔵 Синий</option>
                <option value="green">🟢 Зелёный</option>
                <option value="orange">🟠 Оранжевый</option>
                <option value="purple">🟣 Фиолетовый</option>
            </select>
            <button id="tmod-send-announce" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 10px;">Отправить</button>
            <div id="tmod-announce-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        content.querySelector('#tmod-back').addEventListener('click', () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); });

        content.querySelector('#tmod-send-announce').addEventListener('click', async () => {
            const text = content.querySelector('#tmod-announce-text').value.trim();
            const color = content.querySelector('#tmod-announce-color').value;
            const statusDiv = content.querySelector('#tmod-announce-status');

            if (!text) { statusDiv.style.color = '#ff6b6b'; statusDiv.textContent = 'Введите текст'; return; }
            if (text.length > 500) { statusDiv.style.color = '#ff6b6b'; statusDiv.textContent = 'Текст слишком длинный'; return; }

            statusDiv.style.color = '#adadb8';
            statusDiv.textContent = 'Отправка...';

            const result = await sendAnnouncement(channelName, text, color);

            if (result.success) {
                statusDiv.style.color = '#00ff00';
                statusDiv.textContent = '✅ Отправлено!';
                setTimeout(() => { panel.remove(); createPanel(); }, 1500);
            } else {
                statusDiv.style.color = '#ff6b6b';
                statusDiv.textContent = '❌ ' + result.error;
            }
        });
    }

    function showChatSection(panel) {
        const channelName = window.location.pathname.slice(1);
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;">
                <span>←</span> <span>Назад</span>
            </button>
            <div id="tmod-chat-loading" style="text-align: center; color: #adadb8; padding: 20px;">Загрузка...</div>
            <div id="tmod-chat-settings" style="display: none;">
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;">
                    <span style="font-size: 14px; color: #efeff1;">Slow Mode</span>
                    <input type="checkbox" id="tmod-slow-mode" style="width: 40px; height: 20px;">
                </div>
                <button id="tmod-clear-chat" style="width: 100%; background: #ff4444; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 15px;">🗑️ Очистить чат</button>
                <div id="tmod-chat-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
            </div>
        `;

        content.querySelector('#tmod-back').addEventListener('click', () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); });

        getChatSettings(channelName).then((settings) => {
            if (!settings) {
                content.querySelector('#tmod-chat-loading').textContent = 'Ошибка загрузки';
                return;
            }
            content.querySelector('#tmod-chat-loading').style.display = 'none';
            content.querySelector('#tmod-chat-settings').style.display = 'block';
            content.querySelector('#tmod-slow-mode').checked = settings.slowMode;

            content.querySelector('#tmod-clear-chat').addEventListener('click', () => {
                if (confirm('Очистить чат?')) {
                    sendToChatInput('/clear');
                    const statusDiv = content.querySelector('#tmod-chat-status');
                    statusDiv.style.color = '#00ff00';
                    statusDiv.textContent = '✅ Чат очищен!';
                }
            });
        });
    }

    function showClipSection(panel) {
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;">
                <span>←</span> <span>Назад</span>
            </button>
            <input type="text" id="tmod-clip-title" placeholder="Название клипа" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px; margin-bottom: 10px;">
            <button id="tmod-create-clip" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer;">🎬 Создать клип</button>
            <div id="tmod-clip-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        content.querySelector('#tmod-back').addEventListener('click', () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); });

        content.querySelector('#tmod-create-clip').addEventListener('click', () => {
            const title = content.querySelector('#tmod-clip-title').value.trim();
            const command = title ? `/clip "${title}"` : '/clip';
            sendToChatInput(command);
            const statusDiv = content.querySelector('#tmod-clip-status');
            statusDiv.style.color = '#00ff00';
            statusDiv.textContent = '✅ Клик создан!';
            setTimeout(() => { panel.remove(); createPanel(); }, 1500);
        });
    }

    function injectButton() {
        if (!isStreamPage()) return;

        const chatInput = document.querySelector('[data-a-target="chat-input"]');
        if (!chatInput) { setTimeout(injectButton, 1000); return; }
        if (document.getElementById('tmod-btn')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'tmod-btn-wrapper';
        wrapper.style.cssText = 'padding: 10px 0; margin-top: 10px; border-top: 1px solid #3a3a3d; display: flex; justify-content: center;';

        const btn = document.createElement('button');
        btn.id = 'tmod-btn';
        btn.innerHTML = '<span style="font-size: 18px;">🛡️</span> <span>Панель модератора</span>';
        btn.style.cssText = `
            width: 200px; height: 36px; background: linear-gradient(90deg, #9146FF, #772ce8);
            color: white; border: none; border-radius: 4px; cursor: pointer;
            font-size: 14px; font-weight: 600; display: flex; align-items: center;
            justify-content: center; gap: 8px; transition: all 0.2s;
        `;

        btn.addEventListener('mouseenter', () => { btn.style.background = 'linear-gradient(90deg, #772ce8, #5b21b6)'; btn.style.transform = 'scale(1.02)'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'linear-gradient(90deg, #9146FF, #772ce8)'; btn.style.transform = 'scale(1)'; });

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const token = await getToken();
            if (!token) {
                const result = await startOAuth();
                if (result.success) {
                    setToken(result.token);
                    setUserInfo(result.user);
                    GM_notification({ title: 'Twitch ModPanel', text: '✅ Вход выполнен!', timeout: 5000 });
                } else {
                    GM_notification({ title: 'Twitch ModPanel', text: '❌ ' + result.error, timeout: 5000 });
                }
                return;
            }

            if (panelOpen && panelElement) { panelElement.remove(); panelOpen = false; }
            else { createPanel(); }
        });

        wrapper.appendChild(btn);
        const chatRoom = chatInput.closest('[class*="chat-room"]') || chatInput.parentElement;
        if (chatRoom) chatRoom.appendChild(wrapper);
        else chatInput.appendChild(wrapper);

        console.log('[ModPanel] Button injected');
    }

    if (isStreamPage()) {
        console.log('[ModPanel] Starting on:', window.location.pathname);
        injectButton();
    }

    GM_registerMenuCommand('🔐 Войти', async () => {
        const result = await startOAuth();
        if (result.success) {
            setToken(result.token);
            setUserInfo(result.user);
            GM_notification({ title: 'Twitch ModPanel', text: '✅ Вход: ' + result.user.login, timeout: 5000 });
        } else {
            GM_notification({ title: 'Twitch ModPanel', text: '❌ ' + result.error, timeout: 5000 });
        }
    });

    GM_registerMenuCommand('🚪 Выйти', () => {
        setToken(null);
        setUserInfo(null);
        GM_notification({ title: 'Twitch ModPanel', text: 'Выход выполнен', timeout: 3000 });
    });

})();
