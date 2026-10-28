const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anonymous-md-command-settings-"));
const testSettingsPath = path.join(temporaryDirectory, "settings.json");
process.env.ANONYMOUS_MD_SETTINGS_PATH = testSettingsPath;
fs.writeFileSync(testSettingsPath, JSON.stringify({ mode: "public", prefix: "." }));

after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function setTestMode(mode) {
    const settings = JSON.parse(fs.readFileSync(testSettingsPath, "utf8"));
    settings.mode = mode;
    fs.writeFileSync(testSettingsPath, JSON.stringify(settings));
}

const core = require("../commands/core");
const { approveUser, isApproved, isOwner, unapproveUser } = require("../lib/auth");
const createMessageDeduplicator = require("../lib/message-dedupe");
const {
    commandModules,
    getRegisteredCommandCount,
    handleCommand
} = require("../lib/command-handler");

function normalizeFullWidth(value) {
    return [...value].map(character => {
        const code = character.codePointAt(0);
        if ((code >= 0xff10 && code <= 0xff19) ||
            (code >= 0xff21 && code <= 0xff3a) ||
            (code >= 0xff41 && code <= 0xff5a)) {
            return String.fromCodePoint(code - 0xfee0);
        }
        if (code >= 0x1d5d4 && code <= 0x1d5ed) return String.fromCodePoint(65 + code - 0x1d5d4);
        if (code >= 0x1d5ee && code <= 0x1d607) return String.fromCodePoint(97 + code - 0x1d5ee);
        if (code >= 0x1d7ec && code <= 0x1d7f5) return String.fromCodePoint(48 + code - 0x1d7ec);
        return character;
    }).join("");
}

function createContext(command, args = [], jid = "not-a-real-user@s.whatsapp.net") {
    const sentMessages = [];
    const sock = {
        sendMessage: async (target, payload) => {
            sentMessages.push({ target, payload });
        }
    };

    return {
        context: {
            sock,
            msg: { key: { remoteJid: jid, fromMe: false } },
            command,
            args,
            jid,
            senderJid: jid,
            fromMe: false,
            botName: "ANONYMOUS MD",
            prefix: "."
        },
        sentMessages
    };
}

test("private mode denies regular users while public mode allows normal commands", async () => {
    setTestMode("public");
    const { context, sentMessages } = createContext("ping");
    const handled = await handleCommand(context);

    assert.equal(handled, true);
    assert.match(sentMessages[0].payload.text, /PONG/i);

    setTestMode("private");
    const privateUser = createContext("menu");
    assert.equal(await handleCommand(privateUser.context), true);
    assert.match(privateUser.sentMessages[0].payload.text, /not authorized/i);

    setTestMode("public");
    const ownerCommand = createContext("setsudo");
    assert.equal(await handleCommand(ownerCommand.context), true);
    assert.match(ownerCommand.sentMessages[0].payload.text, /configured bot owner/i);

    const sessions = createContext("sessions");
    assert.equal(await handleCommand(sessions.context), true);
    assert.match(sessions.sentMessages[0].payload.text, /configured bot owner/i);

    const videoSettings = createContext("menuvideo", ["off"]);
    assert.equal(await handleCommand(videoSettings.context), true);
    assert.match(videoSettings.sentMessages[0].payload.text, /owner-only/i);
});

test("owner-only .mode command switches public and private access", async () => {
    const previousOwnerNumber = process.env.OWNER_NUMBER;
    const ownerNumber = "15559990000";
    const ownerJid = `${ownerNumber}@s.whatsapp.net`;
    process.env.OWNER_NUMBER = ownerNumber;

    try {
        const makePrivate = createContext("mode", ["private"], ownerJid);
        assert.equal(await handleCommand(makePrivate.context), true);
        assert.equal(JSON.parse(fs.readFileSync(testSettingsPath, "utf8")).mode, "private");

        const user = createContext("ping");
        assert.equal(await handleCommand(user.context), true);
        assert.match(user.sentMessages[0].payload.text, /not authorized/i);

        const makePublic = createContext("mode", ["public"], ownerJid);
        assert.equal(await handleCommand(makePublic.context), true);
        assert.equal(JSON.parse(fs.readFileSync(testSettingsPath, "utf8")).mode, "public");
    } finally {
        if (previousOwnerNumber === undefined) delete process.env.OWNER_NUMBER;
        else process.env.OWNER_NUMBER = previousOwnerNumber;
        setTestMode("public");
    }
});

