const commandNames = ["google", "gsearch", "wiki", "wikipedia", "npmsearch", "dictionary", "define", "weather", "myip", "news", "randomfact", "numberfact", "waifu", "apod"];
async function handleCommand({ command, jid, sock }) { if (!commandNames.includes(command)) return false; await sock.sendMessage(jid, { text: "No search API is configured for this command." }); return true; }
module.exports = { commandNames, handleCommand };
