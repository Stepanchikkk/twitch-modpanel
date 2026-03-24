/**
 * Components.js — UI компоненты
 * 
 * Библиотека компонентов для панели модератора.
 */

import { CSS_PREFIX, ICONS } from './Config.js';

// ============================================================================
// Кнопки функций
// ============================================================================

/**
 * Создать кнопку функции
 * @param {string} icon - SVG иконка
 * @param {string} label - Текст
 * @param {Function} onClick - Обработчик клика
 * @returns {HTMLElement}
 */
export function createFeatureButton(icon, label, onClick) {
    const btn = document.createElement('button');
    btn.className = `${CSS_PREFIX}feature-btn`;
    btn.innerHTML = `
        <div class="${CSS_PREFIX}icon">${icon}</div>
        <span class="${CSS_PREFIX}label">${label}</span>
    `;
    btn.addEventListener('click', onClick);
    return btn;
}

/**
 * Создать сетку кнопок
 * @param {Array} buttons - Массив кнопок {icon, label, onClick}
 * @returns {HTMLElement}
 */
export function createButtonGrid(buttons) {
    const grid = document.createElement('div');
    grid.className = `${CSS_PREFIX}button-grid`;
    
    buttons.forEach(({ icon, label, onClick }) => {
        const btn = createFeatureButton(icon, label, onClick);
        grid.appendChild(btn);
    });
    
    return grid;
}

// ============================================================================
// Основная панель
// ============================================================================

/**
 * Создать главную панель
 * @returns {HTMLElement}
 */
export function createMainPanel() {
    const panel = document.createElement('div');
    panel.className = `${CSS_PREFIX}panel`;
    panel.innerHTML = `
        <div class="${CSS_PREFIX}panel-header">
            <h3 class="${CSS_PREFIX}title">ModPanel</h3>
            <button class="${CSS_PREFIX}close-btn">${ICONS.close}</button>
        </div>
        <div class="${CSS_PREFIX}panel-content"></div>
    `;
    return panel;
}

// ============================================================================
// Компоненты для функций
// ============================================================================

/**
 * Создать поле ввода текста
 * @param {string} placeholder - Плейсхолдер
 * @param {number} maxLength - Макс. длина
 * @returns {HTMLTextAreaElement}
 */
export function createTextArea(placeholder, maxLength = 500) {
    const textarea = document.createElement('textarea');
    textarea.className = `${CSS_PREFIX}textarea`;
    textarea.placeholder = placeholder;
    textarea.maxLength = maxLength;
    textarea.rows = 4;
    return textarea;
}

/**
 * Создать кнопку
 * @param {string} text - Текст
 * @param {string} variant - Вариант (primary, secondary)
 * @returns {HTMLButtonElement}
 */
export function createButton(text, variant = 'primary') {
    const btn = document.createElement('button');
    btn.className = `${CSS_PREFIX}btn ${CSS_PREFIX}btn-${variant}`;
    btn.textContent = text;
    return btn;
}

/**
 * Создать селект
 * @param {Array} options - Опции [{value, label}]
 * @returns {HTMLSelectElement}
 */
export function createSelect(options) {
    const select = document.createElement('select');
    select.className = `${CSS_PREFIX}select`;
    
    options.forEach(({ value, label }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    });
    
    return select;
}

/**
 * Создать переключатель (toggle)
 * @param {string} label - Текст
 * @param {boolean} checked - Состояние
 * @returns {HTMLElement}
 */
export function createToggle(label, checked = false) {
    const container = document.createElement('label');
    container.className = `${CSS_PREFIX}toggle`;
    container.innerHTML = `
        <span class="${CSS_PREFIX}toggle-label">${label}</span>
        <input type="checkbox" ${checked ? 'checked' : ''}>
        <span class="${CSS_PREFIX}toggle-slider"></span>
    `;
    return container;
}

// ============================================================================
// Уведомления
// ============================================================================

/**
 * Показать уведомление
 * @param {ShadowRoot} shadow - Shadow root
 * @param {string} message - Сообщение
 * @param {string} type - Тип (success, error)
 */
export function showNotification(shadow, message, type = 'success') {
    // Удаляем старые
    const existing = shadow.querySelectorAll(`.${CSS_PREFIX}notification`);
    existing.forEach(el => el.remove());
    
    const notification = document.createElement('div');
    notification.className = `${CSS_PREFIX}notification ${CSS_PREFIX}notification-${type}`;
    notification.innerHTML = `
        <span class="${CSS_PREFIX}notification-icon">${type === 'success' ? ICONS.check : ICONS.error}</span>
        <span class="${CSS_PREFIX}notification-text">${message}</span>
    `;
    
    shadow.appendChild(notification);
    
    // Анимация появления
    setTimeout(() => notification.classList.add(`${CSS_PREFIX}notification-show`), 10);
    
    // Удаление через 3 секунды
    setTimeout(() => {
        notification.classList.remove(`${CSS_PREFIX}notification-show`);
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}
