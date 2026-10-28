const assert = require("node:assert/strict");
const { test } = require("node:test");
const { handleCommand } = require("../commands/view-once");

function createContext({ jid = "group@g.us", senderJid = "15551234567@s.whatsapp.net", msg }) {
    const sentMessages = [];
    return {
        context: {
            command: "vv",
            prefix: ".",
            jid,
            senderJid,
            msg,
            sock: {
                sendMessage: async (target, payload) => sentMessages.push({ target, payload })
            },
            downloadMediaMessage: async media => {
                return Buffer.from(`downloaded:${media.message.imageMessage.mimetype}`);
            }
        },
        sentMessages
    };
}

test("vv sends a replied regular photo as view-once to the sender DM", async () => {
    const { context, sentMessages } = createContext({
        msg: {
            key: { remoteJid: "group@g.us", participant: "15551234567@s.whatsapp.net" },
            message: {
                extendedTextMessage: {
                    text: ".vv",
                    contextInfo: {
                        stanzaId: "photo-message",
                        participant: "15559876543@s.whatsapp.net",
                        quotedMessage: { imageMessage: { mimetype: "image/png" } }
                    }
                }
            }
        }
    });

    assert.equal(await handleCommand(context), true);
    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages[0].target, "15551234567@s.whatsapp.net");
    assert.equal(sentMessages[0].payload.viewOnce, true);
    assert.equal(sentMessages[0].payload.mimetype, "image/png");
    assert.equal(sentMessages[0].payload.image.toString(), "downloaded:image/png");
    assert.equal(sentMessages[1].target, "group@g.us");
    assert.match(sentMessages[1].payload.text, /Sent the photo to your DM/);
});

test("vv accepts an image attached to the command in a private chat", async () => {
    const { context, sentMessages } = createContext({
        jid: "15551234567@s.whatsapp.net",
        senderJid: "15551234567@s.whatsapp.net",
        msg: {
            key: { remoteJid: "15551234567@s.whatsapp.net" },
            message: { imageMessage: { mimetype: "image/jpeg", caption: ".vv" } }
        }
    });

    assert.equal(await handleCommand(context), true);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].target, "15551234567@s.whatsapp.net");
    assert.equal(sentMessages[0].payload.viewOnce, true);
});

test("vv refuses to copy an existing view-once photo", async () => {
    const { context, sentMessages } = createContext({
        msg: {
            key: { remoteJid: "group@g.us" },
            message: {
                extendedTextMessage: {
                    text: ".vv",
                    contextInfo: {
                        stanzaId: "once-message",
                        quotedMessage: {
                            viewOnceMessageV2: {
                                message: { imageMessage: { mimetype: "image/jpeg" } }
                            }
                        }
                    }
                }
            }
        }
    });
    let downloadAttempted = false;
    context.downloadMediaMessage = async () => {
        downloadAttempted = true;
        return Buffer.from("image");
    };

    assert.equal(await handleCommand(context), true);
    assert.equal(downloadAttempted, false);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].payload.text, /can’t copy an existing view-once/i);
});

test("vv explains how to use the command when no photo is supplied", async () => {
    const { context, sentMessages } = createContext({
        msg: { key: { remoteJid: "group@g.us" }, message: { conversation: ".vv" } }
    });

    assert.equal(await handleCommand(context), true);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].payload.text, /Reply to a regular photo/);
});
