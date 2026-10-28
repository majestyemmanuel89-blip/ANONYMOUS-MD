const { isOwner } = require("../lib/auth");
const numberRegistry = require("../lib/number-registry");
const sessionManager = require("../lib/session-manager");

const commandNames = [
    "connect",
    "connectnumber",
    "sessions",
    "sessionstatus",
    "reconnect",
    "disconnect",
    "logout",
    "deletesession",
    "setprimary",
    "correctnumber",
    "addnumber",
    "removenumber",
    "listnumbers",
    "checknumber",
    "confirm",
    "cancelconnect"
];

function isPrivateChat(context) {
    return context.jid === context.senderJid &&
        (context.jid.endsWith("@s.whatsapp.net") || context.jid.endsWith("@lid"));
}

async function reply(context, text) {
    await context.sock.sendMessage(context.jid, { text });
}

function requesterJid(context) {
    return context.senderJid || context.jid;
}

function isConfiguredOwner(context) {
    return Boolean(context.isOwner || isOwner(requesterJid(context), context));
}

async function ownerOnly(context) {
    if (isConfiguredOwner(context)) return true;
    await reply(context, "⛔ This command is restricted to the configured bot owner.");
    return false;
}

function requestConfirmation(context, description, action) {
    const code = numberRegistry.createConfirmation(requesterJid(context), action);
    return reply(
        context,
        `${description}\n\nConfirm within 5 minutes with:\n${context.prefix || "."}confirm ${code}\nCancel with ${context.prefix || "."}confirm cancel.`
    );
}

function formatSession(session) {
    const phone = session.number
        ? numberRegistry.maskNumber(session.number)
        : "number unavailable";
    const lastConnected = session.lastConnectedAt
        ? `; last connected ${session.lastConnectedAt}`
        : "";
    return `• ${session.type === "primary" ? "Primary" : "Secondary"} (${session.id}) — ${phone} — ${session.status}${lastConnected}`;
}

function formatSessions() {
    const sessions = sessionManager.list();
    if (!sessions.length) return "No WhatsApp accounts are registered in the session manager.";
    return sessions.map(formatSession).join("\n");
}

async function beginConnect(context, method, number = "") {
    try {
        const id = await sessionManager.connect({
            method,
            number,
            ownerJid: requesterJid(context),
            prefix: context.prefix || "."
        });
        const pairingInstructions = method === "code"
            ? "A pairing code will be sent privately here. On the new phone, open WhatsApp > Linked devices > Link a device > Link with phone number."
            : "A QR image will be sent privately here. Scan it only from WhatsApp > Linked devices > Link a device. Do not forward it.";
        await reply(context, `Started a separate account connection (${id}). ${pairingInstructions} Use ${context.prefix || "."}cancelconnect to cancel.`);
    } catch (error) {
        await reply(context, `Could not start account linking: ${error.message}`);
    }
}

