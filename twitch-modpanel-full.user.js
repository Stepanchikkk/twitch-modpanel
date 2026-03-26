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
        chatComponent.props.onSendMessage(message);
        return true;
    }

    function startOAuth() {
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

            if (!authWindow) { resolve({success:false,error:'Popup blocked'}); return; }

            let completed = false;
            let checkCount = 0;

            const messageHandler = (event) => {
                if (event.data?.type === 'TMOD_OAUTH_SUCCESS' && !completed) {
                    completed = true;
                    window.removeEventListener('message', messageHandler);
                    try { authWindow.close(); } catch(e) {}
                    
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

        const headerIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white" style="filter: brightness(0) invert(1);"><path fill-rule="evenodd" d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z" clip-rule="evenodd"></path></svg>';
        const announceIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 16V11 M12 16V8 M16 16V13 M4 16.8L4 7.2C4 6.0799 4 5.51984 4.21799 5.09202 C4.40973 4.7157 4.71569 4.40973 5.09202 4.21799 C5.51984 4 6.0799 4 7.2 4H16.8C17.9201 4 18.4802 4 18.908 4.21799 C19.2843 4.40973 19.5903 4.7157 19.782 5.09202 C20 5.51984 20 6.0799 20 7.2V16.8C20 17.9201 20 18.4802 19.782 18.908 C19.5903 19.2843 19.2843 19.5903 18.908 19.782 C18.4802 20 17.9201 20 16.8 20H7.2C6.0799 20 5.51984 20 5.09202 19.782 C4.71569 19.5903 4.40973 19.2843 4.21799 18.908 C4 18.4802 4 17.9201 4 16.8Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const chatIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="white" stroke-width="2"/><path d="M21 12C12 12 12 12 12 12M21 12C21 16.9706 16.9706 21 12 21C17 21 12 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C7 12 12 12 12 12M21 12C21 7.02944 16.9706 3 12 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const pollIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 16V11 M12 16V8 M16 16V13 M4 16.8L4 7.2C4 6.0799 4 5.51984 4.21799 5.09202 C4.40973 4.7157 4.71569 4.40973 5.09202 4.21799 C5.51984 4 6.0799 4 7.2 4H16.8C17.9201 4 18.4802 4 18.908 4.21799 C19.2843 4.40973 19.5903 4.7157 19.782 5.09202 C20 5.51984 20 6.0799 20 7.2V16.8C20 17.9201 20 18.4802 19.782 18.908 C19.5903 19.2843 19.2843 19.5903 18.908 19.782 C18.4802 20 17.9201 20 16.8 20H7.2C6.0799 20 5.51984 20 5.09202 19.782 C4.71569 19.5903 4.40973 19.2843 4.21799 18.908 C4 18.4802 4 17.9201 4 16.8Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const predictionIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 16V11 M12 16V8 M16 16V13 M4 16.8L4 7.2C4 6.0799 4 5.51984 4.21799 5.09202 C4.40973 4.7157 4.71569 4.40973 5.09202 4.21799 C5.51984 4 6.0799 4 7.2 4H16.8C17.9201 4 18.4802 4 18.908 4.21799 C19.2843 4.40973 19.5903 4.7157 19.782 5.09202 C20 5.51984 20 6.0799 20 7.2V16.8C20 17.9201 20 18.4802 19.782 18.908 C19.5903 19.2843 19.2843 19.5903 18.908 19.782 C18.4802 20 17.9201 20 16.8 20H7.2C6.0799 20 5.51984 20 5.09202 19.782 C4.71569 19.5903 4.40973 19.2843 4.21799 18.908 C4 18.4802 4 17.9201 4 16.8Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const clipIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 16V11 M12 16V8 M16 16V13 M4 16.8L4 7.2C4 6.0799 4 5.51984 4.21799 5.09202 C4.40973 4.7157 4.71569 4.40973 5.09202 4.21799 C5.51984 4 6.0799 4 7.2 4H16.8C17.9201 4 18.4802 4 18.908 4.21799 C19.2843 4.40973 19.5903 4.7157 19.782 5.09202 C20 5.51984 20 6.0799 20 7.2V16.8C20 17.9201 20 18.4802 19.782 18.908 C19.5903 19.2843 19.2843 19.5903 18.908 19.782 C18.4802 20 17.9201 20 16.8 20H7.2C6.0799 20 5.51984 20 5.09202 19.782 C4.71569 19.5903 4.40973 19.2843 4.21799 18.908 C4 18.4802 4 17.9201 4 16.8Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const rewardsIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 16V11 M12 16V8 M16 16V13 M4 16.8L4 7.2C4 6.0799 4 5.51984 4.21799 5.09202 C4.40973 4.7157 4.71569 4.40973 5.09202 4.21799 C5.51984 4 6.0799 4 7.2 4H16.8C17.9201 4 18.4802 4 18.908 4.21799 C19.2843 4.40973 19.5903 4.7157 19.782 5.09202 C20 5.51984 20 6.0799 20 7.2V16.8C20 17.9201 20 18.4802 19.782 18.908 C19.5903 19.2843 19.2843 19.5903 18.908 19.782 C18.4802 20 17.9201 20 16.8 20H7.2C6.0799 20 5.51984 20 5.09202 19.782 C4.71569 19.5903 4.40973 19.2843 4.21799 18.908 C4 18.4802 4 17.9201 4 16.8Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
                .tmod-feature-btn svg { width: 24px !important; height: 24px !important; flex-shrink: 0 !important; filter: brightness(0) invert(1) !important; }
                .tmod-feature-btn .tmod-label { font-size: 14px !important; font-weight: 600 !important; color: #efeff1 !important; white-space: nowrap !important; }
                .tmod-toggle-active span:first-of-type { background-color: #9146FF !important; }
                .tmod-toggle-active span:last-of-type { transform: translateX(20px) !important; background-color: #fff !important; }
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
                    <button class="tmod-feature-btn" data-feature="announce">${announceIcon}<span class="tmod-label">Анонс</span></button>
                    <button class="tmod-feature-btn" data-feature="chat">${chatIcon}<span class="tmod-label">Чат</span></button>
                    <button class="tmod-feature-btn" data-feature="poll">${pollIcon}<span class="tmod-label">Опрос</span></button>
                    <button class="tmod-feature-btn" data-feature="prediction">${predictionIcon}<span class="tmod-label">Прогноз</span></button>
                    <button class="tmod-feature-btn" data-feature="clip">${clipIcon}<span class="tmod-label">Клип</span></button>
                    <button class="tmod-feature-btn" data-feature="rewards">${rewardsIcon}<span class="tmod-label">Награды</span></button>
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
            btn.addEventListener('click', function() {
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
        const content = panel.querySelector('#tmod-panel-content');
        if (!content) return;

        content.innerHTML = `
            <button id="tmod-back" style="background: none; border: none; color: #9146FF; cursor: pointer; font-size: 14px; padding: 0; margin-bottom: 12px; display: flex; align-items: center; gap: 4px;"><span>←</span> <span>Назад</span></button>
            <textarea id="tmod-announce-text" placeholder="Текст анонса (макс. 500 символов)" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px; resize: vertical;" rows="4"></textarea>
            <select id="tmod-announce-color" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 8px; margin-top: 10px;">
                <option value="primary">🔴 Красный (Primary)</option><option value="blue">🔵 Синий</option><option value="green">🟢 Зелёный</option><option value="orange">🟠 Оранжевый</option><option value="purple">🟣 Фиолетовый</option>
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
            statusDiv.style.color = '#adadb8'; statusDiv.textContent = 'Отправка...';
            const result = await sendAnnouncement(channelName, text, color);
            if (result.success) { statusDiv.style.color = '#00ff00'; statusDiv.textContent = '✅ Анонс отправлен!'; setTimeout(() => { panel.remove(); createPanel(); }, 1500); }
            else { statusDiv.style.color = '#ff6b6b'; statusDiv.textContent = '❌ ' + result.error; }
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
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Только для подписчиков</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-sub-only" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Только для фолловеров</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-follower-only" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Только эмодзи</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-emote-only" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Slow Mode</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-slow-mode" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <div id="tmod-slow-wait" style="display: none; margin-top: 15px; padding: 12px; background: #18181b; border-radius: 4px;"><input type="number" id="tmod-slow-time" min="0" max="120" value="30" style="width: 100%; background: #0e0e10; border: 1px solid #3a3a3d; border-radius: 4px; color: #efeff1; padding: 10px; font-size: 14px;"><span style="font-size: 12px; color: #adadb8; margin-top: 5px; display: block;">секунд между сообщениями</span></div>
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #26262c;"><span style="font-size: 14px; color: #efeff1;">Shield Mode</span><label style="position: relative; display: inline-block; width: 40px; height: 20px; cursor: pointer;"><input type="checkbox" id="tmod-shield-mode" style="opacity: 0; width: 0; height: 0;"><span style="position: absolute; inset: 0; background-color: #3a3a3d; border-radius: 10px; transition: 0.2s;"></span><span style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: #adadb8; border-radius: 50%; transition: 0.2s;"></span></label></div>
                <button id="tmod-clear-chat" style="width: 100%; background: #ff4444; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 15px;">🗑️ Очистить чат</button>
                <button id="tmod-save-chat" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 10px;">Сохранить</button>
                <div id="tmod-chat-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
            </div>
        `;

        const toggleStyle = document.createElement('style');
        toggleStyle.textContent = `.tmod-toggle-active span:first-of-type { background-color: #9146FF !important; } .tmod-toggle-active span:last-of-type { transform: translateX(20px) !important; background-color: #fff !important; }`;
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
            shield.onchange = () => { updateToggle(shield); sendToChatInput(shield.checked ? '/shieldmode' : '/shieldmodeoff'); };

            content.querySelector('#tmod-clear-chat').onclick = () => { if (confirm('Очистить чат?')) { sendToChatInput('/clear'); content.querySelector('#tmod-chat-status').style.color = '#00ff00'; content.querySelector('#tmod-chat-status').textContent = '✅ Чат очищен!'; setTimeout(() => { content.querySelector('#tmod-chat-status').textContent = ''; }, 2000); } };
            content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };
            content.querySelector('#tmod-save-chat').onclick = async () => {
                const statusDiv = content.querySelector('#tmod-chat-status');
                const settings = { subscriberMode: sub.checked, followerMode: follower.checked, emoteMode: emote.checked, slowMode: slow.checked, slowModeWaitTime: parseInt(content.querySelector('#tmod-slow-time').value) || 30 };
                statusDiv.style.color = '#adadb8'; statusDiv.textContent = 'Сохранение...';
                const result = await updateChatSettings(channelName, settings);
                if (result.success) { statusDiv.style.color = '#00ff00'; statusDiv.textContent = '✅ Сохранено!'; setTimeout(() => { panel.remove(); createPanel(); }, 1500); }
                else { statusDiv.style.color = '#ff6b6b'; statusDiv.textContent = '❌ ' + result.error; }
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
            <button id="tmod-create-clip" style="width: 100%; background: #9146FF; color: white; border: none; border-radius: 4px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer;">🎬 Создать клип</button>
            <div id="tmod-clip-status" style="margin-top: 10px; font-size: 13px; text-align: center;"></div>
        `;

        content.querySelector('#tmod-back').onclick = () => { panel.remove(); panelOpen = false; setTimeout(() => createPanel(), 10); };
        content.querySelector('#tmod-create-clip').onclick = () => {
            const title = content.querySelector('#tmod-clip-title').value.trim();
            const statusDiv = content.querySelector('#tmod-clip-status');
            statusDiv.style.color = '#adadb8'; statusDiv.textContent = 'Создание клипа...';
            sendToChatInput(title ? '/clip "' + title + '"' : '/clip');
            statusDiv.style.color = '#00ff00'; statusDiv.textContent = '✅ Клик создан!';
            setTimeout(() => { panel.remove(); createPanel(); }, 1500);
        };
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
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path fill-rule="evenodd" d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z" clip-rule="evenodd"></path></svg> <span>Панель модератора</span>';
        btn.style.cssText = 'width: 200px; height: 36px; background: linear-gradient(90deg, #9146FF, #772ce8); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s;';

        btn.onmouseenter = () => { btn.style.background = 'linear-gradient(90deg, #772ce8, #5b21b6)'; btn.style.transform = 'scale(1.02)'; };
        btn.onmouseleave = () => { btn.style.background = 'linear-gradient(90deg, #9146FF, #772ce8)'; btn.style.transform = 'scale(1)'; };

        btn.onclick = async (e) => {
            e.preventDefault(); e.stopPropagation();
            const token = await getToken();
            if (!token) {
                const result = await startOAuth();
                if (result.success) { setToken(result.token); setUserInfo(result.user); GM_notification({ title: 'Twitch ModPanel', text: '✅ Вход: ' + result.user.login, timeout: 5000 }); }
                else { GM_notification({ title: 'Twitch ModPanel', text: '❌ ' + result.error, timeout: 5000 }); }
                return;
            }
            if (panelOpen && panelElement) { panelElement.remove(); panelOpen = false; } else { createPanel(); }
        };

        wrapper.appendChild(btn);
        const chatRoom = chatInput.closest('[class*="chat-room"]') || chatInput.parentElement;
        if (chatRoom) chatRoom.appendChild(wrapper); else chatInput.appendChild(wrapper);
        console.log('[ModPanel] Button injected');
    }

    if (isStreamPage()) { console.log('[ModPanel] Starting on:', window.location.pathname); injectButton(); }

    GM_registerMenuCommand('🔐 Войти', async () => { const result = await startOAuth(); if (result.success) { setToken(result.token); setUserInfo(result.user); GM_notification({ title: 'Twitch ModPanel', text: '✅ Вход: ' + result.user.login, timeout: 5000 }); } else { GM_notification({ title: 'Twitch ModPanel', text: '❌ ' + result.error, timeout: 5000 }); } });
    GM_registerMenuCommand('🚪 Выйти', () => { setToken(null); setUserInfo(null); GM_notification({ title: 'Twitch ModPanel', text: 'Выход выполнен', timeout: 3000 }); });

})();
