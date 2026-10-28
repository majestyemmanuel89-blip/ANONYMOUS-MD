const fs = require("fs");
const path = require("path");
const { isOwner } = require("../lib/permissions");

const settingsPath = process.env.ANONYMOUS_MD_SETTINGS_PATH ||
	path.join(__dirname, "../data/settings.json");
const defaults = {
	botName: "ANONYMOUS MD",
	prefix: ".",
	owner: "Anonymous",
	mode: "public",
	menuImage: "",
	welcome: false,
	goodbye: false,
	moderation: {}
};

function readSettings() {
	try {
		return { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath, "utf8")) };
	} catch {
		return { ...defaults };
	}
}

function saveSettings(settings) {
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");
}

async function handleCommand(context) {
	const { command, args, jid, sock } = context;
	const supported = [
		"mode", "setprefix", "public", "private", "setname", "setowner",
		"setmenuimage", "setwelcome", "setgoodbye", "modstatus", "modsettings"
	];
	if (!supported.includes(command)) return false;
	if (!isOwner(context.senderJid, context)) {
		await sock.sendMessage(jid, { text: "This settings command is owner-only." });
		return true;
	}

	const settings = readSettings();
	if (command === "mode") {
		const mode = String(args[0] || "").toLowerCase();
		if (mode !== "public" && mode !== "private") {
			await sock.sendMessage(jid, { text: "Usage: .mode public/private" });
			return true;
		}
		settings.mode = mode;
		saveSettings(settings);
		await sock.sendMessage(jid, { text: `Bot mode set to ${mode}.` });
		return true;
	} else if (command === "modstatus") {
		await sock.sendMessage(jid, { text: `Moderation settings: ${JSON.stringify(settings.moderation)}` });
		return true;
	}
	if (command === "modsettings") {
		settings.moderation = { ...settings.moderation, ...Object.fromEntries(args.map(item => item.split("=", 2))) };
		saveSettings(settings);
		await sock.sendMessage(jid, { text: "Moderation settings updated." });
		return true;
	}

	if (command === "setprefix") {
		const prefix = args[0];
		if (!prefix || prefix.length > 3 || /\s/.test(prefix)) {
			await sock.sendMessage(jid, { text: "Usage: .setprefix <prefix>" });
			return true;
		}
		settings.prefix = prefix;
	} else if (command === "public" || command === "private") {
		settings.mode = command;
	} else if (command === "setname") {
		settings.botName = args.join(" ").trim() || settings.botName;
	} else if (command === "setowner") {
		settings.owner = args[0] || settings.owner;
	} else if (command === "setmenuimage") {
		settings.menuImage = args[0] || "";
	} else {
		const value = args[0]?.toLowerCase();
		if (value !== "on" && value !== "off" && value !== "reset") {
			await sock.sendMessage(jid, { text: `Usage: .${command} on/off/reset` });
			return true;
		}
		settings[command.slice(3)] = value === "reset" ? false : value === "on";
	}

	saveSettings(settings);
	await sock.sendMessage(jid, { text: "Settings updated." });
	return true;
}

module.exports = {
	commandNames: ["mode", "setprefix", "public", "private", "setname", "setowner", "setmenuimage", "setwelcome", "setgoodbye", "modstatus", "modsettings"],
	handleCommand
};
