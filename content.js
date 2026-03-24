/**
 * content.js — Точка входа Content Script (без импортов)
 */

console.log('[ModPanel] Content script loaded!');

// URL иконок (глобально)
const ICON_URL = chrome.runtime.getURL('icons/icon128.png');

// Инжектируем скрипт для доступа к React Fiber
function injectTwitchAPI() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('twitch-api.js');
    script.onload = function() {
        script.remove();
        console.log('[ModPanel] Twitch API injected!');
    };
    (document.head || document.documentElement).appendChild(script);
}

// Ждём загрузки страницы и инжектим API
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTwitchAPI);
} else {
    injectTwitchAPI();
}

// ============================================================================
// API Функции (встроены)
// ============================================================================

const CLIENT_ID = 'qz89rtnd3uz3v7k3rnh5hffx3b97mu';

async function getToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['tmod_access_token'], (result) => {
            resolve(result.tmod_access_token || null);
        });
    });
}

async function getIds(channelName) {
    const token = await getToken();
    if (!token) return null;
    
    try {
        const channelResponse = await fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': CLIENT_ID
            }
        });
        
        if (!channelResponse.ok) return null;
        const channelData = await channelResponse.json();
        const broadcasterId = channelData.data[0]?.id;
        
        const modResponse = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': CLIENT_ID
            }
        });
        
        if (!modResponse.ok) return null;
        const modData = await modResponse.json();
        const moderatorId = modData.data[0]?.id;
        
        return { broadcasterId, moderatorId };
    } catch (error) {
        console.error('[ModPanel] Get IDs error:', error);
        return null;
    }
}

async function sendAnnouncement(channelName, message, color = 'primary') {
    const token = await getToken();
    if (!token) return { success: false, error: 'No token' };
    
    const ids = await getIds(channelName);
    if (!ids) return { success: false, error: 'Could not get IDs' };
    
    try {
        const response = await fetch(
            `https://api.twitch.tv/helix/chat/announcements?broadcaster_id=${ids.broadcasterId}&moderator_id=${ids.moderatorId}`,
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
        
        if (response.ok) {
            console.log('[ModPanel] Announcement sent');
            return { success: true };
        } else {
            const error = await response.json();
            return { success: false, error: error.message || `API Error: ${response.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function getChatSettings(channelName) {
    const token = await getToken();
    console.log('[ModPanel] Get chat settings, token:', token ? 'exists' : 'none');
    if (!token) return null;
    
    const ids = await getIds(channelName);
    console.log('[ModPanel] Get chat settings, ids:', ids);
    if (!ids) return null;
    
    try {
        const response = await fetch(
            `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${ids.broadcasterId}&moderator_id=${ids.moderatorId}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID
                }
            }
        );
        
        console.log('[ModPanel] Chat settings API response:', response.status);
        
        if (!response.ok) {
            const error = await response.text();
            console.error('[ModPanel] Chat settings error:', error);
            return null;
        }
        const data = await response.json();
        const settings = data.data[0];
        
        return {
            slowMode: settings.slow_mode,
            slowModeWaitTime: settings.slow_mode_wait_time,
            followerMode: settings.follower_mode,
            followerModeWaitTime: settings.follower_mode_wait_time,
            subscriberMode: settings.subscriber_mode,
            emoteMode: settings.emote_mode
        };
    } catch (error) {
        console.error('[ModPanel] Get chat settings error:', error);
        return null;
    }
}

