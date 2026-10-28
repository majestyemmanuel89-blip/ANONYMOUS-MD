const commandNames = ["mich-meme", "quoteimg", "crop", "resize", "filter", "wanted", "wasted", "jail", "invert", "rainbow", "hd", "enhance", "carbon", "brat"];
async function handleCommand({ command, jid, sock }) { if (!commandNames.includes(command)) return false; await sock.sendMessage(jid, { text: "Image processing is unavailable because no supported image library is installed." }); return true; }
module.exports = { commandNames, handleCommand };