test("message deduplication is shared across sessions and remains bounded", () => {
    const isDuplicateMessage = createMessageDeduplicator(2);
    const first = { key: { remoteJid: "chat@g.us", id: "message-1" } };
    const second = { key: { remoteJid: "chat@g.us", id: "message-2" } };
    const third = { key: { remoteJid: "chat@g.us", id: "message-3" } };

    assert.equal(isDuplicateMessage(first), false);
    assert.equal(isDuplicateMessage(first), true);
    assert.equal(isDuplicateMessage(second), false);
    assert.equal(isDuplicateMessage(third), false);
    assert.equal(isDuplicateMessage(first), false);
    assert.equal(isDuplicateMessage({ key: { remoteJid: "chat@g.us" } }), false);
});

test("configured owner can use the menu and owner commands without registration", async () => {
    const previousOwnerNumber = process.env.OWNER_NUMBER;
    const ownerNumber = "1".repeat(10);
    process.env.OWNER_NUMBER = ownerNumber;

    try {
        const ownerJid = `${ownerNumber}@s.whatsapp.net`;
        assert.equal(isOwner(ownerJid), true);

        const menu = createContext("menu", [], ownerJid);
        assert.equal(await handleCommand(menu.context), true);
        assert.equal(menu.sentMessages.length, 1);
        const menuText = normalizeFullWidth(menu.sentMessages[0].payload.text);
        assert.match(menuText, /OWNER/);
        assert.match(menuText, /➫ \.mode/);

        const setsudo = createContext("setsudo", [], ownerJid);
        assert.equal(await handleCommand(setsudo.context), true);
        assert.match(setsudo.sentMessages[0].payload.text, /Usage: \.setsudo/);
    } finally {
        if (previousOwnerNumber === undefined) delete process.env.OWNER_NUMBER;
        else process.env.OWNER_NUMBER = previousOwnerNumber;
    }
});

test("wrong numbers and arbitrary LID chat mappings do not receive owner access", async () => {
    setTestMode("private");
    const previousOwnerNumber = process.env.OWNER_NUMBER;
    const ownerNumber = "1".repeat(10);
    process.env.OWNER_NUMBER = ownerNumber;

    try {
        const strangerJid = "2".repeat(10) + "@s.whatsapp.net";
        assert.equal(isOwner(strangerJid), false);
        assert.equal(isOwner("123456789@lid", {
            msg: { key: { remoteJidAlt: `${ownerNumber}@s.whatsapp.net` } }
        }), false);

        const ping = createContext("ping", [], strangerJid);
        assert.equal(await handleCommand(ping.context), true);
        assert.match(ping.sentMessages[0].payload.text, /not authorized/i);
    } finally {
        if (previousOwnerNumber === undefined) delete process.env.OWNER_NUMBER;
        else process.env.OWNER_NUMBER = previousOwnerNumber;
        setTestMode("public");
    }
});

