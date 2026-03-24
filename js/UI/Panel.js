/**
 * Panel.js — Основная панель модератора
 * 
 * Рендеринг и управление панелью.
 */

import { CSS_PREFIX, ICONS, ANNOUNCEMENT_COLORS } from './Config.js';
import { createShadowContainer, addStyles, removeShadowContainer } from './Utils/DOM.js';
import { 
    createMainPanel, 
    createButtonGrid, 
    createFeatureButton,
    showNotification 
} from './UI/Components.js';

// ============================================================================
// Стили
// ============================================================================

const STYLES = `
    * {
        box-sizing: border-box;
    }
    
    :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    .${CSS_PREFIX}panel {
        background: #0e0e10;
        border: 1px solid #3a3a3d;
        border-radius: 8px;
        width: 320px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        overflow: hidden;
    }
    
    .${CSS_PREFIX}panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: #18181b;
        border-bottom: 1px solid #3a3a3d;
    }
    
    .${CSS_PREFIX}title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: #efeff1;
    }
    
    .${CSS_PREFIX}close-btn {
        background: none;
        border: none;
        color: #adadb8;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
    }
    
    .${CSS_PREFIX}close-btn:hover {
        background: #3a3a3d;
        color: #efeff1;
    }
    
    .${CSS_PREFIX}panel-content {
        padding: 16px;
    }
    
    .${CSS_PREFIX}button-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
    }
    
    .${CSS_PREFIX}feature-btn {
        background: #18181b;
        border: 1px solid #3a3a3d;
        border-radius: 6px;
        padding: 12px 8px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        transition: all 0.2s;
    }
    
    .${CSS_PREFIX}feature-btn:hover {
        background: #26262c;
        border-color: #9146FF;
    }
    
    .${CSS_PREFIX}icon {
        width: 32px;
        height: 32px;
        color: #9146FF;
    }
    
    .${CSS_PREFIX}icon svg {
        width: 100%;
        height: 100%;
    }
    
    .${CSS_PREFIX}label {
        font-size: 12px;
        color: #adadb8;
        text-align: center;
    }
    
    .${CSS_PREFIX}textarea {
        width: 100%;
        background: #0e0e10;
        border: 1px solid #3a3a3d;
        border-radius: 4px;
        color: #efeff1;
        padding: 10px;
        font-size: 14px;
        resize: vertical;
    }
    
    .${CSS_PREFIX}textarea:focus {
        outline: none;
        border-color: #9146FF;
    }
    
    .${CSS_PREFIX}btn {
        width: 100%;
        padding: 10px 16px;
        border: none;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 10px;
    }
    
    .${CSS_PREFIX}btn-primary {
        background: #9146FF;
        color: white;
    }
    
    .${CSS_PREFIX}btn-primary:hover {
        background: #772ce8;
    }
    
    .${CSS_PREFIX}btn-secondary {
        background: #3a3a3d;
        color: #efeff1;
    }
    
    .${CSS_PREFIX}btn-secondary:hover {
        background: #4f4f52;
    }
    
    .${CSS_PREFIX}select {
        width: 100%;
        background: #0e0e10;
        border: 1px solid #3a3a3d;
        border-radius: 4px;
        color: #efeff1;
        padding: 8px 12px;
        font-size: 14px;
        margin-top: 10px;
    }
    
    .${CSS_PREFIX}select:focus {
        outline: none;
        border-color: #9146FF;
    }
    
    .${CSS_PREFIX}toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 0;
        cursor: pointer;
    }
    
    .${CSS_PREFIX}toggle-label {
        font-size: 14px;
        color: #adadb8;
    }
    
    .${CSS_PREFIX}toggle input {
        display: none;
    }
    
    .${CSS_PREFIX}toggle-slider {
        width: 40px;
        height: 20px;
        background: #3a3a3d;
        border-radius: 10px;
        position: relative;
        transition: background 0.2s;
    }
    
    .${CSS_PREFIX}toggle-slider::before {
        content: '';
        position: absolute;
        width: 16px;
        height: 16px;
        background: #adadb8;
        border-radius: 50%;
        top: 2px;
        left: 2px;
        transition: transform 0.2s;
    }
    
    .${CSS_PREFIX}toggle input:checked + .${CSS_PREFIX}toggle-slider {
        background: #9146FF;
    }
    
    .${CSS_PREFIX}toggle input:checked + .${CSS_PREFIX}toggle-slider::before {
        transform: translateX(20px);
        background: white;
    }
    
    .${CSS_PREFIX}notification {
        position: absolute;
        top: 10px;
        left: 10px;
        right: 10px;
        padding: 10px 14px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        opacity: 0;
        transform: translateY(-10px);
        transition: all 0.3s;
    }
    
    .${CSS_PREFIX}notification-show {
        opacity: 1;
        transform: translateY(0);
    }
    
    .${CSS_PREFIX}notification-success {
        background: #00ff0033;
        border: 1px solid #00ff00;
        color: #00ff00;
    }
    
    .${CSS_PREFIX}notification-error {
        background: #ff000033;
        border: 1px solid #ff0000;
        color: #ff6b6b;
    }
    
    .${CSS_PREFIX}section {
        display: none;
    }
    
    .${CSS_PREFIX}section-active {
        display: block;
    }
    
    .${CSS_PREFIX}back-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: none;
        color: #9146FF;
        cursor: pointer;
        font-size: 14px;
        margin-bottom: 12px;
        padding: 0;
    }
    
    .${CSS_PREFIX}back-btn:hover {
        text-decoration: underline;
    }
`;

