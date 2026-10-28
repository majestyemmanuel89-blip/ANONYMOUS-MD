const assert = require("node:assert/strict");
const { test } = require("node:test");

const { calculate, handleCommand } = require("../commands/utility");

test("calculator respects precedence, parentheses, and unary operators", () => {
	assert.equal(calculate("2 + 3 * 4"), 14);
	assert.equal(calculate("(2 + 3) * 4"), 20);
	assert.equal(calculate("-2 + +3"), 1);
	assert.equal(calculate("10 % 4"), 2);
});

test("calculator rejects invalid, incomplete, and unsafe expressions", () => {
	for (const expression of [
		"",
		"1 +",
		"(1 + 2",
		"1 + 2)",
		"2 ** 3",
		"1 / 0",
		"1 % 0",
		"1; process.exit()",
		"9".repeat(201)
	]) {
		assert.equal(calculate(expression), null, `expected rejection: ${expression}`);
	}
});

test("calculator command sends a result or clear usage error", async () => {
	const replies = [];
	const sock = {
		sendMessage: async (jid, payload) => replies.push({ jid, payload })
	};

	await handleCommand({
		command: "calc",
		args: ["(12", "+", "8)", "/", "4"],
		jid: "test@s.whatsapp.net",
		sock,
		prefix: "!"
	});
	await handleCommand({
		command: "calculator",
		args: ["1", "/", "0"],
		jid: "test@s.whatsapp.net",
		sock,
		prefix: "!"
	});

	assert.equal(replies[0].payload.text, "5");
	assert.match(replies[1].payload.text, /Use !calc/);
});
