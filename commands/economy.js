const fs = require("fs");
const path = require("path");

const economyPath = path.join(__dirname, "../data/economy.json");
const commandNames = ["economy", "bal", "balance", "wallet", "daily", "work", "deposit", "withdraw", "give", "rob", "gamble", "lb", "leaderboard", "shop", "buy", "inv", "inventory", "steal", "crime", "hunt", "fish", "mine", "level", "ecoinfo", "bail"];
const defaults = { enabled: {}, users: {}, shop: { apple: 10, shield: 100, ticket: 250 } };

function read() { try { return { ...defaults, ...JSON.parse(fs.readFileSync(economyPath, "utf8")) }; } catch { return JSON.parse(JSON.stringify(defaults)); } }
function write(data) { fs.writeFileSync(economyPath, JSON.stringify(data, null, 4), "utf8"); }
function user(data, jid) { if (!data.users[jid]) data.users[jid] = { balance: 0, bank: 0, xp: 0, inventory: {}, cooldowns: {} }; return data.users[jid]; }
function amount(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
function enabled(data, jid) { return data.enabled[jid] !== false; }

async function handleCommand({ command, args, jid, senderJid, sock }) {
	if (!commandNames.includes(command)) return false;
	const data = read();
	let text;
	if (command === "economy") { data.enabled[jid] = args[0]?.toLowerCase() !== "off"; write(data); await sock.sendMessage(jid, { text: `Economy ${data.enabled[jid] ? "enabled" : "disabled"}.` }); return true; }
	if (!enabled(data, jid)) { await sock.sendMessage(jid, { text: "Economy is disabled in this chat." }); return true; }
	const account = user(data, senderJid);
	const now = Date.now();
	const cooldown = (key, ms) => now - (account.cooldowns[key] || 0) >= ms;
	const reward = (key, coins, xp) => { account.balance += coins; account.xp += xp; account.cooldowns[key] = now; write(data); };
	if (["bal", "balance", "wallet"].includes(command)) text = `Balance: ${account.balance}\nBank: ${account.bank}`;
	else if (command === "daily") { if (!cooldown("daily", 86400000)) text = "Daily reward is on cooldown."; else { reward("daily", 250, 25); text = "Daily reward: 250 coins."; } }
	else if (command === "work") { if (!cooldown("work", 3600000)) text = "Work is on cooldown."; else { reward("work", 100, 10); text = "Work reward: 100 coins."; } }
	else if (command === "deposit" || command === "withdraw") { const n = amount(args[0]); if (!n || (command === "deposit" ? account.balance < n : account.bank < n)) text = "Invalid amount or insufficient funds."; else { account.balance += command === "withdraw" ? n : -n; account.bank += command === "deposit" ? n : -n; write(data); text = `${command} complete.`; } }
	else if (command === "give") { const n = amount(args[1]); const target = args[0]; if (!target || !n || account.balance < n) text = "Usage: .give <user> <amount>"; else { account.balance -= n; user(data, target).balance += n; write(data); text = "Transfer complete."; } }
	else if (["rob", "steal", "crime", "hunt", "fish", "mine"].includes(command)) { if (!cooldown(command, 1800000)) text = `${command} is on cooldown.`; else { reward(command, command === "crime" ? 150 : 75, 15); text = `${command} complete. Reward added.`; } }
	else if (command === "gamble") { const n = amount(args[0]); if (!n || account.balance < n) text = "Usage: .gamble <amount>"; else { const win = Math.random() > 0.5; account.balance += win ? n : -n; write(data); text = win ? `You won ${n}.` : `You lost ${n}.`; } }
	else if (command === "level") text = `Level: ${Math.floor(account.xp / 100) + 1}\nXP: ${account.xp}`;
	else if (command === "ecoinfo") text = "Economy uses virtual coins only. Daily, work, games and jobs provide rewards.";
	else if (command === "shop") text = Object.entries(data.shop).map(([name, price]) => `${name}: ${price}`).join("\n");
	else if (command === "buy") { const item = args[0]; if (!data.shop[item]) text = "Unknown shop item."; else if (account.balance < data.shop[item]) text = "Insufficient funds."; else { account.balance -= data.shop[item]; account.inventory[item] = (account.inventory[item] || 0) + 1; write(data); text = "Purchase complete."; } }
	else if (["inv", "inventory"].includes(command)) text = JSON.stringify(account.inventory);
	else if (command === "lb" || command === "leaderboard") text = Object.entries(data.users).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10).map((entry, index) => `${index + 1}. ${entry[1].balance} coins`).join("\n") || "No rankings yet.";
	else if (command === "bail") text = "Bail is unavailable without an active crime state.";
	if (typeof text !== "string") text = "Economy command completed.";
	await sock.sendMessage(jid, { text });
	return true;
}

module.exports = { commandNames, handleCommand };
