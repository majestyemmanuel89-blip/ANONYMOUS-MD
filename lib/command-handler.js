const fs = require("fs");
const path = require("path");

const core = require("../commands/core");
const group = require("../commands/group");
const { isApproved, getOwnerAuthStatus } = require("./auth");
const { getSettings, isOwner, isSudo } = require("./permissions");

const commandsDirectory = path.join(__dirname, "../commands");
const preferredModuleOrder = [
    "owner",
    "settings",
    "status",
    "group",
    "group-management",
    "protection",
    "interactive",
    "image",
    "utility",
    "search",
    "fun",
    "economy",
    "anime",
    "number-session"
];

function loadCommandModules() {
    const filenames = fs.readdirSync(commandsDirectory)
        .filter(filename => filename.endsWith(".js"))
        .filter(filename => filename !== "groups.js")
        .map(filename => filename.slice(0, -3));
    const discoveredNames = new Set(filenames);
    const orderedNames = [
        ...preferredModuleOrder.filter(name => discoveredNames.has(name)),
        ...filenames
            .filter(name => !preferredModuleOrder.includes(name) && name !== "core")
            .sort()
    ];

    return [
        ...orderedNames.map(name => [
            name,
            require(path.join(commandsDirectory, `${name}.js`))
        ]),
        ["core", core]
    ];
}

const commandModules = loadCommandModules();

const groupCommands = new Set(group.commandNames);
const ownerOnlyModuleNames = new Set([
    "owner",
    "settings",
    "menu-video",
    "number-session"
]);

function getAccess(context) {
    return {
        isOwner: Boolean(context.isOwner || isOwner(context.senderJid, context)),
        isSudo: Boolean(context.isSudo || isSudo(context.senderJid, context)),
        isApproved: Boolean(context.isApproved || isApproved(context.senderJid, context))
    };
}

function canExecuteCommand(context, command) {
    const access = getAccess(context);
    const mode = getSettings().mode || "public";
    const hasGeneralAccess = access.isOwner || mode === "public" ||
        (mode !== "private" && (access.isSudo || access.isApproved));
    if (!hasGeneralAccess) return false;

    const moduleName = commandModules.find(([, module]) =>
        Array.isArray(module?.commandNames) && module.commandNames.includes(command)
    )?.[0];
    return !ownerOnlyModuleNames.has(moduleName) || access.isOwner;
}

function getHandler(module) {
    if (typeof module?.handleCommand === "function") {
        return module.handleCommand;
    }

    if (typeof module?.handleCoreCommand === "function") {
        return (context) =>
            module.handleCoreCommand(
                context.sock,
                context.msg,
                context.command,
                context.args,
                context
            );
    }

    if (typeof module?.handleGroupCommand === "function") {
        return ({ sock, msg, command, args }) =>
            module.handleGroupCommand(sock, msg, command, args);
    }

    return null;
}

function getRegisteredCommandCount() {
    return new Set(commandModules.flatMap(([, module]) =>
        Array.isArray(module?.commandNames) ? module.commandNames : []
    )).size;
}

function getDuplicateCommands() {
    const seen = new Map();
    for (const [moduleName, module] of commandModules) {
        for (const commandName of module?.commandNames || []) {
            const owners = seen.get(commandName) || [];
            owners.push(moduleName);
            seen.set(commandName, owners);
        }
    }

    return [...seen.entries()]
        .filter(([, owners]) => owners.length > 1)
        .map(([commandName, owners]) => ({ commandName, owners }));
}

async function handleCommand(context) {
    const { command, accountName = "unknown" } = context;

    const publicCommands = new Set([
        "register",
        "support",
        "help",
        "menu"
    ]);
    const access = {
        isOwner: isOwner(context.senderJid, context),
        isSudo: isSudo(context.senderJid, context),
        isApproved: isApproved(context.senderJid, context)
    };
    const mode = getSettings().mode || "public";
    const hasAccess = access.isOwner || (mode === "public") ||
        (mode !== "private" && (access.isSudo || access.isApproved));
    const denied = mode === "private"
        ? !access.isOwner
        : mode === "public"
            ? false
            : !hasAccess && !publicCommands.has(command);

    if (!access.isOwner && !hasAccess && denied) {
        const authStatus = getOwnerAuthStatus(context.senderJid, context);
        console.log(
            `[AUTH] Sender type: ${authStatus.senderType}; ` +
            `Owner match: ${authStatus.ownerMatch}; ` +
            `Owner resolution: ${authStatus.resolution}`
        );
    }

    if (denied) {
        await context.sock.sendMessage(context.jid, {
            text: "⛔ You are not authorized yet. Ask the bot owner to approve your account."
        });
        return true;
    }

    // The old group module treats every private-chat command as group-only.
    // Invoke it only for its known commands so unrelated commands can continue.
    const orderedModules = [
        ["core", core],
        ...(groupCommands.has(command)
            ? [["group", group]]
            : []),
        ...commandModules.filter(([name]) => name !== "core" && name !== "group")
    ];

    for (const [name, module] of orderedModules) {
        const handler = getHandler(module);
        if (!handler) continue;

        try {
            const handled = await handler({
                ...context,
                ...access,
                commandModules,
                commandCount: getRegisteredCommandCount()
            });
            if (handled === true) {
                console.log(`[${accountName}] [COMMAND HANDLED] ${command} (${name})`);
                return true;
            }
        } catch (error) {
            console.error(
                `[${accountName}] [COMMAND ERROR] ${command} (${name})`,
                error
            );
            return true;
        }
    }

    console.log(`[${accountName}] [COMMAND UNHANDLED] ${command}`);
    return false;
}

module.exports = {
    commandModules,
    canExecuteCommand,
    getRegisteredCommandCount,
    getDuplicateCommands,
    handleCommand
};