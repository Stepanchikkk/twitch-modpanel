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
            while (stack.length) {
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
        while (cur && depth < 80) {
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
        // Fiber-юзеру доверяем, только если его логин совпал с видимым ником
        // сообщения; иначе id не берём — content.js добудет его по логину через Helix.
        const matchesLogin = (cand) => {
            if (!cand || !login) return true;
            const l = norm(cand.login || cand.userLogin || cand.userName || cand.displayName || '');
            return !l || l === norm(login);
        };
        let u = userFromMessage(m);
        if (!matchesLogin(u)) u = null;
        if (!u) u = searchFiberForUser(found);
        if (!matchesLogin(u)) u = null;
        if (!u) u = searchFiberForUser(fiber);
        if (!matchesLogin(u)) u = null;
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

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'TMOD_SEND_CHAT') {
            sendToTwitchChat(event.data.message);
        } else if (event.data?.type === 'TMOD_GET_MSG') {
            const el = document.querySelector('[data-tmod-probe]');
            let data = null;
            if (el) {
                data = getMessageDataFromElement(el);
                el.removeAttribute('data-tmod-probe');
            }
            window.postMessage({ type: 'TMOD_GET_MSG_RESULT', nonce: event.data.nonce, data }, '*');
        } else if (event.data?.type === 'TMOD_GET_MODSTATUS') {
            window.postMessage({ type: 'TMOD_GET_MODSTATUS_RESULT', nonce: event.data.nonce, data: getModViewUserDetails() }, '*');
        } else if (event.data?.type === 'TMOD_GET_GQLOPS') {
            const store = window.__tmod_gql_ops || {};
            const out = [];
            for (const o of Object.values(store)) {
                if (o && (o.hash || (o.query && o.query.length > 20))) out.push(o);
            }
            window.postMessage({ type: 'TMOD_GET_GQLOPS_RESULT', nonce: event.data.nonce, data: out }, '*');
        }
    });

    // Перехват GQL-трафика: когда сам клиент запрашивает статус юзера (открытая
    // карточка/Mod View), запоминаем точный шаблон операции. Многие внутренние
    // операции Твитча — persisted (текста запроса нет, только operationName +
    // sha256Hash), поэтому храним и то и другое: по тексту или по хэшу панель
    // потом повторяет запрос напрямую — незаметно, без открытия карточки.
    (function hookGqlOps() {
        const store = (window.__tmod_gql_ops = window.__tmod_gql_ops || {});
        const orig = window.fetch;
        if (typeof orig !== 'function') return;
        const capSize = 150;
        window.__tmod_gql_logged = 0;
        window.fetch = function (input, init) {
            let keyToWatch = null;
            let tagBan = null;
            try {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                if (url.indexOf('gql.twitch.tv') !== -1 && init && typeof init.body === 'string' && init.body.length > 10) {
                    const body = JSON.parse(init.body);
                    if (body && typeof body === 'object') {
                        const q = (typeof body.query === 'string' ? body.query : '').trim();
                        const opName = body.operationName || null;
                        const hash = (body.extensions && body.extensions.persistedQuery && body.extensions.persistedQuery.sha256Hash) || null;
                        const hasText = q.length > 20;
                        const textBan = /isBanned|expiresAt|bannedAt|banned|timeout/i.test(q);
                        const nameBan = opName && /viewer|usercard|ban|timeout|banned|modview|mod/i.test(opName);
                        const interesting = (hasText && textBan) || nameBan || (hasText && /\buser\s*\{/.test(q));
                        if (window.__tmod_gql_logged < 300) {
                            window.__tmod_gql_logged++;
                            console.log('[TModAPI] gql request', opName || '(anon)', 'text=' + q.length, hasText ? (textBan ? 'ban-text' : 'plain') : 'persisted', hash ? hash.slice(0, 8) : '');
                        }
                        // Копим ВСЕ persisted-операции: какая из них про бан, выясним по ответу
                        // (ban-метка), а не по имени/тексту — так точнее и безопаснее для повтора.
                        const key = opName || (hash ? ('hash:' + hash) : ('q:' + q.slice(0, 60)));
                        const prev = store[key];
                        const want = !prev || (!prev.query && hasText) || (!prev.hash && hash && !prev.query);
                        if (key && (interesting || hash || q.length > 20)) {
                            if (want) {
                                store[key] = { op: opName, query: hasText ? q : '', hash: hash || null, vars: body.variables || null };
                                window.postMessage({ type: 'TMOD_GQL_OP_CAPTURED', key, rec: store[key], url: location.pathname }, '*');
                                if (interesting) console.log('[TModAPI] gql-op captured', opName || '(anon)', hasText ? 'text' : 'persisted', hash ? hash.slice(0, 8) : '');
                            }
                            keyToWatch = key;
                            tagBan = textBan || nameBan;
                            const entries = Object.keys(store);
                            if (entries.length > capSize) delete store[entries[0]];
                        }
                    }
                }
            } catch (e) {}
            const ret = orig.apply(this, arguments);
            if (keyToWatch) {
                try {
                    ret && ret.then && ret.then((resp) => {
                        try {
                            if (!resp || typeof resp.clone !== 'function') return;
                            resp.clone().text().then((txt) => {
                                if (!txt) return;
                                let isBanResp = /"isBanned"|"bannedUntil"|"timeoutUntil"|"banStatus"/.test(txt);
                                if (isBanResp) {
                                    const rec = store[keyToWatch];
                                    if (rec && !rec.ban) {
                                        rec.ban = true;
                                        rec.resp = txt.slice(0, 3000);
                                        window.postMessage({ type: 'TMOD_GQL_OP_CAPTURED', key: keyToWatch, rec, url: location.pathname }, '*');
                                        console.log('[TModAPI] gql-op BAN-RESPONSE', keyToWatch);
                                    }
                                }
                            }).catch(() => {});
                        } catch (e) {}
                    });
                } catch (e) {}
            }
            return ret;
        };
    })();

    window.TModAPI = {
        sendChatMessage: sendToTwitchChat,
        getChatComponent: getChatComponent,
        getMessageData: getMessageDataFromElement
    };

    console.log('[TModAPI] Loaded!');
})();
