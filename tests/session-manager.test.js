const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anonymous-md-sessions-"));
process.env.ANONYMOUS_MD_ACCOUNTS_PATH = path.join(temporaryDirectory, "accounts.json");
process.env.ANONYMOUS_MD_SESSIONS_PATH = path.join(temporaryDirectory, "sessions");

const sessions = require("../lib/session-manager");

function saveRegisteredCredentials(id, number) {
    const directory = sessions.sessionDirectory(id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "creds.json"), JSON.stringify({
        registered: true,
        me: { id: `${number}@s.whatsapp.net` }
    }));
}

after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("secondary accounts persist independently and disconnect without deleting metadata", async () => {
    let started;
    let stoppedId;
    sessions.configure({
        startAccount: async options => {
            started = options;
        },
        stopAccount: async id => {
            stoppedId = id;
        }
    });

    const id = await sessions.connect({
        number: "12345678901",
        method: "code",
        ownerJid: "owner@s.whatsapp.net"
    });
    assert.equal(id, "secondary-1");
    assert.equal(started.id, id);
    assert.equal(sessions.get(id).status, "connecting");

    const sock = { user: { id: "12345678901:2@s.whatsapp.net" } };
    sessions.attachSocket(id, sock);
    sessions.markConnected(id, sock);
    saveRegisteredCredentials(id, "12345678901");
    assert.equal(sessions.get(id).status, "connected");
    assert.equal(sessions.get(id).requestedBy, "owner@s.whatsapp.net");
    const savedAccounts = JSON.parse(fs.readFileSync(process.env.ANONYMOUS_MD_ACCOUNTS_PATH, "utf8"));
    assert.equal(savedAccounts.accounts[0].requestedBy, "owner@s.whatsapp.net");
    assert.deepEqual(sessions.getRestorableAccounts(), [
        { id, number: "12345678901" }
    ]);

    await sessions.disconnect(id);
    assert.equal(stoppedId, id);
    assert.equal(sessions.get(id).status, "disconnected");
    assert.deepEqual(sessions.getRestorableAccounts(), []);

    await sessions.reconnect(id, "owner@s.whatsapp.net");
    assert.equal(started.id, id);
    assert.equal(started.method, "resume");
});

test("pending account linking can be cancelled without persisting an account", async () => {
    let stoppedId;
    sessions.configure({
        startAccount: async () => {},
        stopAccount: async id => {
            stoppedId = id;
        }
    });
    const id = await sessions.connect({
        number: "12345678902",
        method: "code",
        ownerJid: "owner2@s.whatsapp.net"
    });

    assert.equal(await sessions.cancelPending("owner2@s.whatsapp.net"), true);
    assert.equal(stoppedId, id);
    assert.equal(sessions.get(id).status, "cancelled");
    assert.equal(sessions.shouldAutoReconnect(id), false);
});

test("connect creates a separate session without replacing an active same-number session", async () => {
    const started = [];
    sessions.configure({ startAccount: async options => started.push(options) });

    const existingId = await sessions.connect({
        number: "12345678903",
        method: "code",
        ownerJid: "fresh-owner@s.whatsapp.net"
    });
    const existingSocket = { user: { id: "12345678903@s.whatsapp.net" } };
    sessions.markConnected(existingId, existingSocket);

    const freshId = await sessions.connect({
        number: "12345678903",
        method: "code",
        ownerJid: "fresh-owner@s.whatsapp.net"
    });

    assert.notEqual(freshId, existingId);
    assert.equal(started.at(-1).id, freshId);
    assert.equal(sessions.get(existingId).status, "connected");
    assert.equal(sessions.get(existingId).sock, existingSocket);
    assert.equal(sessions.get(freshId).status, "connecting");
    assert.equal(sessions.shouldAutoReconnect(freshId), false);

    sessions.markConnected(freshId, { user: { id: "12345678903@s.whatsapp.net" } });
    saveRegisteredCredentials(freshId, "12345678903");
    assert.equal(sessions.shouldAutoReconnect(freshId), true);
});

