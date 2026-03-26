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

        const headerIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path fill-rule="evenodd" d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z" clip-rule="evenodd"></path></svg>';
        const announceIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M22.5495 4.33897C22.2357 2.04721 19.6752 1.31272 18.0012 2.51193C16.6758 3.4614 14.9703 4.60236 13.2896 5.50172C11.5617 6.42633 10.0306 6.99998 9 6.99998H4C2.34315 6.99998 1 8.34312 1 9.99998V13C1 14.5834 2.22678 15.8804 3.78175 15.9922L3.37637 18.019C3.07284 19.5367 3.97365 21.0361 5.45607 21.4809L6.66894 21.8447C8.32897 22.3427 10.0644 21.3346 10.4542 19.6458L11.1775 16.5115C11.828 16.7623 12.5403 17.0973 13.2896 17.4982C14.9703 18.3976 16.6758 19.5386 18.0012 20.488C19.6752 21.6872 22.2357 20.9527 22.5495 18.661C22.7843 16.9458 23 14.5424 23 11.5C23 8.45759 22.7843 6.05415 22.5495 4.33897ZM19.1659 4.13779C19.4791 3.91345 19.8248 3.89252 20.0858 3.98998C20.3336 4.08249 20.5232 4.28363 20.568 4.61028C20.7911 6.23958 21 8.55232 21 11.5C21 14.4476 20.7911 16.7604 20.568 18.3897C20.5232 18.7163 20.3336 18.9175 20.0858 19.01C19.8248 19.1074 19.4791 19.0865 19.1659 18.8622C17.8074 17.889 16.0226 16.6924 15.2332 15.7348C13.491 14.8026 11.5724 14 9 14H4C3.44772 14 3 13.5523 3 13V9.99998C3 9.44769 3.44772 8.99998 4 8.99998H9C10.5724 8.99998 12.491 8.1974 14.2332 7.26512C16.0226 6.3076 17.8074 5.11099 19.1659 4.13779ZM9.24072 16.0096C9.15774 16.0032 9.07745 16 9 16H5.81979L5.33753 18.4113C5.23636 18.9171 5.53663 19.417 6.03077 19.5652L7.24363 19.9291C7.79698 20.0951 8.37547 19.759 8.50537 19.1961L9.24072 16.0096Z"/></svg>';
        const chatIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M21,4V16a1,1,0,0,1-1,1H13L8,21V17H4a1,1,0,0,1-1-1V4A1,1,0,0,1,4,3H20A1,1,0,0,1,21,4Z" style="fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2;"></path></svg>';
        const pollIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8 16V11 M12 16V8 M16 16V13 M4 16.8L4 7.2C4 6.0799 4 5.51984 4.21799 5.09202 C4.40973 4.7157 4.71569 4.40973 5.09202 4.21799 C5.51984 4 6.0799 4 7.2 4H16.8C17.9201 4 18.4802 4 18.908 4.21799 C19.2843 4.40973 19.5903 4.7157 19.782 5.09202 C20 5.51984 20 6.0799 20 7.2V16.8C20 17.9201 20 18.4802 19.782 18.908 C19.5903 19.2843 19.2843 19.5903 18.908 19.782 C18.4802 20 17.9201 20 16.8 20H7.2C6.0799 20 5.51984 20 5.09202 19.782 C4.71569 19.5903 4.40973 19.2843 4.21799 18.908 C4 18.4802 4 17.9201 4 16.8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const predictionIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7.771 5.229 11 6.5 7.771 7.771 6.5 11 5.229 7.771 2 6.5l3.229-1.271L6.5 2l1.271 3.229Z"/><path d="M3 11c0-.82.11-1.615.315-2.37l.757.298.934 2.373a7 7 0 1 0 4.708-6.92l-.786-.309-.522-1.326a9 9 0 0 1 7.637 16.297L17 20a2 2 0 0 1 2 2H5a2 2 0 0 1 2-2l.957-.957A9 9 0 0 1 3 11Z"/><path d="m15 11-2.152-.848L12 8l-.848 2.152L9 11l2.152.848L12 14l.848-2.152L15 11Z"/></svg>';
        const clipIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M18.0586 4.70802C17.6561 3.89183 16.8016 3.39846 15.8935 3.45798C15.7708 3.46603 15.631 3.49231 15.3825 3.55395L14.9366 7.29311L18.0546 6.45764C18.1717 6.42626 18.2414 6.40748 18.2934 6.39161C18.3263 6.38157 18.3403 6.37616 18.3437 6.37479C18.4327 6.33001 18.4867 6.23658 18.4809 6.13708C18.4804 6.13346 18.4781 6.11864 18.4704 6.08511C18.4581 6.03213 18.4395 5.96239 18.4081 5.84527C18.2184 5.13731 18.1484 4.89007 18.0586 4.70802ZM13.3761 7.71124L13.8225 3.96816L9.10448 5.23234L8.65805 8.97543L13.3761 7.71124ZM7.09755 9.39357L7.54397 5.65051C6.72687 5.86976 6.14281 6.03001 5.69325 6.19522C5.21984 6.36921 4.9659 6.5249 4.79043 6.70037C4.51115 6.97964 4.31031 7.32751 4.20809 7.70901C4.14386 7.9487 4.136 8.24647 4.22203 8.74344C4.28459 9.10483 4.3891 9.53305 4.53282 10.0808L7.09755 9.39357ZM3.24982 11.0929C3.02399 10.2501 2.84221 9.56656 2.74401 8.99931C2.64016 8.3994 2.61537 7.85755 2.7592 7.32079C2.92957 6.68495 3.26431 6.10517 3.72977 5.63971C4.12271 5.24677 4.60436 4.99731 5.17582 4.78729C5.73027 4.58353 6.4347 4.39479 7.30813 4.16076L8.08887 3.95156C8.17636 3.90813 8.27301 3.88143 8.37416 3.87512L14.3457 2.27506C14.3529 2.27311 14.3602 2.27117 14.3674 2.26923C14.455 2.22574 14.5518 2.19903 14.6531 2.19276C15.1271 2.06677 15.474 1.98226 15.7954 1.9612C17.3089 1.862 18.7331 2.68427 19.404 4.04458C19.5679 4.37708 19.676 4.78084 19.8346 5.37321C19.8419 5.40074 19.8494 5.42868 19.857 5.45704C19.8611 5.47246 19.8653 5.48795 19.8695 5.50349C19.9169 5.67914 19.9661 5.86192 19.9776 6.037C20.0239 6.74329 19.6402 7.40793 19.0054 7.72098C18.848 7.79858 18.6651 7.8473 18.4893 7.89412C18.4737 7.89827 18.4582 7.9024 18.4428 7.90653L9.69708 10.2499L16.0518 10.2499C16.9503 10.2499 17.6995 10.2499 18.2943 10.3299C18.9221 10.4143 19.4889 10.5999 19.9444 11.0554C20.3998 11.5109 20.5855 12.0777 20.6699 12.7055C20.7499 13.3002 20.7498 14.0495 20.7498 14.9479V16.0548C20.7498 17.4224 20.7499 18.5247 20.6333 19.3917C20.5123 20.2918 20.2534 21.0497 19.6515 21.6516C19.0496 22.2535 18.2917 22.5124 17.3916 22.6334C16.5246 22.75 15.4223 22.75 14.0547 22.7499H9.94495C8.57735 22.75 7.47503 22.75 6.60806 22.6334C5.70796 22.5124 4.95008 22.2535 4.34817 21.6516C3.74625 21.0497 3.48736 20.2918 3.36634 19.3917C3.24978 18.5247 3.24979 17.4224 3.24982 16.0548L3.24982 11.0929ZM4.74982 11.7499V15.9999C4.74982 17.4354 4.75141 18.4365 4.85296 19.1918C4.95162 19.9256 5.13206 20.3142 5.40883 20.5909C5.68559 20.8677 6.07416 21.0481 6.80794 21.1468C7.56329 21.2483 8.5644 21.2499 9.99982 21.2499H13.9998C15.4352 21.2499 16.4363 21.2483 17.1917 21.1468C17.9255 21.0481 18.314 20.8677 18.5908 20.5909C18.8676 20.3142 19.048 19.9256 19.1467 19.1918C19.2482 18.4365 19.2498 17.4354 19.2498 15.9999V14.9999C19.2498 14.0359 19.2482 13.3884 19.1833 12.9053C19.1212 12.4439 19.014 12.2464 18.8837 12.1161C18.7534 11.9857 18.5559 11.8785 18.0944 11.8165C17.6114 11.7515 16.9638 11.7499 15.9998 11.7499H4.74982Z"/></svg>';
        const rewardsIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7Z"/><path fill-rule="evenodd" d="M1 12C1 5.925 5.925 1 12 1s11 4.925 11 11-4.925 11-11 11S1 18.075 1 12Zm11 9a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" clip-rule="evenodd"/></svg>';

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
            shield.onchange = () => { updateToggle(shield); sendToChatInput(shield.checked ? '/shield' : '/shieldoff'); };

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
