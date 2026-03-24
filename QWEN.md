# Twitch ModPanel — Контекст для AI

## Обзор проекта

**Twitch ModPanel (TMP)** — браузерное расширение (Manifest V3) для модераторов Twitch, предоставляющее быстрый доступ к инструментам управления стримом без переключения на Mod View.

**Основной принцип:** Расширение работает поверх стандартного интерфейса просмотра стрима, активируется только на каналах, где пользователь является модератором.

**Безопасность:** Все данные хранятся локально, нет внешних серверов, используется OAuth 2.0 (PKCE).

## Технический стек

| Компонент | Технология |
|-----------|------------|
| Платформа | Chrome Extension Manifest V3 |
| Язык | JavaScript ES6+ Modules (без TypeScript) |
| Стили | CSS3 внутри Shadow DOM |
| Иконки | Встроенные SVG пути (в Config.js) |
| API | Twitch Helix API |
| Хранилище | chrome.storage.local |
| Зависимости | Отсутствуют (vanilla JavaScript) |

## Структура проекта

```
twitch-mod-panel/
├── manifest.json              # Конфигурация расширения (Manifest V3)
├── background.js              # OAuth flow и управление токенами
├── content.js                 # Инъекция UI и взаимодействие со страницей
├── js/
│   ├── Config.js              # Константы, Client ID, SVG иконки
│   ├── Core/
│   │   ├── Auth.js            # Управление OAuth токенами
│   │   └── API.js             # Fetch wrapper для Twitch Helix API
│   ├── Features/
│   │   ├── Announcements.js   # Отправка анонсов
│   │   ├── ChatSettings.js    # Управление настройками чата
│   │   ├── Polls.js           # Опросы и предсказания
│   │   └── Rewards.js         # Одобрение наград Channel Points
│   ├── UI/
│   │   ├── Panel.js           # Рендеринг панели
│   │   └── Components.js      # Библиотека UI компонентов
│   └── Utils/
│       └── DOM.js             # Безопасные DOM манипуляции
├── css/
│   └── styles.css             # Все стили (инжектируются в Shadow DOM)
├── popup/
│   ├── popup.html             # Popup окно расширения
│   └── popup.js               # Логика popup окна
├── icons/
│   └── icon128.png            # Иконка расширения
├── SPEC.md                    # Полная спецификация проекта
├── AI_INSTRUCTIONS.md         # Инструкции для AI-ассистента
└── QWEN.md                    # Этот файл
```

## Ключевые требования

### Архитектурные

1. **Shadow DOM:** Весь UI рендерится внутри Shadow DOM для изоляции от стилей Twitch/BTTV
2. **Позиционирование:** `position: fixed` относительно окна браузера, не инжектируется в DOM чата
3. **Модульность:** Каждая функция делает одно дело, макс. длина 50 строк
4. **Конфигурация:** Все magic numbers/strings в Config.js

### Безопасность

1. Токены хранятся только в `chrome.storage.local`
2. Никогда не логировать токены в console
3. Использовать `chrome.identity.launchWebAuthFlow` с PKCE
4. Client ID — плейсхолдер `YOUR_CLIENT_ID_HERE`

### Twitch API

1. **Base URL:** `https://api.twitch.tv/helix`
2. **Headers:** `Authorization`, `Client-Id`, `Content-Type`
3. **Rate Limits:** Проверка `Ratelimit-Remaining`, очередь запросов при < 5
4. **Ошибки:** 401 (refresh token), 429 (retry after), 403 (no permissions)

### Совместимость с BTTV

1. Уникальный префикс классов `tmod-`
2. Не модифицировать `window` объект
3. Не использовать глобальные стили
4. Тестировать с включённым BTTV

## Фазы разработки

### Phase 1: Setup
- `manifest.json`, `js/Config.js`, `background.js`

### Phase 2: Core и Auth
- `js/Core/Auth.js`, `js/Core/API.js`

### Phase 3: Base UI
- `js/Utils/DOM.js`, `js/UI/Panel.js`, `js/UI/Components.js`, `css/styles.css`, `content.js`

### Phase 4: API Integration
- `js/Features/Announcements.js`, `js/Features/ChatSettings.js`

### Phase 5: Advanced Features
- `js/Features/Polls.js`, `js/Features/Rewards.js`

### Phase 6: Polish and Testing
- Обработка ошибок, иконки, тестирование

## API Endpoints

| Endpoint | Метод | Назначение |
|----------|-------|------------|
| `/users/moderated_channels` | GET | Проверка статуса модератора |
| `/chat/announcements` | POST | Отправка анонса |
| `/chat/settings` | PUT | Настройки чата |
| `/polls` | POST/GET/PATCH | Опросы |
| `/predictions` | POST/GET/PATCH | Предсказания |
| `/channel/rewards/redemptions` | GET/PATCH | Награды Channel Points |

