/**
 * Announcements.js — Отправка анонсов через Twitch API
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
 * Получить ID широковещателя (канала)
 */
async function getBroadcasterId(channelName) {
    const token = await getToken();
    if (!token) return null;
    
    try {
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': CLIENT_ID
            }
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.data[0]?.id || null;
    } catch (error) {
        console.error('[ModPanel] Get broadcaster ID error:', error);
        return null;
    }
}

/**
 * Отправить анонс
 * @param {string} channelName - Имя канала
 * @param {string} message - Текст анонса
 * @param {string} color - Цвет (primary, blue, green, orange, purple)
 * @returns {Promise<Object>} Результат
 */
export async function sendAnnouncement(channelName, message, color = 'primary') {
    const token = await getToken();
    
    if (!token) {
        return { success: false, error: 'No token' };
    }
    
    const broadcasterId = await getBroadcasterId(channelName);
    
    if (!broadcasterId) {
        return { success: false, error: 'Could not get broadcaster ID' };
    }
    
    // Получаем ID модератора (текущего пользователя)
    let moderatorId;
    try {
        const response = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': CLIENT_ID
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            moderatorId = data.data[0]?.id;
        }
    } catch (error) {
        console.error('[ModPanel] Get moderator ID error:', error);
    }
    
    if (!moderatorId) {
        return { success: false, error: 'Could not get moderator ID' };
    }
    
    // Отправляем анонс
    try {
        const response = await fetch(
            `https://api.twitch.tv/helix/chat/announcements?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': CLIENT_ID,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    color: color
                })
            }
        );
        
        if (response.ok) {
            console.log('[ModPanel] Announcement sent successfully');
            return { success: true };
        } else {
            const error = await response.json();
            console.error('[ModPanel] Send announcement error:', error);
            return { 
                success: false, 
                error: error.message || `API Error: ${response.status}` 
            };
        }
    } catch (error) {
        console.error('[ModPanel] Send announcement error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Получить последние анонсы из истории (локально)
 */
export function getAnnouncementHistory() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['tmod_announcement_history'], (result) => {
            resolve(result.tmod_announcement_history || []);
        });
    });
}

/**
 * Сохранить анонс в историю
 */
export function saveToHistory(message, color) {
    return new Promise((resolve) => {
        getAnnouncementHistory().then((history) => {
            history.unshift({ message, color, timestamp: Date.now() });
            
            // Храним только последние 10
            if (history.length > 10) {
                history = history.slice(0, 10);
            }
            
            chrome.storage.local.set({ tmod_announcement_history: history }, resolve);
        });
    });
}