test("logout preserves auth files and explicit deletion removes only the selected session", async () => {
    let loggedOutId;
    sessions.configure({
        startAccount: async () => {},
        stopAccount: async () => {},
        logoutAccount: async id => {
            loggedOutId = id;
        }
    });

    const id = await sessions.connect({
        number: "12345678904",
        method: "code",
        ownerJid: "fresh-owner@s.whatsapp.net"
    });
    const sock = { user: { id: "12345678904@s.whatsapp.net" } };
    sessions.markConnected(id, sock);
    saveRegisteredCredentials(id, "12345678904");
    const directory = sessions.sessionDirectory(id);

    await sessions.logout(id);
    assert.equal(loggedOutId, id);
    assert.equal(sessions.get(id).status, "logged-out");
    assert.equal(sessions.shouldAutoReconnect(id), false);
    assert.equal(fs.existsSync(directory), true);

    await sessions.deleteSession(id);
    assert.equal(sessions.get(id), null);
    assert.equal(fs.existsSync(directory), false);

    const replacementId = await sessions.connect({
        number: "12345678908",
        method: "code",
        ownerJid: "lifecycle-owner@s.whatsapp.net"
    });
    assert.notEqual(replacementId, id);
});

test("primary selection persists the new primary and retains the former primary", async () => {
    const primarySocket = { user: { id: "12345678905@s.whatsapp.net" } };
    sessions.registerPrimary("account-1", primarySocket);
    sessions.markConnected("account-1", primarySocket);

    const secondaryId = await sessions.connect({
        number: "12345678906",
        method: "code",
        ownerJid: "primary-owner@s.whatsapp.net",
        forceNew: true
    });
    sessions.markConnected(secondaryId, {
        user: { id: "12345678906@s.whatsapp.net" }
    });

    assert.equal(sessions.setPrimary(secondaryId), true);
    assert.equal(sessions.getPrimaryId(), secondaryId);
    assert.equal(sessions.get("account-1").type, "secondary");
    assert.equal(sessions.get(secondaryId).type, "primary");

    const saved = JSON.parse(fs.readFileSync(process.env.ANONYMOUS_MD_ACCOUNTS_PATH, "utf8"));
    assert.equal(saved.primaryId, secondaryId);
    assert.equal(saved.accounts.find(account => account.id === "account-1").type, "secondary");
});

test("registered orphaned session folders are discovered without modifying credentials", async () => {
    const id = "secondary-90";
    const directory = sessions.sessionDirectory(id);
    fs.mkdirSync(directory, { recursive: true });
    const credentialsPath = path.join(directory, "creds.json");
    const credentials = {
        registered: true,
        me: { id: "12345678907@s.whatsapp.net" }
    };
    fs.writeFileSync(credentialsPath, JSON.stringify(credentials));

    sessions.discoverSessionDirectories();

    assert.equal(sessions.get(id).status, "disconnected");
    assert.equal(sessions.get(id).number, "12345678907");
    assert.deepEqual(sessions.getRestorableAccounts().find(account => account.id === id), {
        id,
        number: "12345678907"
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(credentialsPath, "utf8")), credentials);
});

test("registered sessions restore independently from registry after manager restart", async () => {
    const id = await sessions.connect({
        number: "12345678909",
        method: "code",
        ownerJid: "restart-owner@s.whatsapp.net"
    });
    sessions.markConnected(id, { user: { id: "12345678909@s.whatsapp.net" } });
    saveRegisteredCredentials(id, "12345678909");

    const managerPath = require.resolve("../lib/session-manager");
    delete require.cache[managerPath];
    const restartedManager = require(managerPath);

    assert.equal(restartedManager.get(id).status, "disconnected");
    assert.deepEqual(restartedManager.getRestorableAccounts().find(account => account.id === id), {
        id,
        number: "12345678909"
    });
});

