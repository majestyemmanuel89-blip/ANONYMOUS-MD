const catalog = [
    {
        title: "GENERAL",
        icon: "◈",
        audience: "public",
        commands: [
            ["core", "menu", "Show all available commands grouped by category in one message."],
            ["core", "help", "Show command usage and examples.", "help [command]"],
            ["core", "ping", "Check bot response."],
            ["core", "alive", "Show bot status and uptime."],
            ["core", "bot", "Show bot version, mode, account, and uptime."],
            ["core", "status", "Show the current WhatsApp session status."],
            ["core", "runtime", "Show bot uptime."],
            ["core", "owner", "Show the owner display name."],
            ["core", "profile", "Show your privacy-masked profile."],
            ["core", "support", "Show support guidance."],
            ["core", "feedback", "Send feedback to the bot.", "feedback <message>"]
        ]
    },
    {
        title: "FUN",
        icon: "◇",
        audience: "public",
        commands: [
            ["fun", "truth", "Get a truth prompt."],
            ["fun", "dare", "Get a dare prompt."],
            ["core", "love", "Generate a playful love-meter score."],
            ["core", "dice", "Roll a six-sided die."],
            ["fun", "wyr", "Play would-you-rather.", "wyr (alias: wouldyou)"],
            ["fun", "ship", "Generate a compatibility score."],
            ["fun", "riddle", "Get a riddle."],
            ["fun", "pickupline", "Get a pickup line.", "pickupline (alias: rizz)"],
            ["fun", "joke", "Get a joke.", "joke (alias: dadjoke)"],
            ["fun", "fact", "Get a fact."],
            ["fun", "quote", "Get a quote."],
            ["fun", "8ball", "Ask the magic 8-ball."],
            ["fun", "fortune", "Get a fortune."],
            ["fun", "numbergame", "Start or continue the number game.", "numbergame [guess]"],
            ["fun", "battle", "Generate a battle-power score."]
        ]
    },
    {
        title: "ECONOMY",
        icon: "◇",
        audience: "public",
        commands: [
            ["economy", "bal", "View your balance.", "bal (aliases: balance, wallet)"],
            ["economy", "daily", "Claim the daily reward."],
            ["economy", "work", "Claim a work reward."],
            ["economy", "deposit", "Move coins into your bank.", "deposit <amount>"],
            ["economy", "withdraw", "Withdraw coins from your bank.", "withdraw <amount>"],
            ["economy", "give", "Transfer coins to a user.", "give <user> <amount>"],
            ["economy", "rob", "Try a timed robbery."],
            ["economy", "gamble", "Gamble coins.", "gamble <amount>"],
            ["economy", "lb", "View the leaderboard.", "lb (alias: leaderboard)"],
            ["economy", "shop", "View shop items."],
            ["economy", "buy", "Buy a shop item.", "buy <item>"],
            ["economy", "inv", "View your inventory.", "inv (alias: inventory)"],
            ["economy", "steal", "Try to steal coins."],
            ["economy", "crime", "Try a timed crime."],
            ["economy", "hunt", "Claim a hunting reward."],
            ["economy", "fish", "Claim a fishing reward."],
            ["economy", "mine", "Claim a mining reward."],
            ["economy", "level", "View your level and XP."],
            ["economy", "ecoinfo", "Read economy information."]
        ]
    },
    {
        title: "UTILITY",
        icon: "◇",
        audience: "public",
        commands: [
            ["utility", "say", "Repeat text.", "say <text>"],
            ["utility", "calc", "Calculate an arithmetic expression.", "calc <expression> (alias: calculator)"],
            ["utility", "morse", "Convert text to Morse code.", "morse <text> (alias: morsecode)"],
            ["utility", "passcheck", "Check a password-strength heuristic.", "passcheck <text> (alias: passwordcheck)"],
            ["utility", "readmore", "Format text with a read-more break.", "readmore <text>"],
            ["view-once", "vv", "Send a regular photo to your DM as a view-once image.", "vv (reply to a regular photo)"],
            ["interactive", "reactto", "React to a quoted message.", "reactto <emoji>", { requiresQuotedTarget: true }]
        ]
    },
    {
        title: "GROUP",
        icon: "◇",
        audience: "group",
        commands: [
            ["group", "groupinfo", "View group information.", "groupinfo (alias: gcinfo)"],
            ["group", "groupid", "View the current group ID."],
            ["group", "listmembers", "List group members."],
            ["group", "admins", "List group admins.", "admins (alias: tagadmins)"],
            ["group", "tagall", "Mention group members."],
            ["group", "find", "Find a group member.", "find <name or number> (alias: findfriends)"],
            ["group", "poll", "Create a group poll.", "poll <question> | <option> | <option>"],
            ["group-management", "report", "Record a group report.", "report <target> <details>"],
            ["group-management", "event", "Save a group event.", "event <title> | DD/MM/YYYY | HH:MM"],
            ["group-management", "eventinfo", "List saved group events."]
        ]
    },
    {
        title: "ADMIN",
        icon: "◇",
        audience: "group-admin",
        commands: [
            ["group", "getlink", "Get the group invite link.", "botAdmin"],
            ["group", "revoke", "Revoke the group invite link.", "botAdmin"],
            ["group", "open", "Allow all members to send messages.", "botAdmin"],
            ["group", "close", "Restrict messages to admins.", "botAdmin"],
            ["group", "setgcname", "Change the group name.", "setgcname <name> (botAdmin)"],
            ["group", "setgcdesc", "Change the group description.", "setgcdesc <text> (botAdmin)"],
            ["group", "kick", "Remove a member.", "kick @user (botAdmin)"],
            ["group", "add", "Add a member.", "add <number> (botAdmin)"],
            ["group", "promote", "Promote a member.", "promote @user (botAdmin)"],
            ["group", "demote", "Demote a member.", "demote @user (botAdmin)"],
            ["group", "announce", "Send an announcement to group members.", "announce <text> (botAdmin)"],
            ["group", "creategc", "Create a group.", "creategc <name>"],
            ["group-management", "announcement", "Set the group to announcement-only mode.", "botAdmin"]
        ]
    },
    {
        title: "MODERATION",
        icon: "◇",
        audience: "group-admin",
        commands: [
            ["group", "ban", "Add a member to the local ban list.", "ban @user"],
            ["group", "unban", "Remove a member from the local ban list.", "unban @user"],
            ["group", "warn", "Record a member warning.", "warn @user"],
            ["group", "unwarn", "Clear a member warning.", "unwarn @user"],
            ["group", "listwarn", "List group warnings."],
            ["group", "listban", "List group bans."],
            ["group", "resetwarns", "Clear a member's warnings.", "resetwarns @user"],
            ["group", "silence", "Temporarily silence a member.", "silence @user <duration> (botAdmin)"],
            ["group", "unsilence", "Remove a member's silence.", "unsilence @user (botAdmin)"],
            ["group", "silencelist", "List silenced members.", "botAdmin"]
        ]
    },
    {
        title: "OWNER",
        icon: "◇",
        audience: "owner",
        commands: [
            ["settings", "mode", "Set public/private access mode.", "mode <public|private>"],
            ["settings", "setprefix", "Change the command prefix.", "setprefix <prefix>"],
            ["settings", "public", "Set public mode."],
            ["settings", "private", "Set private mode."],
            ["settings", "setname", "Change the bot display name.", "setname <name>"],
            ["settings", "setowner", "Change the owner display name.", "setowner <name>"],
            ["owner", "approve", "Approve a user.", "approve @user"],
            ["owner", "unapprove", "Remove a user's approval.", "unapprove @user"],
            ["owner", "listapproved", "List approved users with masked numbers."],
            ["owner", "setalive", "Change the alive message.", "setalive <text>"],
            ["owner", "setsudo", "Add a sudo user.", "setsudo @user"],
            ["owner", "delsudo", "Remove a sudo user.", "delsudo @user"],
            ["owner", "listsudo", "List sudo users with masked numbers."],
            ["owner", "block", "Block a WhatsApp contact.", "block <number>"],
            ["owner", "unblock", "Unblock a WhatsApp contact.", "unblock <number>"],
            ["owner", "listblocked", "List blocked contacts with masked numbers."],
            ["owner", "setpp", "Set the bot profile picture from quoted media.", "", { requiresMedia: true }],
            ["owner", "delpp", "Remove the bot profile picture."],
            ["owner", "setppname", "Change the WhatsApp profile name.", "setppname <name>"],
            ["owner", "setbio", "Change the WhatsApp profile bio.", "setbio <text>"],
            ["owner", "getpp", "View the bot profile picture."],
            ["owner", "getname", "View the bot profile name."],
            ["owner", "pinchat", "Pin the current chat."],
            ["owner", "unpinchat", "Unpin the current chat."],
            ["owner", "join", "Join a WhatsApp group invite.", "join <invite-link>"],
            ["owner", "leave", "Make the bot leave the current group.", "", { requiresGroup: true }],
            ["owner", "broadcast2", "Send a direct owner message.", "broadcast2 <number> <text>"],
            ["owner", "save", "Save quoted media temporarily.", "", { requiresMedia: true }],
            ["owner", "idch", "Show the current chat identifier."],
            ["owner", "checkidch", "Validate a chat identifier.", "checkidch <id>"],
            ["owner", "autotyping", "Toggle automatic typing presence.", "autotyping <on|off>"],
            ["owner", "autorecording", "Toggle automatic recording presence.", "autorecording <on|off>"],
            ["owner", "autoread", "Toggle automatic message reads.", "autoread <on|off>"],
            ["owner", "autoviewstatus", "Toggle status viewing.", "autoviewstatus <on|off>"],
            ["owner", "alwaysonline", "Toggle always-online presence.", "alwaysonline <on|off>"],
            ["owner", "autoreact", "Toggle automatic reactions.", "autoreact <on|off> [emoji]"],
            ["owner", "anticall", "Toggle call rejection.", "anticall <on|off>"],
            ["owner", "listgc", "List accessible groups."],
            ["owner", "totalcmd", "Count registered commands."],
            ["owner", "totalmembers", "Count unique accessible group members."],
            ["owner", "membercount", "Count members in this group.", "", { requiresGroup: true }],
            ["owner", "mbsearch", "Search accessible group members.", "mbsearch <name or number>"]
        ]
    },
    {
        title: "NUMBER & SESSION MANAGEMENT",
        icon: "◇",
        audience: "owner",
        privateOnly: true,
        commands: [
            ["number-session", "connect", "Create a new linked WhatsApp session.", "connect [new] [code <number>|qr]"],
            ["number-session", "connectnumber", "Create a pairing-code session.", "connectnumber <number>"],
            ["number-session", "sessions", "List saved WhatsApp sessions."],
            ["number-session", "sessionstatus", "Show a session status.", "sessionstatus <id>"],
            ["number-session", "reconnect", "Reconnect a saved session.", "reconnect <id>"],
            ["number-session", "disconnect", "Disconnect a session.", "disconnect <id>"],
            ["number-session", "logout", "Log out a session after confirmation.", "logout <id>"],
            ["number-session", "deletesession", "Delete a session after confirmation.", "deletesession <id>"],
            ["number-session", "setprimary", "Select a primary session.", "setprimary <id>"],
            ["number-session", "addnumber", "Register a number.", "addnumber <number>"],
            ["number-session", "correctnumber", "Correct a registered number.", "correctnumber <old> <new>"],
            ["number-session", "removenumber", "Remove a registered number.", "removenumber <number>"],
            ["number-session", "listnumbers", "List registered numbers with masking."],
            ["number-session", "checknumber", "Check a registered number.", "checknumber <number>"],
            ["number-session", "confirm", "Confirm a pending operation.", "confirm <code>"],
            ["number-session", "cancelconnect", "Cancel a pending session connection."]
        ]
    },
    {
        title: "VIDEO HUB",
        icon: "◇",
        audience: "owner",
        commands: [
            ["menu-video", "setmenuvideo", "Select a local menu MP4.", "setmenuvideo <filename>"],
            ["menu-video", "menuvideo", "Enable or disable the menu video.", "menuvideo <on|off>"],
            ["menu-video", "previewmenuvideo", "Preview the selected menu video."],
            ["menu-video", "videolist", "List available local MP4 files."]
        ]
    }
];

