const { isOwner } = require("../lib/auth");
const {
    getMenuVideoSettings,
    isSafeVideoFilename,
    listMenuVideos,
    loadVideo,
    resolveVideo,
    saveMenuVideoSettings
} = require("../lib/menu-video");

const commandNames = [
    "setmenuvideo",
    "menuvideo",
    "previewmenuvideo",
    "videolist"
];

async function handleCommand(context) {
    const { command, args = [], sock, jid } = context;
    if (!commandNames.includes(command)) return false;
    if (!(context.isOwner || isOwner(context.senderJid, context))) {
        await sock.sendMessage(jid, { text: "⛔ This menu-video command is owner-only." });
        return true;
    }

    const prefix = context.prefix || ".";
    if (command === "videolist") {
        const videos = listMenuVideos();
        await sock.sendMessage(jid, {
            text: videos.length
                ? `AVAILABLE MENU VIDEOS\n\n${videos.map(filename => `• ${filename}`).join("\n")}`
                : "No usable MP4 files were found in the videos/ folder."
        });
        return true;
    }

    if (command === "setmenuvideo") {
        const filename = args.join(" ").trim();
        if (!isSafeVideoFilename(filename) || !resolveVideo(filename)) {
            await sock.sendMessage(jid, {
                text: `Choose an existing MP4 filename from videos/. Usage: ${prefix}setmenuvideo <filename>`
            });
            return true;
        }
        saveMenuVideoSettings({ menuVideoFile: filename });
        await sock.sendMessage(jid, { text: `Menu video selected: ${filename}` });
        return true;
    }

    if (command === "menuvideo") {
        const value = String(args[0] || "").toLowerCase();
        if (value !== "on" && value !== "off") {
            const settings = getMenuVideoSettings();
            await sock.sendMessage(jid, {
                text: `Usage: ${prefix}menuvideo on/off\nMenu videos are preview-only; .menu remains text-only. Preview is currently ${settings.enabled ? "on" : "off"}.`
            });
            return true;
        }
        saveMenuVideoSettings({ menuVideoEnabled: value === "on" });
        await sock.sendMessage(jid, {
            text: `Menu video preview preference turned ${value}. The .menu command remains text-only.`
        });
        return true;
    }

    if (command === "previewmenuvideo") {
        const settings = getMenuVideoSettings();
        const video = loadVideo(settings.filename);
        if (!video) {
            await sock.sendMessage(jid, {
                text: `The selected video (${settings.filename}) is missing, invalid, or too large. Check ${prefix}videolist.`
            });
            return true;
        }
        try {
            await sock.sendMessage(jid, {
                video: video.buffer,
                mimetype: "video/mp4",
                caption: `ANONYMOUS MD menu-video preview\nSelected: ${settings.filename}`
            });
        } catch {
            await sock.sendMessage(jid, { text: "The selected video could not be sent." });
        }
        return true;
    }

    return false;
}

module.exports = {
    commandNames,
    metadata: {
        category: "🎬 MENU VIDEO",
        description: "Manage and preview local menu video files."
    },
    commandMetadata: {
        setmenuvideo: { usage: "setmenuvideo <filename>" },
        menuvideo: { usage: "menuvideo <on|off>" },
        previewmenuvideo: { usage: "previewmenuvideo" },
        videolist: { usage: "videolist" }
    },
    handleCommand
};