test("connect creates a new secondary while preserving existing primary credentials", async () => {
    const primaryId = sessions.getPrimaryId("account-1");
    const primaryDirectory = sessions.sessionDirectory(primaryId);
    fs.mkdirSync(primaryDirectory, { recursive: true });
    const primaryCredentialsPath = path.join(primaryDirectory, "creds.json");
    const originalCredentials = Buffer.from(JSON.stringify({
        registered: true,
        me: { id: "12345678910@s.whatsapp.net" },
        marker: "keep-existing-primary"
    }));
    fs.writeFileSync(primaryCredentialsPath, originalCredentials);
    sessions.configure({ startAccount: async () => {} });

    const newId = await sessions.connect({
        number: "12345678911",
        method: "code",
        ownerJid: "primary-preservation-owner@s.whatsapp.net"
    });

    assert.notEqual(newId, primaryId);
    assert.match(newId, /^secondary-\d+$/);
    assert.equal(fs.existsSync(primaryCredentialsPath), true);
    assert.deepEqual(fs.readFileSync(primaryCredentialsPath), originalCredentials);
    assert.equal(fs.existsSync(sessions.sessionDirectory(newId)), true);
});

test("bulk clear disconnects and removes every account while retaining an unlinked primary", async () => {
    const stoppedIds = [];
    sessions.configure({
        startAccount: async () => {},
        stopAccount: async id => stoppedIds.push(id)
    });

    const primaryId = sessions.getPrimaryId("account-1");
    const primarySocket = { user: { id: "12345678912@s.whatsapp.net" } };
    sessions.registerPrimary(primaryId, primarySocket);
    sessions.markConnected(primaryId, primarySocket);
    saveRegisteredCredentials(primaryId, "12345678912");

    const secondaryId = await sessions.connect({
        number: "12345678913",
        method: "code",
        ownerJid: "bulk-clear-owner@s.whatsapp.net"
    });
    const secondarySocket = { user: { id: "12345678913@s.whatsapp.net" } };
    sessions.markConnected(secondaryId, secondarySocket);
    saveRegisteredCredentials(secondaryId, "12345678913");

    const sessionsBeforeClear = sessions.list();
    const result = await sessions.clearAllSessions();

    assert.equal(result.clearedSessionIds.length, sessionsBeforeClear.length);
    assert.equal(result.primarySessionId, primaryId);
    assert.ok(stoppedIds.includes(primaryId));
    assert.ok(stoppedIds.includes(secondaryId));
    assert.equal(fs.existsSync(sessions.sessionDirectory(primaryId)), false);
    assert.equal(fs.existsSync(sessions.sessionDirectory(secondaryId)), false);
    assert.deepEqual(sessions.list(), [{
        id: primaryId,
        type: "primary",
        number: "",
        status: "new",
        lastConnectedAt: null
    }]);
    assert.deepEqual(sessions.getRestorableAccounts(), []);
    assert.equal(sessions.shouldStartOnBoot(primaryId), true);
});

test("bulk clear preserves saved credentials if a live account cannot be stopped", async () => {
    sessions.configure({
        startAccount: async () => {},
        stopAccount: async () => {
            throw new Error("socket could not be closed");
        }
    });
    const id = await sessions.connect({
        number: "12345678914",
        method: "code",
        ownerJid: "bulk-clear-failure-owner@s.whatsapp.net"
    });
    const sock = { user: { id: "12345678914@s.whatsapp.net" } };
    sessions.markConnected(id, sock);
    saveRegisteredCredentials(id, "12345678914");
    const credentialsDirectory = sessions.sessionDirectory(id);

    await assert.rejects(sessions.clearAllSessions(), /Could not stop all WhatsApp sessions/);

    assert.equal(sessions.get(id).sock, sock);
    assert.equal(sessions.get(id).clearRequested, false);
    assert.equal(sessions.shouldAutoReconnect(id), true);
    assert.equal(fs.existsSync(credentialsDirectory), true);
});