// ============================================================================
// Panel Class
// ============================================================================

export class ModPanel {
    constructor() {
        this.host = null;
        this.shadow = null;
        this.panel = null;
        this.isOpen = false;
        this.currentSection = 'main';
    }

    /**
     * Инициализировать панель
     */
    async init() {
        console.log('[ModPanel] Initializing panel...');
        
        // Проверяем токен
        const token = await this.getToken();
        if (!token) {
            console.log('[ModPanel] No token, opening auth');
            chrome.runtime.sendMessage({ type: 'OAUTH_START' });
            return;
        }
        
        console.log('[ModPanel] Token found, rendering panel');
        this.render();
    }

    /**
     * Получить токен
     */
    async getToken() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['tmod_access_token'], (result) => {
                resolve(result.tmod_access_token);
            });
        });
    }

    /**
     * Проверить статус модератора
     */
    async checkModStatus() {
        const token = await this.getToken();
        if (!token) return false;
        
        // Проверяем кэш
        const cached = localStorage.getItem('tmod_mod_status_cache');
        if (cached) {
            const { channels, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < 5 * 60 * 1000) {
                const channelName = window.location.pathname.slice(1);
                return channels.includes(channelName.toLowerCase());
            }
        }
        
        // Запрос к API
        try {
            const response = await fetch('https://api.twitch.tv/helix/users/moderated_channels', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': 'qz89rtnd3uz3v7k3rnh5hffx3b97mu'
                }
            });
            
            if (!response.ok) return false;
            
            const data = await response.json();
            const channels = (data.data || []).map(ch => ch.broadcaster_login.toLowerCase());
            
            // Кэшируем
            localStorage.setItem('tmod_mod_status_cache', JSON.stringify({
                channels,
                timestamp: Date.now()
            }));
            
            const channelName = window.location.pathname.slice(1);
            return channels.includes(channelName.toLowerCase());
        } catch (error) {
            console.error('[ModPanel] Check mod status error:', error);
            return false;
        }
    }

    /**
     * Рендеринг панели
     */
    render() {
        // Создаём Shadow DOM
        const { host, shadow } = createShadowContainer();
        this.host = host;
        this.shadow = shadow;
        
        // Добавляем стили
        addStyles(shadow, STYLES);
        
        // Создаём панель
        this.panel = createMainPanel();
        shadow.appendChild(this.panel);
        
        // Рендерим главный экран
        this.renderMainScreen();
        
        // Обработчик закрытия
        const closeBtn = this.panel.querySelector(`.${CSS_PREFIX}close-btn`);
        closeBtn.addEventListener('click', () => this.close());
        
        this.isOpen = true;
        console.log('[ModPanel] Panel rendered');
    }

    /**
     * Рендер главного экрана
     */
    renderMainScreen() {
        const content = this.panel.querySelector(`.${CSS_PREFIX}panel-content`);
        content.innerHTML = '';
        
        const buttons = [
            { icon: ICONS.announcement, label: 'Анонс', onClick: () => this.renderAnnouncements() },
            { icon: ICONS.settings, label: 'Чат', onClick: () => this.renderChatSettings() },
            { icon: ICONS.poll, label: 'Опрос', onClick: () => alert('Phase 5: Polls') },
            { icon: ICONS.reward, label: 'Награды', onClick: () => alert('Phase 5: Rewards') },
        ];
        
        const grid = createButtonGrid(buttons);
        content.appendChild(grid);
    }

    /**
     * Рендер секции анонсов
     */
    renderAnnouncements() {
        const content = this.panel.querySelector(`.${CSS_PREFIX}panel-content`);
        content.innerHTML = `
            <button class="${CSS_PREFIX}back-btn">← Назад</button>
            <textarea class="${CSS_PREFIX}textarea" placeholder="Текст анонса (макс. 500 символов)"></textarea>
            <select class="${CSS_PREFIX}select">
                <option value="primary">Синий</option>
                <option value="blue">Голубой</option>
                <option value="green">Зелёный</option>
                <option value="orange">Оранжевый</option>
                <option value="purple">Фиолетовый</option>
            </select>
            <button class="${CSS_PREFIX}btn ${CSS_PREFIX}btn-primary">Отправить</button>
        `;
        
        const backBtn = content.querySelector(`.${CSS_PREFIX}back-btn`);
        backBtn.addEventListener('click', () => this.renderMainScreen());
        
        const sendBtn = content.querySelector(`.${CSS_PREFIX}btn-primary`);
        sendBtn.addEventListener('click', () => {
            showNotification(this.shadow, 'Анонс отправлен!', 'success');
            this.renderMainScreen();
        });
    }

    /**
     * Рендер настроек чата
     */
    renderChatSettings() {
        const content = this.panel.querySelector(`.${CSS_PREFIX}panel-content`);
        content.innerHTML = `
            <button class="${CSS_PREFIX}back-btn">← Назад</button>
            <div class="${CSS_PREFIX}toggle">
                <span class="${CSS_PREFIX}toggle-label">Только для подписчиков</span>
                <input type="checkbox">
                <span class="${CSS_PREFIX}toggle-slider"></span>
            </div>
            <div class="${CSS_PREFIX}toggle">
                <span class="${CSS_PREFIX}toggle-label">Только для фолловеров</span>
                <input type="checkbox">
                <span class="${CSS_PREFIX}toggle-slider"></span>
            </div>
            <div class="${CSS_PREFIX}toggle">
                <span class="${CSS_PREFIX}toggle-label">Только эмодзи</span>
                <input type="checkbox">
                <span class="${CSS_PREFIX}toggle-slider"></span>
            </div>
        `;
        
        const backBtn = content.querySelector(`.${CSS_PREFIX}back-btn`);
        backBtn.addEventListener('click', () => this.renderMainScreen());
    }

    /**
     * Закрыть панель
     */
    close() {
        if (this.host) {
            removeShadowContainer(this.host);
            this.host = null;
            this.shadow = null;
            this.panel = null;
            this.isOpen = false;
            console.log('[ModPanel] Panel closed');
        }
    }
}

// Экспорт экземпляра
export const modPanel = new ModPanel();
