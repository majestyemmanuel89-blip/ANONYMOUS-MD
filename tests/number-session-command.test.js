const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anonymous-md-number-commands-"));
process.env.ANONYMOUS_MD_NUMBER_REGISTRY = path.join(temporaryDirectory, "registered-numbers.json");
process.env.ANONYMOUS_MD_ACCOUNTS_PATH = path.join(temporaryDirectory, "accounts.json");
process.env.ANONYMOUS_MD_SESSIONS_PATH = path.join(temporaryDirectory, "sessions");

const { handleCommand } = require("../commands/number-session");
const sessionManager = require("../lib/session-manager");

after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function createContext(command, args, options = {}) {
    const sentMessages = [];
    const jid = options.jid || "15551234567@s.whatsapp.net";
    const senderJid = options.senderJid || jid;
    return {
        sentMessages,
        context: {
            command,
            args,
            jid,
            senderJid,
            prefix: ".",
            isOwner: options.isOwner ?? true,
            isApproved: options.isApproved ?? false,
            isSudo: options.isSudo ?? false,
            sock: {
                sendMessage: async (target, payload) => {
                    sentMessages.push({ target, payload });
                }
            }
        }
    };
}

test("number commands require an authorized connector, stay private, mask numbers, and gate changes", async () => {
    const unauthorized = createContext("addnumber", ["2348012345678"], {
        isOwner: false,
        jid: "15550000000@s.whatsapp.net"
    });
    await handleCommand(unauthorized.context);
    assert.match(unauthorized.sentMessages[0].payload.text, /restricted to the configured bot owner/i);

    const groupRequest = createContext("addnumber", ["2348012345678"], {
        jid: "120363000000000000@g.us",
        senderJid: "15551234567@s.whatsapp.net"
    });
    await handleCommand(groupRequest.context);
    assert.match(groupRequest.sentMessages[0].payload.text, /private chat/i);

    const add = createContext("addnumber", ["+2348012345678"]);
    await handleCommand(add.context);
    assert.match(add.sentMessages[0].payload.text, /\+23\*\*\*78/);
    assert.equal(add.sentMessages[0].payload.text.includes("2348012345678"), false);

    const correction = createContext("correctnumber", ["2348012345678", "2348012345679"]);
    await handleCommand(correction.context);
    const confirmationCode = correction.sentMessages[0].payload.text.match(/\.confirm (\d{6})/)[1];
    assert.match(correction.sentMessages[0].payload.text, /changes only the registered-number list/i);

    const confirm = createContext("confirm", [confirmationCode]);
    await handleCommand(confirm.context);
    assert.match(confirm.sentMessages[0].payload.text, /completed/i);

    const list = createContext("listnumbers", []);
    await handleCommand(list.context);
    assert.match(list.sentMessages[0].payload.text, /\+23\*\*\*79/);
    assert.equal(list.sentMessages[0].payload.text.includes("2348012345679"), false);
});

test("only the owner can manage sessions, and owner retains global control", async () => {
    const started = [];
    const stopped = [];
    sessionManager.configure({
        startAccount: async options => started.push(options),
        stopAccount: async id => stopped.push(id)
    });

    const firstJid = "15550000001@s.whatsapp.net";
    const secondJid = "15550000002@s.whatsapp.net";
    const firstConnect = createContext("connect", ["code", "15551234570"], {
        isOwner: true,
        jid: firstJid
    });
    await handleCommand(firstConnect.context);
    assert.match(firstConnect.sentMessages[0].payload.text, /Started a separate account connection/);

    const secondConnect = createContext("connect", ["code", "15551234571"], {
        isOwner: true,
        jid: secondJid
    });
    await handleCommand(secondConnect.context);
    assert.match(secondConnect.sentMessages[0].payload.text, /Started a separate account connection/);
    assert.equal(started.length, 2);

    const firstSessionId = started[0].id;
    const secondSessionId = started[1].id;
    assert.equal(sessionManager.get(firstSessionId).requestedBy, firstJid);
    assert.equal(sessionManager.get(secondSessionId).requestedBy, secondJid);

    const firstList = createContext("sessions", [], {
        isOwner: true,
        jid: firstJid
    });
    await handleCommand(firstList.context);
    assert.match(firstList.sentMessages[0].payload.text, new RegExp(firstSessionId));
    assert.match(firstList.sentMessages[0].payload.text, new RegExp(secondSessionId));

    const deniedDisconnect = createContext("disconnect", ["15551234571"], {
        isOwner: false,
        isApproved: true,
        jid: firstJid
    });
    await handleCommand(deniedDisconnect.context);
    assert.match(deniedDisconnect.sentMessages[0].payload.text, /restricted to the configured bot owner/i);

    const firstCancel = createContext("cancelconnect", [], {
        isOwner: true,
        jid: firstJid
    });
    await handleCommand(firstCancel.context);
    assert.match(firstCancel.sentMessages[0].payload.text, /cancelled/i);
    assert.equal(sessionManager.get(firstSessionId).status, "cancelled");
    assert.equal(sessionManager.get(secondSessionId).status, "connecting");

    const ownerList = createContext("sessions", [], {
        isOwner: true,
        jid: "15559999999@s.whatsapp.net"
    });
    await handleCommand(ownerList.context);
    assert.match(ownerList.sentMessages[0].payload.text, new RegExp(secondSessionId));

    const ownerCancel = createContext("cancelconnect", [], {
        isOwner: true,
        jid: "15559999999@s.whatsapp.net"
    });
    await handleCommand(ownerCancel.context);
    assert.match(ownerCancel.sentMessages[0].payload.text, /cancelled/i);
    assert.equal(sessionManager.get(secondSessionId).status, "cancelled");
    assert.deepEqual(stopped, [firstSessionId, secondSessionId]);
});