async function updateChatSettings(channelName, settings) {
    const token = await getToken();
    if (!token) return { success: false, error: 'No token' };
    
    const ids = await getIds(channelName);
    if (!ids) return { success: false, error: 'Could not get IDs' };
    
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
    
    try {
        const response = await fetch(
            `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${ids.broadcasterId}&moderator_id=${ids.moderatorId}`,
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
        
        if (response.ok) return { success: true };
        else {
            const error = await response.json();
            return { success: false, error: error.message || `API Error: ${response.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
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

let panelOpen = false;
let panelElement = null;
let panelPosition = null;

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

    const announceIconUrl = chrome.runtime.getURL('icons/icon-announce.svg');
    const chatIconUrl = chrome.runtime.getURL('icons/icon-chat.svg');
    const pollIconUrl = chrome.runtime.getURL('icons/icon-poll.svg');
    const predictionIconUrl = chrome.runtime.getURL('icons/icon-prediction.svg');
    const clipIconUrl = chrome.runtime.getURL('icons/icon-clip.svg');
    const rewardsIconUrl = chrome.runtime.getURL('icons/icon-rewards.svg');
    
    panel.innerHTML = `
        <style>
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
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            }
        </style>
        <div class="tmod-no-select" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #18181b; border-bottom: 1px solid #3a3a3d; cursor: move; border-radius: 8px 8px 0 0;" id="tmod-panel-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <img src="${ICON_URL}" style="width: 24px; height: 24px; object-fit: contain;" alt="">
                <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #efeff1; pointer-events: none;">Панель модератора</h3>
            </div>
            <button id="tmod-panel-close" style="background: none; border: none; color: #adadb8; cursor: pointer; padding: 4px; font-size: 18px;">✕</button>
        </div>
        <div style="padding: 8px; border-radius: 0 0 8px 8px;" id="tmod-panel-content">
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                <button class="tmod-feature-btn" data-feature="announce">
                    <img src="${announceIconUrl}" style="width: 24px; height: 24px; object-fit: contain;" alt="">
                    <span class="tmod-label">Анонс</span>
                </button>
                <button class="tmod-feature-btn" data-feature="chat">
                    <img src="${chatIconUrl}" style="width: 24px; height: 24px; object-fit: contain;" alt="">
                    <span class="tmod-label">Чат</span>
                </button>
                <button class="tmod-feature-btn" data-feature="poll">
                    <img src="${pollIconUrl}" style="width: 24px; height: 24px; object-fit: contain;" alt="">
                    <span class="tmod-label">Опрос</span>
                </button>
                <button class="tmod-feature-btn" data-feature="prediction">
                    <img src="${predictionIconUrl}" style="width: 24px; height: 24px; object-fit: contain;" alt="">
                    <span class="tmod-label">Прогноз</span>
                </button>
                <button class="tmod-feature-btn" data-feature="clip">
                    <img src="${clipIconUrl}" style="width: 24px; height: 24px; object-fit: contain;" alt="">
                    <span class="tmod-label">Клип</span>
                </button>
                <button class="tmod-feature-btn" data-feature="rewards">
                    <img src="${rewardsIconUrl}" style="width: 24px; height: 24px; object-fit: contain;" alt="">
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
            } else if (feature === 'clip') {
                console.log('[ModPanel] Creating clip');
                showClipSection(panel);
            } else if (feature === 'rewards') {
                console.log('[ModPanel] Sending /requests to chat input');
                sendToChatInput('/requests');
            } else {
                alert('Phase 5: ' + feature);
            }
        });
    });
    
    document.documentElement.appendChild(panel);
    panelOpen = true;
    panelElement = panel;
    
    panel.setAttribute('style', `
        position: fixed !important;
        right: ${rightPos}px !important;
        bottom: ${bottomPos}px !important;
        z-index: 999999 !important;
        background: #0e0e10 !important;
        border: 1px solid #3a3a3d !important;
        border-radius: 8px !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
        overflow: visible !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        animation: tmod-slide-in 0.3s ease-out !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        width: max-content !important;
        min-width: 320px !important;
    `);
    
    console.log('[ModPanel] Panel created at right:', rightPos, 'bottom:', bottomPos);
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
    
    const rect = panel.getBoundingClientRect();
    if (rect.top < 0) {
        const newBottom = panelPosition.bottom + rect.top;
        panel.style.bottom = `${Math.max(10, newBottom)}px`;
    }

    content.querySelector('#tmod-back').addEventListener('click', function() {
        console.log('[ModPanel] Back button clicked');
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
            setTimeout(() => { panel.remove(); createPanel(); }, 1500);
        } else {
            statusDiv.style.color = '#ff6b6b';
            statusDiv.textContent = '❌ Ошибка: ' + result.error;
        }
    });
}

