const fs = require("fs");
const path = require("path");

const warningsPath = path.join(__dirname, "../data/warnings.json");
const silencedPath = path.join(__dirname, "../data/silenced.json");
const maximumSilenceMs = 30 * 24 * 60 * 60 * 1000;

const commandNames = [
    "groupinfo", "gcinfo", "groupid", "listmembers", "admins", "tagall",
    "tagadmins", "find", "findfriends", "getlink", "revoke", "open", "close",
    "setgcname", "setgcdesc", "poll", "left", "leave", "kick", "add",
    "promote", "demote", "ban", "unban", "warn", "unwarn", "listwarn",
    "listban", "promoteall", "demoteall", "demotealladmins", "kickall",
    "resetwarns", "announce", "creategc", "listactive", "silence", "unsilence",
    "silencelist"
];

const informationCommands = new Set([
    "groupinfo", "gcinfo", "groupid", "listmembers", "admins", "tagadmins",
    "find", "findfriends", "tagall", "poll"
]);

const adminCommands = new Set([
    "getlink", "revoke", "open", "close", "setgcname", "setgcdesc",
    "kick", "add", "promote", "demote", "ban", "unban", "warn",
    "unwarn", "listwarn", "listban", "promoteall", "demoteall",
    "demotealladmins", "kickall", "resetwarns", "announce", "creategc",
    "silence", "unsilence", "silencelist"
]);
const botAdminCommands = new Set([
    "getlink", "revoke", "open", "close", "setgcname", "setgcdesc",
    "kick", "add", "promote", "demote", "ban", "unban", "announce"
]);

function readWarnings() {
    try {
        const data = JSON.parse(fs.readFileSync(warningsPath, "utf8"));
        return {
            warnings: data.warnings && typeof data.warnings === "object" ? data.warnings : {},
            bans: data.bans && typeof data.bans === "object" ? data.bans : {}
        };
    } catch {
        return { warnings: {}, bans: {} };
    }
}

function saveWarnings(data) {
    fs.mkdirSync(path.dirname(warningsPath), { recursive: true });
    fs.writeFileSync(warningsPath, JSON.stringify(data, null, 4), "utf8");
}

function readSilenced() {
    try {
        const data = JSON.parse(fs.readFileSync(silencedPath, "utf8"));
        return data.groups && typeof data.groups === "object" ? data : { groups: {} };
    } catch {
        return { groups: {} };
    }
}

function saveSilenced(data) {
    fs.mkdirSync(path.dirname(silencedPath), { recursive: true });
    fs.writeFileSync(silencedPath, JSON.stringify(data, null, 4), "utf8");
}

function cleanExpiredSilences(data, jid, now = Date.now()) {
    const group = data.groups[jid] || {};
    let changed = false;
    for (const user of Object.keys(group)) {
        if (!group[user]?.expiresAt || group[user].expiresAt <= now) {
            delete group[user];
            changed = true;
        }
    }
    if (changed) saveSilenced(data);
    return group;
}

function parseDuration(value) {
    const match = String(value || "").match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const milliseconds = amount * units[match[2].toLowerCase()];
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > maximumSilenceMs) return null;
    return { milliseconds, label: `${amount}${match[2].toLowerCase()}` };
}

