# ANONYMOUS MD Control Panel

The control panel is served by the bot's existing Express process. Its React/Vite source is in `web/`; the production build is written to `public/`, which Express serves alongside the bot API. WhatsApp sessions continue to use the existing Baileys 6.7.24 session manager and `sessions/` storage.

## Build and run

```powershell
npm run build:web
npm start
```

For frontend development, run the bot server in one terminal and `npm run dev:web` in another. Vite proxies `/api` requests to `http://localhost:3000`.

## Public landing page and admin access

Opening the panel shows the public ANONYMOUS MD landing page first, even when an administrator session cookie already exists. `Pair Your Number` opens a dedicated pairing page with the phone-number form; it does not open the admin dashboard. If needed, administrator verification is requested on that page before the backend issues a code. Use the `Admin` button to open the control panel, or `Back to website` to return to the landing page.

## Secure admin setup

Set these server-side environment variables before exposing the panel:

- `PANEL_ADMIN_PASSWORD`: administrator password, at least 10 characters.
- `PANEL_SESSION_SECRET`: random secret, at least 32 characters.

Generate a session secret locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Do not put these values in frontend code or publish them. In production, serve the bot behind HTTPS. The admin cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` when `NODE_ENV=production`; state-changing APIs also require a CSRF token. Login attempts and pairing requests are rate limited. If either admin variable is missing or too short, the panel refuses admin sign-in and privileged API calls.

## Pairing and session safety

The panel requests pairing codes through the existing secondary-session connector, which calls Baileys `sock.requestPairingCode()` for the submitted international number. Codes are returned only to an authenticated admin request. Pairing uses the existing per-session auth directory and session registry; duplicate numbers, concurrent pending connections, and already-existing sessions are rejected rather than overwritten. New pairing requests time out using the bot's existing pending-session lifecycle.

Session lists and lookup responses contain masked phone numbers and connection metadata only. Reconnect, disconnect, logout, and removal actions are authorized on the server. Logout and permanent removal require explicit confirmation; individual primary-session removal remains blocked by the session manager. The admin sessions page also provides a confirmed bulk clear that disconnects every account and deletes all saved WhatsApp credentials, including the primary account's. The primary account identity is retained so the bot can be paired again after restarting. The pairing interface does not use or display QR codes.

The video library lists and streams only validated MP4 files beneath the configured `videos/` directory. Uploads are admin-only, limited to 64 MB, checked for an MP4 file signature, and never overwrite an existing file. `.menu` and `.menu2` send one text message with dynamic system details and all commands visible to the requesting user, grouped and styled by category. Menu videos are not attached; owners can still select and preview an MP4 with the video commands.

## Current backend coverage

Live overview, command catalog, settings, sessions, pairing, and video-library APIs use existing bot state and handlers. The command catalog is built from the bot's curated verified menu catalog. Structured log retrieval is not implemented in the bot, so the panel reports it as unavailable instead of displaying invented events.

Live WhatsApp pairing still requires a reachable bot process and a working WhatsApp connection. Automated tests verify API authorization and callback wiring, but do not perform a real WhatsApp link.
