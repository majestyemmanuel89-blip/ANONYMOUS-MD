const commandNames = ["button", "list", "edit", "keep", "fwdviewonce", "reactto", "pollresults"];
async function handleCommand({ command, args, jid, msg, sock }) {
	if (!commandNames.includes(command)) return false;
	if (command === "reactto") {
		const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
		const participant = msg.message?.extendedTextMessage?.contextInfo?.participant;
		if (!key) await sock.sendMessage(jid, { text: "Reply to a message with .reactto <emoji>." });
		else await sock.sendMessage(jid, { react: { text: args[0] || "👍", key: { remoteJid: jid, id: key, participant } } });
	} else await sock.sendMessage(jid, { text: "This interactive feature is not supported by the current Baileys version." });
	return true;
}
module.exports = { commandNames, handleCommand };
