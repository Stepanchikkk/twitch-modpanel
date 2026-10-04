// preload.js — раннее внедрение twitch-api.js в страницу.
// Выполняется на document_start (классический скрипт, до модулей Twitch),
// чтобы перехват GQL («window.fetch → gql.twitch.tv») успел стать раньше,
// чем Twitch захватит ссылку на fetch.
(function () {
    try {
        const src = chrome.runtime.getURL('twitch-api.js');
        const script = document.createElement('script');
        script.src = src;
        script.onload = function () { script.remove(); };
        (document.documentElement || document.head || document.body).appendChild(script);
    } catch (e) {
        console.error('[ModPanel] preload inject failed:', e);
    }
})();