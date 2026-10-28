const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anonymous-md-menu-video-"));
const videosDirectory = path.join(temporaryDirectory, "videos");
const settingsPath = path.join(temporaryDirectory, "settings.json");
fs.mkdirSync(videosDirectory, { recursive: true });
process.env.ANONYMOUS_MD_VIDEOS_PATH = videosDirectory;
process.env.ANONYMOUS_MD_SETTINGS_PATH = settingsPath;
fs.writeFileSync(settingsPath, JSON.stringify({
    prefix: "!",
    mode: "private",
    menuVideoEnabled: true,
    menuVideoFile: "menu.mp4"
}));

const core = require("../commands/core");
const menuVideoCommands = require("../commands/menu-video");
const menuVideo = require("../lib/menu-video");
const interactiveMenu = require("../lib/interactive-menu");
const { canExecuteCommand, commandModules, getRegisteredCommandCount } = require("../lib/command-handler");

after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function createContext(command = "menu", args = [], options = {}) {
    const sentMessages = [];
    const jid = options.jid || "15551234567@s.whatsapp.net";
    return {
        sentMessages,
        sock: {
            sendMessage: async (target, payload) => {
                if (options.failVideo && payload.video) throw new Error("mock send failure");
                sentMessages.push({ target, payload });
            }
        },
        msg: { key: { remoteJid: jid } },
        command,
        args,
        jid,
        senderJid: jid,
        isOwner: options.isOwner ?? true,
        commandModules,
        botName: "ANONYMOUS MD",
        accountName: "secondary-23",
        sessionInfo: {
            id: "secondary-23",
            type: "secondary",
            status: "connected",
            number: "2348012345678"
        },
        runtime: () => "1d 2h 3m 4s",
        prefix: "!"
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

async function runMenu(context) {
    await core.handleCoreCommand(context.sock, context.msg, context.command, context.args, context);
}

async function runVideoCommand(context) {
    await menuVideoCommands.handleCommand(context);
}

test("menu sends the styled full command list as one text message, even when a menu video is enabled", async () => {
    fs.writeFileSync(path.join(videosDirectory, "menu.mp4"), "mock mp4 payload");
    menuVideo.saveMenuVideoSettings({ menuVideoEnabled: true, menuVideoFile: "menu.mp4" });
    const context = createContext();

    await runMenu(context);

    assert.equal(context.sentMessages.length, 1);
    const { payload } = context.sentMessages[0];
    assert.equal(payload.video, undefined);
    assert.equal(typeof payload.text, "string");
    const text = normalizeMenuText(payload.text);
    assert.match(text, /ANONYMOUS MD/);
    assert.match(text, /Prefix ⇆ !/);
    assert.match(text, /Cmds ⇆ 112/);
    assert.match(text, /Uptime ⇆ 1d 2h 3m 4s/);
    assert.match(text, /Mode ⇆ private/);
    assert.match(text, /Status ⇆ connected/);
    assert.match(text, /Version ⇆ 1\.0\.0/);
    assert.match(text, /Session ⇆ secondary-23 \(\+23\*\*\*78\)/);
    assert.match(text, /╭──〔 亗 OWNER 〕──╮/);
    assert.match(text, /❏◦ ➫ !menu/);
    assert.equal(text.includes("2348012345678"), false);

    const visibleCategories = await interactiveMenu.getAvailableCategories(context, {
        getCommandGroups: core.getCommandGroups,
        canExecuteCommand
    });
    const expectedCommands = visibleCategories
        .flatMap(category => category.commands.map(command => command.name))
        .sort();
    const menuText = text;
    const captionCommands = menuText.split("\n")
        .filter(line => line.startsWith("❏◦ ➫ !"))
        .map(line => line.slice("❏◦ ➫ !".length).split(/[\s(]/, 1)[0])
        .sort();
    assert.deepEqual(captionCommands, expectedCommands);
});

test("menu keeps phone-number session identifiers masked in system info", async () => {
    fs.writeFileSync(path.join(videosDirectory, "menu.mp4"), "mock mp4 payload");
    menuVideo.saveMenuVideoSettings({ menuVideoEnabled: true, menuVideoFile: "menu.mp4" });
    const context = createContext();
    context.sessionInfo.id = "2348012345678";

    await runMenu(context);

    assert.equal(context.sentMessages.length, 1);
    assert.equal(context.sentMessages[0].payload.video, undefined);
    const text = normalizeBoldUnicode(context.sentMessages[0].payload.text);
    assert.equal(text.includes("2348012345678"), false);
    assert.match(text, /Session ⇆ user-23\*\*\*78/);
});

test("disabled or missing menu video leaves the text menu available", async () => {
    const videoPath = path.join(videosDirectory, "menu.mp4");
    if (!fs.existsSync(videoPath)) fs.writeFileSync(videoPath, "mock mp4 payload");

    menuVideo.saveMenuVideoSettings({ menuVideoEnabled: false });
    const disabled = createContext();
    await runMenu(disabled);
    assert.equal(disabled.sentMessages.length, 1);
    assert.match(normalizeBoldUnicode(disabled.sentMessages[0].payload.text), /ANONYMOUS MD/);

    menuVideo.saveMenuVideoSettings({ menuVideoEnabled: true, menuVideoFile: "missing.mp4" });
    const missing = createContext();
    await runMenu(missing);
    assert.equal(missing.sentMessages.length, 1);
    assert.equal(missing.sentMessages[0].payload.video, undefined);
    assert.match(normalizeMenuText(missing.sentMessages[0].payload.text), /GENERAL/);
});

test("menu output remains text-only even when a menu video is configured", async () => {
    fs.writeFileSync(path.join(videosDirectory, "menu.mp4"), "mock mp4 payload");
    menuVideo.saveMenuVideoSettings({ menuVideoEnabled: true, menuVideoFile: "menu.mp4" });
    const context = createContext("menu", [], { failVideo: true });

    await runMenu(context);

    assert.equal(context.sentMessages.length, 1);
    assert.equal(context.sentMessages[0].payload.video, undefined);
    assert.match(normalizeMenuText(context.sentMessages[0].payload.text), /AVAILABLE COMMANDS/);
});

test("menu2 also sends the list as one text-only message", async () => {
    fs.writeFileSync(path.join(videosDirectory, "menu.mp4"), "mock mp4 payload");
    menuVideo.saveMenuVideoSettings({ menuVideoEnabled: true, menuVideoFile: "menu.mp4" });
    const context = createContext("menu2");

    await runMenu(context);

    assert.equal(context.sentMessages.length, 1);
    assert.equal(context.sentMessages[0].payload.video, undefined);
    assert.match(normalizeMenuText(context.sentMessages[0].payload.text), /AVAILABLE COMMANDS/);
    assert.match(normalizeMenuText(context.sentMessages[0].payload.text), /╭──〔 亗 GENERAL 〕──╮/);
});

test("owner video commands validate files and preview a real video payload", async () => {
    fs.writeFileSync(path.join(videosDirectory, "intro.mp4"), "mock preview");
    const set = createContext("setmenuvideo", ["intro.mp4"]);
    await runVideoCommand(set);
    assert.match(set.sentMessages[0].payload.text, /intro\.mp4/);
    assert.equal(menuVideo.getMenuVideoSettings().filename, "intro.mp4");

    const traversal = createContext("setmenuvideo", ["..", "outside.mp4"]);
    await runVideoCommand(traversal);
    assert.match(traversal.sentMessages[0].payload.text, /existing MP4 filename/i);

    const listing = createContext("videolist", []);
    await runVideoCommand(listing);
    assert.match(listing.sentMessages[0].payload.text, /intro\.mp4/);

    const preview = createContext("previewmenuvideo", []);
    await runVideoCommand(preview);
    assert.equal(preview.sentMessages[0].payload.mimetype, "video/mp4");
    assert.ok(Buffer.isBuffer(preview.sentMessages[0].payload.video));

    const disable = createContext("menuvideo", ["off"]);
    await runVideoCommand(disable);
    assert.equal(menuVideo.getMenuVideoSettings().enabled, false);

    const enable = createContext("menuvideo", ["on"]);
    await runVideoCommand(enable);
    assert.equal(menuVideo.getMenuVideoSettings().enabled, true);

    const denied = createContext("menuvideo", ["off"], { isOwner: false });
    await runVideoCommand(denied);
    assert.match(denied.sentMessages[0].payload.text, /owner-only/i);
});

test("text menu uses the real registered category count", async () => {
    menuVideo.saveMenuVideoSettings({ menuVideoEnabled: false });
    const menu = createContext();
    await runMenu(menu);
    const text = normalizeMenuText(menu.sentMessages.map(item => item.payload.text).join("\n"));
    assert.equal(menu.sentMessages.length, 1);
    assert.match(normalizeBoldUnicode(text), /AVAILABLE COMMANDS/);
    assert.match(normalizeBoldUnicode(text), /UTILITY/);
    assert.match(text, /➫ !ping/);
    const visibleCommandCount = Number(normalizeBoldUnicode(text).match(/Cmds ⇆ (\d+)/)?.[1]);
    assert.ok(visibleCommandCount > 0);
    assert.ok(visibleCommandCount <= getRegisteredCommandCount());
    assert.ok(core.getCommandGroups(commandModules).length > 0);

    const chunks = core.splitMenuMessage(`start\n${"x".repeat(8000)}`, 1000);
    assert.equal(chunks.length, 9);
    assert.ok(chunks.every(message => message.length <= 1000));
});

test("an empty video folder reports no videos and still provides the text menu", async () => {
    for (const filename of fs.readdirSync(videosDirectory)) {
        fs.rmSync(path.join(videosDirectory, filename), { force: true });
    }
    menuVideo.saveMenuVideoSettings({ menuVideoEnabled: true, menuVideoFile: "menu.mp4" });

    const listing = createContext("videolist", []);
    await runVideoCommand(listing);
    assert.match(listing.sentMessages[0].payload.text, /No usable MP4 files/);

    const context = createContext();
    await runMenu(context);
    assert.equal(context.sentMessages.length, 1);
    assert.equal(context.sentMessages[0].payload.video, undefined);
    assert.match(normalizeMenuText(context.sentMessages[0].payload.text), /AVAILABLE COMMANDS/);
});