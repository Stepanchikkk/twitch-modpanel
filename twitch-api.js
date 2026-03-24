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

    // Отправляет сообщение в чат
    function sendToTwitchChat(message) {
        const chatComponent = getChatComponent();
        if (!chatComponent) {
            console.error('[TModAPI] Chat component not found');
            window.postMessage({ type: 'TMOD_CHAT_ERROR', error: 'Chat component not found' }, '*');
            return false;
        }
        
        console.log('[TModAPI] Sending to chat:', message);
        chatComponent.props.onSendMessage(message);
        window.postMessage({ type: 'TMOD_CHAT_SUCCESS', message: message }, '*');
        return true;
    }

    // Слушаем команды от content.js
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'TMOD_SEND_CHAT') {
            sendToTwitchChat(event.data.message);
        }
    });

    window.TModAPI = {
        sendChatMessage: sendToTwitchChat,
        getChatComponent: getChatComponent
    };

    console.log('[TModAPI] Loaded!');
})();
