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
        const isVip = flag(u.isVip ?? u.isVIP ?? u.vip ?? (m && (m.isVip ?? m.vip)));
        const isModerator = flag(u.isModerator ?? u.isMod ?? u.moderator ?? (m && (m.isModerator ?? m.isMod ?? m.moderator)));
        const isBroadcaster = flag(u.isBroadcaster ?? u.isBROADCASTER ?? (u.role === 'BROADCASTER') ?? (m && m.isBroadcaster));

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
    // --- Перехват GQL-трафика страницы (discovery операций + чтение статуса) ---
    function gqlUrlOf(input) {
        if (typeof input === 'string') return input;
        if (input && input.url) return input.url;
        return '';
    }
    function gqlBodyOf(input, init) {
        if (init && typeof init.body === 'string') return init.body;
        if (input && typeof input.body === 'string') return input.body;
        return null;
    }
    function postGqlCapture(body, txt) {
        try {
            const j = JSON.parse(body);
            window.postMessage({
                type: 'TMOD_GQL_CAPTURE',
                operationName: (j && j.operationName) || '?',
                variables: j && j.variables,
                body: body,
                response: String(txt || '')
            }, '*');
        } catch (e) {}
    }
    try {
        const origFetch = window.fetch ? window.fetch.bind(window) : null;
        if (origFetch && !window.__tmodGqlHooked) {
            window.__tmodGqlHooked = true;
            window.fetch = function (input, init) {
                return origFetch(input, init).then((res) => {
                    try {
                        const url = gqlUrlOf(input);
                        const body = gqlBodyOf(input, init);
                        if (url.indexOf('gql.twitch.tv') !== -1 && body) {
                            res.clone().text().then((txt) => postGqlCapture(body, txt)).catch(() => {});
                        }
                    } catch (e) {}
                    return res;
                });
            };
        }
    } catch (e) {}
    try {
        if (window.XMLHttpRequest && !window.__tmodXhrHooked) {
            window.__tmodXhrHooked = true;
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (method, url) {
                this.__tmodGqlUrl = String(url || '');
                return origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function (body) {
                if (String(this.__tmodGqlUrl || '').indexOf('gql.twitch.tv') !== -1 && typeof body === 'string') {
                    const xhr = this;
                    this.addEventListener('loadend', function () {
                        try { postGqlCapture(body, xhr.responseText); } catch (e) {}
                    });
                }
                return origSend.apply(this, arguments);
            };
        }
    } catch (e) {}

    // Пытается вытащить данные юзера из открытой карточки модерации через Fiber.
    // Возвращает список «подозрительных» объектов юзера и подрезку props по пути к карточке.
    function getModViewUserDetails() {
        const el = document.querySelector('[data-a-target="mod-view-user-details"]');
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
        }
    });

    window.TModAPI = {
        sendChatMessage: sendToTwitchChat,
        getChatComponent: getChatComponent,
        getMessageData: getMessageDataFromElement
    };

    console.log('[TModAPI] Loaded!');
})();
