const interactionStates = new Map();
const groupCommands = require("../commands/group");
const { getVerifiedMenuCategories } = require("./menu-catalog");
const stateLifetimeMs = Number(process.env.MENU_INTERACTION_TIMEOUT_MS) > 0
    ? Number(process.env.MENU_INTERACTION_TIMEOUT_MS)
    : 5 * 60 * 1000;
const commandsPerPage = 12;

function stateKey(context) {
    return [context.accountName || "unknown", context.jid || "", context.senderJid || ""]
        .join("\u0000");
}

function getMessageText(msg) {
    const message = msg?.message || {};
    return message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        "";
}

function getQuotedMessageId(msg) {
    return msg?.message?.extendedTextMessage?.contextInfo?.stanzaId ||
        msg?.message?.imageMessage?.contextInfo?.stanzaId ||
        msg?.message?.videoMessage?.contextInfo?.stanzaId ||
        "";
}

function hasMediaInput(msg) {
    const message = msg?.message || {};
    const mediaTypes = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"];
    if (mediaTypes.some(type => message[type])) return true;
    const quoted = message.extendedTextMessage?.contextInfo?.quotedMessage || {};
    return mediaTypes.some(type => quoted[type]);
}

function requiresArguments(argumentUsage) {
    let requiredUsage = String(argumentUsage || "");
    let previousUsage;
    do {
        previousUsage = requiredUsage;
        requiredUsage = requiredUsage.replace(/\[[^\[\]]*\]/g, " ");
    } while (requiredUsage !== previousUsage);
    return /<[^>]+>/.test(requiredUsage);
}

async function getMenuCategories(context, commandGroups, canExecuteCommand) {
    let senderIsGroupAdmin = false;
    let botIsGroupAdmin = false;
    if (context.jid?.endsWith("@g.us") && typeof context.sock?.groupMetadata === "function") {
        try {
            const groupMetadata = context.groupMetadata || await context.sock.groupMetadata(context.jid);
            senderIsGroupAdmin = groupCommands.isSenderAdmin({ ...context, groupMetadata });
            botIsGroupAdmin = groupCommands.isBotAdmin({ ...context, groupMetadata });
        } catch (error) {
            console.warn("[MENU PERMISSIONS] Could not verify group roles; hiding privileged categories.", error.message);
            senderIsGroupAdmin = false;
            botIsGroupAdmin = false;
        }
    }

    const categories = getVerifiedMenuCategories({
        context: {
            ...context,
            isSenderAdmin: senderIsGroupAdmin,
            isBotAdmin: botIsGroupAdmin
        },
        commandGroups,
        canExecuteCommand
    });
    return categories.map((category, index) => ({
        ...category,
        key: category.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        order: index
    }));
}

async function getAvailableCategories(context, services) {
    const commandGroups = services.getCommandGroups(
        context.commandModules,
        context.prefix
    );
    return getMenuCategories(context, commandGroups, services.canExecuteCommand);
}

function menuNumber(index) {
    const emojiNumbers = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    return emojiNumbers[index] || `${index + 1}.`;
}

function toBoldUnicode(value) {
    return [...String(value)].map(character => {
        const code = character.codePointAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d5d4 + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d5ee + code - 97);
        if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ec + code - 48);
        return character;
    }).join("");
}

function toFullWidth(value) {
    return [...String(value)].map(character => {
        const code = character.codePointAt(0);
        return (code >= 48 && code <= 57) ||
            (code >= 65 && code <= 90) ||
            (code >= 97 && code <= 122)
            ? String.fromCodePoint(code + 0xfee0)
            : character;
    }).join("");
}

function clearState(key) {
    const state = interactionStates.get(key);
    if (state?.timer) clearTimeout(state.timer);
    interactionStates.delete(key);
}

function renewState(key, state) {
    if (state.timer) clearTimeout(state.timer);
    state.expiresAt = Date.now() + stateLifetimeMs;
    state.timer = setTimeout(() => {
        interactionStates.delete(key);
    }, stateLifetimeMs);
    state.timer.unref?.();
}

async function sendTracked(context, state, payload) {
    const result = await context.sock.sendMessage(context.jid, payload);
    state.menuMessageId = result?.key?.id || "";
    renewState(state.key, state);
    return result;
}

