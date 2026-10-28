const crypto = require("crypto");
const express = require("express");
const { getVerifiedMenuCategories } = require("./menu-catalog");
const permissions = require("./permissions");
const menuVideo = require("./menu-video");
const packageInfo = require("../package.json");

const sessionLifetimeMs = 4 * 60 * 60 * 1000;
const pairingTimeoutMs = 45 * 1000;
const loginAttempts = new Map();
const pairingAttempts = new Map();
const webSessions = new Map();
const accountIdPattern = /^(?:account|secondary)-\d+$/;

function digest(value) {
    return crypto.createHash("sha256").update(String(value)).digest();
}

function safeEqual(left, right) {
    return crypto.timingSafeEqual(digest(left), digest(right));
}

function rateLimit(store, key, limit, windowMs) {
    const now = Date.now();
    const previous = store.get(key);
    if (!previous || previous.resetAt <= now) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return false;
    }
    previous.count += 1;
    return previous.count > limit;
}

function maskPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) return "Unavailable";
    if (digits.length <= 6) return `${digits.slice(0, 1)}***`;
    return `${digits.slice(0, 3)}${"*".repeat(Math.max(3, digits.length - 5))}${digits.slice(-2)}`;
}

function normalizeInternationalNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return /^\d{7,15}$/.test(digits) ? digits : "";
}

