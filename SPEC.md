# Twitch ModPanel Extension Specification

## 1. Project Overview

Name: Twitch ModPanel (TMP)
Type: Browser Extension (Manifest V3)
Goal: Provide moderators with quick access to stream management tools without switching to Mod View
Principle: Extension works on top of standard stream viewing interface, activates only on channels where user is moderator
Security: All data stored locally, no external servers, OAuth 2.0 (PKCE) authorization

## 2. Technical Stack

Platform: Chrome Extension Manifest V3 (Chrome, Edge, Brave, Yandex compatible)
Language: JavaScript (ES6+ Modules), no TypeScript
Styles: CSS3 inside Shadow DOM (isolation from Twitch/BTTV styles)
Icons: Embedded SVG paths, no emojis, no external CDNs
API: Twitch Helix API only
Storage: chrome.storage.local (tokens, settings, templates)
Dependencies: None (vanilla JavaScript only)

## 3. Architecture

### 3.1 Module Structure

Create these files in this exact structure:

manifest.json - Extension configuration (Manifest V3)
background.js - OAuth flow and token management
content.js - UI injection and page interaction

js/Config.js - Constants, Client ID placeholder, SVG icons
js/Core/Auth.js - OAuth token management, validation, refresh
js/Core/API.js - Fetch wrapper for Twitch Helix API
js/Features/Announcements.js - Announcement sending logic
js/Features/ChatSettings.js - Chat settings management
js/Features/Polls.js - Polls and predictions logic
js/Features/Rewards.js - Channel points reward approval
js/UI/Panel.js - Panel rendering and state management
js/UI/Components.js - UI component library
js/Utils/DOM.js - Safe DOM manipulation functions

css/styles.css - All styles (injected into Shadow DOM)
icons/icon128.png - Extension icon (128x128 PNG)

### 3.2 Shadow DOM Isolation

All extension UI must render inside Shadow DOM. This guarantees:
- No CSS conflicts with Twitch or BTTV
- Selector protection from Twitch changes
- Ability to use any styles without affecting the page
- Unique class prefixes (tmod-) for all elements

### 3.3 Positioning

Panel does NOT inject into Twitch chat DOM tree
Uses position: fixed relative to browser window
Coordinates: Right of video player, left of chat, anchored to bottom (above chat input)
JS must track chat width changes and adjust right offset dynamically

## 4. User Interface

### 4.1 Trigger Button

Round button with shield icon (SVG)
Visible only for moderators
Located above chat input field, attached to bottom of browser window
Z-index: 99999 (above all Twitch elements)

### 4.2 Main Panel

Rectangular window with rounded corners
Dark theme (Twitch colors: #0e0e10, #1f1f23, #efeff1)
Main Screen: Grid of buttons (3x3 or 3x2)
Each button: square, SVG icon + text label
Inner Screens: Panel content changes on click, position preserved
Adaptive sizing based on active section

### 4.3 Icons

Use SVG paths only, stored in Config.js
No text emojis
Official Twitch icon style (simple, monochrome)
Size: 24x24 pixels

## 5. Security and Authorization

### 5.1 OAuth Flow

Use chrome.identity.launchWebAuthFlow
Redirect URI: https://<extension_id>.chromiumapp.org/ (auto-generated)
Request only necessary scopes
Token refresh automatically when expired

### 5.2 Required Scopes

moderator:manage:announcements
moderator:manage:chat_settings
moderator:manage:chat_messages
moderator:manage:banned_users
channel:manage:polls
channel:manage:predictions
channel:read:redemptions
channel:manage:redemptions
user:read:moderated_channels
chat:read
chat:edit

### 5.3 Token Storage

Tokens encrypted by browser OS
Store only in chrome.storage.local
Never log tokens to console
Never send tokens to external servers
Access only through background.js

### 5.4 Rights Check

On page load, check GET /helix/users/moderated_channels endpoint
If current channel not in list, do not render UI
Cache result for 5 minutes to reduce API calls

## 6. Feature Specifications

### 6.1 Announcements

Color selection: Blue, Green, Orange, Purple, Primary
Text input with 500 character limit
Template storage: last 10 announcements in chrome.storage.local
Send via API: POST /helix/chat/announcements
Show success/error notification in panel

### 6.2 Chat Settings

Slow Mode: toggle + duration selector (0-120 seconds)
Subscriber Only: toggle
Follower Only: toggle + duration selector (0-120 minutes)
Emote Only: toggle
Send via API: PUT /helix/chat/settings
Show current state on load

### 6.3 Polls

Create poll with 2-5 options
Duration selector: 60-1800 seconds
View active poll status
End poll early
Send via API: POST /helix/polls
Note: Works with moderator token + broadcaster_id

### 6.4 Predictions

Create prediction with 2 outcomes
Duration selector: 60-1800 seconds
View active prediction status
Resolve prediction (lock, cancel, resolve)
Send via API: POST /helix/predictions

### 6.5 Rewards

List pending redemptions (status: UNFULFILLED)
Approve button (PATCH to FULFILLED)
Reject button (PATCH to REJECTED)
Send via API: PATCH /helix/channel_rewards/custom_redemptions
Refresh list every 30 seconds when panel open

## 7. Error Handling

All API requests must have try/catch blocks
Log errors to extension console (not page console)
Show user-friendly error messages in UI
Handle 429 Rate Limit: queue requests, retry after header
Handle 401 Unauthorized: refresh token, retry once
Handle 403 Forbidden: show permission error message
Handle network errors: show offline message

## 8. BTTV Compatibility

Never use document.querySelector for chat elements to inject buttons inside chat
Use only position: fixed overlay
All CSS inside Shadow DOM
Unique class prefixes (tmod-) for all classes
No global variable modifications
No window object modifications
Test with BTTV (reyohoho build) enabled before release

## 9. Code Quality Rules

No dependencies: vanilla JavaScript only
Modularity: each function does one thing, max 50 lines
Configuration: all magic numbers and strings in Config.js
Comments: JSDoc for public functions, inline for complex logic
Extensibility: new features add new files in Features/, do not modify core
Error handling: every async function has try/catch
Naming: descriptive variable names, camelCase for JS, kebab-case for CSS

## 10. Testing Checklist

Extension loads in Chrome without errors
OAuth flow completes successfully
Token stored in chrome.storage.local
Button appears only on moderated channels
Panel renders inside Shadow DOM
No conflicts with BTTV (test with BTTV enabled)
All API requests return expected responses
Rate limits handled correctly
UI responsive on different screen sizes
Token refresh works after expiry
Error messages display correctly

## 11. Future Extension Points

New features should be added by:
1. Creating new file in Features/ folder
2. Registering button in UI/Components.js
3. Adding config in Config.js
4. NOT modifying Core/ or Utils/ folders
5. Following existing code patterns

## 12. API Endpoints Reference

Base URL: https://api.twitch.tv/helix

GET /users/moderated_channels - Check moderator status
POST /chat/announcements - Send announcement
PUT /chat/settings - Update chat settings
POST /polls - Create poll
GET /polls - Get active poll
PATCH /polls - End poll
POST /predictions - Create prediction
GET /predictions - Get active prediction
PATCH /predictions - Resolve prediction
GET /channel/rewards/redemptions - Get pending redemptions
PATCH /channel/rewards/redemptions - Approve/reject redemption

Headers required:
Authorization: Bearer <token>
Client-Id: <client_id>
Content-Type: application/json