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

        return {
            messageId: m.id || null,
            userId: (u && u.id != null ? String(u.id) : null),
            userLogin: login || (u && (u.login || u.userLogin)) || null,
            userName: displayName || (u && (u.displayName || u.userName)) || login || null,
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

    function tmodGqlRecord(input, init) {
        if (!tmodGqlCaptureOn()) return;
        let url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) { return; }
        if (String(url).indexOf('gql.twitch.tv') === -1) return;
        let body = null;
        try { body = (init && init.body) || (input && input.body) || null; } catch (e) {}
        if (body && typeof body !== 'string') { try { body = JSON.stringify(body); } catch (e) { body = null; } }
        const ops = tmodGqlNormalizeOps(body);
        if (!ops.length) return;
        const at = Date.now();
        const ctx = tmodGqlCtx || {};
        const uid = ctx.userId ? String(ctx.userId) : '';
        // id в переменных бывает числом ({"id":12345}) и строкой — проверяем оба вида,
        // иначе пометка targetUser пропускает половину операций карточки.
        const idRe = uid ? new RegExp('(^|[^0-9])' + uid + '([^0-9]|$)') : null;
        const inCtx = !!(ctx.startedAt && at - ctx.startedAt < 12000);
        const items = Array.isArray(window.TMOD_GQL_CAPTURED) ? window.TMOD_GQL_CAPTURED : [];
        const added = [];
        for (const op of ops) {
            let vjson = '';
            try { vjson = JSON.stringify(op.variables || null); } catch (e) { vjson = ''; }
            const rec = {
                at: at,
                sinceCtx: ctx.startedAt ? at - ctx.startedAt : null,
                operationName: op.operationName,
                hash: tmodGqlHash(op),
                query: op.query,
                variables: op.variables,
                extensions: op.extensions,
                raw: op.raw,
                targetUser: idRe ? idRe.test(vjson) : null,
                label: ctx.label || null
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
