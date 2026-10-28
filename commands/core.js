const fs = require("fs");
const path = require("path");

const settingsPath = process.env.ANONYMOUS_MD_SETTINGS_PATH ||
    path.join(__dirname, "../data/settings.json");
const feedbackPath = path.join(
    __dirname,
    "../data/feedback.json"
);
const interactiveMenu = require("../lib/interactive-menu");
const { version } = require("../package.json");

const maximumMenuMessageLength = 3400;

const categoryMetadata = {
    owner: { name: "Owner", description: "Bot ownership and account controls." },
    settings: { name: "Settings", description: "Bot preferences and configuration." },
    status: { name: "Status", description: "WhatsApp status-related commands." },
    group: { name: "Group", description: "Group information and administration." },
    "group-management": { name: "Group tools", description: "Group utilities and member tools." },
    protection: { name: "Protection", description: "Group protection settings." },
    interactive: { name: "Interactive", description: "Interactive message utilities." },
    image: { name: "Images", description: "Image and media commands." },
    utility: { name: "Utilities", description: "General-purpose tools." },
    search: { name: "Search", description: "Search and information commands." },
    fun: { name: "Fun", description: "Games and entertainment." },
    economy: { name: "Economy", description: "Economy and progression commands." },
    anime: { name: "Anime", description: "Anime and character commands." },
    core: { name: "General", description: "Bot information and help." }
};

const coreCommandMetadata = {
    register: { description: "Registration is currently disabled.", usage: "register" },
    menu: { description: "Display all registered commands in one organized list.", usage: "menu" },
    menu2: { description: "Show the registered command menu.", usage: "menu2" },
    help: { description: "Show usage guidance, optionally for one command.", usage: "help [command]", example: "help ping" },
    ping: { description: "Check the bot's response time.", usage: "ping" },
    alive: { description: "Check bot status and uptime.", usage: "alive" },
    bot: { description: "Show bot version, mode, account, and uptime.", usage: "bot" },
    status: { description: "Show the current WhatsApp session status.", usage: "status" },
    runtime: { description: "Show how long the bot has been running.", usage: "runtime" },
    owner: { description: "Show bot owner information.", usage: "owner" },
    profile: { description: "Show your profile information.", usage: "profile" },
    support: { description: "Show how to contact bot support.", usage: "support" },
    feedback: { description: "Send feedback to the bot owner.", usage: "feedback <message>", example: "feedback Please add a new feature" },
    love: { description: "Generate a playful love-meter score.", usage: "love" },
    dice: { description: "Roll a six-sided die.", usage: "dice" }
};

function getSettings() {
    if (!fs.existsSync(settingsPath)) {
        return {
            botName: "ANONYMOUS MD",
            prefix: ".",
            owner: "Anonymous",
            mode: "public",
            sudo: []
        };
    }

    return JSON.parse(
        fs.readFileSync(settingsPath, "utf8")
    );
}

const startTime = Date.now();

function getRuntime() {
    const uptime = Date.now() - startTime;

    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
}

function getContextRuntime(context) {
    return typeof context.runtime === "function"
        ? context.runtime()
        : getRuntime();
}