function showChatSection(panel) {
    const channelName = window.location.pathname.slice(1);
    console.log('[ModPanel] showChatSection called for:', channelName);

    const content = panel.querySelector('#tmod-panel-content');
    console.log('[ModPanel] Content element:', content ? 'found' : 'not found');
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
    
    // Добавляем стили для переключателей
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
    
    console.log('[ModPanel] Calling getChatSettings...');

    const rect = panel.getBoundingClientRect();
    if (rect.top < 0) {
        const newBottom = panelPosition.bottom + rect.top;
        panel.style.bottom = `${Math.max(10, newBottom)}px`;
    }
    
    getChatSettings(channelName).then((settings) => {
        const loadingDiv = content.querySelector('#tmod-chat-loading');
        const settingsDiv = content.querySelector('#tmod-chat-settings');
        
        console.log('[ModPanel] Chat settings loaded:', settings);
        
        if (!settings) {
            loadingDiv.style.color = '#ff6b6b';
            loadingDiv.textContent = 'Ошибка: проверьте консоль (F12)';
            return;
        }
        
        loadingDiv.style.display = 'none';
        settingsDiv.style.display = 'block';
        
        // Функция для обновления стиля переключателя
        function updateToggleStyle(checkbox) {
            const label = checkbox.closest('label');
            if (checkbox.checked) {
                label.classList.add('tmod-toggle-active');
                console.log('[ModPanel] Toggle ON:', checkbox.id);
            } else {
                label.classList.remove('tmod-toggle-active');
                console.log('[ModPanel] Toggle OFF:', checkbox.id);
            }
        }
        
        // Инициализируем состояние переключателей
        const subCheckbox = content.querySelector('#tmod-sub-only');
        const followerCheckbox = content.querySelector('#tmod-follower-only');
        const emoteCheckbox = content.querySelector('#tmod-emote-only');
        const slowCheckbox = content.querySelector('#tmod-slow-mode');
        
        subCheckbox.checked = settings.subscriberMode;
        followerCheckbox.checked = settings.followerMode;
        emoteCheckbox.checked = settings.emoteMode;
        slowCheckbox.checked = settings.slowMode;
        content.querySelector('#tmod-slow-time').value = settings.slowModeWaitTime || 30;
        
        // Обновляем стили
        updateToggleStyle(subCheckbox);
        updateToggleStyle(followerCheckbox);
        updateToggleStyle(emoteCheckbox);
        updateToggleStyle(slowCheckbox);
        
        // Добавляем обработчики
        subCheckbox.addEventListener('change', () => updateToggleStyle(subCheckbox));
        followerCheckbox.addEventListener('change', () => updateToggleStyle(followerCheckbox));
        emoteCheckbox.addEventListener('change', () => updateToggleStyle(emoteCheckbox));
        slowCheckbox.addEventListener('change', () => {
            updateToggleStyle(slowCheckbox);
            content.querySelector('#tmod-slow-wait').style.display = slowCheckbox.checked ? 'block' : 'none';
        });

        // Shield Mode переключатель
        const shieldCheckbox = content.querySelector('#tmod-shield-mode');
        shieldCheckbox.addEventListener('change', () => {
            updateToggleStyle(shieldCheckbox);
            const command = shieldCheckbox.checked ? '/shieldmode' : '/shieldmodeoff';
            sendToChatInput(command);
        });

        // Очистка чата
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

    content.querySelector('#tmod-back').addEventListener('click', function() {
        console.log('[ModPanel] Back button clicked (chat)');
        panel.remove();
        panelOpen = false;
        setTimeout(() => createPanel(), 10);
    });

    content.querySelector('#tmod-save-chat').addEventListener('click', async () => {
        const statusDiv = content.querySelector('#tmod-chat-status');
        
        const settings = {
            subscriberMode: content.querySelector('#tmod-sub-only').checked,
            followerMode: content.querySelector('#tmod-follower-only').checked,
            emoteMode: content.querySelector('#tmod-emote-only').checked,
            slowMode: content.querySelector('#tmod-slow-mode').checked,
            slowModeWaitTime: parseInt(content.querySelector('#tmod-slow-time').value) || 30
        };
        
        statusDiv.style.color = '#adadb8';
        statusDiv.textContent = 'Сохранение...';
        
        const result = await updateChatSettings(channelName, settings);
        
        if (result.success) {
            statusDiv.style.color = '#00ff00';
            statusDiv.textContent = '✅ Сохранено!';
            setTimeout(() => { panel.remove(); createPanel(); }, 1500);
        } else {
            statusDiv.style.color = '#ff6b6b';
            statusDiv.textContent = '❌ Ошибка: ' + result.error;
        }
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

        // Отправляем команду в чат
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

// ============================================================================
// Отправка в чат через React Fiber (как BTTV)
// ============================================================================

// Отправляет сообщение в чат через инжектированный API
function sendToChatInput(message) {
    window.postMessage({ type: 'TMOD_SEND_CHAT', message: message }, '*');
}

// Слушаем ответы от twitch-api.js
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    
    if (event.data?.type === 'TMOD_CHAT_SUCCESS') {
        console.log('[ModPanel] Chat message sent:', event.data.message);
    } else if (event.data?.type === 'TMOD_CHAT_ERROR') {
        console.error('[ModPanel] Chat error:', event.data.error);
    }
});

// ============================================================================
// Кнопка
// ============================================================================

function injectButton() {
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
    
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        console.log('[ModPanel] Button clicked');
        
        // Проверяем токен через сообщение к background
        chrome.runtime.sendMessage({ type: 'OAUTH_GET_TOKEN' }, (response) => {
            const hasToken = response && response.token;
            console.log('[ModPanel] Token:', hasToken ? 'exists' : 'none');

            if (!hasToken) {
                console.log('[ModPanel] No token, starting OAuth');
                chrome.runtime.sendMessage({ type: 'OAUTH_START' });
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
    });
    
    wrapper.appendChild(btn);
    
    const chatRoom = chatContainer.closest('[class*="chat-room"]') || chatContainer.parentElement;
    if (chatRoom) chatRoom.appendChild(wrapper);
    else chatContainer.appendChild(wrapper);
    
    console.log('[ModPanel] Button injected');
}

// ============================================================================
// Запуск
// ============================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (isStreamPage()) {
            console.log('[ModPanel] On stream page:', window.location.pathname);
            injectButton();
        }
    });
} else {
    if (isStreamPage()) {
        console.log('[ModPanel] On stream page:', window.location.pathname);
        injectButton();
    }
}
