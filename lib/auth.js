const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "../.env");

function loadEnvFile() {
    try {
        const content = fs.readFileSync(envPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
            if (!match || match[1] in process.env) continue;

            process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
        }
    } catch {
        // Environment variables may be supplied by the process instead.
    }
}

loadEnvFile();

const usersPath = path.join(
    __dirname,
    "../data/users.json"
);

const approvedPath = path.join(
    __dirname,
    "../data/approved.json"
);

function readApproved() {
    try {
        const content = fs.readFileSync(approvedPath, "utf8").trim();
        const data = content ? JSON.parse(content) : { users: [] };
        return { users: Array.isArray(data.users) ? data.users : [] };
    } catch {
        return { users: [] };
    }
}

function saveApproved(data) {
    fs.mkdirSync(path.dirname(approvedPath), { recursive: true });
    fs.writeFileSync(
        approvedPath,
        JSON.stringify({ users: [...new Set(data.users)] }, null, 4),
        "utf8"
    );
}

function getUsers() {
    return JSON.parse(
        fs.readFileSync(usersPath, "utf8")
    );
}

function saveUsers(data) {
    fs.writeFileSync(
        usersPath,
        JSON.stringify(data, null, 4)
    );
}

function getNumber(jid) {
    if (typeof jid !== "string") return "";

    const value = jid.trim();
    return value.includes("@")
        ? phoneNumberFromJid(value)
        : normalizePhoneNumber(value);
}

function normalizePhoneNumber(value) {
    const number = String(value || "").replace(/\D/g, "");
    return number.length >= 7 && number.length <= 15 ? number : "";
}

function phoneNumberFromJid(jid) {
    if (typeof jid !== "string") return "";

    const match = jid.trim().toLowerCase().match(/^\+?(\d+)(?::\d+)?@s\.whatsapp\.net$/);
    return match ? normalizePhoneNumber(match[1]) : "";
}

function identityJids(jid, context = {}) {
    return [
        jid,
        context.msg?.key?.senderPn,
        context.msg?.key?.participantPn,
        context.msg?.key?.participantAlt,
        context.msg?.participantAlt
    ].filter(Boolean);
}

function socketIdentityJids(context = {}) {
    const user = context.sock?.user;
    return [user?.id, user?.jid, user?.lid].filter(Boolean);
}

function getIdentityNumbers(jid, context = {}) {
    return [...new Set(
        identityJids(jid, context)
            .map(phoneNumberFromJid)
            .filter(Boolean)
    )];
}

function isOwner(jid, context = {}) {
    const configuredNumber = normalizePhoneNumber(process.env.OWNER_NUMBER);
    if (!configuredNumber) return false;

    const directMatch = getIdentityNumbers(jid, context)
        .some(number => number === configuredNumber);
    if (directMatch) return true;

    if (!(context.msg?.key?.fromMe ?? context.fromMe)) return false;

    return socketIdentityJids(context)
        .map(phoneNumberFromJid)
        .some(number => number === configuredNumber);
}

function getOwnerAuthStatus(jid, context = {}) {
    const directJids = identityJids(jid, context);
    const hasPhoneMapping = directJids
        .some(candidate => phoneNumberFromJid(candidate));
    const isLid = typeof jid === "string" && jid.toLowerCase().endsWith("@lid");
    const ownerMatch = isOwner(jid, context);

    return {
        configured: Boolean(normalizePhoneNumber(process.env.OWNER_NUMBER)),
        senderType: isLid ? "LID" : "PHONE",
        ownerMatch,
        resolution: hasPhoneMapping
            ? "message-context"
            : (context.msg?.key?.fromMe ?? context.fromMe) && socketIdentityJids(context)
                .some(candidate => phoneNumberFromJid(candidate))
                ? "socket-identity"
                : "failed"
    };
}

function safeJidForLog(jid) {
    if (typeof jid !== "string") return "unknown";
    const [user, server] = jid.split("@");
    if (server !== "s.whatsapp.net") return server ? `${server}` : "unknown";
    return "user";
}

function isRegistered(jid) {
    return isApproved(jid);
}

function registerUser(jid) {
    const number = getNumber(jid);
    const data = getUsers();

    if (!number) return false;

    if (!data.users.includes(number)) {
        data.users.push(number);
        saveUsers(data);
    }

    return true;
}

function removeUser(jid) {
    const number = getNumber(jid);
    const data = getUsers();

    data.users = data.users.filter(
        user => user !== number
    );

    saveUsers(data);

    return true;
}

function isApproved(jid, context = {}) {
    const approvedUsers = readApproved().users;
    return getIdentityNumbers(jid, context)
        .some(number => approvedUsers.includes(number));
}

function approveUser(jid) {
    const number = getNumber(jid);
    if (!number) return false;

    const data = readApproved();
    if (!data.users.includes(number)) data.users.push(number);
    saveApproved(data);
    return true;
}

function unapproveUser(jid) {
    const number = getNumber(jid);
    if (!number) return false;

    const data = readApproved();
    data.users = data.users.filter(user => user !== number);
    saveApproved(data);
    return true;
}

function getApprovedUsers() {
    return readApproved().users;
}

module.exports = {
    loadEnvFile,
    getUsers,
    saveUsers,
    getNumber,
    getIdentityNumbers,
    isOwner,
    getOwnerAuthStatus,
    safeJidForLog,
    isRegistered,
    registerUser,
    removeUser,
    isApproved,
    approveUser,
    unapproveUser,
    getApprovedUsers
};