const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const accountsPath = process.env.ANONYMOUS_MD_ACCOUNTS_PATH ||
    path.join(__dirname, "../data/accounts.json");
const sessionsPath = process.env.ANONYMOUS_MD_SESSIONS_PATH ||
    path.join(__dirname, "../sessions");
const sessionIdPattern = /^(?:account|secondary)-\d+$/;
const sessions = new Map();
let primaryId = null;
let nextSecondaryId = 1;
let startAccount;
let stopAccount;
let logoutAccount;
const registry = readRegistry();
primaryId = registry.primaryId;
nextSecondaryId = registry.nextSecondaryId;

function readRegistry() {
    try {
        const data = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
        if (!Array.isArray(data.accounts)) {
            console.warn("[SESSION MANAGER] Invalid registry shape; saved session folders will be discovered independently.");
                        return { accounts: [], primaryId: null, nextSecondaryId: 1 };
        }
        const isValidAccount = account => !(
            !account ||
            typeof account.id !== "string" ||
            !sessionIdPattern.test(account.id) ||
            typeof account.number !== "string" ||
            (account.number && !/^\d{7,15}$/.test(account.number)) ||
            (account.type !== undefined && !["primary", "secondary"].includes(account.type)) ||
            (account.status !== undefined && ![
                "new", "needs-review", "connecting", "connected", "disconnected",
                "cancelled", "logged-out", "replaced", "error"
            ].includes(account.status)) ||
            (account.requestedBy !== undefined && account.requestedBy !== null &&
                (typeof account.requestedBy !== "string" ||
                    account.requestedBy.length > 255 ||
                    !account.requestedBy.includes("@"))) ||
            (account.autoReconnect !== undefined && typeof account.autoReconnect !== "boolean")
        );
        const accounts = data.accounts.filter(isValidAccount);
        if (accounts.length !== data.accounts.length) {
            console.warn(`[SESSION MANAGER] Skipped ${data.accounts.length - accounts.length} invalid registry record(s).`);
        }
        return {
            accounts,
            primaryId: typeof data.primaryId === "string" && sessionIdPattern.test(data.primaryId)
                ? data.primaryId
                : null,
            nextSecondaryId: Number.isSafeInteger(data.nextSecondaryId) && data.nextSecondaryId > 0
                ? data.nextSecondaryId
                : Math.max(0, ...accounts.map(account => Number(account.id.match(/^secondary-(\d+)$/)?.[1] || 0))) + 1
        };
    } catch (error) {
        if (error.code === "ENOENT") return { accounts: [], primaryId: null, nextSecondaryId: 1 };
        console.error("[SESSION MANAGER] Could not read the registry; session folders will be discovered independently.", error.message);
        return { accounts: [], primaryId: null, nextSecondaryId: 1 };
    }
}

