const fs = require("fs");
const path = require("path");

const settingsPath = process.env.ANONYMOUS_MD_SETTINGS_PATH ||
    path.join(__dirname, "../data/settings.json");

const { getIdentityNumbers, getNumber, isOwner } = require("./auth");

const sudoPath = path.join(
    __dirname,
    "../data/sudo.json"
);

function readJson(filePath, fallback) {
    try {
        const content = fs.readFileSync(filePath, "utf8").trim();
        return content ? JSON.parse(content) : fallback;
    } catch {
        return fallback;
    }
}

function getSettings() {
    return readJson(settingsPath, {
        botName: "ANONYMOUS MD",
        prefix: ".",
        owner: "Anonymous",
        sudo: []
    });
}

function saveSettings(settings) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
        settingsPath,
        JSON.stringify(settings, null, 4)
    );
}

function isSudo(jid, context = {}) {
    const numbers = getIdentityNumbers(jid, context);
    if (!numbers.length) return false;

    const settings = getSettings();
    const settingsSudo = Array.isArray(settings.sudo)
        ? settings.sudo
        : [];
    const sudoData = readJson(sudoPath, { sudo: [] });
    const fileSudo = Array.isArray(sudoData)
        ? sudoData
        : sudoData && Array.isArray(sudoData.sudo)
            ? sudoData.sudo
            : [];

    const sudoNumbers = [...settingsSudo, ...fileSudo]
        .map(getNumber)
        .filter(Boolean);
    return numbers.some(number => sudoNumbers.includes(number));
}

function isOwnerOrSudo(jid) {
    return isOwner(jid) || isSudo(jid);
}

module.exports = {
    getSettings,
    saveSettings,
    getNumber,
    isOwner,
    isSudo,
    isOwnerOrSudo
};