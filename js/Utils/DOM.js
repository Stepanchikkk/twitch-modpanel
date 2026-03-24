/**
 * DOM.js — Утилиты для безопасной работы с DOM
 * 
 * Все функции для создания Shadow DOM и манипуляций.
 */

import { CSS_PREFIX, UI_Z_INDEX } from './Config.js';

// ============================================================================
// Shadow DOM
// ============================================================================

/**
 * Создать Shadow DOM контейнер для расширения
 * @returns {Object} { host, shadow }
 */
export function createShadowContainer() {
    // Создаём хост элемент
    const host = document.createElement('div');
    host.id = `${CSS_PREFIX}root`;
    host.style.cssText = `
        all: initial;
        position: fixed;
        z-index: ${UI_Z_INDEX};
        bottom: 80px;
        right: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    // Создаём Shadow DOM
    const shadow = host.attachShadow({ mode: 'open' });
    
    document.body.appendChild(host);
    
    return { host, shadow };
}

/**
 * Добавить стили в Shadow DOM
 * @param {ShadowRoot} shadow - Shadow root
 * @param {string} css - CSS строка
 */
export function addStyles(shadow, css) {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
}

/**
 * Создать элемент в Shadow DOM
 * @param {ShadowRoot} shadow - Shadow root
 * @param {string} tag - Тег элемента
 * @param {Object} props - Свойства
 * @param {string} className - Класс
 * @returns {HTMLElement}
 */
export function createElement(shadow, tag, props = {}, className = '') {
    const el = document.createElement(tag);
    
    if (className) {
        el.className = `${CSS_PREFIX}${className}`;
    }
    
    Object.assign(el, props);
    
    if (shadow) {
        shadow.appendChild(el);
    }
    
    return el;
}

// ============================================================================
// Удаление
// ============================================================================

/**
 * Удалить Shadow DOM контейнер
 * @param {HTMLElement} host - Хост элемент
 */
export function removeShadowContainer(host) {
    if (host && host.parentNode) {
        host.parentNode.removeChild(host);
    }
}

// ============================================================================
// Позиционирование
// ============================================================================

/**
 * Обновить позицию панели относительно чата
 * @param {HTMLElement} host - Хост элемент
 */
export function updatePanelPosition(host) {
    // Находим чат Twitch
    const chatContainer = document.querySelector('[data-a-target="chat-root"]');
    
    if (chatContainer) {
        const chatRect = chatContainer.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        
        // Позиционируем справа от видео, слева от чата
        const rightOffset = window.innerWidth - chatRect.left;
        host.style.right = `${rightOffset + 20}px`;
    }
}

// ============================================================================
// События
// ============================================================================

/**
 * Добавить обработчик события с очисткой
 * @param {HTMLElement} el - Элемент
 * @param {string} event - Событие
 * @param {Function} handler - Обработчик
 * @returns {Function} Функция для удаления
 */
export function addEvent(el, event, handler) {
    el.addEventListener(event, handler);
    return () => el.removeEventListener(event, handler);
}
