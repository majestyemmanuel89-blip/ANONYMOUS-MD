const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anonymous-md-interactive-menu-"));
const settingsPath = path.join(temporaryDirectory, "settings.json");
process.env.ANONYMOUS_MD_SETTINGS_PATH = settingsPath;
process.env.ANONYMOUS_MD_VIDEOS_PATH = path.join(temporaryDirectory, "videos");
process.env.OWNER_NUMBER = "15559990000";
fs.writeFileSync(settingsPath, JSON.stringify({ prefix: ".", mode: "public", menuVideoEnabled: false }));

const core = require("../commands/core");
const interactiveMenu = require("../lib/interactive-menu");
const { getVerifiedMenuCategories } = require("../lib/menu-catalog");
const {
    canExecuteCommand,
    commandModules,
    handleCommand
} = require("../lib/command-handler");

after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

beforeEach(() => {
    interactiveMenu.cleanupExpiredInteractions(Number.MAX_SAFE_INTEGER);
});

let messageCounter = 0;

function createContext(senderJid, jid = senderJid, accountName = "account-1") {
    const sentMessages = [];
    const sock = {
        user: { id: "bot@s.whatsapp.net" },
        sendMessage: async (target, payload) => {
            const result = {
                key: { id: `menu-message-${++messageCounter}`, remoteJid: target },
                payload
            };
            sentMessages.push(result);
            return result;
        },
        groupMetadata: async groupJid => ({
            id: groupJid,
            subject: "Test group",
            participants: [
                { id: senderJid, admin: senderJid.includes("admin") ? "admin" : null },
                { id: "bot@s.whatsapp.net", admin: "admin" }
            ]
        })
    };

    return {
        sock,
        sentMessages,
        msg: {
            key: {
                remoteJid: jid,
                participant: jid.endsWith("@g.us") ? senderJid : undefined,
                fromMe: false
            },
            message: { conversation: ".menu" }
        },
        command: "menu",
        args: [],
        jid,
        senderJid,
        accountName,
        prefix: ".",
        botName: "ANONYMOUS MD",
        isOwner: senderJid === "15559990000@s.whatsapp.net",
        commandModules,
        runtime: () => "0d 0h 0m 1s"
    };
}

const services = {
    getCommandGroups: core.getCommandGroups,
    canExecuteCommand,
    dispatchCommand: handleCommand
};

async function openMenu(context) {
    await interactiveMenu.start(context, services);
}

function createReply(context, text, quoteId = "") {
    return {
        ...context,
        msg: {
            key: {
                remoteJid: context.jid,
                participant: context.jid.endsWith("@g.us") ? context.senderJid : undefined,
                fromMe: false
            },
            message: {
                extendedTextMessage: {
                    text,
                    contextInfo: quoteId ? { stanzaId: quoteId } : {}
                }
            }
        }
    };
}

function normalizeBoldUnicode(value) {
    return [...value].map(character => {
        const code = character.codePointAt(0);
        if (code >= 0x1d5d4 && code <= 0x1d5ed) return String.fromCodePoint(65 + code - 0x1d5d4);
        if (code >= 0x1d5ee && code <= 0x1d607) return String.fromCodePoint(97 + code - 0x1d5ee);
        if (code >= 0x1d7ec && code <= 0x1d7f5) return String.fromCodePoint(48 + code - 0x1d7ec);
        return character;
    }).join("");
}

function normalizeFullWidth(value) {
    return [...value].map(character => {
        const code = character.codePointAt(0);
        return (code >= 0xff10 && code <= 0xff19) ||
            (code >= 0xff21 && code <= 0xff3a) ||
            (code >= 0xff41 && code <= 0xff5a)
            ? String.fromCodePoint(code - 0xfee0)
            : character;
    }).join("");
}

function normalizeMenuText(value) {
    return normalizeFullWidth(normalizeBoldUnicode(value));
}

function categoryNumber(context, title) {
    const categoryLines = normalizeMenuText(context.sentMessages.at(-1).payload.text)
        .split("\n")
        .filter(line => line.includes(" — "));
    const index = categoryLines.findIndex(line => line.includes(title));
    assert.notEqual(index, -1, `Category ${title} was not displayed`);
    return String(index + 1);
}

function commandNumber(context, name) {
    const commandLines = normalizeFullWidth(context.sentMessages.at(-1).payload.text)
        .split("\n")
        .filter(line => /┃ \d+\. \*\./.test(line));
    const index = commandLines.findIndex(line => line.includes(`*.${name}*`));
    assert.notEqual(index, -1, `Command ${name} was not displayed`);
    return String(index + 1);
}

test("numeric replies are ignored without an active menu", async () => {
    const context = createContext("15550000001@s.whatsapp.net");
    const handled = await interactiveMenu.handleIncoming(
        createReply(context, "1"),
        services
    );

    assert.equal(handled, false);
    assert.equal(context.sentMessages.length, 0);
});