function renderMainMenu(state, context, header = "") {
    const lines = [];
    if (header) lines.push(header, "");
    lines.push(`〔 📂 ${toBoldUnicode("SELECT A CATEGORY")} 〕`, "");
    state.categories.forEach((category, index) => {
        lines.push(`┃ ${menuNumber(index)} — ${toFullWidth(category.title.toUpperCase())}`);
    });
    lines.push("", "Reply with a category number.", "Reply *help* for navigation or *cancel* to close.");
    return lines.join("\n");
}

function renderCategory(state, context) {
    const category = state.categories.find(item => item.key === state.categoryKey);
    if (!category) return "This category is no longer available. Reply *menu* to reopen the menu.";

    const totalPages = Math.max(1, Math.ceil(category.commands.length / commandsPerPage));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const start = (state.page - 1) * commandsPerPage;
    const commands = category.commands.slice(start, start + commandsPerPage);
    const lines = [`╭━━〔 🤖 ${toFullWidth(category.title.toUpperCase())} ${toBoldUnicode("COMMANDS")} 〕━━╮`];

    commands.forEach((command, index) => {
        const usage = command.argumentUsage ? ` ${command.argumentUsage}` : "";
        const aliases = command.aliasNote ? ` ${command.aliasNote}` : "";
        lines.push(`┃ ${index + 1}. *${context.prefix || "."}${toFullWidth(command.name)}*${usage} — ${command.description}${aliases}`);
    });

    if (totalPages > 1) lines.push(`┃ Page ${state.page}/${totalPages} — reply *next* or *back*`);
    lines.push("╰━━━━━━━━━━━━━━━━━━━━╯", "Reply with a command number. Reply *0* for categories.");
    return lines.join("\n");
}

async function start(context, services) {
    const key = stateKey(context);
    clearState(key);
    const categories = await getMenuCategories(context, services.getCommandGroups(context.commandModules, context.prefix), services.canExecuteCommand);
    const state = {
        key,
        phase: "categories",
        categories,
        categoryKey: null,
        page: 1,
        selectedCommand: null,
        menuMessageId: "",
        expiresAt: 0,
        timer: null
    };
    interactionStates.set(key, state);

    let videoSent = false;
    const visibleCommandCount = categories.reduce((total, category) => total + category.commands.length, 0);
    const header = typeof services.header === "function"
        ? services.header(context, visibleCommandCount)
        : services.header;
    if (services.video) {
        try {
            await sendTracked(context, state, {
                video: services.video.buffer,
                mimetype: "video/mp4",
                caption: header
            });
            videoSent = true;
        } catch (error) {
            console.warn("[MENU VIDEO] Video delivery failed; sending the text menu.", error.message);
        }
    }

    function clearForContext(context) {
        clearState(stateKey(context));
    }

    const text = renderMainMenu(state, context, videoSent ? "" : header);
    await sendTracked(context, state, { text });
}

async function showMain(context, state, services) {
    state.phase = "categories";
    state.categoryKey = null;
    state.page = 1;
    state.selectedCommand = null;
    state.categories = await getMenuCategories(context, services.getCommandGroups(context.commandModules, context.prefix), services.canExecuteCommand);
    await sendTracked(context, state, { text: renderMainMenu(state, context) });
}

async function showCategory(context, state, category, page = 1) {
    state.phase = "commands";
    state.categoryKey = category.key;
    state.page = page;
    state.selectedCommand = null;
    await sendTracked(context, state, { text: renderCategory(state, context) });
}

async function reply(context, state, text) {
    await sendTracked(context, state, { text });
}