## Необходимые OAuth scopes

```
moderator:manage:announcements
moderator:manage:chat_settings
moderator:manage:chat_messages
moderator:manage:banned_users
channel:manage:polls
channel:manage:predictions
channel:read:redemptions
channel:manage:redemptions
user:read:moderated_channels
chat:read
chat:edit
```

## Команды для пользователя

### Начало новой фазы
> "Start Phase [X]: [Phase Name]. Create the files listed in AI_INSTRUCTIONS.md for this phase. Follow SPEC.md architecture."

### Добавление фичи
> "Add new feature: [Feature Name]. Create new file in js/Features/. Add button to Components.js. Register in Config.js. Do not modify Core/ or Utils/."

### Отладка
> "Error occurred: [error message]. File: [file path]. Line: [line number]. Analyze and suggest fix."

## Важные заметки

1. Client ID должен быть предоставлен пользователем
2. Все SVG иконки хранятся в Config.js
3. Тестировать каждую фазу перед переходом к следующей
4. Использовать JSDoc для публичных функций
5. camelCase для JavaScript, kebab-case для CSS классов
6. ES6 модули (import/export), не CommonJS

## Установка и запуск

### Требования
- Chrome 111+ (или браузер на базе Chromium: Edge, Brave, Yandex)
- Twitch Developer Account (для получения Client ID)

### Установка

1. Откройте `chrome://extensions/`
2. Включите **Developer mode** (переключатель в правом верхнем углу)
3. Нажмите **Load unpacked**
4. Выберите папку `twitch-mod-panel`

### Настройка