test("group menu state is isolated per sender and validates quoted menu IDs", async () => {
    const groupJid = "120363000000000000@g.us";
    const alice = createContext("15550000001@s.whatsapp.net", groupJid);
    const bob = createContext("15550000002@s.whatsapp.net", groupJid);
    await openMenu(alice);
    await openMenu(bob);

    const aliceMainId = alice.sentMessages.at(-1).key.id;
    const bobMainId = bob.sentMessages.at(-1).key.id;
    assert.doesNotMatch(normalizeMenuText(alice.sentMessages.at(-1).payload.text), /OWNER/);
    assert.equal(interactiveMenu.getActiveStateCount(), 2);

    await interactiveMenu.handleIncoming(createReply(alice, categoryNumber(alice, "GROUP"), aliceMainId), services);
    assert.match(normalizeMenuText(alice.sentMessages.at(-1).payload.text), /〔 🤖 GROUP COMMANDS 〕/);
    assert.doesNotMatch(normalizeMenuText(alice.sentMessages.at(-1).payload.text), /\.kick\*/);

    const aliceCategoryId = alice.sentMessages.at(-1).key.id;
    const beforeStaleReply = alice.sentMessages.length;
    await interactiveMenu.handleIncoming(createReply(alice, "1", aliceMainId), services);
    assert.equal(alice.sentMessages.length, beforeStaleReply);

    await interactiveMenu.handleIncoming(createReply(bob, categoryNumber(bob, "FUN"), bobMainId), services);
    assert.match(normalizeMenuText(bob.sentMessages.at(-1).payload.text), /〔 🤖 FUN COMMANDS 〕/);
    assert.equal(interactiveMenu.getActiveStateCount(), 2);

    await interactiveMenu.handleIncoming(createReply(alice, commandNumber(alice, "groupinfo"), aliceCategoryId), services);
    assert.match(alice.sentMessages.at(-1).payload.text, /GROUP INFO/);
    assert.equal(interactiveMenu.getActiveStateCount(), 1);

    const bobCurrentMenuId = bob.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(bob, "cancel", bobCurrentMenuId), services);
    assert.equal(interactiveMenu.getActiveStateCount(), 0);
    assert.match(bob.sentMessages.at(-1).payload.text, /cancelled/i);
});

test("group admins see admin commands and can page forward and back", async () => {
    const groupJid = "120363000000000001@g.us";
    const admin = createContext("admin-member@s.whatsapp.net", groupJid);
    await openMenu(admin);
    const mainId = admin.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(admin, categoryNumber(admin, "ADMIN"), mainId), services);

    let categoryText = admin.sentMessages.at(-1).payload.text;
    assert.match(normalizeMenuText(categoryText), /🤖 ADMIN COMMANDS/);
    assert.match(categoryText, /Page 1\//);
    assert.match(normalizeMenuText(categoryText), /\.kick\*/);
    const pageCount = Number(categoryText.match(/Page 1\/(\d+)/)?.[1]);
    assert.ok(pageCount > 1);

    const firstPageId = admin.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(admin, "next", firstPageId), services);
    assert.match(admin.sentMessages.at(-1).payload.text, new RegExp(`Page 2/${pageCount}`));

    const secondPageId = admin.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(admin, "back", secondPageId), services);
    assert.match(admin.sentMessages.at(-1).payload.text, new RegExp(`Page 1/${pageCount}`));

    const previousPageId = admin.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(admin, "0", previousPageId), services);
    assert.match(normalizeBoldUnicode(admin.sentMessages.at(-1).payload.text), /SELECT A CATEGORY/);
    await interactiveMenu.handleIncoming(createReply(admin, "cancel", admin.sentMessages.at(-1).key.id), services);
});

test("admin menu hides actions that require bot-admin privileges", async () => {
    const groupJid = "120363000000000011@g.us";
    const admin = createContext("admin-member@s.whatsapp.net", groupJid);
    admin.sock.groupMetadata = async () => ({
        id: groupJid,
        participants: [
            { id: admin.senderJid, admin: "admin" },
            { id: "bot@s.whatsapp.net", admin: null }
        ]
    });

    await openMenu(admin);
    const mainId = admin.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(admin, categoryNumber(admin, "ADMIN"), mainId), services);
    const adminMenu = admin.sentMessages.at(-1).payload.text;
    assert.doesNotMatch(adminMenu, /\.kick\*/);
    assert.doesNotMatch(adminMenu, /\.getlink\*/);

    admin.command = "kick";
    admin.args = ["15550000001"];
    assert.equal(await handleCommand(admin), true);
    assert.match(admin.sentMessages.at(-1).payload.text, /I need to be a group admin first/i);
});

