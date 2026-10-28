const { loadEnvFile } = require("./lib/auth");
loadEnvFile();

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} = require("@whiskeysockets/baileys");

const QRCode = require("qrcode");
const P = require("pino");
const readline = require("readline");

const {
    canExecuteCommand,
    commandModules,
    handleCommand
} = require("./lib/command-handler");
const { handleSilencedMessage } = require("./commands/group");
const { getCommandGroups } = require("./commands/core");
const { getSettings } = require("./lib/permissions");
const { isOwner, safeJidForLog } = require("./lib/auth");
const createMessageDeduplicator = require("./lib/message-dedupe");
const interactiveMenu = require("./lib/interactive-menu");
const sessionManager = require("./lib/session-manager");
const { createPanelRouter } = require("./lib/control-panel-api");

const BOT_NAME = "ANONYMOUS MD";
const PREFIX = ".";

// ==========================================
// EXPRESS & SOCKET.IO SETUP
// ==========================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.disable("x-powered-by");
app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
});
app.use("/api", createPanelRouter({
    sessionManager,
    commandModules,
    getCommandGroups,
    canExecuteCommand,
    runtime,
    startedAt: Date.now()
}));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[WEB SERVER] Portal running on port ${PORT}`);
});

io.on("connection", (socket) => {
    console.log("[WEB SOCKET] Web client connected to dashboard.");
});

// ==========================================
// ACCOUNT & READLINE
// ==========================================

const defaultAccountId = process.argv[2] || "account-1";
sessionManager.getPrimaryId(defaultAccountId);

function primaryAccountId() {
    return sessionManager.getPrimaryId(defaultAccountId);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

// ==========================================
// RUNTIME
// ==========================================

const startTime = Date.now();
const activeSockets = new Map();
const intentionalStops = new Set();
const connectionTimers = new Map();
const reconnectTimers = new Map();
const isDuplicateMessage = createMessageDeduplicator();

async function notifyOwner(jid, payload) {
    const primarySocket = activeSockets.get(primaryAccountId());
    if (!primarySocket) {
        throw new Error("The primary WhatsApp session is not available for private delivery.");
    }
    await primarySocket.sendMessage(jid, payload);
}

function runtime() {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function clearReconnectTimer(accountName) {
    const timer = reconnectTimers.get(accountName);
    if (!timer) return;
    clearTimeout(timer);
    reconnectTimers.delete(accountName);
}

function scheduleReconnect(accountName, options, delay) {
    clearReconnectTimer(accountName);
    if (!sessionManager.shouldAutoReconnect(accountName)) return;

    const timer = setTimeout(() => {
        reconnectTimers.delete(accountName);
        if (!sessionManager.shouldAutoReconnect(accountName)) return;
        startBot(accountName, options).catch(error => {
            console.error(`[${accountName}] Reconnect error:`, error.message);
        });
    }, delay);
    reconnectTimers.set(accountName, timer);
}

// ==========================================
// START BOT
// ==========================================

async function startBot(accountName = "account-1", options = {}) {
    clearReconnectTimer(accountName);
    console.log("");
    console.log("================================");
    console.log(`      ${BOT_NAME}`);
    console.log(`      ${accountName.toUpperCase()}`);
    console.log("================================");
    console.log("");

   const fs = require("fs");

const sessionPath = sessionManager.sessionDirectory(accountName);

fs.mkdirSync(sessionPath, {
    recursive: true,
    mode: 0o700
});
if (process.platform !== "win32") {
    fs.chmodSync(sessionPath, 0o700);
}

console.log(
    `[${accountName}] Session path: ${sessionPath}`
);

const { state, saveCreds } =
await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        version,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        printQRInTerminal: false,
        logger: P({ level: "silent" }),
        getMessage: async (key) => {
            return { conversation: "" };
        }
    });

    activeSockets.set(accountName, sock);
    if (options.secondary) {
        sessionManager.attachSocket(accountName, sock);
    } else {
        sessionManager.registerPrimary(accountName, sock);
    }

    sock.ev.on("creds.update", saveCreds);

    let isPairingRequested = false;
    let isQrRendered = false;
    const PAIRING_MODE = options.secondary
        ? options.method === "code"
        : true;

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection) {
            console.log(`[${accountName}] [WHATSAPP] ${connection}`);
            if (accountName === primaryAccountId()) io.emit("status", connection);
        }

        if (
            options.secondary &&
            PAIRING_MODE &&
            !sock.authState.creds.registered &&
            !isPairingRequested
        ) {
            isPairingRequested = true;
            try {
                await new Promise(resolve => setTimeout(resolve, 3000));
                const pendingSession = sessionManager.get(accountName);
                if (!pendingSession || pendingSession.cancelled) return;
                const pairingCode = await sock.requestPairingCode(options.number);
                if (sessionManager.get(accountName)?.cancelled) return;
                if (typeof options.onPairingCode === "function") {
                    options.onPairingCode(pairingCode);
                } else {
                    await notifyOwner(options.ownerJid, {
                        text:
                            `🔐 Pairing code for ${accountName}: *${pairingCode}*\n\n` +
                            "On the new phone, open WhatsApp > Linked devices > Link a device > Link with phone number. " +
                            "Enter this code only in WhatsApp and do not share it.\n\n" +
                            `This code expires. Use ${options.prefix || "."}cancelconnect to cancel.`
                    });
                }
            } catch (error) {
                console.error(`[${accountName}] [PAIRING REQUEST FAILED]`, error.message);
                if (typeof options.onPairingError === "function") {
                    options.onPairingError(error);
                } else {
                    try {
                        await notifyOwner(options.ownerJid, {
                            text: "❌ WhatsApp could not create a pairing code. Check the number and try again."
                        });
                    } catch (sendError) {
                        console.error(`[${accountName}] [PRIVATE PAIRING NOTICE FAILED]`, sendError.message);
                    }
                }
                await sessionManager.cancelPendingSession(accountName);
            }
        }

        // The primary account retains its existing terminal-based first-link flow.
        if (!options.secondary && PAIRING_MODE && !sock.authState.creds.registered && !isPairingRequested) {
            isPairingRequested = true;

            try {
                let phoneNumber = process.env.PHONE_NUMBER;

                if (!phoneNumber) {
                    const number = await ask(
                        `[${accountName}] Enter WhatsApp number (example: 2348012345678): `
                    );
                    phoneNumber = number.replace(/\D/g, "");
                }

                if (!phoneNumber) {
                    console.log(`[${accountName}] Invalid phone number.`);
                    return;
                }

                console.log("");
                console.log(`[${accountName}] Requesting pairing code...`);
                console.log("");

                await new Promise((resolve) => setTimeout(resolve, 3000));

                const pairingCode = await sock.requestPairingCode(phoneNumber);

                console.log("");
                console.log("================================");
                console.log(`       ${BOT_NAME}`);
                console.log(`       ${accountName.toUpperCase()}`);
                console.log("       PAIRING CODE");
                console.log("================================");
                console.log("");
                process.stdout.write(`          ${pairingCode}\n`);
                console.log("");

                console.log("================================");
                console.log("");

            } catch (error) {
                console.log("");
                console.log(`[${accountName}] PAIRING ERROR:`);
                console.log(error);
                console.log("");
            }
        }

        if (qr && (options.method === "qr" || (!options.secondary && !PAIRING_MODE))) {
            if (options.secondary) {
                if (sessionManager.get(accountName)?.cancelled) return;
                if (!isQrRendered) {
                    isQrRendered = true;
                    try {
                        const image = await QRCode.toBuffer(qr, { type: "png" });
                        await notifyOwner(options.ownerJid, {
                            image,
                            caption:
                                `Scan to link ${accountName}: WhatsApp > Linked devices > Link a device. ` +
                                "This QR is private and expires; do not forward it."
                        });
                    } catch (error) {
                        console.error(`[${accountName}] [PRIVATE QR DELIVERY FAILED]`, error.message);
                        try {
                            await notifyOwner(options.ownerJid, {
                                text: "❌ Could not deliver the QR privately. Use .connectnumber <number> for a private pairing code."
                            });
                        } catch (sendError) {
                            console.error(`[${accountName}] [QR FAILURE NOTICE FAILED]`, sendError.message);
                        }
                        await sessionManager.cancelPending(options.ownerJid);
                    }
                }
            }
        }

        if (connection === "open") {
            console.log("");
            console.log("================================");
            console.log(`   ${BOT_NAME} ONLINE`);
            console.log(`   ACCOUNT: ${accountName}`);
            console.log("================================");
            console.log("");
            if (accountName === primaryAccountId()) io.emit("status", "connected");
            let persistenceFailed = false;
            try {
                sessionManager.markConnected(accountName, sock);
            } catch (error) {
                persistenceFailed = true;
                console.error(`[${accountName}] [SESSION REGISTRY SAVE FAILED]`, error);
            }
            const timer = connectionTimers.get(accountName);
            if (timer) {
                clearTimeout(timer);
                connectionTimers.delete(accountName);
            }
            if (options.ownerJid) {
                try {
                    await notifyOwner(options.ownerJid, {
                        text: persistenceFailed
                            ? `⚠️ Session ${accountName} connected, but its registry could not be saved. It may not reconnect automatically after a restart.`
                            : `✅ WhatsApp session ${accountName} connected successfully.`
                    });
                } catch (error) {
                    console.error(`[${accountName}] [CONNECTION NOTICE FAILED]`, error.message);
                }
            }

            if (getSettings().alwaysonline && typeof sock.sendPresenceUpdate === "function") {
                await sock.sendPresenceUpdate("available");
            }
        }

        if (connection === "close") {
            if (typeof options.onPairingError === "function") {
                options.onPairingError(new Error("WhatsApp disconnected before completing the pairing request."));
            }
            const statusCode =
                lastDisconnect?.error?.output?.statusCode;

            console.log(
                `[${accountName}] Connection closed: ${statusCode || "unknown"}`
            );
            activeSockets.delete(accountName);
            const pairingTimer = connectionTimers.get(accountName);
            if (pairingTimer) {
                clearTimeout(pairingTimer);
                connectionTimers.delete(accountName);
            }

            if (intentionalStops.has(accountName)) {
                intentionalStops.delete(accountName);
                sessionManager.markDisconnected(accountName);
                return;
            }

            // Logged out / unauthorized.
            // Keep the session files intact instead of deleting them automatically.
            if (
                statusCode === DisconnectReason.loggedOut ||
                statusCode === 401
            ) {
                console.log(
                    `[${accountName}] WhatsApp session is logged out or unauthorized.`
                );
                console.log(
                    `[${accountName}] Session files were NOT deleted.`
                );
                sessionManager.markDisconnected(accountName, "logged-out");
                return;
            }

            // 440 = connection replaced by another WhatsApp session.
            if (
                statusCode === DisconnectReason.connectionReplaced ||
                statusCode === 440
            ) {
                console.log(
                    `[${accountName}] Connection was replaced by another WhatsApp session.`
                );
                console.log(
                    `[${accountName}] Reconnect stopped to avoid competing sockets.`
                );
                sessionManager.markDisconnected(accountName, "replaced");
                return;
            }

            // WhatsApp requested a restart.
            if (
                statusCode === DisconnectReason.restartRequired
            ) {
                console.log(
                    `[${accountName}] Restart requested.`
                );

                sessionManager.markDisconnected(accountName, "disconnected");
                scheduleReconnect(accountName, options, 1000);

                return;
            }

            // Other temporary connection failures.
            console.log(
                `[${accountName}] Reconnecting in 5 seconds...`
            );
            sessionManager.markDisconnected(accountName, "disconnected");
            scheduleReconnect(accountName, options, 5000);
        }
    });

    if (
        options.secondary &&
        options.method !== "resume" &&
        !sock.authState.creds.registered
    ) {
        const timer = setTimeout(async () => {
            const session = sessionManager.get(accountName);
            if (!session || session.status !== "connecting") return;
            await sessionManager.cancelPending(options.ownerJid);
            try {
                if (options.ownerJid) {
                    await notifyOwner(options.ownerJid, {
                        text: `⌛ Account linking timed out. Start again with ${options.prefix || "."}connect or ${options.prefix || "."}connectnumber.`
                    });
                }
            } catch (error) {
                console.error(`[${accountName}] [TIMEOUT NOTICE FAILED]`, error.message);
            }
        }, 2 * 60 * 1000);
        connectionTimers.set(accountName, timer);
    }

    sock.ev.on("call", async (calls) => {
        if (!getSettings().anticall || typeof sock.rejectCall !== "function") return;

        for (const call of calls || []) {
            if (!call?.id || !call?.from) continue;

            try {
                await sock.rejectCall(call.id, call.from);
            } catch (error) {
                console.error(`[${accountName}] [ANTICALL ERROR]`, error);
            }
        }
    });

    // ==========================================
    // MESSAGE HANDLER
    // ==========================================

    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            for (const msg of messages) {
                if (!msg || !msg.message) continue;
                if (isDuplicateMessage(msg)) continue;

                const jid = msg.key.remoteJid;
                if (!jid) continue;

                const runtimeSettings = getSettings();
                const activePrefix = runtimeSettings.prefix || PREFIX;
                if (jid === "status@broadcast") {
                    if (runtimeSettings.autoviewstatus && typeof sock.readMessages === "function") {
                        try {
                            await sock.readMessages([msg.key]);
                        } catch (error) {
                            console.error(`[${accountName}] [STATUS READ ERROR]`, error);
                        }
                    }
                    continue;
                }

                if (runtimeSettings.autoread && typeof sock.readMessages === "function") {
                    try {
                        await sock.readMessages([msg.key]);
                    } catch (error) {
                        console.error(`[${accountName}] [AUTOREAD ERROR]`, error);
                    }
                }

                if (runtimeSettings.autotyping && typeof sock.sendPresenceUpdate === "function") {
                    try {
                        await sock.sendPresenceUpdate("composing", jid);
                    } catch (error) {
                        console.error(`[${accountName}] [AUTOTYPING ERROR]`, error);
                    }
                } else if (runtimeSettings.autorecording && typeof sock.sendPresenceUpdate === "function") {
                    try {
                        await sock.sendPresenceUpdate("recording", jid);
                    } catch (error) {
                        console.error(`[${accountName}] [AUTORECORDING ERROR]`, error);
                    }
                }

                if (runtimeSettings.autoreact && !msg.key.fromMe && typeof sock.sendMessage === "function") {
                    try {
                        await sock.sendMessage(jid, {
                            react: { text: runtimeSettings.autoreactEmoji || "👍", key: msg.key }
                        });
                    } catch (error) {
                        console.error(`[${accountName}] [AUTOREACT ERROR]`, error);
                    }
                }

                const senderJid = msg.key.participant || msg.key.remoteJid;

                if (await handleSilencedMessage(sock, msg, jid, senderJid)) {
                    continue;
                }

                let text = "";
                if (msg.message.conversation) {
                    text = msg.message.conversation;
                } else if (msg.message.extendedTextMessage) {
                    text = msg.message.extendedTextMessage.text || "";
                } else if (msg.message.imageMessage) {
                    text = msg.message.imageMessage.caption || "";
                } else if (msg.message.videoMessage) {
                    text = msg.message.videoMessage.caption || "";
                }

                text = text.trim();
                const menuContext = {
                    sock,
                    msg,
                    jid,
                    senderJid,
                    accountName,
                    prefix: activePrefix,
                    runtime,
                    botName: BOT_NAME,
                    commandModules,
                    sessionInfo: {
                        id: accountName,
                        type: sessionManager.get(accountName)?.type ||
                            (accountName === primaryAccountId() ? "primary" : "secondary"),
                        status: sessionManager.get(accountName)?.status || "connected",
                        number: (() => {
                            const number = sessionManager.get(accountName)?.number ||
                                sock.user?.id?.split("@")[0]?.split(":")[0] || "";
                            return /^\d{7,15}$/.test(number) ? number : "";
                        })()
                    },
                    isOwner: isOwner(senderJid, {
                        msg,
                        fromMe: Boolean(msg.key.fromMe),
                        sock
                    })
                };
                const handledAsMenuReply = await interactiveMenu.handleIncoming(menuContext, {
                    getCommandGroups,
                    canExecuteCommand,
                    dispatchCommand: handleCommand
                });
                if (handledAsMenuReply) continue;
                if (!text) continue;

                console.log("");
                console.log("================================");
                console.log(`[${accountName}] [MESSAGE RECEIVED]`);
                console.log(`From: ${safeJidForLog(jid)}`);
                console.log("================================");

                if (!text.startsWith(activePrefix)) {
                    const lower = text.toLowerCase();
                    if (lower === "hi" || lower === "hello" || lower === "hey") {
                        await sock.sendMessage(jid, {
                            text:
                                `Hello 👋\n\n` +
                                `I'm *${BOT_NAME}*.\n\n` +
                                `Type *.menu* to see my commands.`
                        });
                    }
                    continue;
                }

                const commandLine = text.slice(activePrefix.length).trim();
                const parts = commandLine.split(/\s+/);
                const command = parts.shift()?.toLowerCase();
                const args = parts;
                const session = sessionManager.get(accountName);
                const sessionNumber = session?.number || sock.user?.id?.split("@")[0]?.split(":")[0] || "";

                console.log(`[${accountName}] [COMMAND] ${command}`);

                const handled = await handleCommand({
                    sock,
                    msg,
                    command,
                    args,
                    jid,
                    senderJid,
                    fromMe: Boolean(msg.key.fromMe),
                    accountName,
                    botName: BOT_NAME,
                    prefix: activePrefix,
                    runtime,
                    sessionInfo: {
                        id: accountName,
                        type: session?.type || (accountName === primaryAccountId() ? "primary" : "secondary"),
                        status: session?.status || "connected",
                        number: /^\d{7,15}$/.test(sessionNumber) ? sessionNumber : ""
                    },
                    commandModules: undefined,
                    downloadMediaMessage
                });
                if (handled) continue;

                if (command === "ping") {
                    const start = Date.now();
                    await sock.sendMessage(jid, { text: "🏓 PONG!" });
                    const speed = Date.now() - start;
                    await sock.sendMessage(jid, { text: `⚡ Response: ${speed}ms` });
                    continue;
                }

                if (command === "alive") {
                    await sock.sendMessage(jid, {
                        text:
                            `🟢 *${BOT_NAME} IS ALIVE*\n\n` +
                            `⚡ System: Online\n` +
                            `🤖 Bot: Running\n` +
                            `📱 Account: ${accountName}\n` +
                            `⏱️ Runtime: ${runtime()}`
                    });
                    continue;
                }

                if (command === "owner") {
                    await sock.sendMessage(jid, {
                        text: `👑 *BOT OWNER*\n\nAnonymous`
                    });
                    continue;
                }

                if (command === "runtime") {
                    await sock.sendMessage(jid, {
                        text: `⏱️ *ANONYMOUS MD RUNTIME*\n\n${runtime()}`
                    });
                    continue;
                }

                if (command === "joke") {
                    const jokes = [
                        "Why do programmers prefer dark mode? Because light attracts bugs 😂",
                        "My code works. Don't touch it 😭",
                        "There are 10 types of people: those who understand binary and those who don't 😂",
                        "A programmer is a machine that turns coffee into code ☕😂",
                        "Debugging: removing the needles from the haystack 🥲"
                    ];
                    const joke = jokes[Math.floor(Math.random() * jokes.length)];
                    await sock.sendMessage(jid, { text: joke });
                    continue;
                }

                if (command === "ship") {
                    const percentage = Math.floor(Math.random() * 101);
                    await sock.sendMessage(jid, {
                        text: `💘 *SHIP METER*\n\nCompatibility: *${percentage}%*`
                    });
                    continue;
                }

                if (command === "8ball") {
                    const answers = [
                        "Yes.", "No.", "Definitely.", "Probably.",
                        "Ask again later.", "I don't think so.",
                        "Absolutely.", "The signs are unclear.", "100% yes 😂"
                    ];
                    const answer = answers[Math.floor(Math.random() * answers.length)];
                    await sock.sendMessage(jid, {
                        text: `🎱 *8 BALL*\n\n${answer}`
                    });
                    continue;
                }

                if (command === "say") {
                    if (!args.length) {
                        await sock.sendMessage(jid, { text: "Usage:\n.say hello world" });
                        continue;
                    }
                    await sock.sendMessage(jid, { text: args.join(" ") });
                    continue;
                }

                if (command === "calc") {
                    if (!args.length) {
                        await sock.sendMessage(jid, { text: "Usage:\n.calc 50*20" });
                        continue;
                    }
                    const expression = args.join("");
                    if (!/^[0-9+\-*/().% ]+$/.test(expression)) {
                        await sock.sendMessage(jid, { text: "❌ Invalid calculation." });
                        continue;
                    }
                    try {
                        const result = Function(`"use strict"; return (${expression})`)();
                        await sock.sendMessage(jid, {
                            text: `🧮 *CALCULATOR*\n\n${expression} = *${result}*`
                        });
                    } catch {
                        await sock.sendMessage(jid, { text: "❌ Couldn't calculate that." });
                    }
                    continue;
                }

                if (["groupinfo", "admins", "tagall", "promote", "demote", "kick"].includes(command)) {
                    if (!jid.endsWith("@g.us")) {
                        await sock.sendMessage(jid, { text: "❌ This command only works in groups." });
                        continue;
                    }
                }

                if (command === "groupinfo") {
                    const metadata = await sock.groupMetadata(jid);
                    const admins = metadata.participants.filter(
                        (p) => p.admin === "admin" || p.admin === "superadmin"
                    );
                    await sock.sendMessage(jid, {
                        text:
                            `👥 *GROUP INFO*\n\n` +
                            `📛 Name: ${metadata.subject}\n` +
                            `👤 Members: ${metadata.participants.length}\n` +
                            `👑 Admins: ${admins.length}`
                    });
                    continue;
                }

                if (command === "admins") {
                    const metadata = await sock.groupMetadata(jid);
                    const admins = metadata.participants.filter(
                        (p) => p.admin === "admin" || p.admin === "superadmin"
                    );
                    let message = "👑 *GROUP ADMINS*\n\n";
                    for (const admin of admins) {
                        message += `• @${admin.id.split("@")[0]}\n`;
                    }
                    const mentions = admins.map((admin) => admin.id);
                    await sock.sendMessage(jid, { text: message, mentions });
                    continue;
                }

                if (command === "tagall") {
                    const metadata = await sock.groupMetadata(jid);
                    const participants = metadata.participants;
                    let message = "📢 *ANONYMOUS MD TAG ALL*\n\n";
                    const mentions = [];
                    for (const member of participants) {
                        message += `@${member.id.split("@")[0]} `;
                        mentions.push(member.id);
                    }
                    await sock.sendMessage(jid, { text: message, mentions });
                    continue;
                }

                function getTarget() {
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                    if (mentioned?.length) return mentioned[0];
                    if (args[0]) {
                        const number = args[0].replace(/\D/g, "");
                        if (number) return `${number}@s.whatsapp.net`;
                    }
                    return null;
                }

                if (command === "promote") {
                    const target = getTarget();
                    if (!target) {
                        await sock.sendMessage(jid, { text: "Usage:\n.promote @user" });
                        continue;
                    }
                    try {
                        await sock.groupParticipantsUpdate(jid, [target], "promote");
                        await sock.sendMessage(jid, {
                            text: `👑 @${target.split("@")[0]} is now an admin.`,
                            mentions: [target]
                        });
                    } catch {
                        await sock.sendMessage(jid, {
                            text: "❌ I couldn't promote that user. Make sure I'm a group admin."
                        });
                    }
                    continue;
                }

                if (command === "demote") {
                    const target = getTarget();
                    if (!target) {
                        await sock.sendMessage(jid, { text: "Usage:\n.demote @user" });
                        continue;
                    }
                    try {
                        await sock.groupParticipantsUpdate(jid, [target], "demote");
                        await sock.sendMessage(jid, {
                            text: `⬇️ @${target.split("@")[0]} is no longer an admin.`,
                            mentions: [target]
                        });
                    } catch {
                        await sock.sendMessage(jid, {
                            text: "❌ I couldn't demote that user. Make sure I'm a group admin."
                        });
                    }
                    continue;
                }

                if (command === "kick") {
                    const target = getTarget();
                    if (!target) {
                        await sock.sendMessage(jid, { text: "Usage:\n.kick @user" });
                        continue;
                    }
                    try {
                        await sock.groupParticipantsUpdate(jid, [target], "remove");
                        await sock.sendMessage(jid, {
                            text: `🚪 @${target.split("@")[0]} has been removed.`,
                            mentions: [target]
                        });
                    } catch {
                        await sock.sendMessage(jid, {
                            text: "❌ I couldn't remove that user. Make sure I'm a group admin."
                        });
                    }
                    continue;
                }

                await sock.sendMessage(jid, {
                    text:
                        `❌ Unknown command: *${PREFIX}${command}*\n\n` +
                        `Type *.menu* to see available commands.`
                });
            }
        } catch (error) {
            console.log("");
            console.log(`[${accountName}] [MESSAGE ERROR]`);
            console.log(error);
            console.log("");
        }
    });
}

