const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isOwner, saveSettings } = require("../lib/permissions");
const {
    approveUser,
    unapproveUser,
    getApprovedUsers
} = require("../lib/auth");

const dataDirectory = path.join(__dirname, "../data");
const settingsPath = path.join(dataDirectory, "settings.json");
const sudoPath = path.join(dataDirectory, "sudo.json");
const tempDirectory = path.join(__dirname, "../temp");

const ownerCommands = [
    "approve", "unapprove", "listapproved",
    "setalive", "setsudo", "delsudo", "listsudo", "block", "unblock",
    "listblocked", "setpp", "delpp", "setppname", "setbio", "getpp",
    "getname", "pinchat", "unpinchat", "join", "joinch", "leave",
    "broadcast", "broadcast2", "save", "sendgclink", "reactch", "idch",
    "checkidch", "autotyping", "autorecording", "autoread",
    "autoviewstatus", "alwaysonline", "autoreact", "anticall", "listgc",
    "totalcmd", "totalmembers", "membercount", "mblock", "mbsearch"
];

const settingsDefaults = {
    botName: "ANONYMOUS MD",
    prefix: ".",
    owner: "Anonymous",
    sudo: [],
    aliveMessage: "ANONYMOUS MD ONLINE",
    autoread: false,
    autotyping: false,
    autorecording: false,
    autoviewstatus: false,
    alwaysonline: false,
    autoreact: false,
    autoreactEmoji: "\u{1F44D}",
    anticall: false,
    broadcastTargets: []
};

function readJson(filePath, fallback) {
    try {
        const content = fs.readFileSync(filePath, "utf8").trim();
        return content ? JSON.parse(content) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 4), "utf8");
    fs.renameSync(temporaryPath, filePath);
}

function loadSettings() {
    const settings = {
        ...settingsDefaults,
        ...readJson(settingsPath, {})
    };

    if (!Array.isArray(settings.sudo)) settings.sudo = [];
    if (!Array.isArray(settings.broadcastTargets)) settings.broadcastTargets = [];
    return settings;
}

function updateSettings(changes) {
    const settings = loadSettings();
    saveSettings({ ...settings, ...changes });
}

function loadSudo() {
    const value = readJson(sudoPath, { sudo: [] });
    const list = Array.isArray(value) ? value : value.sudo;
    return Array.isArray(list) ? list : [];
}

function saveSudo(list) {
    writeJson(sudoPath, { sudo: [...new Set(list)] });
}

function normalizeNumber(value) {
    const number = String(value || "").replace(/\D/g, "");
    return number.length >= 7 && number.length <= 15 ? number : null;
}

function numberFromJid(jid) {
    return normalizeNumber(String(jid || "").split("@")[0]);
}

function maskNumber(value) {
    const number = normalizeNumber(value);
    return number ? `+${number.slice(0, 2)}***${number.slice(-2)}` : "unavailable";
}

function targetJid(context) {
    const mentioned = context.msg.message?.extendedTextMessage?.contextInfo
        ?.mentionedJid?.[0];
    return mentioned || context.args[0] || "";
}

function targetNumber(context) {
    return normalizeNumber(numberFromJid(targetJid(context)) || context.args[0]);
}

function approvedNumber(context) {
    return targetNumber(context);
}

function botJid(sock) {
    return sock.user?.id?.split(":")[0] || sock.user?.id || "me";
}

function unsupported(sock, jid) {
    return sock.sendMessage(jid, {
        text: "\u274C This feature is not supported by the current Baileys version."
    });
}

async function ownerOnly(context) {
    if (context.isOwner || isOwner(context.senderJid, context)) return true;

    await context.sock.sendMessage(context.jid, {
        text: "\u274C This owner command is restricted to the configured bot owner."
    });
    return false;
}

function toggle(args) {
    if (!args[0]) return null;
    if (args[0].toLowerCase() === "on") return true;
    if (args[0].toLowerCase() === "off") return false;
    return null;
}

function quotedMedia(msg) {
    const message = msg.message;
    const mediaTypes = [
        "imageMessage", "videoMessage", "audioMessage",
        "documentMessage", "stickerMessage"
    ];

    if (mediaTypes.some((type) => message?.[type])) {
        return { key: msg.key, message };
    }

    const info = message?.extendedTextMessage?.contextInfo;
    if (!info?.quotedMessage) return null;

    return {
        key: {
            remoteJid: msg.key.remoteJid,
            id: info.stanzaId,
            participant: info.participant
        },
        message: info.quotedMessage
    };
}