test("non-admin users cannot execute group-wide management controls", async () => {
    const groupJid = "120363000000000002@g.us";
    const member = createContext("15550000006@s.whatsapp.net", groupJid);
    const commandContext = {
        ...member,
        command: "mute-gc",
        args: []
    };

    assert.equal(await handleCommand(commandContext), true);
    assert.match(member.sentMessages.at(-1).payload.text, /You must be a group admin/i);

    const privateContext = createContext("15550000006@s.whatsapp.net");
    const privateCommand = { ...privateContext, command: "mute-gc", args: [] };
    assert.equal(await handleCommand(privateCommand), true);
    assert.match(privateContext.sentMessages.at(-1).payload.text, /only works in groups/i);
});

test("non-admin users cannot change group protection settings directly", async () => {
    const groupJid = "120363000000000013@g.us";
    const member = createContext("15550000006@s.whatsapp.net", groupJid);
    member.command = "antilink";
    member.args = ["on"];

    assert.equal(await handleCommand(member), true);
    assert.match(member.sentMessages.at(-1).payload.text, /must be a group admin/i);
});

test("the overlapping group leave command remains owner-only", async () => {
    const groupJid = "120363000000000003@g.us";
    const member = createContext("15550000007@s.whatsapp.net", groupJid);
    let leftGroup = false;
    member.msg.key.participant = member.senderJid;
    member.command = "leave";
    member.sock.groupMetadata = async () => ({ participants: [] });
    member.sock.groupLeave = async () => {
        leftGroup = true;
    };

    assert.equal(await handleCommand(member), true);
    assert.equal(leftGroup, false);
    assert.match(member.sentMessages.at(-1).payload.text, /configured bot owner/i);
});

test("command selection prompts for required input and executes the real handler", async () => {
    const context = createContext("15550000003@s.whatsapp.net");
    await openMenu(context);
    const mainId = context.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(context, categoryNumber(context, "UTILITY"), mainId), services);
    assert.match(normalizeMenuText(context.sentMessages.at(-1).payload.text), /〔 🤖 UTILITY COMMANDS 〕/);

    const toolsMenuId = context.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(context, commandNumber(context, "calc"), toolsMenuId), services);
    assert.match(context.sentMessages.at(-1).payload.text, /selected \*\.calc\*/i);

    const argumentPromptId = context.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(context, "1 + 2", argumentPromptId), services);
    assert.equal(context.sentMessages.at(-1).payload.text, "3");
    assert.equal(interactiveMenu.getActiveStateCount(), 0);
});

test("media-requiring owner command waits for media and invokes its existing handler", async () => {
    const owner = createContext("15559990000@s.whatsapp.net");
    let updatedProfilePicture = false;
    owner.sock.updateProfilePicture = async () => {
        updatedProfilePicture = true;
    };
    owner.downloadMediaMessage = async () => Buffer.from("mock image");

    await openMenu(owner);
    const mainId = owner.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(owner, categoryNumber(owner, "OWNER"), mainId), services);

    let categoryText = owner.sentMessages.at(-1).payload.text;
    while (!normalizeFullWidth(categoryText).includes("*.setpp*")) {
        const menuId = owner.sentMessages.at(-1).key.id;
        await interactiveMenu.handleIncoming(createReply(owner, "next", menuId), services);
        categoryText = owner.sentMessages.at(-1).payload.text;
    }

    const categoryId = owner.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(owner, commandNumber(owner, "setpp"), categoryId), services);
    assert.match(owner.sentMessages.at(-1).payload.text, /Reply with the supported media/i);

    const promptId = owner.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(owner, "not media", promptId), services);
    assert.equal(updatedProfilePicture, false);
    assert.match(owner.sentMessages.at(-1).payload.text, /Reply to this prompt with the supported image/i);

    const mediaReply = {
        ...owner,
        command: undefined,
        msg: {
            key: { remoteJid: owner.jid, fromMe: false },
            message: { imageMessage: { mimetype: "image/jpeg" } }
        }
    };
    await interactiveMenu.handleIncoming(mediaReply, services);
    assert.equal(updatedProfilePicture, true);
    assert.match(owner.sentMessages.at(-1).payload.text, /Profile picture updated/i);
    assert.equal(interactiveMenu.getActiveStateCount(), 0);
});

test("quoted-target selection accepts a reply to the target message", async () => {
    const user = createContext("15550000008@s.whatsapp.net");
    await openMenu(user);
    const mainId = user.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(user, categoryNumber(user, "UTILITY"), mainId), services);

    const utilityMenuId = user.sentMessages.at(-1).key.id;
    await interactiveMenu.handleIncoming(createReply(user, commandNumber(user, "reactto"), utilityMenuId), services);
    assert.match(user.sentMessages.at(-1).payload.text, /Reply directly to the message you want to react to/i);

    const targetReply = createReply(user, "🔥", "target-message-123");
    await interactiveMenu.handleIncoming(targetReply, services);
    const reaction = user.sentMessages.at(-1).payload.react;
    assert.equal(reaction.text, "🔥");
    assert.equal(reaction.key.id, "target-message-123");
    assert.equal(interactiveMenu.getActiveStateCount(), 0);
});

