/**
 * twitch-api.js — Доступ к Twitch API из контекста страницы
 * Инжектируется в страницу для доступа к React Fiber
 */

(function() {
    if (window.TModAPI) return; // Уже загружен

    // Находит React Fiber узел по DOM элементу
    function getReactFiber(element) {
        for (const key in element) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
                return element[key];
            }
        }
        return null;
    }

    // Обходит Fiber дерево вверх
    function findFiberParent(fiber, callback, maxDepth = 15, depth = 0) {
        if (!fiber || depth > maxDepth) return null;
        try {
            if (callback(fiber)) return fiber;
        } catch (e) {}
        if (fiber.return) {
            return findFiberParent(fiber.return, callback, maxDepth, depth + 1);
        }
        return null;
    }

    // Находит компонент чата с onSendMessage
    function getChatComponent() {
        const chatElement = document.querySelector('section[data-test-selector="chat-room-component-layout"]');
        if (!chatElement) return null;
        
        const fiber = getReactFiber(chatElement);
        if (!fiber) return null;
        
        const chatFiber = findFiberParent(fiber, (f) => {
            return f.stateNode && f.stateNode.props && f.stateNode.props.onSendMessage;
        });
        
        return chatFiber?.stateNode;
    }

    // Ищет объект юзера по дереву fiber: вверх (return) и вниз (children/siblings)
    function isUserObj(o) {
        return !!(o && typeof o === 'object' && o.id != null &&
            (typeof o.login === 'string' || typeof o.displayName === 'string' || typeof o.userName === 'string'));
    }

    // Прямые пользовательские поля сообщения (в новых версиях Twitch fiber).
    function userFromMessage(m) {
        if (!m) return null;
        const uid = m.userId ?? m.user_id ?? m.senderId ?? m.sender_id ?? null;
        const ulogin = m.userLogin ?? m.user_login ?? m.senderLogin ?? m.sender_login ?? null;
        const uname = m.userDisplayName ?? m.user_display_name ?? m.displayName ?? m.senderDisplayName ?? null;
        if (uid || ulogin) {
            return { id: uid, login: ulogin, displayName: uname };
        }
        return null;
    }

    function collectUserCandidate(f) {
        const p = f.memoizedProps || f.pendingProps;
        if (!p) return null;
        const keys = ['user', 'userInfo', 'chatter', 'sender', 'chatUser', 'author', 'owner'];
        for (const k of keys) {
            const v = p[k];
            if (isUserObj(v)) return v;
            if (v && typeof v === 'object') {
                const inner = v.user || v.chatter || v.sender;
                if (isUserObj(inner)) return inner;
            }
        }
        const m = p.message || p.chatMessage || p.translatedMessage || p.messageData;
        if (m) {
            const direct = userFromMessage(m);
            if (direct) return direct;
            for (const k of keys) {
                const v = m[k];
                if (isUserObj(v)) return v;
                if (v && typeof v === 'object') {
                    const inner = v.user || v.chatter || v.sender;
                    if (isUserObj(inner)) return inner;
                }
            }
        }
        return null;
    }

    // Обходит дерево fiber вверх (через return) и вниз (children/siblings).
    function searchFiberForUser(fiber, maxNodes = 600) {
        const seen = new Set();
        let count = 0;
        const check = (f) => {
            if (!f || count >= maxNodes || seen.has(f)) return null;
            seen.add(f); count++;
            return collectUserCandidate(f);
        };
        const scanDown = (root) => {
            const stack = [{ f: root.child, sib: root.sibling }];
            // Условие по count обязательно: без него лимит останавливал только сбор
            // кандидатов, а обход продолжал класть в стек всё поддерево.
            while (stack.length && count < maxNodes) {
                const { f, sib } = stack.pop();
                if (f) {
                    const u = check(f);
                    if (u) return u;
                    stack.push({ f: f.child, sib: f.sibling });
                }
                if (sib) {
                    const u = check(sib);
                    if (u) return u;
                    stack.push({ f: sib.child, sib: sib.sibling });
                }
            }
            return null;
        };
        let cur = fiber;
        let depth = 0;
        while (cur && depth < 80 && count < maxNodes) {
            const u = check(cur);
            if (u) return u;
            const d = scanDown(cur);
            if (d) return d;
            cur = cur.return;
            depth++;
        }
        return null;
    }

    // Достаёт данные сообщения чата (messageId + юзер) из React Fiber
    function getMessageDataFromElement(el) {
        const fiber = getReactFiber(el);
        if (!fiber) return null;
        const found = findFiberParent(fiber, (f) => {
            const p = f.memoizedProps || f.pendingProps;
            if (!p) return false;
            const m = p.message || p.chatMessage || p.translatedMessage || p.messageData;
            return !!(m && typeof m.id === 'string');
        }, 60);
        if (!found) return null;
        const p = found.memoizedProps || found.pendingProps;
        const m = p.message || p.chatMessage || p.translatedMessage || p.messageData;

        // Авторитетный логин/имя — видимый ник сообщения в DOM (как в чате).
        const norm = (v) => String(v || '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        let login = null;
        let displayName = null;
        if (el) {
            const nick = el.querySelector('[data-a-target="chat-line-username"]')
                || el.querySelector('.chat-line__username, [data-a-target="chat-line-username"] a');
            if (nick) {
                const text = (nick.textContent || '').trim().replace(/^@/, '');
                if (text && text.length < 40) displayName = text;
                const title = (nick.getAttribute('title') || '').replace(/^@/, '');
                if (title && title.length < 40) displayName = displayName || title;
                const href = nick.getAttribute('href') || '';
                const m2 = href.match(/^\/([^/?]+)$/);
                if (m2) login = m2[1];
                if (!login && displayName) login = displayName.toLowerCase();
            }
        }

        // Прямые поля сообщения, затем поиск по дереву (предки + дети).
        // Fiber-юзеру доверяем ТОЛЬКО при совпадении логина с видимым ником.
        // Раньше проверка была «fail-open»: при нечитаемом нике (login === null)
        // принимался ЛЮБОЙ кандидат, а searchFiberForUser обходит предков и чужие
        // сообщения — и действие уходило другому человеку. При неизвестном нике
        // берём только прямые поля самого сообщения, иначе userId: null.
        const candLogin = (cand) => norm(cand && (cand.login || cand.userLogin || cand.userName || cand.displayName) || '');
        const matchesLogin = (cand) => {
            if (!cand || !login) return false;
            const l = candLogin(cand);
            return !!l && l === norm(login);
        };
        let u = userFromMessage(m);
        if (login) {
            if (!matchesLogin(u)) u = null;
            if (!u) u = searchFiberForUser(found);
            if (!matchesLogin(u)) u = null;
            if (!u) u = searchFiberForUser(fiber);
            if (!matchesLogin(u)) u = null;
        } else if (!candLogin(u)) {
            u = null;
        }
        u = u || {};
        const flag = (v) => (v === true || v === false ? !!v : null);
        const badgeOf = (badges, types) => {
            if (!badges) return null;
            const arr = Array.isArray(badges) ? badges : [badges];
            for (const b of arr) {
                if (b == null) continue;
                const low = String(b.type ?? b.id ?? b.name ?? b.label ?? b.setID ?? b.set_id ?? b.title ?? b).toLowerCase();
                for (const t of types) {
                    if (low === t || low.indexOf(t) !== -1) return true;
                }
            }
            return null;
        };
        const isVip = flag(u.isVip ?? u.isVIP ?? u.vip)
            ?? badgeOf(u.badges, ['vip'])
            ?? badgeOf(m && m.badges, ['vip'])
            ?? flag(m && (m.isVip ?? m.vip));
        const isModerator = flag(u.isModerator ?? u.isMod ?? u.moderator)
            ?? badgeOf(u.badges, ['mod', 'moderator'])
            ?? badgeOf(m && m.badges, ['mod', 'moderator'])
            ?? flag(m && (m.isModerator ?? m.isMod ?? m.moderator));
        const isBroadcaster = flag(u.isBroadcaster ?? u.isBROADCASTER ?? (u.role === 'BROADCASTER'))
            ?? badgeOf(u.badges, ['broadcaster', 'broad'])
            ?? badgeOf(m && m.badges, ['broadcaster', 'broad'])
            ?? flag(m && m.isBroadcaster);

        // Текст сообщения из модели чата Twitch: это ровно то, что написал пользователь,
        // включая названия смайлов. Нужен для превью: DOM сообщения содержит ещё время,
        // ник и служебные подписи сторонних расширений (7TV/BTTV).
        const bodyOf = (msg) => {
            if (!msg) return '';
            const cand = [msg.messageBody, msg.message, msg.body, msg.rawBody, msg.text];
            for (const c of cand) {
                if (typeof c === 'string' && c.trim()) return c.trim();
            }
            return '';
        };

        return {
            messageId: m.id || null,
            userId: (u && u.id != null ? String(u.id) : null),
            userLogin: login || (u && (u.login || u.userLogin)) || null,
            userName: displayName || (u && (u.displayName || u.userName)) || login || null,
            body: bodyOf(m) || bodyOf(u),
            isBroadcaster,
            isModerator,
            isVip
        };
    }

    // Отправляет сообщение в чат
    function sendToTwitchChat(message) {
        const chatComponent = getChatComponent();
        if (!chatComponent) {
            console.error('[TModAPI] Chat component not found');
            window.postMessage({ type: 'TMOD_CHAT_ERROR', message: message, error: 'Chat component not found' }, '*');
            return false;
        }
        
        console.log('[TModAPI] Sending to chat:', message);
        chatComponent.props.onSendMessage(message);
        window.postMessage({ type: 'TMOD_CHAT_SUCCESS', message: message }, '*');
        return true;
    }

    // Слушаем команды от content.js
    // Пытается вытащить данные юзера из открытой карточки модерации через Fiber.
    // Возвращает список «подозрительных» объектов юзера и подрезку props по пути к карточке.
    function getModViewUserDetails() {
        const el = document.querySelector('[data-a-target="mod-view-user-details"], [data-test-selector="mod-view-user-details"]');
        if (!el) return null;
        const results = [];
        const fiber = getReactFiber(el);
        if (!fiber) return { fiber: false };
        let node = fiber;
        let depth = 0;
        while (node && depth < 50) {
            const props = node.memoizedProps || node.pendingProps || node.props || null;
            if (props && typeof props === 'object') {
                let found = null;
                try {
                    if (props.user && props.user.id != null && typeof props.user.login === 'string') found = props.user;
                    else if (props.userData && props.userData.id != null && typeof props.userData.login === 'string') found = props.userData;
                } catch (e) {}
                if (found) results.push({ at: depth, source: props.user ? 'user' : 'userData', data: { id: found.id, login: found.login, displayName: found.displayName } });
                const texts = [];
                for (const k of Object.keys(props)) {
                    if (/mod|ban|timeout|user/i.test(k)) {
                        try { texts.push(k + '=' + JSON.stringify(props[k]).slice(0, 300)); } catch (e) {}
                    }
                }
                if (texts.length) results.push({ at: depth, source: 'props', data: texts.slice(0, 8).join('\n') });
            }
            node = node.return;
            depth++;
        }
        return { fiber: true, results };
    }

    // ------------------------------------------------------------------------
    // Диагностика GQL: узнать операцию, которой Twitch рисует карточку юзера.
    // В DevTools Network это сделать нереально (сотни запросов в секунду), поэтому
    // перехватываем fetch здесь, в page world, и пишем только операции gql.twitch.tv
    // в кольцевой буфер. Включается вручную:  localStorage.TMOD_CAPTURE_GQL = '1'
    // Посмотреть результат (в консоли СТРАНИЦЫ, не расширения).
    // Twitch шлёт persisted queries, поэтому в записи важен hash, а не query:
    //   copy(TMOD_GQL_CAPTURED.filter(i => i.targetUser).map(i => i.operationName + ' ' + i.hash).join('\n'))
    //   copy(JSON.stringify(TMOD_GQL_CAPTURED.filter(i => i.targetUser).map(i => i.raw), null, 1))
    // Второй вариант даёт готовое тело для реплея: operationName + variables + extensions.
    // ------------------------------------------------------------------------
    const TMOD_GQL_KEEP = 40;
    let tmodGqlCtx = null; // { startedAt, userId, label } — выставляется content.js

    function tmodGqlCaptureOn() {
        try { return localStorage.getItem('TMOD_CAPTURE_GQL') === '1'; } catch (e) { return false; }
    }

    function tmodGqlGuessName(query) {
        const m = /\b(?:query|mutation|subscription)\s+([A-Za-z0-9_]+)/.exec(String(query || ''));
        return m ? m[1] : '(анонимная)';
    }

    function tmodGqlNormalizeOps(body) {
        const out = [];
        const push = (o) => {
            if (!o || typeof o !== 'object') return;
            if (!o.query && !o.operationName) return;
            out.push({
                operationName: o.operationName || tmodGqlGuessName(o.query),
                query: o.query || '',
                variables: o.variables || null,
                // Twitch почти всё шлёт как persisted query: текста запроса в теле нет,
                // вместо него хеш в extensions.persistedQuery.sha256Hash — именно он и
                // нужен для реплея (тело получается крошечным).
                extensions: o.extensions || null,
                raw: o
            });
        };
        try {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body;
            if (Array.isArray(parsed)) parsed.forEach(push);
            else push(parsed);
        } catch (e) {}
        return out;
    }

    function tmodGqlHash(op) {
        try {
            return String((op.extensions && op.extensions.persistedQuery && op.extensions.persistedQuery.sha256Hash) || '');
        } catch (e) { return ''; }
    }

    // Чтение заголовков запроса (Headers или обычный объект).
    function tmodReadHeaders(src) {
        try {
            const h = (src && src.headers) || null;
            if (!h) return null;
            const get = (name) => {
                if (typeof h.get === 'function') return h.get(name);
                const k = Object.keys(h).find((x) => x.toLowerCase() === String(name).toLowerCase());
                return k ? h[k] : null;
            };
            return {
                clientId: get('Client-Id') || null,
                integrity: get('Client-Integrity') || null,
                sessionId: get('Client-Session-Id') || null,
                deviceId: get('X-Device-Id') || null,
                version: get('Client-Version') || null,
                hasAuth: !!get('Authorization')
            };
        } catch (e) { return null; }
    }

    // Живые заголовки клиента Twitch: сохраняем ВСЕГДА (это нужно для работы, а не для
    // отладки). Токен integrity короткоживущий и не является учётными данными пользователя —
    // он нужен только чтобы повторять запросы Twitch, которые иначе отбиваются проверкой.
    function tmodStoreLiveHeaders(h) {
        try {
            if (!h || !h.integrity) return;
            localStorage.setItem('TMOD_LIVE_GQL_HEADERS', JSON.stringify({
                at: Date.now(),
                integrity: h.integrity,
                sessionId: h.sessionId || null,
                deviceId: h.deviceId || null,
                version: h.version || null,
                clientId: h.clientId || null
            }));
        } catch (e) {}
    }

    function tmodGqlRecord(input, init) {
        let url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) { return; }
        if (String(url).indexOf('gql.twitch.tv') === -1) return;
        const live = tmodReadHeaders(init) || tmodReadHeaders(input);
        if (live && live.integrity) tmodStoreLiveHeaders(live);
        let body = null;
        try { body = (init && init.body) || (input && input.body) || null; } catch (e) {}
        if (body && typeof body !== 'string') { try { body = JSON.stringify(body); } catch (e) { body = null; } }
        const ops = tmodGqlNormalizeOps(body);
        // Диагностика пагинации: запоминаем, какие GQL-операции Twitch вообще дёргает, когда
        // журнал листают. Работает всегда, без режима отладки — по консоли видно, листается ли.
        try {
            const names = JSON.parse(localStorage.getItem('TMOD_GQL_OPS') || '{}') || {};
            ops.forEach((op) => {
                const n = String(op.operationName || '—');
                names[n] = (names[n] || 0) + 1;
            });
            localStorage.setItem('TMOD_GQL_OPS', JSON.stringify(names));
            ops.forEach((op) => {
                const n = String(op.operationName || '');
                // Поиск ПОЛЬЗОВАТЕЛЕЙ: публичного API у Twitch нет (в Helix только каналы).
                // Поэтому запоминаем их собственную операцию из трафика страницы — поиск на сайте
                // или автодополнение личных сообщений. Панель потом ищет по всему Twitch ею же.
                if (/searchuser|usersearch|autocomplete|whisper|searchresult/i.test(n)) {
                    try {
                        const list = JSON.parse(localStorage.getItem('TMOD_USER_SEARCH_OPS') || '[]') || [];
                        const h = String((op.extensions && op.extensions.persistedQuery
                            && op.extensions.persistedQuery.sha256Hash) || '');
                        if (h) {
                            list.unshift({
                                at: Date.now(), op: n, hash: h,
                                vars: JSON.stringify(op.variables || {}).slice(0, 400)
                            });
                            localStorage.setItem('TMOD_USER_SEARCH_OPS', JSON.stringify(list.slice(0, 6)));
                        }
                    } catch (e0) {}
                }
                if (!/mod|log|action|strike|ban|chat/i.test(n)) return;
                let log = [];
                try { log = JSON.parse(localStorage.getItem('TMOD_GQL_MODLOG_OPS') || '[]') || []; } catch (e) { log = []; }
                log.unshift({
                    at: Date.now(), op: n,
                    hash: String((op.extensions && op.extensions.persistedQuery && op.extensions.persistedQuery.sha256Hash) || ''),
                    vars: JSON.stringify(op.variables || {}).slice(0, 300)
                });
                localStorage.setItem('TMOD_GQL_MODLOG_OPS', JSON.stringify(log.slice(0, 30)));
                // Если Twitch листает сам журнал — запоминаем поле пагинации И хэш запроса:
                // у листающей версии запроса хэш может быть другим, и тогда наш `after` просто
                // игнорируется (что и происходило).
                const v = op.variables || {};
                const extra = Object.keys(v).filter((k) => !/^(channelID|channelLogin)$/i.test(k));
                if (/ModActionsList|ModerationAction|ModLog/i.test(n)) {
                    const h = String((op.extensions && op.extensions.persistedQuery && op.extensions.persistedQuery.sha256Hash) || '');
                    // Разные варианты запроса = разные хэши. Запоминаем оба: базовый (без
                    // курсора) и листающий (с after) — иначе наш `after` уходит не тем хэшем
                    // и Twitch отвечает ошибкой.
                    try {
                        const hashes = JSON.parse(localStorage.getItem('TMOD_MODLOG_HASHES') || '{}') || {};
                        if (h) hashes[h] = JSON.stringify(v).slice(0, 200);
                        localStorage.setItem('TMOD_MODLOG_HASHES', JSON.stringify(hashes));
                        // Имя операции для каждого хеша: панель по нему отбрасывает хеши ЧУЖИХ
                        // операций, которые попали сюда по совпадению имени (регулярка выше), —
                        // именно такой хеш ломал листание журнала.
                        try {
                            const owners = JSON.parse(localStorage.getItem('TMOD_MODLOG_HASH_OPS') || '{}') || {};
                            if (h) owners[h] = String(n);
                            localStorage.setItem('TMOD_MODLOG_HASH_OPS', JSON.stringify(owners));
                        } catch (e4) {}
                    } catch (e3) {}
                    if (!extra.length) {
                        if (h) localStorage.setItem('TMOD_MODLOG_HASH_BASE', h);
                    } else if (h) {
                        // Ключом пагинации считаем ТОЛЬКО переменную-курсор. Раньше сюда попадала
                        // первая «лишняя» переменная — у операций карточек это targetID, и панель
                        // отправляла курсор в targetID, отчего журнал переставал листаться.
                        const cursorVar = Object.keys(v).find((k) => !/^(channelID|channelLogin)$/i.test(k)
                            && (/^(after|cursor|endCursor|from|offset)$/i.test(k)
                                || /^eyJ[A-Za-z0-9_-]{8,}/.test(String(v[k] || ''))));
                        if (!cursorVar) return;
                        localStorage.setItem('TMOD_MODLOG_PAGE_KEY', JSON.stringify({
                            key: cursorVar, type: typeof v[cursorVar], sample: String(v[cursorVar]).slice(0, 40), at: Date.now()
                        }));
                        try { localStorage.setItem('TMOD_MODLOG_VARS_SAMPLE', JSON.stringify(v).slice(0, 600)); } catch (e2) {}
                        localStorage.setItem('TMOD_MODLOG_HASH_PAGE', h);
                        // Имя операции сохраняем рядом с хешем: без него панель не может понять,
                        // что «выученный» хеш принадлежит ДРУГОЙ операции (мы фильтруем по имени
                        // регуляркой), и подставляет его для ModActionsList — Twitch на это
                        // отвечает "operation with name 'ModActionsList' not found".
                        localStorage.setItem('TMOD_MODLOG_PAGE_OP', String(n));
                    }
                }
            });
        } catch (e) {}
        if (!tmodGqlCaptureOn()) return;
        if (!ops.length) return;
        let hdrs = null;
        try {
            if (live) {
                hdrs = {
                    clientId: live.clientId,
                    hasIntegrity: !!live.integrity,
                    hasDeviceId: !!live.deviceId,
                    hasAuth: live.hasAuth,
                    hasSessionId: !!live.sessionId,
                    clientVersion: live.version
                };
                // Версия клиента нужна, чтобы повторять запросы Twitch (она не секретная).
                if (hdrs.clientVersion) {
                    try { localStorage.setItem('TMOD_CLIENT_VERSION', hdrs.clientVersion); } catch (e) {}
                }
            }
        } catch (e) {}
        // Аналитика Twitch (spade/SendEvents) шлёт огромные GZIP-блобы и мгновенно вытесняет
        // из буфера то, что нам нужно: он хранит только последние TMOD_GQL_KEEP записей.
        // Такие операции не кладём совсем, а у остальных обрезаем гигантские строки.
        const TMOD_GQL_NOISE = /^(SendEvents|SendSpadeEvents|.*Spade.*|.*Analytics.*|.*Telemetry.*)$/i;
        const useful = ops.filter((o) => !TMOD_GQL_NOISE.test(String(o.operationName || '')));
        if (!useful.length) return;
        const trimVars = (v) => {
            if (!v || typeof v !== 'object') return v;
            try {
                const s = JSON.stringify(v);
                if (s.length <= 1500) return v;
                return JSON.parse(s.replace(/"([^"]{512,})"/g, (m, p1) => '"<' + p1.length + ' chars>"'));
            } catch (e) { return v; }
        };
        const at = Date.now();
        const ctx = tmodGqlCtx || {};
        const uid = ctx.userId ? String(ctx.userId) : '';
        // id в переменных бывает числом ({"id":12345}) и строкой — проверяем оба вида,
        // иначе пометка targetUser пропускает половину операций карточки.
        const idRe = uid ? new RegExp('(^|[^0-9])' + uid + '([^0-9]|$)') : null;
        const inCtx = !!(ctx.startedAt && at - ctx.startedAt < 12000);
        const items = Array.isArray(window.TMOD_GQL_CAPTURED) ? window.TMOD_GQL_CAPTURED : [];
        const added = [];
        for (const op of useful) {
            let vjson = '';
            try { vjson = JSON.stringify(op.variables || null); } catch (e) { vjson = ''; }
            const vars = trimVars(op.variables);
            const rec = {
                at: at,
                sinceCtx: ctx.startedAt ? at - ctx.startedAt : null,
                operationName: op.operationName,
                hash: tmodGqlHash(op),
                query: op.query,
                variables: vars,
                extensions: op.extensions,
                raw: op.raw,
                targetUser: idRe ? idRe.test(vjson) : null,
                label: ctx.label || null,
                headers: hdrs
            };
            items.push(rec);
            added.push(rec);
        }
        while (items.length > TMOD_GQL_KEEP) items.shift();
        window.TMOD_GQL_CAPTURED = items;
        // Автоподхват хешей: сохраняем текущий хеш каждой нужной нам операции, чтобы
        // реплей в content.js не сломался, когда Twitch обновит клиент и сменит хеши.
        // Учимся мы бесплатно — карточка всё равно открывается при чтении ролей.
        for (const rec of added) {
            try {
                if (!rec.hash) continue;
                if (!/^(ChatModeratorStrikeStatus|UserModStatus|LowTrustUserProperties|ViewerCardModLogs|ViewerCardModLogsComments|ViewerCardModLogsSharedComments|ViewerCardHeader|ViewerCard)$/.test(rec.operationName)) continue;
                localStorage.setItem('TMOD_GQL_HASH_' + rec.operationName, rec.hash);
            } catch (e) {}
        }
        // Логируем только то, что попали в окно чтения карточки: иначе консоль
        // заваливается всеми подряд gql-запросами страницы (SendEvents и т.п.).
        if (!inCtx) return;
        try {
            window.postMessage({
                type: 'TMOD_GQL_CAPTURED_LOG',
                ops: added.map((r) => ({ op: r.operationName, hash: r.hash ? r.hash.slice(0, 10) + '…' : '(нет)', targetUser: r.targetUser, sinceCtx: r.sinceCtx }))
            }, '*');
        } catch (e) {}
    }

    function tmodGqlInstallHook() {
        try {
            const orig = window.fetch;
            if (typeof orig !== 'function' || orig.__tmodGqlHook) return;
            const wrapped = function (input, init) {
                try { tmodGqlRecord(input, init); } catch (e) {}
                return orig.apply(this, arguments);
            };
            wrapped.__tmodGqlHook = true;
            window.fetch = wrapped;
        } catch (e) {}
    }
    tmodGqlInstallHook();

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'TMOD_SEND_CHAT') {
            sendToTwitchChat(event.data.message);
        } else if (event.data?.type === 'TMOD_GQL_CAPTURE_CTX') {
            // content.js помечает окно чтения карточки: кто именно читается.
            tmodGqlCtx = { startedAt: Date.now(), userId: event.data.userId, label: event.data.label || null };
        } else if (event.data?.type === 'TMOD_DEBUG_STORE') {
            // Склад диагностики в page world: сюда content.js кладёт сырые ответы
            // внутренних запросов, чтобы их можно было посмотреть из консоли страницы
            // (из изолированного мира расширения они не видны):
            //   copy(JSON.stringify(TMOD_DEBUG_DATA, null, 1))
            try {
                window.TMOD_DEBUG_DATA = window.TMOD_DEBUG_DATA || {};
                window.TMOD_DEBUG_DATA[String(event.data.key || 'data')] = event.data.value;
            } catch (e) {}
        } else if (event.data?.type === 'TMOD_GET_MSG') {
            // Метка = nonce запроса (см. content.js): берём ИМЕННО свой элемент,
            // иначе при наложившихся кликах вернули бы данные чужого сообщения.
            const nonce = String(event.data.nonce || '');
            let el = null;
            try {
                el = nonce
                    ? document.querySelector('[data-tmod-probe="' + nonce + '"]')
                    : document.querySelector('[data-tmod-probe]');
            } catch (e) { el = null; }
            let data = null;
            if (el) {
                data = getMessageDataFromElement(el);
                el.removeAttribute('data-tmod-probe');
            }
            window.postMessage({ type: 'TMOD_GET_MSG_RESULT', nonce: event.data.nonce, data }, '*');
        } else if (event.data?.type === 'TMOD_GET_MODSTATUS') {
            window.postMessage({ type: 'TMOD_GET_MODSTATUS_RESULT', nonce: event.data.nonce, data: getModViewUserDetails() }, '*');
        }
    });

    window.TModAPI = {
        sendChatMessage: sendToTwitchChat,
        getChatComponent: getChatComponent,
        getMessageData: getMessageDataFromElement
    };

    console.log('[TModAPI] Loaded!');
})();
