/**
 * Twitch ModPanel — Loader
 * Загружает все модули расширения
 */

(function() {
    'use strict';

    const BASE_URL = 'https://raw.githubusercontent.com/stepa/twitch-modpanel/main/';

    // Загружаем скрипты последовательно
    const scripts = [
        'twitch-api.js',
        'content.js'
    ];

    let currentScript = 0;

    function loadNextScript() {
        if (currentScript >= scripts.length) {
            console.log('[TMP] All scripts loaded!');
            return;
        }

        const scriptName = scripts[currentScript];
        const scriptUrl = BASE_URL + scriptName + '?t=' + Date.now();

        console.log('[TMP] Loading:', scriptUrl);

        GM_xmlhttpRequest({
            method: 'GET',
            url: scriptUrl,
            onload: function(response) {
                console.log('[TMP] Loaded:', scriptName);

                // Выполняем скрипт
                try {
                    eval(response.responseText);
                } catch (e) {
                    console.error('[TMP] Error executing', scriptName, e);
                }

                currentScript++;
                loadNextScript();
            },
            onerror: function(error) {
                console.error('[TMP] Failed to load', scriptName, error);
            }
        });
    }

    // Начинаем загрузку
    console.log('[TMP] Starting loader...');
    loadNextScript();

})();
