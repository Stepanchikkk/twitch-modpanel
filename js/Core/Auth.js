/**
 * Auth.js — OAuth токены и аутентификация
 * 
 * Предоставляет API для получения, проверки и обновления токенов.
 * Все операции выполняются через background.js (service worker).
 */

// ============================================================================
// Константы
// ============================================================================

const MESSAGE_TIMEOUT = 10000;

// ============================================================================
// Message Sender
// ============================================================================

/**
 * Отправить сообщение в background.js и получить ответ
 * @param {Object} message - Сообщение для background
 * @returns {Promise<Object>} Ответ от background
 */
function sendToBackground(message) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Message timeout: no response from background'));
        }, MESSAGE_TIMEOUT);

        chrome.runtime.sendMessage(message, (response) => {
            clearTimeout(timeout);
            
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            
            if (!response) {
                reject(new Error('No response from background'));
                return;
            }
            
            resolve(response);
        });
    });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Инициировать OAuth flow для получения токена
 * @returns {Promise<string>} Access token
 */
export async function login() {
    console.log('[ModPanel Auth] Initiating OAuth flow...');
    
    try {
        const response = await sendToBackground({ type: 'OAUTH_INITIATE' });
        
        if (response.success) {
            console.log('[ModPanel Auth] OAuth successful');
            return response.token;
        } else {
            throw new Error(response.error || 'OAuth failed');
        }
    } catch (error) {
        console.error('[ModPanel Auth] OAuth error:', error);
        throw error;
    }
}

/**
 * Получить сохранённый токен
 * @returns {Promise<string|null>} Access token или null
 */
export async function getToken() {
    try {
        const response = await sendToBackground({ type: 'OAUTH_GET_TOKEN' });
        return response.success ? response.token : null;
    } catch (error) {
        console.error('[ModPanel Auth] Get token error:', error);
        return null;
    }
}

/**
 * Проверить валидность текущего токена
 * @returns {Promise<boolean>} true если токен валиден
 */
export async function validateToken() {
    try {
        const response = await sendToBackground({ type: 'OAUTH_VALIDATE' });
        return response.success || false;
    } catch (error) {
        console.error('[ModPanel Auth] Validate token error:', error);
        return false;
    }
}

/**
 * Проверить токен и получить его (для инициализации)
 * @returns {Promise<string|null>} Валидный токен или null
 */
export async function getValidToken() {
    const token = await getToken();
    
    if (!token) {
        return null;
    }
    
    const isValid = await validateToken();
    if (!isValid) {
        console.log('[ModPanel Auth] Token invalid, clearing...');
        await clearToken();
        return null;
    }
    
    return token;
}

/**
 * Очистить сохранённый токен (logout)
 * @returns {Promise<void>}
 */
export async function clearToken() {
    try {
        await sendToBackground({ type: 'OAUTH_CLEAR' });
        console.log('[ModPanel Auth] Token cleared');
    } catch (error) {
        console.error('[ModPanel Auth] Clear token error:', error);
    }
}

/**
 * Получить информацию о пользователе
 * @returns {Promise<Object|null>} Данные пользователя или null
 */
export async function getUserInfo() {
    try {
        const response = await sendToBackground({ type: 'OAUTH_GET_USER' });
        return response.success ? response.user : null;
    } catch (error) {
        console.error('[ModPanel Auth] Get user info error:', error);
        return null;
    }
}

/**
 * Проверить, авторизован ли пользователь
 * @returns {Promise<boolean>}
 */
export async function isLoggedIn() {
    const token = await getValidToken();
    return !!token;
}

// ============================================================================
// Хелперы
// ============================================================================

/**
 * Получить заголовки для API запросов
 * @param {string} token - Access token
 * @returns {Object} Заголовки для fetch
 */
export function getAuthHeaders(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}
