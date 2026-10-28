function createMessageDeduplicator(limit = 2000) {
    const seen = new Set();
    const maximum = Number.isSafeInteger(limit) && limit > 0 ? limit : 2000;

    return function isDuplicateMessage(msg) {
        const messageId = msg?.key?.id;
        const chatJid = msg?.key?.remoteJid;
        if (!messageId || !chatJid) return false;

        const key = `${chatJid}:${messageId}`;
        if (seen.has(key)) return true;
        seen.add(key);
        if (seen.size > maximum) seen.delete(seen.values().next().value);
        return false;
    };
}

module.exports = createMessageDeduplicator;