function formatRemaining(milliseconds) {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.ceil(hours / 24)}d`;
}

function isSilenced(jid, senderJid, now = Date.now()) {
    const data = readSilenced();
    const group = cleanExpiredSilences(data, jid, now);
    const match = Object.entries(group).find(([storedJid, value]) =>
        isSameUserJid(storedJid, senderJid) && value.expiresAt > now
    );
    return match ? { jid: match[0], ...match[1] } : null;
}

async function handleSilencedMessage(sock, msg, jid, senderJid) {
    if (!jid?.endsWith("@g.us")) return false;
    const silence = isSilenced(jid, senderJid);
    if (!silence) return false;

    let metadata;
    try {
        metadata = typeof sock.groupMetadata === "function"
            ? await sock.groupMetadata(jid)
            : null;
    } catch (error) {
        console.error("[SILENCE METADATA ERROR]", error);
        return true;
    }

    const botIsAdmin = metadata && (metadata.participants || []).some(participant =>
        getBotJids(sock).some(botJid => participantMatches(participant, botJid)) &&
        isAdminParticipant(participant)
    );
    if (!botIsAdmin) {
        await sock.sendMessage(jid, {
            text: "A user is silenced, but I need to be a group admin to delete their messages."
        });
        return true;
    }

    if (typeof sock.sendMessage !== "function") return true;
    if (typeof sock.sendMessage !== "function" || !msg?.key?.id) return true;

    try {
        await sock.sendMessage(jid, { delete: msg.key });
        return true;
    } catch (error) {
        console.error("[SILENCE DELETE ERROR]", error);
        await sock.sendMessage(jid, {
            text: "A silenced member sent a message, but WhatsApp did not allow it to be deleted."
        });
        return true;
    }
}

function normalizeJid(jid) {
    if (!jid || typeof jid !== "string") return null;
    const value = jid.trim().toLowerCase();
    const at = value.indexOf("@");
    if (at < 1) return null;
    const user = value.slice(0, at).replace(/:\d+$/, "");
    const server = value.slice(at + 1);
    return { raw: value, user, server };
}

function isSameUserJid(first, second) {
    const a = normalizeJid(first);
    const b = normalizeJid(second);
    if (!a || !b) return false;
    if (a.raw === b.raw) return true;
    if (a.server === "s.whatsapp.net" && b.server === "s.whatsapp.net") {
        return a.user === b.user;
    }
    if (a.server === "lid" && b.server === "lid") {
        return a.user === b.user;
    }
    return false;
}

function isGroup(context) {
    return Boolean(context.jid && context.jid.endsWith("@g.us"));
}

function participantMatches(participant, jid) {
    return [participant?.id, participant?.jid, participant?.lid]
        .filter(Boolean)
        .some(candidate => isSameUserJid(candidate, jid));
}

function getSenderJids(context) {
    return [
        context.senderJid,
        context.msg?.key?.participant,
        context.msg?.key?.participantAlt,
        context.msg?.participant
    ].filter(Boolean);
}

function findParticipant(context, metadata, jidList) {
    return (metadata?.participants || []).find(participant =>
        jidList.some(jid => participantMatches(participant, jid))
    );
}

function isAdminParticipant(participant) {
    return participant?.admin === "admin" || participant?.admin === "superadmin";
}

function isSenderAdmin(context) {
    return isAdminParticipant(findParticipant(context, context.groupMetadata, getSenderJids(context)));
}

function requiresGroupAdmin(command) {
    return adminCommands.has(command) || ["silence", "unsilence", "silencelist"].includes(command);
}

function requiresBotAdmin(command) {
    return botAdminCommands.has(command);
}

function getBotJids(sock) {
    return [sock.user?.id, sock.user?.lid, sock.user?.jid].filter(Boolean);
}

function isBotAdmin(context) {
    const metadata = context.groupMetadata;
    return (metadata?.participants || []).some(participant =>
        getBotJids(context.sock).some(jid => participantMatches(participant, jid)) &&
        isAdminParticipant(participant)
    );
}

function resolveTarget(context) {
    const info = context.msg?.message?.extendedTextMessage?.contextInfo;
    const mentioned = info?.mentionedJid || [];
    if (mentioned[0]) return mentioned[0];
    if (info?.participant) return info.participant;

    const value = context.args[0];
    if (!value) return null;
    const number = value.replace(/\D/g, "");
    return number.length >= 7 && number.length <= 15
        ? `${number}@s.whatsapp.net`
        : null;
}

function resolveSilenceTarget(context) {
    const info = context.msg?.message?.extendedTextMessage?.contextInfo;
    if (info?.mentionedJid?.[0]) return info.mentionedJid[0];
    if (info?.participant) return info.participant;

    const candidate = context.args[0];
    if (!candidate || /^(\d+)(s|m|h|d)$/i.test(candidate)) return null;
    const number = candidate.replace(/\D/g, "");
    return number.length >= 7 && number.length <= 15
        ? `${number}@s.whatsapp.net`
        : null;
}

function botMatchesTarget(context, target) {
    return getBotJids(context.sock).some(jid => isSameUserJid(jid, target));
}

function displayJid(jid) {
    const normalized = normalizeJid(jid);
    if (!normalized) return "unknown";
    if (normalized.server === "s.whatsapp.net") {
        return `@${normalized.user}`;
    }
    return `@${normalized.user}`;
}

async function getMetadata(context) {
    if (context.groupMetadata) return context.groupMetadata;
    if (typeof context.sock.groupMetadata !== "function") return null;
    return context.sock.groupMetadata(context.jid);
}

async function requireBotAdmin(context) {
    if (isBotAdmin(context)) return true;
    await context.sock.sendMessage(context.jid, {
        text: "I need to be a group admin first."
    });
    return false;
}

async function sendGroupInfo(context, metadata) {
    const admins = metadata.participants.filter(isAdminParticipant);
    const created = metadata.creation
        ? new Date(Number(metadata.creation) * 1000).toISOString()
        : "Unavailable";
    await context.sock.sendMessage(context.jid, {
        text: [
            "GROUP INFO",
            "",
            `Name: ${metadata.subject || "Unnamed group"}`,
            `Members: ${metadata.participants.length}`,
            `Admins: ${admins.length}`,
            `ID: ${context.jid}`,
            `Description: ${metadata.desc || "Unavailable"}`,
            `Created: ${created}`
        ].join("\n")
    });
}

async function handleCommand(context) {
    if (!commandNames.includes(context.command)) return false;
    const { command, args, jid, sock } = context;

    if (["leave", "left"].includes(command) && !context.isOwner) {
        await sock.sendMessage(jid, { text: "Only the configured bot owner can make the bot leave a group." });
        return true;
    }

    if (!isGroup(context)) {
        await sock.sendMessage(jid, { text: "This command only works in groups." });
        return true;
    }

    try {
        const metadata = await getMetadata(context);
        if (!metadata || !Array.isArray(metadata.participants)) {
            await sock.sendMessage(jid, { text: "Group information is unavailable." });
            return true;
        }
        context.groupMetadata = metadata;

        if (["silence", "unsilence", "silencelist"].includes(command)) {
            if (!isSenderAdmin(context)) {
                await sock.sendMessage(jid, { text: "You must be a group admin." });
                return true;
            }
            if (!(await requireBotAdmin(context))) return true;

            const silenceData = readSilenced();
            const groupSilences = cleanExpiredSilences(silenceData, jid);

            if (command === "silencelist") {
                const entries = Object.entries(groupSilences);
                const text = entries.length
                    ? entries.map(([user, value]) => `${displayJid(user)} - ${formatRemaining(value.expiresAt - Date.now())}${value.reason ? ` (${value.reason})` : ""}`).join("\n")
                    : "No users are currently silenced.";
                await sock.sendMessage(jid, {
                    text: `SILENCED USERS\n\n${text}`,
                    mentions: entries.map(([user]) => user)
                });
                return true;
            }

            const target = resolveSilenceTarget(context);
            if (!target || botMatchesTarget(context, target)) {
                await sock.sendMessage(jid, { text: "User not found or the bot cannot be silenced." });
                return true;
            }

            if (command === "unsilence") {
                const stored = Object.keys(groupSilences).find(user => isSameUserJid(user, target));
                if (stored) {
                    delete groupSilences[stored];
                    saveSilenced(silenceData);
                }
                await sock.sendMessage(jid, { text: "User silence removed.", mentions: [target] });
                return true;
            }

            const durationIndex = context.args[0] && /^(\d+)(s|m|h|d)$/i.test(context.args[0])
                ? 0
                : 1;
            const duration = parseDuration(context.args[durationIndex]);
            if (!duration) {
                await sock.sendMessage(jid, { text: "Usage: .silence @user <duration> (maximum 30d)" });
                return true;
            }

            const reason = context.args.slice(durationIndex + 1).join(" ").trim();
            silenceData.groups[jid] = groupSilences;
            silenceData.groups[jid][target] = {
                expiresAt: Date.now() + duration.milliseconds,
                reason: reason || undefined
            };
            saveSilenced(silenceData);
            await sock.sendMessage(jid, {
                text: `USER SILENCED\n\nUser: ${displayJid(target)}\nDuration: ${duration.label}${reason ? `\nReason: ${reason}` : ""}`,
                mentions: [target]
            });
            return true;
        }

        if (informationCommands.has(command)) {
            if (command === "gcinfo" || command === "groupinfo") await sendGroupInfo(context, metadata);
            else if (command === "groupid") await sock.sendMessage(jid, { text: `Group ID: ${jid}` });
            else if (command === "listmembers") {
                await sock.sendMessage(jid, {
                    text: metadata.participants.map(participant => displayJid(participant.id)).join(" "),
                    mentions: metadata.participants.map(participant => participant.id)
                });
            } else if (command === "admins" || command === "tagadmins") {
                const admins = metadata.participants.filter(isAdminParticipant);
                await sock.sendMessage(jid, {
                    text: admins.map(admin => displayJid(admin.id)).join(" ") || "No admins found.",
                    mentions: admins.map(admin => admin.id)
                });
            } else if (command === "tagall") {
                await sock.sendMessage(jid, {
                    text: metadata.participants.map(participant => displayJid(participant.id)).join(" "),
                    mentions: metadata.participants.map(participant => participant.id)
                });
            } else if (command === "poll") {
                const parts = args.join(" ").split("|").map(value => value.trim()).filter(Boolean);
                if (parts.length < 3) {
                    await sock.sendMessage(jid, { text: "Usage: .poll Question | Option 1 | Option 2" });
                } else {
                    await sock.sendMessage(jid, { poll: { name: parts[0], values: parts.slice(1), selectableCount: 1 } });
                }
            } else {
                const query = args.join(" ").toLowerCase();
                const matches = metadata.participants.filter(participant =>
                    `${participant.notify || ""} ${participant.id || ""}`.toLowerCase().includes(query)
                );
                await sock.sendMessage(jid, {
                    text: matches.length ? matches.map(participant => displayJid(participant.id)).join(" ") : "No matching members found.",
                    mentions: matches.map(participant => participant.id)
                });
            }
            return true;
        }

        if (adminCommands.has(command) && !isSenderAdmin(context)) {
            await sock.sendMessage(jid, { text: "You must be a group admin." });
            return true;
        }

        if (["leave", "left"].includes(command)) {
            if (typeof sock.groupLeave !== "function") return unsupported(sock, jid);
            await sock.groupLeave(jid);
            return true;
        }

        if (requiresBotAdmin(command) && !(await requireBotAdmin(context))) return true;

        const target = resolveTarget(context);
        if (["kick", "promote", "demote", "ban", "unban", "warn", "unwarn", "resetwarns"].includes(command) && !target) {
            await sock.sendMessage(jid, { text: `Usage: .${command} @user or .${command} <number>` });
            return true;
        }

        if (command === "getlink") {
            if (typeof sock.groupInviteCode !== "function") return unsupported(sock, jid);
            const code = await sock.groupInviteCode(jid);
            await sock.sendMessage(jid, { text: `Group link: https://chat.whatsapp.com/${code}` });
        } else if (command === "revoke") {
            if (typeof sock.groupRevokeInvite !== "function") return unsupported(sock, jid);
            await sock.groupRevokeInvite(jid);
            await sock.sendMessage(jid, { text: "Group invite link revoked." });
        } else if (command === "open" || command === "close") {
            if (typeof sock.groupSettingUpdate !== "function") return unsupported(sock, jid);
            await sock.groupSettingUpdate(jid, command === "close" ? "announcement" : "not_announcement");
            await sock.sendMessage(jid, { text: `Group ${command}ed.` });
        } else if (command === "setgcname") {
            if (!args.length || typeof sock.groupUpdateSubject !== "function") return unsupported(sock, jid);
            await sock.groupUpdateSubject(jid, args.join(" "));
            await sock.sendMessage(jid, { text: "Group name updated." });
        } else if (command === "setgcdesc") {
            if (!args.length || typeof sock.groupUpdateDescription !== "function") return unsupported(sock, jid);
            await sock.groupUpdateDescription(jid, args.join(" "));
            await sock.sendMessage(jid, { text: "Group description updated." });
        } else if (["kick", "add", "promote", "demote"].includes(command)) {
            if (typeof sock.groupParticipantsUpdate !== "function") return unsupported(sock, jid);
            const targetNumber = String(args[0] || "").replace(/\D/g, "");
            const targetJid = command === "add"
                ? targetNumber.length >= 7 && targetNumber.length <= 15
                    ? `${targetNumber}@s.whatsapp.net`
                    : null
                : target;
            if (!targetJid || targetJid.includes("undefined")) return invalidTarget(sock, jid);
            await sock.groupParticipantsUpdate(jid, [targetJid], command === "kick" ? "remove" : command);
            await sock.sendMessage(jid, { text: `Member ${command} operation completed.` });
        } else if (command === "ban" || command === "unban") {
            const data = readWarnings();
            data.bans[jid] = data.bans[jid] || [];
            data.bans[jid] = command === "ban"
                ? [...new Set([...data.bans[jid], target])]
                : data.bans[jid].filter(item => !isSameUserJid(item, target));
            saveWarnings(data);
            await sock.sendMessage(jid, { text: `Member ${command} list updated.` });
        } else if (["warn", "unwarn", "resetwarns"].includes(command)) {
            const data = readWarnings();
            data.warnings[jid] = data.warnings[jid] || {};
            if (command === "warn") data.warnings[jid][target] = (data.warnings[jid][target] || 0) + 1;
            else delete data.warnings[jid][target];
            saveWarnings(data);
            await sock.sendMessage(jid, { text: command === "warn" ? `Warning recorded for ${displayJid(target)}.` : "Warnings updated." });
        } else if (["listban", "listwarn"].includes(command)) {
            const data = readWarnings();
            const values = command === "listban" ? data.bans[jid] || [] : Object.entries(data.warnings[jid] || {}).map(([user, count]) => `${displayJid(user)}: ${count}`);
            await sock.sendMessage(jid, { text: values.length ? values.join("\n") : "No entries." });
        } else if (["promoteall", "demoteall", "demotealladmins", "kickall"].includes(command)) {
            await sock.sendMessage(jid, { text: "Bulk member changes are disabled for safety." });
        } else if (command === "announce") {
            await sock.sendMessage(jid, { text: args.join(" ") || "Usage: .announce <text>", mentions: metadata.participants.map(participant => participant.id) });
        } else if (command === "creategc") {
            if (typeof sock.groupCreate !== "function") return unsupported(sock, jid);
            const result = await sock.groupCreate(args.join(" ") || "New group", []);
            await sock.sendMessage(jid, { text: `Created group: ${result.id}` });
        } else if (command === "listactive") {
            await sock.sendMessage(jid, { text: "Activity data is not available." });
        }
        return true;
    } catch (error) {
        console.error(`[GROUP COMMAND ERROR] ${command}`, error);
        await sock.sendMessage(jid, { text: "The group command could not be completed safely." });
        return true;
    }
}

function invalidTarget(sock, jid) {
    return sock.sendMessage(jid, { text: "User not found." });
}

function unsupported(sock, jid) {
    return sock.sendMessage(jid, { text: "This feature is not supported by the current Baileys version." });
}

module.exports = {
    commandNames,
    handleCommand,
    normalizeJid,
    isSameUserJid,
    isGroup,
    isSenderAdmin,
    requiresGroupAdmin,
    requiresBotAdmin,
    isBotAdmin,
    resolveTarget,
    isSilenced,
    handleSilencedMessage,
    parseDuration
};
