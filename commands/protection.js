const fs = require("fs");
const path = require("path");
const { isSenderAdmin } = require("./group");
const protectionPath = path.join(__dirname, "../data/protection.json");
const modes = ["antilink", "antifwd", "antibot", "antigroupmention", "antispam", "antitag", "antibadword", "antipromote", "antidemote", "flood", "antidelete", "antigroupstatus"];
function read() { try { return JSON.parse(fs.readFileSync(protectionPath, "utf8")); } catch { return {}; } }
function write(data) { fs.writeFileSync(protectionPath, JSON.stringify(data, null, 4), "utf8"); }
async function handleCommand(context) {
	const { command, args, jid, sock } = context;
	if (!modes.includes(command) && command !== "antibadwords") return false;
	if (!jid.endsWith("@g.us")) { await sock.sendMessage(jid, { text: "Protection settings only work in groups." }); return true; }
	let groupMetadata;
	try {
		if (typeof sock.groupMetadata !== "function") {
			throw new Error("Group metadata is unavailable.");
		}
		groupMetadata = await sock.groupMetadata(jid);
	} catch (error) {
		console.error("[PROTECTION PERMISSIONS] Could not verify group admins.", error);
		await sock.sendMessage(jid, { text: "Group permissions could not be verified." });
		return true;
	}
	if (!isSenderAdmin({ ...context, groupMetadata })) {
		await sock.sendMessage(jid, { text: "You must be a group admin to change protection settings." });
		return true;
	}
	const data = read(); data[jid] = data[jid] || {};
	if (command === "antibadwords" && args[0] === "add") { data[jid].badwords = [...new Set([...(data[jid].badwords || []), ...args.slice(1).map(w => w.toLowerCase())])]; write(data); await sock.sendMessage(jid, { text: "Bad words updated." }); return true; }
	const value = args[0]?.toLowerCase();
	if (!value || !["on", "off", "warn", "kick", "reset"].includes(value)) { await sock.sendMessage(jid, { text: `Usage: .${command} on/off${["antilink", "antifwd", "antibot", "antigroupmention", "antispam", "antitag", "antidelete", "antigroupstatus"].includes(command) ? "/warn/kick" : ""}` }); return true; }
	data[jid][command] = value === "reset" ? "off" : value; write(data); await sock.sendMessage(jid, { text: `${command}: ${data[jid][command]}` }); return true;
}
module.exports = { commandNames: [...modes, "antibadwords"], handleCommand };
