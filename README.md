# 🛡️ Twitch ModPanel

Панель модератора для Twitch — быстрый доступ к инструментам управления стримом без переключения на Mod View.

## 📦 Установка

### Способ 1: Chrome Extension (рекомендуется)

1. Открой `chrome://extensions/`
2. Включи **Developer mode**
3. Нажми **Load unpacked**
4. Выбери папку `twitch-mod-panel`
5. **Готово!** Зайди на любой стрим где ты модератор

### Способ 2: Tampermonkey

1. **Установи Tampermonkey:**
   - [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2. **Нажми кнопку установки:**

   [📦 Установить скрипт](https://raw.githubusercontent.com/Stepanchikkk/twitch-modpanel/main/twitch-modpanel.user.js)

3. **Подтверди установку** в окне Tampermonkey

4. **Готово!** Зайди на любой стрим где ты модератор

### Ручная установка Tampermonkey

1. Скачай [`twitch-modpanel.user.js`](https://raw.githubusercontent.com/Stepanchikkk/twitch-modpanel/main/twitch-modpanel.user.js)
2. Открой Tampermonkey → **Create new script**
3. Вставь содержимое файла
4. **File** → **Save**

## 🔐 Авторизация

1. Открой любой стрим где ты модератор
2. Над чатом появится кнопка **🛡️ Панель модератора**
3. Нажми на кнопку
4. Если не авторизован — нажми **🔐 Войти через Twitch**
5. Разреши доступ к аккаунту

## ✨ Возможности

| Функция | Описание |
|---------|----------|
| 📢 **Анонсы** | Отправка анонсов в чат с выбором цвета |
| ⚙️ **Настройки чата** | Slow mode, Sub mode, Follower mode, Emote mode |
| 📊 **Опросы** | Быстрое создание опросов |
| 🔮 **Прогнозы** | Создание прогнозов |
| 🎬 **Клипы** | Создание клипов с названием |
| 🎁 **Награды** | Управление наградами Channel Points |
| 🛡️ **Shield Mode** | Вкл/Выкл Shield Mode |
| 🗑️ **Очистка чата** | Очистка чата с подтверждением |

## 🎨 Интерфейс

```
┌─────────────────────────────────┐
│ 🛡️ Панель модератора       ✕   │
├─────────────────────────────────┤
│  📢      ⚙️      📊            │
│ Анонс    Чат    Опрос          │
│                                 │
│  🔮      🎬      🎁            │
│ Прогноз  Клип   Награды        │
└─────────────────────────────────┘
```

## 🔧 Настройки

Кликни на иконку Tampermonkey → **Twitch ModPanel** → **🔐 Войти** / **🚪 Выйти**

## 📝 Заметки

- Расширение работает **только** на каналах где ты модератор
- Все данные хранятся локально
- Нет внешних серверов
- Используется официальное Twitch API

## 🐛 Проблемы

Если что-то не работает:

1. Обнови страницу (F5)
2. Проверь что авторизован
3. Проверь что ты модератор на этом канале
4. Открой консоль (F12) и посмотри ошибки

## 📄 Лицензия

MIT License

## 🙏 Благодарности

- [ReYohoho Twitch Extension](https://ext.rte.net.ru/) — за вдохновение
- [Twitch API](https://dev.twitch.tv/docs/api/) — официальный API
