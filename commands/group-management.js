const fs = require("fs");
const path = require("path");
const { isBotAdmin, isSenderAdmin } = require("./group");
const eventsPath = path.join(__dirname, "../data/events.json");
const commandNames = ["mute-gc", "unmute-gc", "announcement", "report", "event", "eventinfo", "online", "contact"];
const adminCommands = new Set(["mute-gc", "unmute-gc", "announcement"]);
function read() { try { return JSON.parse(fs.readFileSync(eventsPath, "utf8")); } catch { return { events: {}, reports: {}, muted: {} }; } }
function write(data) { fs.writeFileSync(eventsPath, JSON.stringify(data, null, 4), "utf8"); }
async function handleCommand(context) {
    const { command, args, jid, senderJid, sock } = context;
	if (!commandNames.includes(command)) return false;
	if (!jid.endsWith("@g.us")) {
		await sock.sendMessage(jid, { text: "This command only works in groups." });
		return true;
	}
	if (adminCommands.has(command)) {
		let groupMetadata;
		try {
			groupMetadata = await sock.groupMetadata(jid);
		} catch {
			await sock.sendMessage(jid, { text: "Group permissions could not be verified." });
			return true;
		}
		const adminContext = { ...context, groupMetadata };
		if (!isSenderAdmin(adminContext)) {
			await sock.sendMessage(jid, { text: "You must be a group admin." });
			return true;
		}
		if (command === "announcement" && !isBotAdmin(adminContext)) {
			await sock.sendMessage(jid, { text: "I need to be a group admin first." });
			return true;
		}
	}
	const data = read();
	if (command === "event") {
		const parts = args.join(" ").split("|").map(item => item.trim());
		if (parts.length < 3 || !/^\d{2}\/\d{2}\/\d{4}$/.test(parts[1]) || !/^\d{2}:\d{2}$/.test(parts[2])) { await sock.sendMessage(jid, { text: "Usage: .event Title | DD/MM/YYYY | HH:MM" }); return true; }
		data.events[jid] = data.events[jid] || []; data.events[jid].push({ title: parts[0], date: parts[1], time: parts[2], creator: senderJid }); write(data); await sock.sendMessage(jid, { text: "Event saved." }); return true;
	}
	if (command === "eventinfo") { const events = data.events[jid] || []; await sock.sendMessage(jid, { text: events.length ? events.map(event => `${event.title} - ${event.date} ${event.time}`).join("\n") : "No events saved." }); return true; }
	if (command === "report") { data.reports[jid] = data.reports[jid] || []; data.reports[jid].push({ target: args[0] || "unknown", text: args.slice(1).join(" "), reporter: senderJid, at: Date.now() }); write(data); await sock.sendMessage(jid, { text: "Report saved for group review." }); return true; }
	if (["mute-gc", "unmute-gc"].includes(command)) { data.muted[jid] = command === "mute-gc"; write(data); await sock.sendMessage(jid, { text: `Group mute: ${data.muted[jid] ? "on" : "off"}` }); return true; }
	if (command === "announcement") { if (typeof sock.groupSettingUpdate !== "function") await sock.sendMessage(jid, { text: "Announcement mode is unsupported." }); else { await sock.groupSettingUpdate(jid, "announcement"); await sock.sendMessage(jid, { text: "Group set to announcement mode." }); } return true; }
	if (command === "online") { await sock.sendMessage(jid, { text: "Presence information is only available when WhatsApp provides it." }); return true; }
	await sock.sendMessage(jid, { text: "Contact storage is not configured in this project." }); return true;
}
module.exports = { commandNames, handleCommand };