async function handleIncoming(context, services) {
    const key = stateKey(context);
    const state = interactionStates.get(key);
    if (!state) return false;

    if (state.expiresAt <= Date.now()) {
        clearState(key);
        return false;
    }

    const prefix = context.prefix || ".";
    const text = getMessageText(context.msg).trim();
    if (text.startsWith(prefix)) {
        clearState(key);
        return false;
    }

    const quotedId = getQuotedMessageId(context.msg);
    if (state.phase !== "arguments" && quotedId && state.menuMessageId && quotedId !== state.menuMessageId) return true;

    const lower = text.toLowerCase();
    if (lower === "cancel") {
        clearState(key);
        await context.sock.sendMessage(context.jid, { text: "Menu interaction cancelled." });
        return true;
    }
    if (lower === "help") {
        await reply(context, state, "Reply with a number shown in the current menu. Use *0* to go back, *menu* to return to categories, or *cancel* to close.");
        return true;
    }
    if (lower === "menu") {
        await showMain(context, state, services);
        return true;
    }

    if (state.phase === "arguments") {
        if (lower === "0") {
            const category = state.categories.find(item => item.key === state.categoryKey);
            if (category) await showCategory(context, state, category, state.page);
            else await showMain(context, state, services);
            return true;
        }
        const selected = state.selectedCommand;
        if (!selected || (services.canExecuteCommand && !services.canExecuteCommand(context, selected.name))) {
            clearState(key);
            await context.sock.sendMessage(context.jid, { text: "⛔ You are not allowed to use that command." });
            return true;
        }
        if (selected.requiresMedia && !hasMediaInput(context.msg)) {
            await reply(context, state, `You selected *${prefix}${selected.name}*. Reply to this prompt with the supported image, video, audio, document, or sticker.`);
            return true;
        }
        if (selected.requiresQuotedTarget && !quotedId) {
            await reply(context, state, `You selected *${prefix}${selected.name}*. Reply directly to the message you want to react to, with the emoji.`);
            return true;
        }
        clearState(key);
        const args = text ? text.split(/\s+/) : [];
        const handled = await services.dispatchCommand({
            ...context,
            command: selected.name,
            args
        });
        if (!handled) {
            await context.sock.sendMessage(context.jid, { text: "That command is not available in this chat." });
        }
        return true;
    }

    if (state.phase === "categories") {
        if (lower === "0") {
            await showMain(context, state, services);
            return true;
        }
        if (!/^\d+$/.test(text)) return true;
        const index = Number(text) - 1;
        const category = state.categories[index];
        if (!category) {
            await reply(context, state, "❌ Invalid selection. Reply with one of the category numbers shown, or *0* to show the categories again.");
            return true;
        }
        await showCategory(context, state, category);
        return true;
    }

    if (state.phase === "commands") {
        const category = state.categories.find(item => item.key === state.categoryKey);
        if (!category) {
            await showMain(context, state, services);
            return true;
        }
        if (lower === "0") {
            await showMain(context, state, services);
            return true;
        }
        if (lower === "next" || lower === "back") {
            const pageCount = Math.max(1, Math.ceil(category.commands.length / commandsPerPage));
            const nextPage = lower === "next" ? state.page + 1 : state.page - 1;
            if (nextPage < 1 || nextPage > pageCount) {
                await reply(context, state, `❌ There is no ${lower} page.`);
            } else {
                await showCategory(context, state, category, nextPage);
            }
            return true;
        }
        if (!/^\d+$/.test(text)) return true;

        const start = (state.page - 1) * commandsPerPage;
        const selected = category.commands[start + Number(text) - 1];
        if (!selected) {
            await reply(context, state, "❌ Invalid selection. Reply with one of the command numbers shown, or *0* to return to categories.");
            return true;
        }
        if (services.canExecuteCommand && !services.canExecuteCommand(context, selected.name)) {
            await reply(context, state, "⛔ You are not allowed to use that command.");
            return true;
        }

        if (selected.requiresMedia || selected.requiresQuotedTarget || requiresArguments(selected.argumentUsage)) {
            state.phase = "arguments";
            state.selectedCommand = selected;
            const instruction = selected.requiresMedia
                ? "Reply with the supported media."
                : selected.requiresQuotedTarget
                    ? "Reply directly to the message you want to react to, with the emoji."
                    : `Reply with the required arguments${selected.argumentUsage ? ` (${selected.argumentUsage})` : ""}.`;
            await reply(context, state, `You selected *${prefix}${selected.name}*. ${instruction} Reply *0* to go back or *cancel* to close.`);
            return true;
        }

        clearState(key);
        const handled = await services.dispatchCommand({
            ...context,
            command: selected.name,
            args: []
        });
        if (!handled) {
            await context.sock.sendMessage(context.jid, { text: "That command is not available in this chat." });
        }
        return true;
    }

    return true;
}

function getActiveStateCount() {
    return interactionStates.size;
}

function clearForContext(context) {
    clearState(stateKey(context));
}

function cleanupExpiredInteractions(now = Date.now()) {
    let cleared = 0;
    for (const [key, state] of interactionStates) {
        if (state.expiresAt <= now) {
            clearState(key);
            cleared += 1;
        }
    }
    return cleared;
}

module.exports = {
    cleanupExpiredInteractions,
    clearForContext,
    getAvailableCategories,
    getActiveStateCount,
    getMessageText,
    hasMediaInput,
    handleIncoming,
    requiresArguments,
    start
};