function getVerifiedMenuCategories({ context, commandGroups, canExecuteCommand }) {
    const registered = new Map();
    for (const group of commandGroups) {
        for (const command of group.commands) {
            if (!registered.has(command.name)) registered.set(command.name, { ...command, moduleName: group.moduleName });
        }
    }

    return catalog.map(category => {
        const commands = category.commands.flatMap(([moduleName, name, description, usage = "", options = {}]) => {
            const command = registered.get(name);
            if (!command || command.moduleName !== moduleName) return [];
            if (category.audience === "owner" && !context.isOwner) return [];
            if (category.privateOnly &&
                (context.jid !== context.senderJid ||
                    !["@s.whatsapp.net", "@lid"].some(suffix => context.jid?.endsWith(suffix)))) return [];
            if (category.audience === "group" && !context.jid?.endsWith("@g.us")) return [];
            if (options.requiresGroup && !context.jid?.endsWith("@g.us")) return [];
            if (category.audience === "group-admin" &&
                (!context.jid?.endsWith("@g.us") || !context.isSenderAdmin ||
                    (usage.includes("botAdmin") && !context.isBotAdmin))) return [];
            if (canExecuteCommand && !canExecuteCommand(context, name)) return [];
            const cleanUsage = usage
                .replace(/\s*\(botAdmin\)/i, "")
                .replace(/\s*\((?:alias:|aliases:)[^)]+\)/i, "")
                .trim();
            const catalogArguments = cleanUsage.startsWith(name)
                ? cleanUsage.slice(name.length).trim()
                : "";
            return [{
                name,
                description,
                usage: cleanUsage,
                aliasNote: (usage.match(/\((?:alias:|aliases:)[^)]+\)/i) || [""])[0],
                argumentUsage: command.argumentUsage || catalogArguments,
                example: command.example || null,
                requiresMedia: Boolean(options.requiresMedia),
                requiresQuotedTarget: Boolean(options.requiresQuotedTarget)
            }];
        });
        return { ...category, commands };
    }).filter(category => category.commands.length > 0);
}

module.exports = {
    getVerifiedMenuCategories
};