test("register does not approve a user while public and approved users remain usable", async () => {
    const previousOwnerNumber = process.env.OWNER_NUMBER;
    delete process.env.OWNER_NUMBER;

    const approvedJid = "3".repeat(10) + "@s.whatsapp.net";
    const alreadyApproved = isApproved(approvedJid);
    try {
        const registration = createContext("register");
        assert.equal(await handleCommand(registration.context), true);
        assert.match(registration.sentMessages[0].payload.text, /contact the bot owner/i);
        assert.equal(isApproved(registration.context.senderJid), false);

        const publicPing = createContext("ping");
        assert.equal(await handleCommand(publicPing.context), true);
        assert.match(publicPing.sentMessages[0].payload.text, /PONG/i);

        approveUser(approvedJid);
        const approved = createContext("ping", [], approvedJid);
        assert.equal(await handleCommand(approved.context), true);
        assert.match(approved.sentMessages[0].payload.text, /PONG/i);

        const lidApproved = createContext("sessions", [], "123456789@lid");
        lidApproved.context.msg.key.senderPn = approvedJid;
        assert.equal(await handleCommand(lidApproved.context), true);
        assert.match(lidApproved.sentMessages[0].payload.text, /restricted to the configured bot owner/i);

        const sessions = createContext("sessions", [], approvedJid);
        assert.equal(await handleCommand(sessions.context), true);
        assert.match(sessions.sentMessages[0].payload.text, /restricted to the configured bot owner/i);
    } finally {
        if (!alreadyApproved) unapproveUser(approvedJid);
        if (previousOwnerNumber === undefined) delete process.env.OWNER_NUMBER;
        else process.env.OWNER_NUMBER = previousOwnerNumber;
    }
});

test("help is public and handles registered command usage", async () => {
    const { context, sentMessages } = createContext("help", ["ping"]);
    const handled = await handleCommand(context);

    assert.equal(handled, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].payload.text, /\.ping/);
    assert.match(sentMessages[0].payload.text, /response time/i);
});

test("menu lists all available commands in one message and omits unavailable examples", async () => {
    const { context, sentMessages } = createContext("menu");
    assert.equal(await handleCommand(context), true);
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].payload.text.includes("𝗺𝗲𝗻𝘂"));
    assert.ok(sentMessages[0].payload.text.includes("╭──〔 亗 𝗚𝗘𝗡𝗘𝗥𝗔𝗟 〕──╮"));
    assert.ok(sentMessages[0].payload.text.includes("❏◦ ➫ .𝗳𝗲𝗲𝗱𝗯𝗮𝗰𝗸 <message>"));
    const menu = normalizeFullWidth(sentMessages.map(item => item.payload.text).join("\n"));
    assert.doesNotMatch(menu, /𝗦𝗘𝗟𝗘𝗖𝗧 𝗔 𝗖𝗔𝗧𝗘𝗚𝗢𝗥𝗬/);
    assert.match(menu, /GENERAL/);
    assert.match(menu, /FUN/);
    assert.match(menu, /➫ \.ping/);
    assert.match(menu, /➫ \.dice/);
    assert.match(menu, /Cmds.*52/);
    assert.match(menu, /➫ \.vv/);
    assert.doesNotMatch(menu, /AI & CHATBOT/);
    assert.equal(getRegisteredCommandCount(), 279);
});

test("legacy general and fun commands are registered and execute through the real dispatcher", async () => {
    setTestMode("public");
    const registered = new Set(commandModules.flatMap(([, module]) => module.commandNames || []));
    const expectedOutput = {
        bot: /Version: 1\.0\.0/,
        status: /connected/,
        love: /LOVE METER/,
        dice: /You rolled: \*[1-6]\*/
    };
    for (const [command, expected] of Object.entries(expectedOutput)) {
        assert.equal(registered.has(command), true);
        const { context, sentMessages } = createContext(command);
        context.sessionInfo = { status: "connected" };
        context.runtime = () => "2d 3h 4m 5s";
        assert.equal(await handleCommand(context), true);
        assert.equal(sentMessages.length, 1);
        assert.match(sentMessages[0].payload.text, expected);
    }
});

test("help reports unknown commands without claiming they are supported", async () => {
    const { context, sentMessages } = createContext("help", ["not-a-command"]);
    const handled = await handleCommand(context);

    assert.equal(handled, true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].payload.text, /No registered command/i);
});

test("core command help can render directly with a mocked WhatsApp socket", async () => {
    const { context, sentMessages } = createContext("help", ["feedback"]);
    await core.handleCoreCommand(
        context.sock,
        context.msg,
        context.command,
        context.args,
        { commandModules, prefix: "." }
    );

    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].payload.text, /\.feedback <message>/);
    assert.match(sentMessages[0].payload.text, /Example:/);
});