function mediaExtension(message) {
    if (message?.imageMessage) return "jpg";
    if (message?.videoMessage) return "mp4";
    if (message?.audioMessage) return "ogg";
    if (message?.stickerMessage) return "webp";
    return "bin";
}

async function downloadMedia(context, media) {
    if (typeof context.downloadMediaMessage !== "function") return null;
    return context.downloadMediaMessage(media, "buffer", {});
}

function groupEntries(groups) {
    return Object.entries(groups || {}).map(([id, group]) => ({
        id,
        subject: group.subject || "Unnamed group",
        participants: Array.isArray(group.participants) ? group.participants : []
    }));
}

async function handleCommand(context) {
    const { command, args, jid, msg, sock } = context;
    if (!ownerCommands.includes(command)) return false;
    if (!(await ownerOnly(context))) return true;

    try {
        switch (command) {
            case "approve":
            case "unapprove": {
                const number = approvedNumber(context);
                if (!number) {
                    await sock.sendMessage(jid, {
                        text: `Usage: .${command} @user or .${command} <number>`
                    });
                    return true;
                }

                const target = `${number}@s.whatsapp.net`;
                const changed = command === "approve"
                    ? approveUser(target)
                    : unapproveUser(target);
                await sock.sendMessage(jid, {
                    text: changed
                        ? command === "approve"
                            ? "✅ User approved successfully."
                            : "✅ User access removed."
                        : "❌ Invalid WhatsApp user identifier."
                });
                return true;
            }

            case "listapproved": {
                const users = getApprovedUsers();
                const list = users.length
                    ? users.map(user => `• ${maskNumber(user)}`).join("\n")
                    : "No approved users configured.";
                await sock.sendMessage(jid, {
                    text: `APPROVED USERS\n\n${list}`
                });
                return true;
            }

            case "setalive": {
                const message = args.join(" ").trim();
                if (!message) {
                    await sock.sendMessage(jid, { text: "Usage: .setalive <text>" });
                    return true;
                }
                updateSettings({ aliveMessage: message });
                await sock.sendMessage(jid, { text: "\u2705 Alive message updated." });
                return true;
            }

            case "setsudo":
            case "delsudo": {
                const number = targetNumber(context);
                if (!number) {
                    await sock.sendMessage(jid, { text: `Usage: .${command} @user` });
                    return true;
                }

                const sudo = loadSudo();
                const updated = command === "setsudo"
                    ? [...new Set([...sudo, number])]
                    : sudo.filter((item) => numberFromJid(item) !== number);
                saveSudo(updated);
                await sock.sendMessage(jid, {
                    text: `\u2705 Sudo ${command === "setsudo" ? "added" : "removed"}: ${maskNumber(number)}`
                });
                return true;
            }

            case "listsudo": {
                const sudo = loadSudo();
                const list = sudo.length
                    ? sudo.map((item) => `• ${maskNumber(item)}`).join("\n")
                    : "No sudo users configured.";
                await sock.sendMessage(jid, { text: `SUDO USERS\n\n${list}` });
                return true;
            }

            case "block":
            case "unblock": {
                const number = targetNumber(context);
                if (!number) {
                    await sock.sendMessage(jid, { text: `Usage: .${command} <number>` });
                    return true;
                }
                if (typeof sock.updateBlockStatus !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                await sock.updateBlockStatus(
                    `${number}@s.whatsapp.net`,
                    command === "block" ? "block" : "unblock"
                );
                await sock.sendMessage(jid, { text: `\u2705 Contact ${command}ed.` });
                return true;
            }

            case "listblocked": {
                if (typeof sock.fetchBlocklist !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                const blocked = await sock.fetchBlocklist();
                const list = (blocked || []).map((item) => {
                    const value = typeof item === "string" ? item : item.id;
                    return `• ${maskNumber(value)}`;
                });
                await sock.sendMessage(jid, {
                    text: `BLOCKED CONTACTS\n\n${list.length ? list.join("\n") : "No blocked contacts."}`
                });
                return true;
            }

            case "setpp": {
                const media = quotedMedia(msg);
                if (!media) {
                    await sock.sendMessage(jid, { text: "\u274C Reply to an image with .setpp." });
                    return true;
                }
                if (typeof sock.updateProfilePicture !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                const buffer = await downloadMedia(context, media);
                if (!buffer) {
                    await unsupported(sock, jid);
                    return true;
                }
                await sock.updateProfilePicture(botJid(sock), buffer);
                await sock.sendMessage(jid, { text: "\u2705 Profile picture updated." });
                return true;
            }

            case "delpp":
                if (typeof sock.removeProfilePicture !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                await sock.removeProfilePicture(botJid(sock));
                await sock.sendMessage(jid, { text: "\u2705 Profile picture removed." });
                return true;

            case "setppname": {
                const name = args.join(" ").trim();
                if (!name) {
                    await sock.sendMessage(jid, { text: "Usage: .setppname <text>" });
                    return true;
                }
                if (typeof sock.updateProfileName !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                await sock.updateProfileName(name);
                await sock.sendMessage(jid, { text: "\u2705 Profile name updated." });
                return true;
            }

            case "setbio": {
                const bio = args.join(" ").trim();
                if (!bio) {
                    await sock.sendMessage(jid, { text: "Usage: .setbio <text>" });
                    return true;
                }
                if (typeof sock.updateProfileStatus !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                await sock.updateProfileStatus(bio);
                await sock.sendMessage(jid, { text: "\u2705 Profile bio updated." });
                return true;
            }

            case "getpp": {
                if (typeof sock.profilePictureUrl !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                const url = await sock.profilePictureUrl(botJid(sock), "image");
                if (!url) {
                    await sock.sendMessage(jid, { text: "No profile picture is available." });
                    return true;
                }
                await sock.sendMessage(jid, {
                    image: { url },
                    caption: "ANONYMOUS MD profile picture"
                });
                return true;
            }

            case "getname":
                await sock.sendMessage(jid, {
                    text: `Current bot name: ${sock.user?.name || loadSettings().botName}`
                });
                return true;

            case "pinchat":
            case "unpinchat":
                if (typeof sock.chatModify !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                await sock.chatModify({ pin: command === "pinchat" }, jid);
                await sock.sendMessage(jid, {
                    text: `\u2705 Chat ${command === "pinchat" ? "pinned" : "unpinned"}.`
                });
                return true;

            case "join": {
                const match = args[0]?.match(
                    /^https?:\/\/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)$/i
                );
                if (!match) {
                    await sock.sendMessage(jid, {
                        text: "Usage: .join https://chat.whatsapp.com/<invite>"
                    });
                    return true;
                }
                if (typeof sock.groupAcceptInvite !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                await sock.groupAcceptInvite(match[1]);
                await sock.sendMessage(jid, { text: "\u2705 Group invite accepted." });
                return true;
            }

            case "joinch":
            case "sendgclink":
            case "reactch":
                await unsupported(sock, jid);
                return true;

            case "leave":
                if (!jid.endsWith("@g.us")) {
                    await sock.sendMessage(jid, { text: "\u274C .leave only works in groups." });
                    return true;
                }
                if (typeof sock.groupLeave !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                await sock.groupLeave(jid);
                return true;

            case "broadcast": {
                const text = args.join(" ").trim();
                const targets = loadSettings().broadcastTargets
                    .map(numberFromJid)
                    .filter(Boolean);
                if (!text || !targets.length) {
                    await sock.sendMessage(jid, {
                        text: "Usage: .broadcast <text>\nNo broadcast targets are configured."
                    });
                    return true;
                }
                for (const number of [...new Set(targets)]) {
                    await sock.sendMessage(`${number}@s.whatsapp.net`, { text });
                }
                await sock.sendMessage(jid, { text: "\u2705 Broadcast sent." });
                return true;
            }

            case "broadcast2": {
                const number = normalizeNumber(args[0]);
                const text = args.slice(1).join(" ").trim();
                if (!number || !text) {
                    await sock.sendMessage(jid, { text: "Usage: .broadcast2 <number> <text>" });
                    return true;
                }
                await sock.sendMessage(`${number}@s.whatsapp.net`, { text });
                await sock.sendMessage(jid, { text: "\u2705 Message sent." });
                return true;
            }

            case "save": {
                const media = quotedMedia(msg);
                if (!media) {
                    await sock.sendMessage(jid, { text: "\u274C Reply to supported media with .save." });
                    return true;
                }
                const buffer = await downloadMedia(context, media);
                if (!buffer) {
                    await unsupported(sock, jid);
                    return true;
                }
                fs.mkdirSync(tempDirectory, { recursive: true });
                const token = crypto.randomBytes(8).toString("hex");
                const filePath = path.join(
                    tempDirectory,
                    `saved-${Date.now()}-${token}.${mediaExtension(media.message)}`
                );
                fs.writeFileSync(filePath, buffer);
                await sock.sendMessage(jid, { text: "\u2705 Media saved temporarily." });
                return true;
            }

            case "idch":
                await sock.sendMessage(jid, {
                    text: jid.endsWith("@s.whatsapp.net")
                        ? `Current chat ID: ${maskNumber(jid)}`
                        : `Current chat ID: ${jid}`
                });
                return true;

            case "checkidch": {
                const value = args[0] || "";
                const valid = /^\d+@(g\.us|s\.whatsapp\.net)$/.test(value) ||
                    /^\d{5,30}$/.test(value);
                await sock.sendMessage(jid, {
                    text: valid ? "\u2705 Valid chat identifier." : "\u274C Invalid chat identifier."
                });
                return true;
            }

            case "autotyping":
            case "autorecording":
            case "autoread":
            case "alwaysonline": {
                const value = toggle(args);
                updateSettings({ [command]: value === null ? true : value });
                await sock.sendMessage(jid, { text: `\u2705 ${command} updated.` });
                return true;
            }

            case "autoviewstatus":
            case "anticall": {
                const value = toggle(args);
                if (value === null) {
                    await sock.sendMessage(jid, { text: `Usage: .${command} on/off` });
                    return true;
                }
                updateSettings({ [command]: value });
                await sock.sendMessage(jid, { text: `\u2705 ${command} updated.` });
                return true;
            }

            case "autoreact": {
                const value = toggle(args);
                if (value === null) {
                    await sock.sendMessage(jid, { text: "Usage: .autoreact on/off [emoji]" });
                    return true;
                }
                updateSettings({
                    autoreact: value,
                    autoreactEmoji: value && args[1]
                        ? args[1]
                        : loadSettings().autoreactEmoji
                });
                await sock.sendMessage(jid, { text: "\u2705 autoreact updated." });
                return true;
            }

            case "listgc": {
                if (typeof sock.groupFetchAllParticipating !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                const groups = groupEntries(await sock.groupFetchAllParticipating());
                const text = groups.length
                    ? groups.map((group) => `${group.subject} (${group.participants.length})\n${group.id}`).join("\n\n")
                    : "No accessible groups.";
                await sock.sendMessage(jid, { text: `GROUPS\n\n${text}` });
                return true;
            }

            case "totalcmd":
                await sock.sendMessage(jid, {
                    text: `Registered commands: ${context.commandCount || 0}`
                });
                return true;

            case "totalmembers": {
                if (typeof sock.groupFetchAllParticipating !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                const members = new Set();
                for (const group of groupEntries(await sock.groupFetchAllParticipating())) {
                    for (const participant of group.participants) {
                        if (participant.id) members.add(participant.id);
                    }
                }
                await sock.sendMessage(jid, { text: `Unique accessible members: ${members.size}` });
                return true;
            }

            case "membercount":
                if (!jid.endsWith("@g.us") || typeof sock.groupMetadata !== "function") {
                    await sock.sendMessage(jid, { text: "\u274C .membercount only works in groups." });
                    return true;
                }
                {
                    const metadata = await sock.groupMetadata(jid);
                    await sock.sendMessage(jid, {
                        text: `Members: ${metadata.participants?.length || 0}`
                    });
                }
                return true;

            case "mblock":
                await sock.sendMessage(jid, {
                    text: "\u274C .mblock is unsupported because member management is not defined separately from WhatsApp account blocking."
                });
                return true;

            case "mbsearch": {
                const query = args.join(" ").trim().toLowerCase();
                if (!query) {
                    await sock.sendMessage(jid, { text: "Usage: .mbsearch <name or number>" });
                    return true;
                }
                if (typeof sock.groupFetchAllParticipating !== "function") {
                    await unsupported(sock, jid);
                    return true;
                }
                const matches = [];
                for (const group of groupEntries(await sock.groupFetchAllParticipating())) {
                    for (const participant of group.participants) {
                        const name = participant.notify || participant.name || "Unnamed member";
                        const number = numberFromJid(participant.id) || "";
                        if (`${name} ${number}`.toLowerCase().includes(query)) {
                            matches.push(`${name} in ${group.subject} (${maskNumber(number)})`);
                        }
                    }
                }
                await sock.sendMessage(jid, {
                    text: matches.length ? `MEMBER SEARCH\n\n${matches.slice(0, 50).join("\n")}` : "No matching members found."
                });
                return true;
            }

            default:
                return false;
        }
    } catch (error) {
        console.error(`[OWNER COMMAND ERROR] ${command}`, error);
        await sock.sendMessage(jid, {
            text: "\u274C The owner command could not be completed safely."
        });
        return true;
    }
}

module.exports = {
    commandNames: ownerCommands,
    handleCommand
};
