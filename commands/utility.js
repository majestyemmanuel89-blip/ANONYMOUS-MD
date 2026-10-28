const crypto = require("crypto");

const commandNames = ["say", "calc", "calculator", "morse", "morsecode", "passcheck", "passwordcheck", "qrcode", "readmore"];
const morse = { a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--.." };

function calculate(expression) {
	if (typeof expression !== "string" || !expression.trim() || expression.length > 200) return null;
	const source = expression.trim();

	const tokens = [];
	const tokenPattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([()+\-*/%]))/gy;
	let position = 0;
	while (position < source.length) {
		tokenPattern.lastIndex = position;
		const match = tokenPattern.exec(source);
		if (!match) return null;
		tokens.push(match[1] || match[2]);
		position = tokenPattern.lastIndex;
		if (tokens.length > 100) return null;
	}

	let cursor = 0;
	function parsePrimary() {
		const token = tokens[cursor];
		if (token === "(") {
			cursor += 1;
			const value = parseExpression();
			if (value === null || tokens[cursor] !== ")") return null;
			cursor += 1;
			return value;
		}

		if (token === undefined || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return null;
		cursor += 1;
		const value = Number(token);
		return Number.isFinite(value) ? value : null;
	}

	function parseUnary() {
		const operator = tokens[cursor];
		if (operator === "+" || operator === "-") {
			cursor += 1;
			const value = parseUnary();
			if (value === null) return null;
			return operator === "-" ? -value : value;
		}
		return parsePrimary();
	}

	function parseTerm() {
		let value = parseUnary();
		if (value === null) return null;

		while (["*", "/", "%"].includes(tokens[cursor])) {
			const operator = tokens[cursor++];
			const right = parseUnary();
			if (right === null || ((operator === "/" || operator === "%") && right === 0)) return null;
			value = operator === "*"
				? value * right
				: operator === "/"
					? value / right
					: value % right;
			if (!Number.isFinite(value)) return null;
		}

		return value;
	}

	function parseExpression() {
		let value = parseTerm();
		if (value === null) return null;

		while (tokens[cursor] === "+" || tokens[cursor] === "-") {
			const operator = tokens[cursor++];
			const right = parseTerm();
			if (right === null) return null;
			value = operator === "+" ? value + right : value - right;
			if (!Number.isFinite(value)) return null;
		}

		return value;
	}

	const result = parseExpression();
	return result !== null && cursor === tokens.length ? result : null;
}

async function handleCommand({ command, args, jid, sock, prefix = "." }) {
	if (!commandNames.includes(command)) return false;
	const input = args.join(" ");
	if (command === "say") await sock.sendMessage(jid, { text: input || "Usage: .say <text>" });
	else if (command === "calc" || command === "calculator") {
		const result = calculate(input);
		await sock.sendMessage(jid, {
			text: result === null
				? `Invalid calculation. Use ${prefix}calc <expression>.`
				: String(result)
		});
	}
	else if (command === "morse" || command === "morsecode") await sock.sendMessage(jid, { text: input.toLowerCase().split(" ").map(word => [...word].map(char => morse[char] || char).join(" ")).join(" / ") });
	else if (command === "passcheck" || command === "passwordcheck") await sock.sendMessage(jid, { text: `Password strength: ${input.length >= 12 && /[A-Z]/.test(input) && /\d/.test(input) ? "strong" : input.length >= 8 ? "moderate" : "weak"}` });
	else if (command === "qrcode") await sock.sendMessage(jid, { text: "QR generation requires an installed QR image library; use the existing web portal for QR display." });
	else if (command === "readmore") await sock.sendMessage(jid, { text: input ? `${input}\n\n...` : "Usage: .readmore <text>" });
	return true;
}

module.exports = {
	commandNames,
	metadata: {
		category: "Utilities",
		description: "General-purpose tools."
	},
	commandMetadata: {
		calc: {
			description: "Safely evaluate arithmetic with parentheses and standard operators.",
			usage: "calc <expression>",
			example: "calc (12 + 8) / 4"
		},
		calculator: {
			description: "Alias for the safe arithmetic calculator.",
			usage: "calculator <expression>",
			example: "calculator 12 * 4"
		}
	},
	calculate,
	handleCommand
};
