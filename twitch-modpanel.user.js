// ==UserScript==
// @name            Twitch ModPanel
// @namespace       TMP
// @description     Панель модератора для Twitch
// @version         1.0.0
// @author          Twitch ModPanel Team
//
// @grant           GM_getValue
// @grant           GM_setValue
// @grant           GM_xmlhttpRequest
// @grant           GM_registerMenuCommand
// @grant           GM_notification
//
// @match           https://*.twitch.tv/*
//
// @connect         raw.githubusercontent.com
// @connect         api.twitch.tv
// @connect         id.twitch.tv
// @connect         irc-ws.chat.twitch.tv
//
// @run-at          document-end
//
// @updateURL       https://raw.githubusercontent.com/Stepanchikkk/twitch-modpanel/main/twitch-modpanel.user.js
// @downloadURL     https://raw.githubusercontent.com/Stepanchikkk/twitch-modpanel/main/twitch-modpanel.user.js
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_URL = 'https://raw.githubusercontent.com/Stepanchikkk/twitch-modpanel/main/twitch-modpanel-content.user.js';
    const CACHE_KEY = 'tmp_last_update';
    const CACHE_DURATION = 3600000;

    function shouldRefreshCache() {
        try {
            const lastUpdate = GM_getValue(CACHE_KEY, 0);
            return (Date.now() - lastUpdate) > CACHE_DURATION;
        } catch (e) {
            return true;
        }
    }

    function loadScript() {
        const cacheBust = shouldRefreshCache() ? '?t=' + Date.now() : '';

        GM_xmlhttpRequest({
            method: 'GET',
            url: SCRIPT_URL + cacheBust,
            onload: function(response) {
                try {
                    eval(response.responseText);
                    console.log('[TMP] Script loaded successfully');
                    GM_setValue(CACHE_KEY, Date.now());
                } catch (e) {
                    console.error('[TMP] Error executing script:', e);
                }
            },
            onerror: function(error) {
                console.error('[TMP] Failed to load script:', error);
            }
        });
    }

    loadScript();
})();
