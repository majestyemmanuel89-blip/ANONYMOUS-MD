const commandNames = ["vv"];

function isViewOnce(message) {
    if (!message || typeof message !== "object") return false;
    if (
        message.viewOnceMessage ||
        message.viewOnceMessageV2 ||
        message.viewOnceMessageV2Extension ||
        message.imageMessage?.viewOnce
    ) {
        return true;
    }

    return Object.entries(message).some(([key, value]) =>
        key === "ephemeralMessage" && isViewOnce(value?.message)
    );
}

function getImageInput(msg) {
    const message = msg?.message || {};
    if (isViewOnce(message)) return { viewOnce: true };
    if (message.imageMessage) {
        return {
            media: { key: msg.key, message },
            image: message.imageMessage
        };
    }

    const quotedMessage = message.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMessage) return null;
    if (isViewOnce(quotedMessage)) return { viewOnce: true };
    if (!quotedMessage.imageMessage) return null;

    return {
        media: {
            key: {
                remoteJid: msg.key.remoteJid,
                id: message.extendedTextMessage.contextInfo.stanzaId,
                participant: message.extendedTextMessage.contextInfo.participant
            },
            message: quotedMessage
        },
        image: quotedMessage.imageMessage
    };
}

function getPrivateSenderJid(context) {
    const messageKey = context.msg?.key || {};
    const candidates = [
        messageKey.senderPn,
        messageKey.participantPn,
        messageKey.participantAlt,
        context.senderJid,
        context.jid
    ];
    return candidates.find(jid =>
        typeof jid === "string" &&
        (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))
    ) || null;
}

async function handleCommand(context) {
    if (!commandNames.includes(context.command)) return false;

    const input = getImageInput(context.msg);
    if (input?.viewOnce) {
        await context.sock.sendMessage(context.jid, {
            text: "I can’t copy an existing view-once image. Use .vv with a regular photo you’re allowed to share."
        });
        return true;
    }
    if (!input) {
        await context.sock.sendMessage(context.jid, {
            text: `Reply to a regular photo with ${context.prefix || "."}vv, or attach a photo to the command.`
        });
        return true;
    }

    const targetJid = getPrivateSenderJid(context);
    if (!targetJid) {
        await context.sock.sendMessage(context.jid, {
            text: "I couldn’t identify your private chat to send the image."
        });
        return true;
    }
    if (typeof context.downloadMediaMessage !== "function") {
        throw new Error("Image downloading is unavailable in this bot context.");
    }

    let image;
    try {
        image = await context.downloadMediaMessage(input.media, "buffer", {});
        if (!Buffer.isBuffer(image) || image.length === 0) {
            throw new Error("The photo could not be downloaded.");
        }
    } catch (error) {
        console.error("[VIEW ONCE] Could not download image.", error);
        await context.sock.sendMessage(context.jid, {
            text: "I couldn’t download that photo. Check that the image is still available and try again."
        });
        return true;
    }

    try {
        await context.sock.sendMessage(targetJid, {
            image,
            mimetype: input.image.mimetype || "image/jpeg",
            viewOnce: true
        });
    } catch (error) {
        console.error("[VIEW ONCE] Could not send image.", error);
        await context.sock.sendMessage(context.jid, {
            text: "I couldn’t send the view-once image to your DM. Make sure your private chat with the bot is open and try again."
        });
        return true;
    }

    if (context.jid !== targetJid) {
        await context.sock.sendMessage(context.jid, {
            text: "Sent the photo to your DM as a view-once image."
        });
    }
    return true;
}

module.exports = {
    commandNames,
    metadata: {
        category: "Images",
        description: "Send an ordinary photo to your DM as a view-once image."
    },
    commandMetadata: {
        vv: {
            description: "Send a regular photo to your DM as a view-once image.",
            usage: "vv (reply to a regular photo)",
            example: "Reply to a photo with .vv"
        }
    },
    handleCommand
};
