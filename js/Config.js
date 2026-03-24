/**
 * Config.js — Центральное хранилище констант и конфигурации
 * 
 * Все magic numbers, strings, SVG иконки и настройки хранятся здесь.
 * Изменяйте значения только в этом файле.
 */

// ============================================================================
// OAuth и API конфигурация
// ============================================================================

/**
 * Twitch OAuth Client ID
 * Получен из https://dev.twitch.tv/console
 */
export const CLIENT_ID = 'qz89rtnd3uz3v7k3rnh5hffx3b97mu';

/**
 * Базовый URL Twitch Helix API
 */
export const TWITCH_API_BASE = 'https://api.twitch.tv/helix';

/**
 * URL для OAuth авторизации
 */
export const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';

/**
 * Запрошенные OAuth scopes
 */
export const OAUTH_SCOPES = [
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

// ============================================================================
// Таймауты и кэширование
// ============================================================================

/**
 * Время кэширования статуса модератора (в миллисекундах)
 * 5 минут
 */
export const MOD_STATUS_CACHE_TTL = 5 * 60 * 1000;

/**
 * Время обновления списка наград (в миллисекундах)
 * 30 секунд
 */
export const REWARDS_REFRESH_INTERVAL = 30 * 1000;

/**
 * Максимальное время ожидания ответа от API (в миллисекундах)
 */
export const API_TIMEOUT = 30000;

/**
 * Минимальное количество оставшихся запросов перед паузой
 */
export const RATE_LIMIT_THRESHOLD = 5;

// ============================================================================
// UI конфигурация
// ============================================================================

/**
 * Z-index для всех UI элементов расширения
 * Должен быть выше всех элементов Twitch
 */
export const UI_Z_INDEX = 99999;

/**
 * Префикс для всех CSS классов (изоляция от Twitch/BTTV)
 */
export const CSS_PREFIX = 'tmod-';

/**
 * Максимальная длина текста анонса (символов)
 */
export const ANNOUNCEMENT_MAX_LENGTH = 500;

/**
 * Максимальное количество сохраняемых шаблонов анонсов
 */
export const ANNOUNCEMENT_TEMPLATES_MAX = 10;

// ============================================================================
// SVG иконки
// ============================================================================

/**
 * Иконка щита — для триггер-кнопки
 */
export const ICON_SHIELD = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
`;

/**
 * Иконка мегафона — для анонсов
 */
export const ICON_ANNOUNCEMENT = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 11l18-5v12L3 14v-3z"/>
        <path d="M11.6 16.8a3 3 0 11-5.8-1.6"/>
    </svg>
`;

/**
 * Иконка настроек — для настроек чата
 */
export const ICON_SETTINGS = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
`;

/**
 * Иконка опроса — для polls
 */
export const ICON_POLL = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 20V10"/>
        <path d="M12 20V4"/>
        <path d="M6 20v-6"/>
    </svg>
`;

/**
 * Иконка награды — для channel points rewards
 */
export const ICON_REWARD = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="8" r="7"/>
        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
    </svg>
`;

/**
 * Иконка закрытия
 */
export const ICON_CLOSE = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
`;

/**
 * Иконка галочки (успех)
 */
export const ICON_CHECK = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
    </svg>
`;

/**
 * Иконка ошибки
 */
export const ICON_ERROR = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
`;

/**
 * Иконка обновления/перезагрузки
 */
export const ICON_REFRESH = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>
`;

// Экспорт всех иконок объектом для удобного доступа
export const ICONS = {
    shield: ICON_SHIELD,
    announcement: ICON_ANNOUNCEMENT,
    settings: ICON_SETTINGS,
    poll: ICON_POLL,
    reward: ICON_REWARD,
    close: ICON_CLOSE,
    check: ICON_CHECK,
    error: ICON_ERROR,
    refresh: ICON_REFRESH
};

// ============================================================================
// Цвета анонсов
// ============================================================================

/**
 * Доступные цвета для анонсов
 */
export const ANNOUNCEMENT_COLORS = {
    primary: 'primary',
    blue: 'blue',
    green: 'green',
    orange: 'orange',
    purple: 'purple'
};

// ============================================================================
// Хелперы
// ============================================================================

/**
 * Получить актуальный timestamp
 * @returns {number} Текущее время в миллисекундах
 */
export function now() {
    return Date.now();
}

/**
 * Проверить, истёк ли срок кэша
 * @param {number} cachedAt — Время кэширования (timestamp)
 * @param {number} ttl — Время жизни кэша (мс)
 * @returns {boolean} true если кэш устарел
 */
export function isCacheExpired(cachedAt, ttl) {
    return now() - cachedAt > ttl;
}
