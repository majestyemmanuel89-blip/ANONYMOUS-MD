const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const registryPath = process.env.ANONYMOUS_MD_NUMBER_REGISTRY ||
    path.join(__dirname, "../data/registered-numbers.json");
const confirmationLifetimeMs = 5 * 60 * 1000;
const pendingConfirmations = new Map();

function normalizeNumber(value) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const raw = String(value).trim();
    if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;
    const number = raw.replace(/\D/g, "");
    return number.length >= 7 && number.length <= 15 ? number : null;
}

function maskNumber(value) {
    const number = normalizeNumber(String(value));
    if (!number) return "unavailable";
    return `+${number.slice(0, 2)}***${number.slice(-2)}`;
}

function readNumbers() {
    try {
        const content = fs.readFileSync(registryPath, "utf8");
        const data = JSON.parse(content);
        if (!Array.isArray(data.numbers)) {
            throw new Error("Registered number data must contain a numbers array.");
        }
        const numbers = data.numbers.map(normalizeNumber);
        if (numbers.some(number => !number)) {
            throw new Error("Registered number data contains an invalid phone number.");
        }
        return [...new Set(numbers)];
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
}

function saveNumbers(numbers) {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    const temporaryPath = `${registryPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify({ numbers }, null, 4), {
            encoding: "utf8",
            mode: 0o600
        });
        fs.renameSync(temporaryPath, registryPath);
    } catch (error) {
        try {
            fs.rmSync(temporaryPath, { force: true });
        } catch (cleanupError) {
            console.error("[NUMBER REGISTRY] Temporary-file cleanup failed.", cleanupError);
        }
        throw error;
    }
}

function addNumber(value) {
    const number = normalizeNumber(value);
    if (!number) return { ok: false, reason: "invalid" };
    const numbers = readNumbers();
    if (numbers.includes(number)) return { ok: false, reason: "duplicate" };
    numbers.push(number);
    saveNumbers(numbers);
    return { ok: true, number };
}

function findNumber(value) {
    const number = normalizeNumber(value);
    if (!number) return null;
    return readNumbers().includes(number) ? number : null;
}

function createConfirmation(senderJid, action) {
    const code = crypto.randomInt(100000, 1000000).toString();
    pendingConfirmations.set(senderJid, {
        code,
        action,
        expiresAt: Date.now() + confirmationLifetimeMs
    });
    return code;
}

function cancelConfirmation(senderJid) {
    return pendingConfirmations.delete(senderJid);
}

async function confirmAction(senderJid, code) {
    const pending = pendingConfirmations.get(senderJid);
    if (!pending) return { ok: false, reason: "missing" };
    if (pending.expiresAt < Date.now()) {
        pendingConfirmations.delete(senderJid);
        return { ok: false, reason: "expired" };
    }
    if (pending.code !== code) return { ok: false, reason: "incorrect" };
    pendingConfirmations.delete(senderJid);

    try {
        const result = await pending.action();
        return { ok: true, result };
    } catch (error) {
        return { ok: false, reason: "failed", error };
    }
}

function removeNumber(value) {
    const number = normalizeNumber(value);
    if (!number) return { ok: false, reason: "invalid" };
    const numbers = readNumbers();
    if (!numbers.includes(number)) return { ok: false, reason: "not-found" };
    saveNumbers(numbers.filter(item => item !== number));
    return { ok: true, number };
}

function correctNumber(oldValue, newValue) {
    const oldNumber = normalizeNumber(oldValue);
    const newNumber = normalizeNumber(newValue);
    if (!oldNumber || !newNumber) return { ok: false, reason: "invalid" };
    const numbers = readNumbers();
    if (!numbers.includes(oldNumber)) return { ok: false, reason: "not-found" };
    if (oldNumber !== newNumber && numbers.includes(newNumber)) {
        return { ok: false, reason: "duplicate" };
    }
    saveNumbers(numbers.map(number => number === oldNumber ? newNumber : number));
    return { ok: true, oldNumber, newNumber };
}

module.exports = {
    addNumber,
    cancelConfirmation,
    confirmAction,
    correctNumber,
    createConfirmation,
    findNumber,
    maskNumber,
    normalizeNumber,
    readNumbers,
    removeNumber
};
