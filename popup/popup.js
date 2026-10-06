/**
 * popup.js — Логика popup окна
 */

const loadingEl = document.getElementById('loading');
const notLoggedInEl = document.getElementById('notLoggedIn');
const loggedInEl = document.getElementById('loggedIn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfoEl = document.getElementById('userInfo');
const mainEl = document.querySelector('main');
const settingsViewEl = document.getElementById('settingsView');
const openSettingsBtn = document.getElementById('openSettings');
const backFromSettingsBtn = document.getElementById('backFromSettings');
const settStatusEl = document.getElementById('settStatus');

// Проверка токена
async function checkAuth() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['tmod_access_token'], (result) => {
            resolve(!!result.tmod_access_token);
        });
    });
}

// Получение информации о пользователе
async function getUserInfo() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['tmod_user_info'], (result) => {
            resolve(result.tmod_user_info);
        });
    });
}

// Начало OAuth
function login() {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Открытие...';

    chrome.runtime.sendMessage({ type: 'OAUTH_START' }, (response) => {
        console.log('[Popup] OAuth response:', response);
        if (response && response.success) {
            console.log('[Popup] Success, user:', response.user?.login);
            location.reload();
        } else {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Войти через Twitch';
            const errorMsg = response?.error || 'Неизвестная ошибка';
            console.error('[Popup] Error:', errorMsg);
            alert('Ошибка: ' + errorMsg);
        }
    });
}

// Выход
async function logout() {
    await chrome.storage.local.remove(['tmod_access_token', 'tmod_user_info']);
    location.reload();
}

// Обновление UI
async function updateUI() {
    const isLoggedIn = await checkAuth();
    loadingEl.classList.add('hidden');

    if (isLoggedIn) {
        notLoggedInEl.classList.add('hidden');
        loginBtn.classList.add('hidden');
        loggedInEl.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');

        const userInfo = await getUserInfo();
        if (userInfo) {
            userInfoEl.textContent = `Вы вошли как: ${userInfo.login}`;
            userInfoEl.classList.remove('hidden');
        }
    } else {
        notLoggedInEl.classList.remove('hidden');
        loginBtn.classList.remove('hidden');
        loggedInEl.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        userInfoEl.classList.add('hidden');
    }
}

// Слушаем сообщения от background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OAUTH_SUCCESS') {
        location.reload();
    }
    sendResponse({});
});

// ---- Настройки панели (tmod_settings) ----
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['tmod_settings'], (r) => {
            try { resolve(r.tmod_settings ? JSON.parse(r.tmod_settings) : {}); } catch { resolve({}); }
        });
    });
}
async function saveSettings(s) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ tmod_settings: JSON.stringify(s) }, resolve);
    });
}

function bindToggle(id, key, invert) {
    const track = document.getElementById(id);
    getSettings().then((s) => {
        const on = invert ? s[key] !== false : s[key] === true;
        track.classList.toggle('on', on);
    });
    track.addEventListener('click', async () => {
        const next = !track.classList.contains('on');
        track.classList.toggle('on', next);
        const s = await getSettings();
        s[key] = invert ? next : next;
        await saveSettings(s);
    });
}

function showSettingsStatus(msg, ok) {
    settStatusEl.textContent = msg;
    settStatusEl.style.color = ok ? '#00ff00' : '#ff6b6b';
    settStatusEl.classList.remove('hidden');
}

function openSettings() {
    mainEl.classList.add('hidden');
    settingsViewEl.classList.remove('hidden');
    settStatusEl.classList.add('hidden');
    bindToggle('sett-ctxmenu', 'contextMenu', true);
    bindToggle('sett-autofocus', 'chatAutofocus', true);
    bindToggle('sett-showalways', 'showAlways', false);
}
function closeSettings() {
    settingsViewEl.classList.add('hidden');
    mainEl.classList.remove('hidden');
}

// Обработчики
loginBtn.addEventListener('click', login);
logoutBtn.addEventListener('click', logout);
openSettingsBtn.addEventListener('click', openSettings);
backFromSettingsBtn.addEventListener('click', closeSettings);

// Инициализация
updateUI();