function formatPrivateIdentifier(jid) {
    if (!jid) return "Unavailable";

    const [identifier, server] = jid.split("@");
    if (!identifier) return "Unavailable";
    if (server === "g.us") {
        return `group-${identifier.slice(-6)}`;
    }

    if (identifier.length <= 5) {
        return "user-***";
    }

    return `user-${identifier.slice(0, 2)}***${identifier.slice(-2)}`;
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

function getCommandGroups(modules = [], prefix = ".") {
    const seen = new Set();
    const groups = [];
    const categoryOrder = [
        "core", "utility", "search", "image", "fun", "anime", "interactive",
        "group", "group-management", "protection", "number-session",
        "menu-video", "settings", "status", "economy", "owner"
    ];

    for (const [moduleName, module] of modules) {
        if (!Array.isArray(module?.commandNames)) continue;

        const commands = module.commandNames.filter(command => {
            if (typeof command !== "string" || seen.has(command)) return false;
            seen.add(command);
            return true;
        });
        if (!commands.length) continue;

        const category = module.metadata?.category || categoryMetadata[moduleName]?.name || moduleName;
        const description = module.metadata?.description || categoryMetadata[moduleName]?.description || "Registered commands.";
        const commandDetails = commands.map(command => {
            const metadata = module.commandMetadata?.[command] ||
                (moduleName === "core" ? coreCommandMetadata[command] : null);
            const rawUsage = metadata?.usage || command;
            const argumentUsage = rawUsage.startsWith(command)
                ? rawUsage.slice(command.length).trim()
                : "";

            return {
                name: command,
                description: metadata?.description || description,
                usage: `${prefix}${rawUsage}`,
                argumentUsage,
                example: metadata?.example ? `${prefix}${metadata.example}` : null
            };
        });

        groups.push({ moduleName, category, description, commands: commandDetails });
    }

    return groups.sort((left, right) => {
        const leftIndex = categoryOrder.indexOf(left.moduleName);
        const rightIndex = categoryOrder.indexOf(right.moduleName);
        return (leftIndex < 0 ? categoryOrder.length : leftIndex) -
            (rightIndex < 0 ? categoryOrder.length : rightIndex);
    });
}

function formatCommandMenu(modules, prefix, botName) {
    const groups = getCommandGroups(modules, prefix);
    const commands = groups.flatMap(group =>
        group.commands.map(command => ({ ...command, category: group.category }))
    );
    const lines = [
        `*${botName} COMMANDS*`,
        `All ${commands.length} registered commands`,
        `Use ${prefix}help <command> for details.`,
        ""
    ];

    let activeCategory = "";
    for (const command of commands) {
        if (command.category !== activeCategory) {
            activeCategory = command.category;
            lines.push(`〔 ⚡ ${toBoldUnicode(activeCategory.toUpperCase())} 〕`);
        }
        const args = command.argumentUsage ? ` ${command.argumentUsage}` : "";
        lines.push(`❏◦ ➫ ${prefix}${toBoldUnicode(command.name)}${args} — ${command.description}`);
    }

    return lines.join("\n");
}

function formatSystemHeader(context, settings, commandCount) {
    const now = new Date();
    const session = context.sessionInfo || {};
    const rawSessionId = session.id || context.accountName || "unknown";
    const phoneSessionId = String(rawSessionId)
        .match(/^\+?(\d{6,})(?:@s\.whatsapp\.net)?$/i);
    const sessionId = phoneSessionId
        ? formatPrivateIdentifier(`${phoneSessionId[1]}@s.whatsapp.net`)
        : rawSessionId;
    const number = String(session.number || "").replace(/\D/g, "");
    const maskedNumber = number.length >= 7
        ? ` (+${number.slice(0, 2)}***${number.slice(-2)})`
        : "";
    const connectionStatus = session.status || "Unavailable";
    const botName = String(settings.botName || context.botName || "ANONYMOUS MD")
        .replace(/[\r\n\u0000-\u001f]/g, " ")
        .trim();
    const displayName = String(context.msg?.pushName || "there")
        .replace(/[\r\n\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, 40) || "there";

    return [
        `══『 ${toBoldUnicode(botName)} 』══`,
        "⿻ ⿻ ⿻ ⿻ ⿻ ⿻ ⿻ ⿻",
        "",
        `〔 ${toBoldUnicode("SYSTEM INFO")} 〕`,
        `亗 ${toBoldUnicode("Hello")}, ${displayName}`,
        `❏◦ ${toBoldUnicode("Prefix")} ⇆ ${settings.prefix || context.prefix || "."}`,
        `❏◦ ${toBoldUnicode("Cmds")} ⇆ ${commandCount}`,
        `❏◦ ${toBoldUnicode("Uptime")} ⇆ ${getContextRuntime(context)}`,
        `❏◦ ${toBoldUnicode("Date")} ⇆ ${now.toLocaleDateString("en-GB")}`,
        `❏◦ ${toBoldUnicode("Time")} ⇆ ${now.toLocaleTimeString("en-GB", { hour12: false })}`,
        `❏◦ ${toBoldUnicode("Mode")} ⇆ ${settings.mode || "public"}`,
        `❏◦ ${toBoldUnicode("Status")} ⇆ ${connectionStatus}`,
        `❏◦ ${toBoldUnicode("Version")} ⇆ ${version}`,
        `❏◦ ${toBoldUnicode("Session")} ⇆ ${sessionId}${maskedNumber}`,
        "⟢ ── 亗 ── ⟡ ── 亗 ── ⟢"
    ].join("\n");
}

function splitMenuMessage(text, maximumLength = maximumMenuMessageLength) {
    const messages = [];
    let current = "";
    for (const line of text.split("\n")) {
        if (line.length > maximumLength) {
            if (current) messages.push(current);
            for (let offset = 0; offset < line.length; offset += maximumLength) {
                messages.push(line.slice(offset, offset + maximumLength));
            }
            current = "";
            continue;
        }
        const next = current ? `${current}\n${line}` : line;
        if (next.length > maximumLength && current) {
            messages.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current) messages.push(current);
    return messages;
}

async function sendMenu(context, sock, jid, commandModules, settings) {
    const prefix = settings.prefix || ".";
    const commandHandler = require("../lib/command-handler");
    const menuContext = { ...context, sock, jid, prefix, commandModules };
    interactiveMenu.clearForContext(menuContext);
    const categories = await interactiveMenu.getAvailableCategories(menuContext, {
        getCommandGroups,
        canExecuteCommand: commandHandler.canExecuteCommand
    });
    const commandCount = categories.reduce(
        (count, category) => count + category.commands.length,
        0
    );
    const lines = [
        formatSystemHeader(menuContext, settings, commandCount),
        "",
        `〔 ${toBoldUnicode("AVAILABLE COMMANDS")} 〕`
    ];

    for (const category of categories) {
        lines.push("", `╭──〔 亗 ${toBoldUnicode(category.title.toUpperCase())} 〕──╮`);
        const sortedCommands = [...category.commands].sort((left, right) =>
            left.name.localeCompare(right.name)
        );
        for (const command of sortedCommands) {
            const usage = command.argumentUsage ? ` ${command.argumentUsage}` : "";
            const aliases = command.aliasNote ? ` ${command.aliasNote}` : "";
            lines.push(`❏◦ ➫ ${prefix}${toBoldUnicode(command.name)}${usage}${aliases}`);
        }
        lines.push("╰────────────────╯");
    }

    lines.push("", `Use ${prefix}help <command> for command details.`);
    await sock.sendMessage(jid, { text: lines.join("\n") });
}

async function handleCoreCommand(sock, msg, command, args, context = {}) {
    const settings = getSettings();
    const prefix = settings.prefix || ".";
    const botName = settings.botName || context.botName || "ANONYMOUS MD";
    const accountName = context.accountName || "Unknown";
    const jid = msg.key.remoteJid;
    const commandGroups = getCommandGroups(context.commandModules || [], prefix);

    if (command === "register") {
        await sock.sendMessage(jid, {
            text: "⛔ Registration is disabled. Contact the bot owner to approve your WhatsApp account."
        });

        return true;
    }

    switch (command) {

        // =========================
        // MENU
        // =========================
        case "menu":
            await sendMenu(context, sock, jid, context.commandModules || [], settings);
            break;

        // =========================
        // MENU 2
        // =========================
        case "menu2":
            await sendMenu(context, sock, jid, context.commandModules || [], settings);
            break;

        // =========================
        // HELP
        // =========================
        case "help":
            if (args.length) {
                const requestedCommand = args[0].toLowerCase().replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "");
                const detail = commandGroups
                    .flatMap(group => group.commands.map(item => ({ ...item, category: group.category })))
                    .find(item => item.name === requestedCommand);

                await sock.sendMessage(jid, {
                    text: detail
                        ? `╭━━〔 🆘 COMMAND HELP 〕━━╮\n\n${prefix}${detail.name}\nCategory: ${detail.category}\n${detail.description}\nUsage: ${detail.usage}${detail.example ? `\nExample: ${detail.example}` : ""}\n\n╰━━━━━━━━━━━━━━━━━━╯`
                        : `No registered command named "${requestedCommand}". Use ${prefix}menu to browse commands.`
                });
                break;
            }

            await sock.sendMessage(msg.key.remoteJid, {
                text: `
╭━━〔 🆘 HELP 〕━━╮

Use ${prefix}menu to see all available commands grouped by category in one message.
Use ${prefix}help <command> for a command's usage.

Examples:

${prefix}ping
${prefix}help feedback
${prefix}feedback Please add a feature
${prefix}menu

Only commands registered by this bot are shown in the menu.
╰━━━━━━━━━━━━━━╯
`
            });
            break;

        // =========================
        // PING
        // =========================
        case "ping": {
            const start = Date.now();

            await sock.sendMessage(jid, {
                text: "🏓 PONG!"
            });

            const latency = Date.now() - start;

            await sock.sendMessage(jid, {
                text: `⚡ Response time: ${latency}ms`
            });

            break;
        }

        // =========================
        // ALIVE
        // =========================
        case "alive":
            await sock.sendMessage(jid, {
                text: `
╭━━〔 🤖 ${botName} 〕━━╮

🤖 Bot name: ${botName}
🟢 Status: ONLINE
📱 Account: ${accountName}
⏱️ Runtime: ${getContextRuntime(context)}
⌨️ Prefix: ${prefix}
📣 ${settings.aliveMessage || `${botName} ONLINE`}

Type ${prefix}menu to see commands.

╰━━━━━━━━━━━━━━━━━━╯
`
            });
            break;

        case "bot":
            await sock.sendMessage(jid, {
                text: [
                    `══『 ${toBoldUnicode(botName)} 』══`,
                    `Version: ${version}`,
                    `Status: ${context.sessionInfo?.status || "Unavailable"}`,
                    `Mode: ${settings.mode || "public"}`,
                    `Prefix: ${prefix}`,
                    `Account: ${accountName}`,
                    `Uptime: ${getContextRuntime(context)}`
                ].join("\n")
            });
            break;

        case "status":
            await sock.sendMessage(jid, {
                text: [
                    `〔 ${toBoldUnicode("SYSTEM STATUS")} 〕`,
                    `WhatsApp: ${context.sessionInfo?.status || "Unavailable"}`,
                    `Mode: ${settings.mode || "public"}`,
                    `Version: ${version}`,
                    `Uptime: ${getContextRuntime(context)}`
                ].join("\n")
            });
            break;

        // =========================
        // RUNTIME
        // =========================
        case "runtime":
            await sock.sendMessage(jid, {
                text: `⏱️ *${botName} Runtime*\n\n🟢 ${getContextRuntime(context)}`
            });
            break;

        // =========================
        // OWNER
        // =========================
        case "owner":
            await sock.sendMessage(jid, {
                text: `
╭━━〔 👑 BOT OWNER 〕━━╮

${settings.owner || "Anonymous"}

━━━━━━━━━━━━━━━━

Need help?
Use ${prefix}menu

╰━━━━━━━━━━━━━━╯
`
            });
            break;

        case "love":
            await sock.sendMessage(jid, {
                text: `❤️ *LOVE METER*\n\nLove: *${Math.floor(Math.random() * 101)}%*`
            });
            break;

        case "dice":
            await sock.sendMessage(jid, {
                text: `🎲 You rolled: *${Math.floor(Math.random() * 6) + 1}*`
            });
            break;

        case "profile": {
            const chatJid = context.jid || jid;
            const senderJid =
                context.senderJid || msg.key.participant || chatJid;
            const isGroup = chatJid.endsWith("@g.us");
            const displayName = msg.pushName || "Unavailable";

            await sock.sendMessage(jid, {
                text: `
╭━━〔 👤 PROFILE 〕━━╮

🆔 Identifier: ${formatPrivateIdentifier(senderJid)}
📛 Name: ${displayName}
💬 Chat: ${isGroup ? "Group" : "Private"}
🤖 Bot account: ${accountName}

╰━━━━━━━━━━━━━━━━╯
`
            });
            break;
        }

        case "support":
            await sock.sendMessage(jid, {
                text: `
╭━━〔 🛟 SUPPORT 〕━━╮

ANONYMOUS MD support is available here.

Describe the issue clearly and include the command that caused it.
Use ${prefix}feedback to send feedback.

╰━━━━━━━━━━━━━━━━━━╯
`
            });
            break;

        case "feedback":
            if (!args.length) {
                await sock.sendMessage(jid, {
                    text: `📝 Please include your feedback.\n\nExample: ${prefix}feedback Add a new feature`
                });
                break;
            }
            {
                let feedback = [];
                try {
                    feedback = JSON.parse(fs.readFileSync(feedbackPath, "utf8"));
                } catch {
                    feedback = [];
                }
                feedback.push({
                    text: args.join(" "),
                    sender: context.senderJid || "unknown",
                    chat: jid,
                    at: new Date().toISOString()
                });
                fs.writeFileSync(feedbackPath, JSON.stringify(feedback, null, 4), "utf8");
            }
            await sock.sendMessage(jid, { text: "✅ Thank you. Your feedback has been saved." });
            break;

        default:
            return false;
    }

    return true;
}

module.exports = {
    formatCommandMenu,
    formatSystemHeader,
    getCommandGroups,
    splitMenuMessage,
    commandNames: [
        "register",
        "menu",
        "menu2",
        "help",
        "ping",
        "alive",
        "bot",
        "status",
        "runtime",
        "owner",
        "profile",
        "support",
        "feedback",
        "love",
        "dice"
    ],
    handleCoreCommand
};