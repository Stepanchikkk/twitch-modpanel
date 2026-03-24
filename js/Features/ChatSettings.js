/**
 * ChatSettings.js — Управление настройками чата через Twitch API
 */

import { CLIENT_ID } from '../Config.js';

/**
 * Получить токен из storage
 */
async function getToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['tmod_access_token'], (result) => {
            resolve(result.tmod_access_token || null);
        });
    });
}

/**
 * Получить ID широковещателя и модератора
 */
async function getIds(channelName) {
    const token = await getToken();
    if (!token) return null;
    
    try {
        // Получаем ID канала
        const channelResponse = await fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': CLIENT_ID
            }
        });
        
        if (!channelResponse.ok) return null;
        
        const channelData = await channelResponse.json();
        const broadcasterId = channelData.data[0]?.id;
        
        // Получаем ID модератора
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

/**
 * Получить текущие настройки чата
 * @param {string} channelName - Имя канала
 * @returns {Promise<Object>} Настройки
 */
export async function getChatSettings(channelName) {
    const token = await getToken();
    if (!token) return null;
    
    const ids = await getIds(channelName);
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
        
        if (!response.ok) return null;
        
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

/**
 * Обновить настройки чата
 * @param {string} channelName - Имя канала
 * @param {Object} settings - Настройки для обновления
 * @returns {Promise<Object>} Результат
 */
export async function updateChatSettings(channelName, settings) {
    const token = await getToken();
    if (!token) {
        return { success: false, error: 'No token' };
    }
    
    const ids = await getIds(channelName);
    if (!ids) {
        return { success: false, error: 'Could not get IDs' };
    }
    
    // Формируем тело запроса только с указанными полями
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
        
        if (response.ok) {
            console.log('[ModPanel] Chat settings updated successfully');
            return { success: true };
        } else {
            const error = await response.json();
            console.error('[ModPanel] Update chat settings error:', error);
            return { 
                success: false, 
                error: error.message || `API Error: ${response.status}` 
            };
        }
    } catch (error) {
        console.error('[ModPanel] Update chat settings error:', error);
        return { success: false, error: error.message };
    }
}