test("owner sees protected categories and regular users cannot choose hidden owner commands", async () => {
    const owner = createContext("15559990000@s.whatsapp.net");
    await openMenu(owner);
    const ownerMenu = normalizeMenuText(owner.sentMessages.at(-1).payload.text);
    assert.match(ownerMenu, /OWNER/);
    assert.match(ownerMenu, /NUMBER & SESSION MANAGEMENT/);

    const user = createContext("15550000004@s.whatsapp.net");
    await openMenu(user);
    const menuId = user.sentMessages.at(-1).key.id;
    const userMenu = normalizeMenuText(user.sentMessages.at(-1).payload.text);
    assert.doesNotMatch(userMenu, /OWNER/);
    assert.doesNotMatch(userMenu, /ADMIN/);
    await interactiveMenu.handleIncoming(createReply(user, "11", menuId), services);
    assert.match(user.sentMessages.at(-1).payload.text, /Invalid selection/);

    await interactiveMenu.handleIncoming(createReply(user, "menu", user.sentMessages.at(-1).key.id), services);
    assert.match(normalizeBoldUnicode(user.sentMessages.at(-1).payload.text), /SELECT A CATEGORY/);
    await interactiveMenu.handleIncoming(createReply(owner, "cancel", owner.sentMessages.at(-1).key.id), services);
    await interactiveMenu.handleIncoming(createReply(user, "cancel", user.sentMessages.at(-1).key.id), services);
});

test("verified catalog contains only registered available commands for each audience", () => {
    const commandGroups = core.getCommandGroups(commandModules, ".");
    const registered = new Set(commandModules.flatMap(([, module]) => module.commandNames || []));
    const publicContext = createContext("15550000009@s.whatsapp.net");
    const publicCategories = getVerifiedMenuCategories({
        context: publicContext,
        commandGroups,
        canExecuteCommand
    });
    const publicCommands = publicCategories.flatMap(category => category.commands.map(command => command.name));

    assert.ok(publicCommands.length > 0);
    assert.ok(publicCommands.every(command => registered.has(command)));
    assert.equal(publicCommands.length, 52);
    assert.ok(publicCommands.includes("love"));
    assert.ok(publicCommands.includes("dice"));
    assert.ok(publicCommands.includes("calc"));
    assert.ok(publicCommands.includes("vv"));
    assert.equal(publicCommands.includes("calculator"), false);
    for (const unavailable of ["google", "animewlp", "mich-meme", "antilink", "joinch", "mblock", "bail", "qrcode"]) {
        assert.equal(publicCommands.includes(unavailable), false, `${unavailable} must not appear in the public menu`);
    }
    assert.equal(publicCommands.some(command => ["mode", "connect", "setmenuvideo"].includes(command)), false);

    const ownerContext = createContext("15559990000@s.whatsapp.net");
    const ownerCategories = getVerifiedMenuCategories({
        context: ownerContext,
        commandGroups,
        canExecuteCommand
    });
    const ownerCommands = ownerCategories.flatMap(category => category.commands.map(command => command.name));
    assert.ok(ownerCommands.includes("mode"));
    assert.ok(ownerCommands.includes("connect"));
    assert.ok(ownerCommands.includes("setmenuvideo"));
    assert.ok(ownerCommands.every(command => registered.has(command)));
    assert.equal(ownerCommands.includes("joinch"), false);

    const groupOwnerContext = createContext("15559990000@s.whatsapp.net", "120363000000000012@g.us");
    const groupOwnerCategories = getVerifiedMenuCategories({
        context: groupOwnerContext,
        commandGroups,
        canExecuteCommand
    });
    assert.equal(groupOwnerCategories.some(category => category.title === "NUMBER & SESSION MANAGEMENT"), false);
});

test("optional usage arguments do not trigger an input prompt and expired state is cleared", async () => {
    assert.equal(interactiveMenu.requiresArguments("[new] [code <number>|qr]"), false);
    assert.equal(interactiveMenu.requiresArguments("calc <expression>"), true);

    const context = createContext("15550000005@s.whatsapp.net");
    await openMenu(context);
    assert.equal(interactiveMenu.getActiveStateCount(), 1);
    assert.equal(interactiveMenu.cleanupExpiredInteractions(Number.MAX_SAFE_INTEGER), 1);
    assert.equal(interactiveMenu.getActiveStateCount(), 0);
    assert.equal(await interactiveMenu.handleIncoming(createReply(context, "1"), services), false);
});