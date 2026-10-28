// Compatibility entry point for older imports. The canonical group handler is group.js.
const group = require("./group");

async function handleGroupCommand(sock, msg, command, args, context = {}) {
    return group.handleCommand({
        ...context,
        sock,
        msg,
        command,
        args,
        jid: context.jid || msg.key.remoteJid,
        senderJid: context.senderJid || msg.key.participant || msg.key.remoteJid
    });
}

module.exports = {
    commandNames: group.commandNames,
    handleCommand: group.handleCommand,
    handleGroupCommand,
    normalizeJid: group.normalizeJid,
    isSameUserJid: group.isSameUserJid,
    isGroup: group.isGroup,
    isSenderAdmin: group.isSenderAdmin,
    isBotAdmin: group.isBotAdmin,
    resolveTarget: group.resolveTarget
};
