// ==UserScript==
// @name            Twitch ModPanel
// @namespace       TMP
// @description     Панель модератора для Twitch — быстрый доступ к инструментам управления стримом
// @copyright       Twitch ModPanel Team
//
// @grant   GM_getValue
// @grant   GM_setValue
// @grant   GM_xmlhttpRequest
//
// @match           https://*.twitch.tv/*
//
// @version         1.0.0
// @updateURL       https://raw.githubusercontent.com/stepa/twitch-modpanel/main/twitch-modpanel.user.js
// @downloadURL     https://raw.githubusercontent.com/stepa/twitch-modpanel/main/twitch-modpanel.user.js
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_URL = 'https://raw.githubusercontent.com/stepa/twitch-modpanel/main/twitch-modpanel-loader.js';
    const CACHE_KEY = 'tmp_last_update';
    const CACHE_DURATION = 3600000; // 1 час

    function shouldRefreshCache() {
        try {
            const lastUpdate = GM_getValue(CACHE_KEY, 0);
            const now = Date.now();
            return (now - lastUpdate) > CACHE_DURATION;
        } catch (e) {
            console.log('[TMP] Cache error:', e);
            return true;
        }
    }

    function updateCacheTimestamp() {
        try {
            GM_setValue(CACHE_KEY, Date.now());
        } catch (e) {
            console.log('[TMP] Cache write error:', e);
        }
    }

    function loadScript() {
        const script = document.createElement('script');
        script.type = 'text/javascript';

        if (shouldRefreshCache()) {
            script.src = SCRIPT_URL + '?t=' + Date.now();
            updateCacheTimestamp();
            console.log('[TMP] Loading script with cache bust');
        } else {
            script.src = SCRIPT_URL;
            console.log('[TMP] Loading script from cache');
        }

        script.onload = function() {
            console.log('[TMP] Script loaded successfully');
        };

        script.onerror = function() {
            console.error('[TMP] Failed to load script');
        };

        document.head.appendChild(script);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        loadScript();
    } else {
        window.addEventListener('DOMContentLoaded', loadScript);
    }
})();