1. Откройте [Twitch Dev Console](https://dev.twitch.tv/console)
2. Создайте новое приложение или используйте существующее
3. Скопируйте **Client ID**
4. Откройте `js/Config.js` и замените `YOUR_CLIENT_ID_HERE` на ваш Client ID
5. В **OAuth Redirect URLs** добавьте: `http://localhost:3000`

### Использование

1. Откройте любой канал Twitch, где вы модератор
2. Над полем ввода чата появится кнопка с иконкой щита
3. Кликните на кнопку для открытия панели модератора
4. Используйте кнопки для быстрого доступа к функциям

## Критические правила реализации

### ⚠️ ЗАПРЕЩЕНО ФИКСИРОВАТЬ РАЗМЕРЫ

**НИКОГДА не фиксируй ширину/высоту плиток или панели!** Всё должно быть адаптивным:

```css
/* ❌ ПЛОХО - фиксированная ширина */
grid-template-columns: repeat(3, 100px);
width: 380px;

/* ✅ ХОРОШО - адаптивная ширина */
grid-template-columns: repeat(3, 1fr);
width: max-content;
min-width: 320px;
```

**Плитки должны:**
- Иметь `min-width` но не фиксированную ширину
- Растягиваться через `grid-template-columns: repeat(3, 1fr)`
- Все быть одинаковой ширины (по самой широкой плитке)

### ⚠️ CSS ДОЛЖЕН БЫТЬ ВНУТРИ innerHTML

**НИКОГДА не создавай `<style>` через createElement перед innerHTML:**

```javascript
// ❌ ПЛОХО - стиль перезапишется
const style = document.createElement('style');
style.textContent = `...`;
panel.appendChild(style);
panel.innerHTML = `<div>...</div>`;  // <-- style удалён!

// ✅ ХОРОШО - стиль внутри innerHTML
panel.innerHTML = `
    <style>
        .tmod-feature-btn { ... }
    </style>
    <div>...</div>
`;
```

### ⚠️ СТИЛИ ТРЕБУЮТ !important

Twitch агрессивно перебивает стили. Всегда используй `!important`:

```css
.tmod-feature-btn {
    background: #18181b !important;
    display: flex !important;
    /* ... все свойства с !important */
}
```

### ⚠️ СТРУКТУРА ПАНЕЛИ

```html
<!-- Шапка с border-radius только сверху -->
<div id="tmod-panel-header" style="border-radius: 8px 8px 0 0;">...</div>

<!-- Контент с border-radius только снизу -->
<div id="tmod-panel-content" style="border-radius: 0 0 8px 8px;">...</div>
```

### ⚠️ ИКОНКИ SVG

**Требования к SVG иконкам:**
1. Использовать `fill="currentColor"` на `<svg>` элементе
2. НЕ использовать `fill` на `<path>` элементах
3. CSS применяет `filter: brightness(0) invert(1)` для белых иконок

```svg
<!-- ✅ ПРАВИЛЬНО -->
<svg viewBox="0 0 24 24" fill="currentColor">
  <path d="..."/>
</svg>

<!-- ❌ НЕПРАВИЛЬНО -->
<svg viewBox="0 0 24 24">
  <path fill="#000000" d="..."/>
</svg>
```

**CSS для иконок:**
```css
.tmod-feature-btn img {
    filter: brightness(0) invert(1) !important;
}
```

### ⚠️ ОТПРАВКА КОМАНД В ЧАТ

**Механизм:**
1. `content.js` → `window.postMessage()` → `twitch-api.js` (в контексте страницы)
2. `twitch-api.js` → находит React компонент чата → вызывает `onSendMessage()`

**Для вставки текста (без отправки):**
```javascript
window.postMessage({ type: 'TMOD_SEND_CHAT', message: '/command' }, '*');
```

**twitch-api.js должен быть инжектирован:**
```javascript
function injectTwitchAPI() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('twitch-api.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}
```

### ⚠️ OAuth авторизация

**Redirect URI:** `http://localhost:3000`

**Должен быть добавлен в Twitch Dev Console!**

**Flow:**
1. Открывается popup окно с OAuth URL
2. Пользователь авторизуется
3. Redirect на `http://localhost:3000#access_token=XXX&...`
4. Парсим токен из hash
5. Закрываем окно, сохраняем токен

### ⚠️ ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ

**ICON_URL должен быть глобальным:**

```javascript
// В начале content.js
const ICON_URL = chrome.runtime.getURL('icons/icon128.png');

// Используется в createPanel() и injectButton()
```


## Отладка

### Проверка что стили применяются

```javascript
// В консоли Twitch
getComputedStyle(document.querySelector('.tmod-feature-btn')).background
// Должно показать '#18181b' а не 'rgba(0, 0, 0, 0)'

// Проверка что style тег есть
document.querySelector('#tmod-panel style')
// Должно вернуть <style> элемент
```

### Проверка кнопок

```javascript
// Сколько кнопок найдено
document.querySelectorAll('.tmod-feature-btn').length
// Должно показать 6

// Проверка панели
document.querySelector('#tmod-panel')
// Должно вернуть элемент панели
```

### Частые проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| Кнопки без фона | CSS не применился | Проверить что `<style>` внутри innerHTML |
| Плитки разной ширины | grid-template-columns: max-content | Использовать `repeat(3, 1fr)` |
| Углы шапки вылезают | Нет border-radius | Добавить `border-radius: 8px 8px 0 0` шапке |
| Иконки не белые | fill на path вместо svg | Убрать fill из path, использовать `fill="currentColor"` на svg |
| Иконки не красятся CSS | `<img>` не применяет color | Использовать `filter: brightness(0) invert(1)` |
| ICON_URL не определён | Переменная не глобальна | Объявить в начале файла вне функций |
| OAuth не работает | Нет redirect URI | Добавить `http://localhost:3000` в Twitch Dev Console |

## Текущий статус

**Реализовано:**
- ✅ OAuth авторизация (через popup окно)
- ✅ Панель с кнопками (6 штук: Анонс, Чат, Опрос, Прогноз, Клип, Награды)
- ✅ Отправка команд через twitch-api.js (`/poll`, `/prediction`, `/requests`)
- ✅ Анонсы (через Twitch API)
- ✅ Настройки чата (через Twitch API)
- ✅ Создание клипов (через команду `/clip`)
- ✅ Shield Mode (переключатель в меню чата)
- ✅ Очистка чата (кнопка с подтверждением)

**Не реализовано:**
- ❌ Шатаут (только вставка команды `/shoutout @` в чат)
- ❌ Просмотр списков (забаненные, модераторы, VIP)
- ❌ Управление наградами (только открытие панели)

## Команды для чата

| Команда | Описание |
|---------|----------|
| `/poll` | Открыть окно создания опроса |
| `/prediction` | Открыть окно создания прогноза |
| `/requests` | Открыть управление наградами |
| `/clip [название]` | Создать клип |
| `/clear` | Очистить чат |
| `/shieldmode` | Включить Shield Mode |
| `/shieldmodeoff` | Выключить Shield Mode |


## Тестирование

### Проверка OAuth

1. Открыть popup расширения
2. Нажать "Войти через Twitch"
3. Авторизоваться на Twitch
4. Окно закроется, в popup появится "Вы вошли как: username"

### Проверка панели

1. Открыть канал, где вы модератор
2. Кликнуть на кнопку щита над чатом
3. Должна открыться панель с кнопками функций

### Проверка API

1. Открыть консоль background page
2. Использовать функцию панели (например, отправить анонс)
3. Проверить логи на наличие ошибок API
