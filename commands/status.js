const commandNames = ["togcstatus", "totgstatus2", "poststatus", "mstatus", "groupstatus"];
async function handleCommand({ command, jid, sock }) { if (!commandNames.includes(command)) return false; await sock.sendMessage(jid, { text: "This status feature is not supported by the current Baileys version." }); return true; }
module.exports = { commandNames, handleCommand };