test("connect and connect new create independent fresh sessions", async () => {
    const started = [];
    sessionManager.configure({ startAccount: async options => started.push(options) });

    const first = createContext("connect", [], {
        isOwner: true,
        jid: "15550000003@s.whatsapp.net"
    });
    await handleCommand(first.context);
    assert.match(first.sentMessages[0].payload.text, /Started a separate account connection/);
    assert.equal(started[0].method, "qr");

    const second = createContext("connect", ["code", "15551234572"], {
        isOwner: true,
        jid: "15550000004@s.whatsapp.net"
    });
    await handleCommand(second.context);
    assert.match(second.sentMessages[0].payload.text, /Started a separate account connection/);
    assert.equal(started[1].method, "code");

    const third = createContext("connect", ["new", "code", "15551234572"], {
        isOwner: true,
        jid: "15550000005@s.whatsapp.net"
    });
    await handleCommand(third.context);
    assert.match(third.sentMessages[0].payload.text, /Started a separate account connection/);
    assert.equal(started[2].method, "code");
    assert.equal(started[2].number, "15551234572");
    assert.notEqual(started[1].id, started[2].id);
});

test("session lifecycle commands target IDs and require confirmation for disconnect, logout, and deletion", async () => {
    let stoppedId;
    let loggedOutId;
    const started = [];
    sessionManager.configure({
        startAccount: async options => started.push(options),
        stopAccount: async id => {
            stoppedId = id;
        },
        logoutAccount: async id => {
            loggedOutId = id;
        }
    });

    const ownerJid = "15550000006@s.whatsapp.net";
    const id = await sessionManager.connect({
        number: "15551234573",
        method: "code",
        ownerJid,
        forceNew: true
    });
    const socket = { user: { id: "15551234573@s.whatsapp.net" } };
    sessionManager.markConnected(id, socket);
    const directory = sessionManager.sessionDirectory(id);
    fs.writeFileSync(path.join(directory, "creds.json"), JSON.stringify({
        registered: true,
        me: { id: "15551234573@s.whatsapp.net" }
    }));

    const status = createContext("sessionstatus", [id], { jid: ownerJid });
    await handleCommand(status.context);
    assert.match(status.sentMessages[0].payload.text, new RegExp(`${id}.*connected`));

    const disconnect = createContext("disconnect", [id], { jid: ownerJid });
    await handleCommand(disconnect.context);
    const disconnectCode = disconnect.sentMessages[0].payload.text.match(/\.confirm (\d{6})/)[1];
    assert.equal(sessionManager.get(id).status, "connected");

    const confirmDisconnect = createContext("confirm", [disconnectCode], { jid: ownerJid });
    await handleCommand(confirmDisconnect.context);
    assert.equal(stoppedId, id);
    assert.equal(sessionManager.get(id).status, "disconnected");
    assert.equal(fs.existsSync(directory), true);

    const reconnect = createContext("reconnect", [id], { jid: ownerJid });
    await handleCommand(reconnect.context);
    assert.match(reconnect.sentMessages[0].payload.text, /Current status: connecting/);
    assert.equal(started.at(-1).id, id);

    sessionManager.attachSocket(id, socket);
    sessionManager.markConnected(id, socket);
    const logout = createContext("logout", [id], { jid: ownerJid });
    await handleCommand(logout.context);
    const logoutCode = logout.sentMessages[0].payload.text.match(/\.confirm (\d{6})/)[1];
    assert.equal(sessionManager.get(id).status, "connected");

    const confirmLogout = createContext("confirm", [logoutCode], { jid: ownerJid });
    await handleCommand(confirmLogout.context);
    assert.equal(loggedOutId, id);
    assert.equal(sessionManager.get(id).status, "logged-out");
    assert.equal(fs.existsSync(directory), true);

    const deleteSession = createContext("deletesession", [id], { jid: ownerJid });
    await handleCommand(deleteSession.context);
    const deleteCode = deleteSession.sentMessages[0].payload.text.match(/\.confirm (\d{6})/)[1];
    assert.equal(fs.existsSync(directory), true);

    const confirmDelete = createContext("confirm", [deleteCode], { jid: ownerJid });
    await handleCommand(confirmDelete.context);
    assert.equal(sessionManager.get(id), null);
    assert.equal(fs.existsSync(directory), false);
});
