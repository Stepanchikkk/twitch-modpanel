/**
 * background.js — OAuth авторизация
 */

const STORAGE_KEY_TOKEN = 'tmod_access_token';
const STORAGE_KEY_USER = 'tmod_user_info';

let authWindowId = null;

// ============================================================================
// OAuth авторизация
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
            `?client_id=qz89rtnd3uz3v7k3rnh5hffx3b97mu` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=token` +
            `&scope=${encodeURIComponent(scopes)}` +
            `&force_verify=true`;

        console.log('[OAuth] Opening auth window...');

        chrome.windows.create({
            url: authUrl,
            type: 'popup',
            width: 600,
            height: 700
        }, (win) => {
            authWindowId = win.id;
            console.log('[OAuth] Window created:', win.id);
            
            chrome.tabs.onUpdated.addListener(onTabUpdated);
        });
        
        function onTabUpdated(tabId, changeInfo, tab) {
            if (tab.windowId !== authWindowId) return;
            
            const url = changeInfo.url || tab.url;
            if (!url) return;
            
            console.log('[OAuth] Tab updated:', url.substring(0, 100));
            
            if (url.startsWith('http://localhost:3000') && url.includes('access_token')) {
                console.log('[OAuth] Redirect detected!');
                
                chrome.tabs.onUpdated.removeListener(onTabUpdated);
                
                const hash = url.split('#')[1];
                if (!hash) {
                    resolve({ success: false, error: 'No token' });
                    return;
                }

                const params = new URLSearchParams(hash);
                const token = params.get('access_token');

                if (!token) {
                    resolve({ success: false, error: 'No access_token' });
                    return;
                }

                console.log('[OAuth] Token received!');
                
                chrome.windows.remove(authWindowId);
                authWindowId = null;
                
                saveTokenAndUser(token, resolve);
            }
        }
        
        setTimeout(() => {
            if (authWindowId) {
                chrome.windows.remove(authWindowId);
                authWindowId = null;
            }
            chrome.tabs.onUpdated.removeListener(onTabUpdated);
            resolve({ success: false, error: 'Timeout' });
        }, 120000);
    });
}

async function saveTokenAndUser(token, resolve) {
    try {
        await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token });

        const userResponse = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': 'qz89rtnd3uz3v7k3rnh5hffx3b97mu'
            }
        });

        const userData = await userResponse.json();
        const user = userData.data[0];

        if (user) {
            await chrome.storage.local.set({
                [STORAGE_KEY_USER]: {
                    id: user.id,
                    login: user.login,
                    display_name: user.display_name
                }
            });

            console.log('[OAuth] User saved:', user.login);
            try { chrome.runtime.sendMessage({ type: 'OAUTH_SUCCESS' }); } catch(e) {}
            resolve({ success: true, user });
        } else {
            resolve({ success: false, error: 'No user data' });
        }
    } catch (error) {
        console.error('[OAuth] Error:', error);
        resolve({ success: false, error: error.message });
    }
}

// ============================================================================
// Хелперы
// ============================================================================

async function getToken() {
    const result = await chrome.storage.local.get([STORAGE_KEY_TOKEN]);
    return result[STORAGE_KEY_TOKEN] || null;
}

async function getUserInfo() {
    const result = await chrome.storage.local.get([STORAGE_KEY_USER]);
    return result[STORAGE_KEY_USER] || null;
}

// ============================================================================
// Message Listener
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OAUTH_START') {
        (async () => {
            const result = await startOAuth();
            sendResponse(result);
        })();
        return true;
    } else if (message.type === 'OAUTH_GET_TOKEN') {
        getToken().then(token => sendResponse({ success: !!token, token }));
        return true;
    } else if (message.type === 'OAUTH_GET_USER') {
        getUserInfo().then(user => sendResponse({ success: true, user }));
        return true;
    }

    sendResponse({ success: false, error: 'Unknown type' });
    return false;
});

console.log('[ModPanel] Background initialized');
