/**
 * API.js — Fetch wrapper для Twitch Helix API
 * 
 * Предоставляет унифицированный интерфейс для запросов к Twitch API.
 * Автоматически добавляет заголовки, обрабатывает rate limits и ошибки.
 */

import { TWITCH_API_BASE, RATE_LIMIT_THRESHOLD, API_TIMEOUT } from '../Config.js';

// ============================================================================
// Константы
// ============================================================================

const DEFAULT_TIMEOUT = API_TIMEOUT;

// ============================================================================
// Rate Limit State
// ============================================================================

let rateLimitRemaining = null;
let rateLimitReset = null;
let requestQueue = [];
let isProcessingQueue = false;

// ============================================================================
// Request Queue
// ============================================================================

/**
 * Обработать очередь запросов при rate limit
 */
async function processQueue() {
    if (isProcessingQueue || requestQueue.length === 0) {
        return;
    }
    
    isProcessingQueue = true;
    
    while (requestQueue.length > 0) {
        if (rateLimitRemaining !== null && rateLimitRemaining < RATE_LIMIT_THRESHOLD) {
            const waitTime = Math.max(0, rateLimitReset - Date.now());
            console.log(`[ModPanel API] Rate limit low, waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime + 1000));
        }
        
        const request = requestQueue.shift();
        try {
            const result = await executeRequest(request.url, request.options);
            request.resolve(result);
        } catch (error) {
            request.reject(error);
        }
    }
    
    isProcessingQueue = false;
}

/**
 * Добавить запрос в очередь
 * @param {string} url - URL запроса
 * @param {Object} options - Опции fetch
 * @returns {Promise<any>} Результат запроса
 */
function queueRequest(url, options) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ url, options, resolve, reject });
        processQueue();
    });
}

// ============================================================================
// Core Request Handler
// ============================================================================

/**
 * Выполнить HTTP запрос к Twitch API
 * @param {string} url - Полный URL или путь относительно API base
 * @param {Object} options - Опции fetch
 * @param {string} token - Access token
 * @param {string} clientId - Client ID
 * @returns {Promise<any>} Данные ответа
 */
async function executeRequest(url, options = {}, token = null, clientId = null) {
    const fullUrl = url.startsWith('http') ? url : `${TWITCH_API_BASE}${url}`;
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (clientId) {
        headers['Client-Id'] = clientId;
    }
    
    console.log(`[ModPanel API] ${options.method || 'GET'} ${fullUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
    
    try {
        const response = await fetch(fullUrl, {
            ...options,
            headers,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Обновление информации о rate limit
        rateLimitRemaining = parseInt(response.headers.get('Ratelimit-Remaining') || '500', 10);
        const rateLimitResetSec = parseInt(response.headers.get('Ratelimit-Reset') || '0', 10);
        if (rateLimitResetSec) {
            rateLimitReset = rateLimitResetSec * 1000;
        }
        
        console.log(`[ModPanel API] Rate limit remaining: ${rateLimitRemaining}`);
        
        // Обработка ошибок
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            
            switch (response.status) {
                case 401:
                    console.error('[ModPanel API] Unauthorized (401) - token expired');
                    throw new ApiError('Unauthorized', 401, errorData);
                    
                case 403:
                    console.error('[ModPanel API] Forbidden (403) - insufficient permissions');
                    throw new ApiError('Forbidden', 403, errorData);
                    
                case 429:
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
                    console.error(`[ModPanel API] Rate limited (429) - retry after ${retryAfter}s`);
                    throw new ApiError('Rate limit exceeded', 429, errorData, retryAfter * 1000);
                    
                case 404:
                    console.error(`[ModPanel API] Not found (404) - ${fullUrl}`);
                    throw new ApiError('Not found', 404, errorData);
                    
                default:
                    console.error(`[ModPanel API] Error (${response.status})`, errorData);
                    throw new ApiError(`HTTP ${response.status}`, response.status, errorData);
            }
        }
        
        // Парсинг ответа
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
            return await response.json();
        }
        
        return await response.text();
        
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            throw new ApiError('Request timeout', 0, { message: 'Request timed out' });
        }
        
        if (error instanceof ApiError) {
            throw error;
        }
        
        throw new ApiError('Network error', 0, { message: error.message });
    }
}

// ============================================================================
// API Error Class
// ============================================================================

/**
 * Класс ошибки API
 */
export class ApiError extends Error {
    constructor(message, status, data, retryAfter = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
        this.retryAfter = retryAfter;
    }
}

// ============================================================================
// Public API Methods
// ============================================================================

/**
 * GET запрос
 * @param {string} url - URL или путь
 * @param {Object} params - Query параметры
 * @param {string} token - Access token
 * @param {string} clientId - Client ID
 * @returns {Promise<any>}
 */
export async function get(url, params = {}, token = null, clientId = null) {
    const queryString = new URLSearchParams(params).toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;
    
    return executeRequest(fullUrl, { method: 'GET' }, token, clientId);
}

/**
 * POST запрос
 * @param {string} url - URL или путь
 * @param {Object} body - Тело запроса
 * @param {string} token - Access token
 * @param {string} clientId - Client ID
 * @returns {Promise<any>}
 */
export async function post(url, body = {}, token = null, clientId = null) {
    return executeRequest(
        url,
        {
            method: 'POST',
            body: JSON.stringify(body)
        },
        token,
        clientId
    );
}

/**
 * PUT запрос
 * @param {string} url - URL или путь
 * @param {Object} body - Тело запроса
 * @param {string} token - Access token
 * @param {string} clientId - Client ID
 * @returns {Promise<any>}
 */
export async function put(url, body = {}, token = null, clientId = null) {
    return executeRequest(
        url,
        {
            method: 'PUT',
            body: JSON.stringify(body)
        },
        token,
        clientId
    );
}

/**
 * PATCH запрос
 * @param {string} url - URL или путь
 * @param {Object} body - Тело запроса
 * @param {string} token - Access token
 * @param {string} clientId - Client ID
 * @returns {Promise<any>}
 */
export async function patch(url, body = {}, token = null, clientId = null) {
    return executeRequest(
        url,
        {
            method: 'PATCH',
            body: JSON.stringify(body)
        },
        token,
        clientId
    );
}

/**
 * DELETE запрос
 * @param {string} url - URL или путь
 * @param {Object} params - Query параметры
 * @param {string} token - Access token
 * @param {string} clientId - Client ID
 * @returns {Promise<any>}
 */
export async function del(url, params = {}, token = null, clientId = null) {
    const queryString = new URLSearchParams(params).toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;
    
    return executeRequest(fullUrl, { method: 'DELETE' }, token, clientId);
}

/**
 * Создать URL с параметрами
 * @param {string} path - Путь
 * @param {Object} params - Параметры
 * @returns {string}
 */
export function buildUrl(path, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return queryString ? `${TWITCH_API_BASE}${path}?${queryString}` : `${TWITCH_API_BASE}${path}`;
}

// ============================================================================
// Rate Limit Helpers
// ============================================================================

/**
 * Получить текущий статус rate limit
 * @returns {Object}
 */
export function getRateLimitStatus() {
    return {
        remaining: rateLimitRemaining,
        reset: rateLimitReset,
        queueLength: requestQueue.length
    };
}