function writeAccounts() {
    const accounts = [...sessions.values()]
        .filter(session => session.persisted)
        .map(({ id, type, number, status, lastConnectedAt, autoReconnect, requestedBy }) => ({
            id,
            type,
            number,
            status,
            lastConnectedAt,
            requestedBy: requestedBy || null,
            autoReconnect: autoReconnect !== false
        }));
    fs.mkdirSync(path.dirname(accountsPath), { recursive: true });
    const temporaryPath = `${accountsPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify({ primaryId, nextSecondaryId, accounts }, null, 4), {
            encoding: "utf8",
            mode: 0o600
        });
        fs.renameSync(temporaryPath, accountsPath);
    } catch (error) {
        try {
            fs.rmSync(temporaryPath, { force: true });
        } catch (cleanupError) {
            console.error("[SESSION MANAGER] Temporary-file cleanup failed.", cleanupError);
        }
        throw error;
    }
}

function sessionDirectory(id) {
    if (!sessionIdPattern.test(id)) throw new Error("Invalid session ID.");
    return path.join(sessionsPath, id);
}

function readSavedCredentials(id) {
    try {
        const value = JSON.parse(fs.readFileSync(path.join(sessionDirectory(id), "creds.json"), "utf8"));
        const match = String(value.me?.id || "").match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
        return {
            registered: value.registered === true,
            number: match ? match[1] : ""
        };
    } catch {
        return { registered: false, number: "" };
    }
}

for (const account of registry.accounts) {
    const savedCredentials = readSavedCredentials(account.id);
    sessions.set(account.id, {
        ...account,
        type: account.id === primaryId ? "primary" : account.type || "secondary",
        status: ["logged-out", "replaced", "error"].includes(account.status)
            ? account.status
            : savedCredentials.registered
                ? "disconnected"
                : "needs-review",
        lastConnectedAt: account.lastConnectedAt || null,
        sock: null,
        persisted: true,
        autoReconnect: account.autoReconnect !== false && savedCredentials.registered,
        requestedBy: account.requestedBy || null,
        ownerJid: null,
        cancelled: false,
        clearRequested: false
    });
}

function discoverSessionDirectories() {
    let entries;
    try {
        entries = fs.readdirSync(sessionsPath, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || !sessionIdPattern.test(entry.name) || sessions.has(entry.name)) continue;
        const savedCredentials = readSavedCredentials(entry.name);
        sessions.set(entry.name, {
            id: entry.name,
            type: entry.name === primaryId ? "primary" : "secondary",
            number: savedCredentials.number,
            status: savedCredentials.registered ? "disconnected" : "needs-review",
            lastConnectedAt: null,
            sock: null,
            persisted: savedCredentials.registered,
            autoReconnect: savedCredentials.registered,
            requestedBy: null,
            ownerJid: null,
            cancelled: false,
            clearRequested: false
        });
    }
}

discoverSessionDirectories();
for (const id of sessions.keys()) {
    const match = id.match(/^secondary-(\d+)$/);
    if (match) nextSecondaryId = Math.max(nextSecondaryId, Number(match[1]) + 1);
}

function configure(options = {}) {
    if (typeof options.startAccount === "function") startAccount = options.startAccount;
    if (typeof options.stopAccount === "function") stopAccount = options.stopAccount;
    if (typeof options.logoutAccount === "function") logoutAccount = options.logoutAccount;
}

function nextAccountId() {
    const accountIds = new Set(sessions.keys());
    try {
        for (const filename of fs.readdirSync(sessionsPath)) {
            if (sessionIdPattern.test(filename)) accountIds.add(filename);
        }
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    while (accountIds.has(`secondary-${nextSecondaryId}`) ||
        fs.existsSync(sessionDirectory(`secondary-${nextSecondaryId}`))) {
        nextSecondaryId += 1;
    }
    const id = `secondary-${nextSecondaryId}`;
    nextSecondaryId += 1;
    return id;
}

async function connect({
    number = "",
    method,
    ownerJid,
    prefix = ".",
    onPairingCode,
    onPairingError
}) {
    if (!["code", "qr"].includes(method)) {
        throw new Error("Unsupported linking method.");
    }
    if (method === "code" && !/^\d{7,15}$/.test(number)) {
        throw new Error("A valid phone number with country code is required for pairing-code linking.");
    }
    if (typeof startAccount !== "function") {
        throw new Error("The account connector is not available.");
    }
    if ([...sessions.values()].some(session =>
        session.status === "connecting" && session.ownerJid === ownerJid
    )) {
        throw new Error("A connection attempt is already in progress.");
    }
    const id = nextAccountId();
    fs.mkdirSync(sessionsPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(sessionDirectory(id), { mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(sessionDirectory(id), 0o700);
    const session = {
        id,
        type: "secondary",
        number,
        status: "connecting",
        lastConnectedAt: null,
        sock: null,
        persisted: true,
        autoReconnect: false,
        requestedBy: ownerJid || null,
        ownerJid,
        cancelled: false,
        clearRequested: false,
        method
    };
    sessions.set(id, session);
    writeAccounts();

    try {
        await startAccount({
            id,
            number,
            method,
            ownerJid,
            prefix,
            secondary: true,
            onPairingCode,
            onPairingError
        });
    } catch (error) {
        session.status = "error";
        session.autoReconnect = false;
        session.ownerJid = null;
        writeAccounts();
        throw error;
    }
    return id;
}

function attachSocket(id, sock) {
    const session = sessions.get(id);
    if (!session) return;
    session.sock = sock;
    if (!session.cancelled) session.status = "connecting";
}

function markConnected(id, sock) {
    const session = sessions.get(id);
    if (!session || session.cancelled) return;
    session.sock = sock || session.sock;
    session.status = "connected";
    session.lastConnectedAt = new Date().toISOString();
    session.ownerJid = null;
    session.persisted = true;
    session.autoReconnect = true;
    const connectedNumber = sock?.user?.id?.split("@")[0]?.split(":")[0];
    if (connectedNumber && /^\d{7,15}$/.test(connectedNumber)) {
        session.number = connectedNumber;
    }
    if (session.persisted) writeAccounts();
}

function markDisconnected(id, status = "disconnected") {
    const session = sessions.get(id);
    if (!session) return;
    if (session.clearRequested) {
        session.status = session.type === "primary" && !readSavedCredentials(id).registered
            ? "new"
            : "disconnected";
        session.sock = null;
        session.autoReconnect = false;
        if (session.persisted) writeAccounts();
        return;
    }
    session.status = session.cancelled ? "cancelled" : status;
    session.sock = null;
    if (status === "logged-out" || status === "replaced" || status === "error") {
        session.autoReconnect = false;
        session.persisted = true;
        writeAccounts();
    } else if (session.persisted) {
        writeAccounts();
    }
}

function registerPrimary(id, sock) {
    const record = sessions.get(id) || {
        id,
        type: "primary",
        number: "",
        status: "disconnected",
        lastConnectedAt: null,
        sock: null,
        persisted: false,
        autoReconnect: true,
        ownerJid: null,
        cancelled: false
    };
    if (!primaryId) primaryId = id;
    record.type = id === primaryId ? "primary" : "secondary";
    record.clearRequested = false;
    sessions.set(id, record);
    attachSocket(id, sock);
}

function getPrimaryId(fallback = "account-1") {
    if (!sessionIdPattern.test(fallback)) fallback = "account-1";
    if (!primaryId) primaryId = fallback;
    let session = sessions.get(primaryId);
    if (!session) {
        session = {
            id: primaryId,
            type: "primary",
            number: "",
            status: "new",
            lastConnectedAt: null,
            sock: null,
            persisted: false,
            autoReconnect: true,
            ownerJid: null,
            cancelled: false,
            clearRequested: false
        };
        sessions.set(primaryId, session);
    }
    session.type = "primary";
    return primaryId;
}

function setPrimary(id) {
    if (!sessionIdPattern.test(id) || !sessions.has(id)) {
        throw new Error("Unknown session ID.");
    }
    if (primaryId === id) return false;

    const selected = sessions.get(id);
    if (selected.status !== "connected" && !readSavedCredentials(id).registered) {
        throw new Error("Complete WhatsApp pairing before selecting a primary session.");
    }

    const previous = sessions.get(primaryId);
    if (previous) {
        previous.type = "secondary";
        previous.persisted = previous.persisted || fs.existsSync(sessionDirectory(previous.id));
        previous.number = previous.number || previous.sock?.user?.id?.split("@")[0]?.split(":")[0] || "";
    }

    selected.type = "primary";
    selected.persisted = selected.persisted || fs.existsSync(sessionDirectory(id));
    selected.autoReconnect = true;
    primaryId = id;
    writeAccounts();
    return true;
}

function shouldStartOnBoot(id) {
    const session = sessions.get(id);
    return Boolean(session && (
        session.status === "new" ||
        session.status === "needs-review" ||
        session.autoReconnect
    ));
}

function get(id) {
    return sessions.get(id) || null;
}

function list() {
    return [...sessions.values()].map(({ id, type, number, status, lastConnectedAt }) => ({
        id,
        type,
        number,
        status,
        lastConnectedAt
    }));
}

function findSecondaryByNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) return null;
    return [...sessions.values()].find(session =>
        session.type === "secondary" &&
        session.status !== "logged-out" &&
        (session.status !== "cancelled" || session.persisted) &&
        session.number.replace(/\D/g, "") === digits
    ) || null;
}

async function disconnect(id) {
    const session = sessions.get(id);
    if (!session) throw new Error("Unknown session ID.");
    session.autoReconnect = false;
    if (session.persisted) writeAccounts();
    if (typeof stopAccount !== "function") {
        if (!session.sock) {
            session.status = "disconnected";
            return;
        }
        throw new Error("The account disconnector is not available.");
    }
    await stopAccount(id);
    session.status = "disconnected";
    session.sock = null;
}

async function reconnect(id, ownerJid, prefix = ".") {
    const session = sessions.get(id);
    if (!session) throw new Error("Unknown session ID.");
    if (session.status === "connecting" || session.status === "connected") {
        throw new Error("That session is already active.");
    }
    if (typeof startAccount !== "function") throw new Error("The account connector is not available.");
    const hasRegisteredCredentials = readSavedCredentials(id).registered;
    if (!hasRegisteredCredentials && session.type === "primary") {
        throw new Error("The primary session has no linked credentials. Use the terminal pairing flow or connect a new session.");
    }
    if (!hasRegisteredCredentials) {
        throw new Error("This session has no registered credentials. Use .connect new to start pairing without replacing its files.");
    }
    const method = hasRegisteredCredentials ? "resume" : "qr";

    session.status = "connecting";
    session.autoReconnect = true;
    session.persisted = true;
    session.ownerJid = ownerJid;
    session.cancelled = false;
    session.clearRequested = false;
    writeAccounts();
    try {
        await startAccount({
            id,
            number: session.number || "",
            method,
            ownerJid,
            prefix,
            secondary: session.type !== "primary"
        });
    } catch (error) {
        session.status = "error";
        session.autoReconnect = false;
        session.ownerJid = null;
        writeAccounts();
        throw error;
    }
    return id;
}

async function logout(id) {
    const session = sessions.get(id);
    if (!session) throw new Error("Unknown session ID.");
    if (!session.sock || typeof logoutAccount !== "function") {
        throw new Error("That session is offline; reconnect it before logging out.");
    }
    session.autoReconnect = false;
    session.status = "logged-out";
    session.cancelled = false;
    if (session.persisted) writeAccounts();
    await logoutAccount(id);
    session.sock = null;
}

async function deleteSession(id) {
    const session = sessions.get(id);
    if (!session) throw new Error("Unknown session ID.");
    if (id === primaryId) throw new Error("Select a different primary session before deleting this one.");
    if (session.sock) {
        if (typeof stopAccount !== "function") throw new Error("The account disconnector is not available.");
        await stopAccount(id);
    }
    fs.rmSync(sessionDirectory(id), { recursive: true, force: true });
    sessions.delete(id);
    writeAccounts();
}

async function clearAllSessions() {
    discoverSessionDirectories();
    const accounts = [...sessions.values()];
    const preservedPrimaryId = primaryId;
    const previousReconnectSettings = new Map(
        accounts.map(session => [session.id, session.autoReconnect])
    );

    for (const session of accounts) {
        session.autoReconnect = false;
        session.clearRequested = true;
    }
    try {
        writeAccounts();
    } catch (error) {
        for (const session of accounts) {
            session.autoReconnect = previousReconnectSettings.get(session.id);
            session.clearRequested = false;
        }
        throw error;
    }

    const stopErrors = [];
    for (const session of accounts) {
        if (!session.sock) continue;
        try {
            if (typeof stopAccount !== "function") {
                throw new Error("The account disconnector is not available.");
            }
            await stopAccount(session.id);
            session.sock = null;
            session.status = session.type === "primary" ? "new" : "disconnected";
        } catch (error) {
            stopErrors.push(`${session.id}: ${error.message}`);
        }
    }
    if (stopErrors.length) {
        for (const session of accounts) {
            session.autoReconnect = previousReconnectSettings.get(session.id);
            session.clearRequested = false;
        }
        writeAccounts();
        throw new Error(`Could not stop all WhatsApp sessions: ${stopErrors.join("; ")}`);
    }

    const clearedSessionIds = [];
    const removalErrors = [];
    for (const session of accounts) {
        try {
            fs.rmSync(sessionDirectory(session.id), { recursive: true, force: true });
            clearedSessionIds.push(session.id);
            if (session.id === preservedPrimaryId) {
                session.type = "primary";
                session.number = "";
                session.status = "new";
                session.lastConnectedAt = null;
                session.sock = null;
                session.persisted = false;
                session.autoReconnect = false;
                session.requestedBy = null;
                session.ownerJid = null;
                session.cancelled = false;
                session.clearRequested = true;
            } else {
                sessions.delete(session.id);
            }
        } catch (error) {
            removalErrors.push(`${session.id}: ${error.message}`);
        }
    }
    writeAccounts();

    if (removalErrors.length) {
        throw new Error(`Could not remove all saved WhatsApp sessions: ${removalErrors.join("; ")}`);
    }
    return { clearedSessionIds, primarySessionId: preservedPrimaryId };
}

async function cancelSession(session) {
    if (!session) return false;
    session.cancelled = true;
    session.status = "cancelled";
    session.autoReconnect = false;
    if (session.persisted) writeAccounts();
    session.ownerJid = null;
    session.sock = null;
    if (typeof stopAccount === "function") await stopAccount(session.id);
    return true;
}

async function cancelPending(ownerJid, includeAll = false) {
    const session = [...sessions.values()].find(item =>
        item.type === "secondary" &&
        item.status === "connecting" &&
        (includeAll || item.ownerJid === ownerJid)
    );
    return cancelSession(session);
}

async function cancelPendingSession(id) {
    const session = sessions.get(id);
    if (!session || session.type !== "secondary" || session.status !== "connecting") return false;
    return cancelSession(session);
}

function getRestorableAccounts() {
    return [...sessions.values()]
        .filter(session =>
            session.type === "secondary" &&
            session.persisted &&
            session.autoReconnect &&
            readSavedCredentials(session.id).registered
        )
        .map(({ id, number }) => ({ id, number }));
}

function shouldAutoReconnect(id) {
    const session = sessions.get(id);
    return Boolean(session && session.autoReconnect && (
        session.type === "primary" || readSavedCredentials(id).registered
    ));
}

module.exports = {
    attachSocket,
    cancelPending,
    cancelPendingSession,
    clearAllSessions,
    configure,
    connect,
    deleteSession,
    disconnect,
    discoverSessionDirectories,
    findSecondaryByNumber,
    get,
    getRestorableAccounts,
    list,
    markConnected,
    markDisconnected,
    getPrimaryId,
    registerPrimary,
    sessionDirectory,
    reconnect,
    logout,
    setPrimary,
    shouldStartOnBoot,
    shouldAutoReconnect
};