async function handleCommand(context) {
    const { command, args = [] } = context;
    if (!commandNames.includes(command)) return false;
    if (!(await ownerOnly(context))) return true;
    if (!isPrivateChat(context)) {
        await reply(context, "For privacy, use number and session commands in a private chat with the bot.");
        return true;
    }

    try {
        switch (command) {
            case "connect": {
                const method = String(args[0] || "new").toLowerCase();
                const fresh = method === "new" || method === "qr";
                const selectedMethod = method === "code"
                    ? "code"
                    : method === "qr" || method === "new"
                        ? String(args[method === "new" ? 1 : 0] || "qr").toLowerCase()
                        : "";
                const numberIndex = method === "new" ? 2 : 1;

                if (selectedMethod === "qr") {
                    await beginConnect(context, "qr");
                    return true;
                }
                if (selectedMethod === "code") {
                    const number = numberRegistry.normalizeNumber(args[numberIndex] || "");
                    if (!number) {
                        await reply(context, `Usage: ${context.prefix || "."}connect ${fresh ? "new " : ""}code <phone-number-with-country-code>`);
                        return true;
                    }
                    await beginConnect(context, "code", number);
                    return true;
                }
                await reply(context, `Choose "code" or "qr". Example: ${context.prefix || "."}connect new code 2348012345678`);
                return true;
            }

            case "connectnumber": {
                const number = numberRegistry.normalizeNumber(args[0] || "");
                if (!number) {
                    await reply(context, `Usage: ${context.prefix || "."}connectnumber <phone-number-with-country-code>`);
                    return true;
                }
                await beginConnect(context, "code", number);
                return true;
            }

            case "sessions":
                await reply(context, `WHATSAPP SESSIONS\n\n${formatSessions()}`);
                return true;

            case "sessionstatus": {
                const id = String(args[0] || "").trim();
                const session = sessionManager.get(id);
                if (!session) {
                    await reply(context, `Usage: ${context.prefix || "."}sessionstatus <id>\nUnknown session ID.`);
                    return true;
                }
                await reply(context, `SESSION STATUS\n\n${formatSession(session)}`);
                return true;
            }

            case "reconnect": {
                const id = String(args[0] || "").trim();
                if (!sessionManager.get(id)) {
                    await reply(context, `Usage: ${context.prefix || "."}reconnect <id>\nUnknown session ID.`);
                    return true;
                }
                const startedId = await sessionManager.reconnect(id, requesterJid(context), context.prefix || ".");
                await reply(context, `Reconnect started for ${startedId}. Current status: connecting.`);
                return true;
            }

            case "disconnect": {
                const id = String(args[0] || "").trim();
                const session = sessionManager.get(id);
                if (!session) {
                    await reply(context, `Usage: ${context.prefix || "."}disconnect <id>\nUnknown session ID.`);
                    return true;
                }
                if (session.status === "connecting") {
                    await reply(context, `That session is still connecting. Use ${context.prefix || "."}cancelconnect to cancel the pending attempt.`);
                    return true;
                }
                await requestConfirmation(
                    context,
                    `Disconnect session ${id}? Its local session files will be retained.`,
                    () => sessionManager.disconnect(id)
                );
                return true;
            }

            case "logout":
            case "deletesession": {
                const id = String(args[0] || "").trim();
                const session = sessionManager.get(id);
                if (!session) {
                    await reply(context, `Usage: ${context.prefix || "."}${command} <id>\nUnknown session ID.`);
                    return true;
                }
                if (command === "deletesession" && session.type === "primary") {
                    await reply(context, "Select another primary session before deleting the current primary session.");
                    return true;
                }
                const description = command === "logout"
                    ? `Log out session ${id}? Local auth files will be retained.`
                    : `Permanently delete local files for session ${id}? This cannot be undone.`;
                await requestConfirmation(
                    context,
                    description,
                    () => command === "logout"
                        ? sessionManager.logout(id)
                        : sessionManager.deleteSession(id)
                );
                return true;
            }

            case "setprimary": {
                const id = String(args[0] || "").trim();
                if (!sessionManager.get(id)) {
                    await reply(context, `Usage: ${context.prefix || "."}setprimary <id>\nUnknown session ID.`);
                    return true;
                }
                const changed = sessionManager.setPrimary(id);
                await reply(context, changed
                    ? `Primary session set to ${id}. Active sockets were not restarted.`
                    : `${id} is already the primary session.`);
                return true;
            }

            case "addnumber": {
                const result = numberRegistry.addNumber(args[0] || "");
                const messages = {
                    invalid: "Invalid number. Enter 7–15 digits, including the country code.",
                    duplicate: "That number is already registered."
                };
                await reply(
                    context,
                    result.ok
                        ? `✅ Registered ${numberRegistry.maskNumber(result.number)}.`
                        : messages[result.reason]
                );
                return true;
            }

            case "correctnumber": {
                const oldNumber = numberRegistry.normalizeNumber(args[0] || "");
                const newNumber = numberRegistry.normalizeNumber(args[1] || "");
                if (!oldNumber || !newNumber) {
                    await reply(context, `Usage: ${context.prefix || "."}correctnumber <old-number> <new-number>`);
                    return true;
                }
                if (!numberRegistry.findNumber(oldNumber)) {
                    await reply(context, "The old number is not in the registered-number list.");
                    return true;
                }
                await requestConfirmation(
                    context,
                    `Replace registered number ${numberRegistry.maskNumber(oldNumber)} with ${numberRegistry.maskNumber(newNumber)}? This changes only the registered-number list, not a WhatsApp account.`,
                    () => numberRegistry.correctNumber(oldNumber, newNumber)
                );
                return true;
            }

            case "removenumber": {
                const number = numberRegistry.normalizeNumber(args[0] || "");
                if (!number) {
                    await reply(context, `Usage: ${context.prefix || "."}removenumber <number>`);
                    return true;
                }
                if (!numberRegistry.findNumber(number)) {
                    await reply(context, "That number is not in the registered-number list.");
                    return true;
                }
                await requestConfirmation(
                    context,
                    `Remove registered number ${numberRegistry.maskNumber(number)}?`,
                    () => numberRegistry.removeNumber(number)
                );
                return true;
            }

            case "listnumbers": {
                const numbers = numberRegistry.readNumbers();
                await reply(
                    context,
                    numbers.length
                        ? `REGISTERED NUMBERS\n\n${numbers.map(number => `• ${numberRegistry.maskNumber(number)}`).join("\n")}`
                        : "No registered numbers."
                );
                return true;
            }

            case "checknumber": {
                const number = numberRegistry.normalizeNumber(args[0] || "");
                if (!number) {
                    await reply(context, `Usage: ${context.prefix || "."}checknumber <number>`);
                    return true;
                }
                await reply(
                    context,
                    numberRegistry.findNumber(number)
                        ? `${numberRegistry.maskNumber(number)} is registered.`
                        : `${numberRegistry.maskNumber(number)} is not registered.`
                );
                return true;
            }

            case "confirm": {
                const token = String(args[0] || "").toLowerCase();
                if (token === "cancel") {
                    const cancelled = numberRegistry.cancelConfirmation(requesterJid(context));
                    await reply(context, cancelled ? "Pending confirmation cancelled." : "There is no pending confirmation.");
                    return true;
                }
                if (!/^\d{6}$/.test(token)) {
                    await reply(context, `Usage: ${context.prefix || "."}confirm <6-digit-code>`);
                    return true;
                }
                const result = await numberRegistry.confirmAction(requesterJid(context), token);
                if (!result.ok) {
                    await reply(context, result.reason === "failed"
                        ? "Confirmation failed; no success was recorded."
                        : `Confirmation unavailable (${result.reason}). Request the operation again.`);
                    if (result.error) console.error("[NUMBER/SESSION CONFIRMATION ERROR]", result.error.message);
                    return true;
                }
                if (result.result?.ok === false) {
                    await reply(context, `No change made: ${result.result.reason}.`);
                    return true;
                }
                await reply(context, "✅ Confirmed and completed.");
                return true;
            }

            case "cancelconnect": {
                const cancelled = await sessionManager.cancelPending(requesterJid(context), true);
                await reply(context, cancelled
                    ? "The pending account connection was cancelled. Its partial session files were retained."
                    : "There is no account connection pending.");
                return true;
            }

            default:
                return false;
        }
    } catch (error) {
        console.error(`[NUMBER/SESSION COMMAND ERROR] ${command}`, error.message);
        await reply(context, "❌ The number/session request could not be completed.");
        return true;
    }
}

module.exports = {
    commandNames,
    metadata: {
        category: "📱 NUMBER & SESSION MANAGER",
        description: "Owner-only number registry and account session controls."
    },
    commandMetadata: {
        connect: {
            description: "Create a fresh independent WhatsApp session.",
            usage: "connect [new] [code <number>|qr]"
        },
        connectnumber: { usage: "connectnumber <number>" },
        sessions: { usage: "sessions" },
        sessionstatus: { usage: "sessionstatus <id>" },
        reconnect: { usage: "reconnect <id>" },
        disconnect: { usage: "disconnect <id>" },
        logout: { usage: "logout <id>" },
        deletesession: { usage: "deletesession <id>" },
        setprimary: { usage: "setprimary <id>" },
        addnumber: { usage: "addnumber <number>" },
        correctnumber: { usage: "correctnumber <old> <new>" },
        removenumber: { usage: "removenumber <number>" },
        listnumbers: { usage: "listnumbers" },
        checknumber: { usage: "checknumber <number>" },
        cancelconnect: { usage: "cancelconnect" }
    },
    handleCommand
};
