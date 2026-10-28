const games = new Map();
const commandNames = ["truth", "dare", "wyr", "wouldyou", "ship", "riddle", "pickupline", "rizz", "joke", "dadjoke", "fact", "quote", "8ball", "fortune", "numbergame", "battle"];
const truths = ["What is one goal you have not told anyone?", "What was your last embarrassing mistake?", "What habit would you like to change?"];
const dares = ["Send a kind message to someone.", "Change your status for one minute.", "Do ten jumping jacks."];
const jokes = ["Why did the developer go broke? Because they used up all their cache.", "A bug walked into a bar and checked out because the bartender said they had no exceptions."];
const quotes = ["Small steps still move you forward.", "Clarity is a feature.", "Consistency beats intensity."];

function pick(values) { return values[Math.floor(Math.random() * values.length)]; }

async function handleCommand({ command, args, jid, sock }) {
	if (!commandNames.includes(command)) return false;
	let text;
	if (command === "truth") text = pick(truths);
	else if (command === "dare") text = pick(dares);
	else if (command === "wyr" || command === "wouldyou") text = "Would you rather always be ten minutes late or always be twenty minutes early?";
	else if (command === "riddle") text = "I have keys but open no locks. I have space but no room. What am I?";
	else if (command === "pickupline" || command === "rizz") text = "Are you a keyboard? You are just my type.";
	else if (command === "joke" || command === "dadjoke") text = pick(jokes);
	else if (command === "fact") text = "Octopuses have three hearts.";
	else if (command === "quote") text = pick(quotes);
	else if (command === "8ball") text = pick(["Yes.", "No.", "Ask again later.", "The signs look promising."]);
	else if (command === "fortune") text = "A useful opportunity will appear when you keep paying attention.";
	else if (command === "ship") text = `Compatibility: ${Math.floor(Math.random() * 101)}%`;
	else if (command === "numbergame") {
		const current = games.get(jid);
		const guess = Number(args[0]);
		if (!current) { games.set(jid, { answer: Math.floor(Math.random() * 10) + 1 }); text = "I picked a number from 1 to 10. Guess with .numbergame <number>."; }
		else if (!Number.isInteger(guess)) text = "Guess a whole number from 1 to 10.";
		else if (guess === current.answer) { games.delete(jid); text = "Correct. New game available anytime."; }
		else text = guess < current.answer ? "Higher." : "Lower.";
	} else if (command === "battle") text = `Battle power: ${Math.floor(Math.random() * 100) + 1}/100`;
	await sock.sendMessage(jid, { text });
	return true;
}

module.exports = { commandNames, handleCommand };