sessionManager.configure({
    startAccount: async ({ id, number, method, ownerJid, prefix, onPairingCode, onPairingError }) => {
        await startBot(id, {
            secondary: id !== primaryAccountId(),
            number,
            method,
            ownerJid,
            prefix,
            onPairingCode,
            onPairingError
        });
    },
    stopAccount: async id => {
        clearReconnectTimer(id);
        const sock = activeSockets.get(id);
        if (!sock) return;
        intentionalStops.add(id);
        const timer = connectionTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            connectionTimers.delete(id);
        }
        if (typeof sock.end === "function") {
            sock.end(new Error("Session disconnected by owner."));
        } else if (sock.ws && typeof sock.ws.close === "function") {
            sock.ws.close();
        } else {
            throw new Error("Baileys socket does not expose a supported close method.");
        }
    },
    logoutAccount: async id => {
        const sock = activeSockets.get(id);
        if (!sock || typeof sock.logout !== "function") {
            throw new Error("Baileys socket does not expose a supported logout method.");
        }
        const timer = connectionTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            connectionTimers.delete(id);
        }
        clearReconnectTimer(id);
        await sock.logout("Session logged out by owner.");
    }
});

// ==========================================
// START PRIMARY AND SAVED SECONDARY ACCOUNTS
// ==========================================

async function startAccounts() {
    const primaryId = primaryAccountId();
    if (sessionManager.shouldStartOnBoot(primaryId)) {
        try {
            await startBot(primaryId, { secondary: false });
        } catch (error) {
            console.error(`[${primaryId}] [SESSION START ERROR]`, error.message);
            sessionManager.markDisconnected(primaryId, "error");
        }
    } else {
        console.log(`[${primaryId}] Primary session is disabled; use .reconnect ${primaryId} to start it.`);
    }
    for (const account of sessionManager.getRestorableAccounts()) {
        if (account.id === primaryId) continue;
        startBot(account.id, {
            secondary: true,
            number: account.number,
            method: "resume"
        }).catch(error => {
            console.error(`[${account.id}] [SESSION RESTORE ERROR]`, error.message);
            sessionManager.markDisconnected(account.id, "disconnected");
        });
    }
}

startAccounts().catch((error) => {
    console.error("");
    console.error("FATAL BOT ERROR:");
    console.error(error);
    console.error("");
});