function ownerJid() {
    const digits = String(process.env.OWNER_NUMBER || "").replace(/\D/g, "");
    return /^\d{7,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
}

function createPanelRouter({
    sessionManager,
    commandModules,
    getCommandGroups,
    canExecuteCommand,
    runtime,
    startedAt
}) {
    const router = express.Router();

    router.use((req, res, next) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Frame-Options", "DENY");
        next();
    });
    router.use(express.json({ limit: "16kb" }));

    function configurationReady() {
        return typeof process.env.PANEL_ADMIN_PASSWORD === "string" &&
            process.env.PANEL_ADMIN_PASSWORD.length >= 10 &&
            typeof process.env.PANEL_SESSION_SECRET === "string" &&
            process.env.PANEL_SESSION_SECRET.length >= 32;
    }

    function getCookie(req) {
        const cookieHeader = req.headers.cookie || "";
        const entry = cookieHeader.split(";").map(value => value.trim())
            .find(value => value.startsWith("anonymous_md_admin="));
        if (!entry) return null;
        const value = entry.slice("anonymous_md_admin=".length);
        const [id, signature] = value.split(".");
        if (!id || !signature) return null;
        const expected = crypto.createHmac("sha256", process.env.PANEL_SESSION_SECRET)
            .update(id).digest("hex");
        if (!safeEqual(signature, expected)) return null;
        return id;
    }

    function authenticatedSession(req) {
        if (!configurationReady()) return null;
        const id = getCookie(req);
        if (!id) return null;
        const session = webSessions.get(id);
        if (!session || session.expiresAt <= Date.now()) {
            webSessions.delete(id);
            return null;
        }
        return session;
    }

    function requireAdmin(req, res, next) {
        const session = authenticatedSession(req);
        if (!session) return res.status(401).json({ error: "Admin authentication required." });
        req.panelSession = session;
        next();
    }

    function requireCsrf(req, res, next) {
        const supplied = req.get("X-CSRF-Token") || "";
        if (!req.panelSession || !safeEqual(supplied, req.panelSession.csrfToken)) {
            return res.status(403).json({ error: "Request verification failed. Refresh the panel and try again." });
        }
        next();
    }

    function setSessionCookie(res, id) {
        const signature = crypto.createHmac("sha256", process.env.PANEL_SESSION_SECRET)
            .update(id).digest("hex");
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader(
            "Set-Cookie",
            `anonymous_md_admin=${id}.${signature}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${sessionLifetimeMs / 1000}${secure}`
        );
    }

    function clearSessionCookie(res) {
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        res.setHeader(
            "Set-Cookie",
            `anonymous_md_admin=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`
        );
    }

    router.get("/auth/session", (req, res) => {
        const session = authenticatedSession(req);
        res.json({
            configured: configurationReady(),
            authenticated: Boolean(session),
            csrfToken: session?.csrfToken || null
        });
    });

    router.get("/admin/sessions/:id", requireAdmin, (req, res) => {
        if (!accountIdPattern.test(req.params.id)) return res.status(400).json({ error: "Invalid session identifier." });
        const session = sessionManager.get(req.params.id);
        if (!session) return res.status(404).json({ error: "Session not found." });
        res.json({
            session: {
                id: session.id,
                type: session.type,
                number: maskPhone(session.number),
                status: session.status,
                lastConnectedAt: session.lastConnectedAt
            }
        });
    });

    router.post("/auth/login", (req, res) => {
        if (!configurationReady()) {
            return res.status(503).json({
                error: "Admin access is not configured. Set PANEL_ADMIN_PASSWORD (10+ characters) and PANEL_SESSION_SECRET (32+ characters), then restart the bot."
            });
        }
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        if (rateLimit(loginAttempts, ip, 8, 15 * 60 * 1000)) {
            return res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
        }
        const password = typeof req.body?.password === "string" ? req.body.password : "";
        if (!safeEqual(password, process.env.PANEL_ADMIN_PASSWORD)) {
            return res.status(401).json({ error: "Invalid admin password." });
        }
        loginAttempts.delete(ip);
        const id = crypto.randomBytes(32).toString("hex");
        const csrfToken = crypto.randomBytes(32).toString("base64url");
        webSessions.set(id, { csrfToken, expiresAt: Date.now() + sessionLifetimeMs });
        setSessionCookie(res, id);
        res.json({ authenticated: true, csrfToken });
    });

    router.post("/auth/logout", requireAdmin, requireCsrf, (req, res) => {
        const id = getCookie(req);
        if (id) webSessions.delete(id);
        clearSessionCookie(res);
        res.json({ authenticated: false });
    });

    router.get("/admin/overview", requireAdmin, (req, res) => {
        const accounts = sessionManager.list();
        const primaryId = sessionManager.getPrimaryId();
        const primary = accounts.find(account => account.id === primaryId);
        const memory = process.memoryUsage();
        res.json({
            status: primary?.status || "unavailable",
            uptime: typeof runtime === "function"
                ? runtime()
                : `${Math.floor((Date.now() - startedAt) / 1000)}s`,
            totalSessions: accounts.length,
            onlineNow: accounts.filter(account => account.status === "connected").length,
            memory: {
                rssBytes: memory.rss,
                heapUsedBytes: memory.heapUsed
            },
            commandCount: new Set(commandModules.flatMap(([, module]) =>
                Array.isArray(module?.commandNames) ? module.commandNames : []
            )).size,
            version: packageInfo.version,
            checkedAt: new Date().toISOString()
        });
    });

    router.get("/admin/commands", requireAdmin, (req, res) => {
        const commandGroups = getCommandGroups(commandModules, permissions.getSettings().prefix || ".");
        const contexts = [
            {
                isOwner: true,
                senderJid: "15550000000@s.whatsapp.net",
                jid: "15550000000@s.whatsapp.net"
            },
            {
                isOwner: true,
                senderJid: "15550000000@s.whatsapp.net",
                jid: "120363000000000000@g.us",
                isSenderAdmin: true,
                isBotAdmin: true
            }
        ];
        const categories = contexts.flatMap(context => getVerifiedMenuCategories({
            context,
            commandGroups,
            canExecuteCommand
        }));
        const unique = new Map();
        for (const category of categories) {
            for (const command of category.commands) {
                if (unique.has(command.name)) continue;
                const permission = category.audience === "owner"
                    ? "Owner"
                    : category.audience === "group-admin"
                        ? "Group Admin"
                        : "User";
                unique.set(command.name, {
                    ...command,
                    category: category.title,
                    permission,
                    availability: "Available"
                });
            }
        }
        res.json({ commands: [...unique.values()] });
    });

    router.get("/admin/sessions", requireAdmin, (req, res) => {
        res.json({
            sessions: sessionManager.list().map(session => ({
                id: session.id,
                type: session.type,
                number: maskPhone(session.number),
                status: session.status,
                lastConnectedAt: session.lastConnectedAt
            }))
        });
    });

    router.get("/admin/sessions/lookup", requireAdmin, (req, res) => {
        const number = normalizeInternationalNumber(req.query.number);
        if (!number) return res.status(400).json({ error: "Enter a full international number with country code." });
        const session = sessionManager.list().find(item =>
            String(item.number || "").replace(/\D/g, "") === number
        );
        if (!session) return res.status(404).json({ error: "No session was found for that number." });
        res.json({
            session: {
                id: session.id,
                type: session.type,
                number: maskPhone(session.number),
                status: session.status,
                lastConnectedAt: session.lastConnectedAt
            }
        });
    });

    router.post("/admin/sessions/pair", requireAdmin, requireCsrf, async (req, res, next) => {
        const number = normalizeInternationalNumber(req.body?.number);
        if (!number) return res.status(400).json({ error: "Enter a valid international phone number (7–15 digits)." });
        const ip = req.ip || req.socket.remoteAddress || "unknown";
        if (rateLimit(pairingAttempts, ip, 3, 60 * 60 * 1000)) {
            return res.status(429).json({ error: "Pairing is rate limited. Try again in one hour." });
        }

        const existing = sessionManager.list().find(session =>
            String(session.number || "").replace(/\D/g, "") === number
        );
        if (existing) {
            return res.status(409).json({
                error: `A ${existing.status} session already exists for this number. Use Manage My Session instead.`,
                sessionId: existing.id,
                status: existing.status
            });
        }
        if (sessionManager.list().some(session => session.status === "connecting")) {
            return res.status(409).json({ error: "Another session is already connecting. Wait for it to finish before pairing." });
        }

        let resolveCode;
        let rejectCode;
        const pairingCode = new Promise((resolve, reject) => {
            resolveCode = resolve;
            rejectCode = reject;
        });
        const pairingResult = pairingCode.then(
            code => ({ code }),
            error => ({ error })
        );
        let id;
        let timeout;
        try {
            id = await sessionManager.connect({
                number,
                method: "code",
                ownerJid: null,
                prefix: permissions.getSettings().prefix || ".",
                onPairingCode: resolveCode,
                onPairingError: rejectCode
            });
            timeout = setTimeout(() => rejectCode(new Error("Timed out while waiting for WhatsApp to issue a pairing code.")), pairingTimeoutMs);
            const result = await pairingResult;
            if (result.error) throw result.error;
            res.status(201).json({
                sessionId: id,
                pairingCode: result.code
            });
        } catch (error) {
            if (id) {
                try {
                    await sessionManager.cancelPendingSession(id);
                } catch (cancelError) {
                    console.error("[CONTROL PANEL] Could not cancel failed pairing session.", cancelError);
                }
            }
            if (/already active|already in progress/i.test(error.message)) {
                return res.status(409).json({ error: "Another session connection is already in progress." });
            }
            if (/connector is not available/i.test(error.message)) {
                return res.status(503).json({ error: "The bot session connector is unavailable. Restart the bot process and try again." });
            }
            const timedOut = /timed out/i.test(error.message);
            res.status(timedOut ? 504 : 502).json({
                error: timedOut
                    ? "WhatsApp did not issue a pairing code in time. Confirm the bot can reach WhatsApp and try again."
                    : "WhatsApp could not issue a pairing code. Check the number and bot connection, then try again."
            });
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    });

    router.post("/admin/sessions/clear", requireAdmin, requireCsrf, async (req, res, next) => {
        if (req.body?.confirm !== true) {
            return res.status(400).json({ error: "Explicit confirmation is required to clear all WhatsApp sessions." });
        }
        try {
            const result = await sessionManager.clearAllSessions();
            res.json({
                success: true,
                clearedSessions: result.clearedSessionIds.length,
                primarySessionId: result.primarySessionId
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/admin/sessions/:id/:action", requireAdmin, requireCsrf, async (req, res, next) => {
        const { id, action } = req.params;
        if (!accountIdPattern.test(id)) return res.status(400).json({ error: "Invalid session identifier." });
        const session = sessionManager.get(id);
        if (!session) return res.status(404).json({ error: "Session not found." });

        try {
            if (action === "reconnect") {
                await sessionManager.reconnect(id, ownerJid(), permissions.getSettings().prefix || ".");
            } else if (action === "disconnect") {
                await sessionManager.disconnect(id);
            } else if (action === "logout" || action === "remove") {
                if (req.body?.confirm !== true) {
                    return res.status(400).json({ error: "Explicit confirmation is required for this action." });
                }
                if (action === "logout") await sessionManager.logout(id);
                else await sessionManager.deleteSession(id);
            } else {
                return res.status(404).json({ error: "Unknown session action." });
            }
            res.json({ success: true, sessionId: id, action });
        } catch (error) {
            if (/already active|already in progress|no registered credentials|no linked credentials|unknown session|offline/i.test(error.message)) {
                const status = /unknown session/i.test(error.message) ? 404 : 409;
                return res.status(status).json({ error: error.message });
            }
            next(error);
        }
    });

    router.get("/admin/settings", requireAdmin, (req, res) => {
        const settings = permissions.getSettings();
        const videoSettings = menuVideo.getMenuVideoSettings();
        res.json({
            settings: {
                botName: settings.botName || "ANONYMOUS MD",
                prefix: settings.prefix || ".",
                mode: settings.mode || "public",
                menuVideoEnabled: videoSettings.enabled,
                menuVideoFile: videoSettings.filename
            }
        });
    });

    router.patch("/admin/settings", requireAdmin, requireCsrf, (req, res) => {
        const body = req.body || {};
        const changes = {};
        if ("botName" in body) {
            if (typeof body.botName !== "string" || body.botName.trim().length < 1 || body.botName.trim().length > 40) {
                return res.status(400).json({ error: "Bot name must contain 1–40 characters." });
            }
            changes.botName = body.botName.trim();
        }
        if ("prefix" in body) {
            if (typeof body.prefix !== "string" || body.prefix.length > 3 || !body.prefix || /[A-Za-z0-9\s]/.test(body.prefix)) {
                return res.status(400).json({ error: "Prefix must be 1–3 non-alphanumeric characters." });
            }
            changes.prefix = body.prefix;
        }
        if ("mode" in body) {
            if (!["public", "private"].includes(body.mode)) {
                return res.status(400).json({ error: "Mode must be public or private." });
            }
            changes.mode = body.mode;
        }
        if (!Object.keys(changes).length) return res.status(400).json({ error: "No supported settings were provided." });
        permissions.saveSettings({ ...permissions.getSettings(), ...changes });
        const saved = { ...permissions.getSettings(), ...changes };
        res.json({
            success: true,
            settings: {
                botName: saved.botName || "ANONYMOUS MD",
                prefix: saved.prefix || ".",
                mode: saved.mode || "public"
            }
        });
    });

    router.get("/admin/menu-videos", requireAdmin, (req, res) => {
        const settings = menuVideo.getMenuVideoSettings();
        res.json({
            selected: settings.filename,
            enabled: settings.enabled,
            videos: menuVideo.listMenuVideos().map(filename => {
                const video = menuVideo.resolveVideo(filename);
                return {
                    filename,
                    sizeBytes: video?.size || 0,
                    selected: filename === settings.filename
                };
            })
        });
    });

    router.get("/admin/menu-videos/:filename", requireAdmin, (req, res, next) => {
        const video = menuVideo.resolveVideo(req.params.filename);
        if (!video) return res.status(404).json({ error: "Video not found or unavailable." });
        res.type("video/mp4").sendFile(video.path, error => {
            if (error && !res.headersSent) next(error);
        });
    });

    router.post(
        "/admin/menu-videos",
        requireAdmin,
        requireCsrf,
        express.raw({ type: "video/mp4", limit: "64mb" }),
        (req, res) => {
            try {
                const filename = typeof req.query.filename === "string" ? req.query.filename : "";
                const saved = menuVideo.saveUploadedVideo(filename, req.body);
                res.status(201).json({ video: saved });
            } catch (error) {
                if (error.code === "EEXIST") {
                    return res.status(409).json({ error: "A video with that filename already exists." });
                }
                if (error.code) {
                    console.error("[CONTROL PANEL API] Video upload could not be saved.", error);
                    return res.status(500).json({ error: "The video could not be saved on the bot server." });
                }
                res.status(400).json({ error: error.message });
            }
        }
    );

    router.patch("/admin/menu-video", requireAdmin, requireCsrf, (req, res) => {
        const { enabled, filename } = req.body || {};
        const changes = {};
        if (typeof enabled === "boolean") changes.menuVideoEnabled = enabled;
        if (filename !== undefined) {
            if (!menuVideo.resolveVideo(filename)) {
                return res.status(400).json({ error: "Select an existing, valid MP4 file." });
            }
            changes.menuVideoFile = filename;
        }
        if (!Object.keys(changes).length) return res.status(400).json({ error: "Provide a video selection or enabled state." });
        menuVideo.saveMenuVideoSettings(changes);
        res.json({ success: true, ...menuVideo.getMenuVideoSettings() });
    });

    router.get("/admin/logs", requireAdmin, (req, res) => {
        res.status(501).json({ error: "Structured operational logs are not exposed by the current bot backend." });
    });

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error.type === "entity.too.large") return res.status(413).json({ error: "Request exceeds the allowed size." });
        if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON request body." });
        console.error("[CONTROL PANEL API] Request failed.", error);
        res.status(500).json({ error: "The control panel request failed." });
    });

    const pruneTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, session] of webSessions) {
            if (session.expiresAt <= now) webSessions.delete(id);
        }
        for (const [key, state] of loginAttempts) {
            if (state.resetAt <= now) loginAttempts.delete(key);
        }
        for (const [key, state] of pairingAttempts) {
            if (state.resetAt <= now) pairingAttempts.delete(key);
        }
    }, 60 * 60 * 1000);
    if (typeof pruneTimer.unref === "function") pruneTimer.unref();

    return router;
}

module.exports = {
    createPanelRouter,
    maskPhone,
    normalizeInternationalNumber
};
