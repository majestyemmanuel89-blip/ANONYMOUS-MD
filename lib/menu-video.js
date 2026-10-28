const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const videosPath = process.env.ANONYMOUS_MD_VIDEOS_PATH ||
    path.join(__dirname, "../videos");
const settingsPath = process.env.ANONYMOUS_MD_SETTINGS_PATH ||
    path.join(__dirname, "../data/settings.json");
const maximumVideoBytes = 64 * 1024 * 1024;
const defaults = {
    menuVideoEnabled: true,
    menuVideoFile: "menu.mp4"
};

function readSettings() {
    try {
        const content = fs.readFileSync(settingsPath, "utf8");
        const settings = JSON.parse(content);
        return { ...defaults, ...settings };
    } catch {
        return { ...defaults };
    }
}

function getMenuVideoSettings() {
    const settings = readSettings();
    return {
        enabled: settings.menuVideoEnabled !== false,
        filename: isSafeVideoFilename(settings.menuVideoFile)
            ? settings.menuVideoFile
            : defaults.menuVideoFile
    };
}

function saveMenuVideoSettings(changes) {
    const settings = readSettings();
    const next = { ...settings, ...changes };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const temporaryPath = `${settingsPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 4), {
            encoding: "utf8",
            mode: 0o600
        });
        fs.renameSync(temporaryPath, settingsPath);
    } catch (error) {
        try {
            fs.rmSync(temporaryPath, { force: true });
        } catch {
            // Preserve the original settings write error.
        }
        throw error;
    }
    return next;
}

function isSafeVideoFilename(filename) {
    return typeof filename === "string" &&
        filename.length <= 120 &&
        path.basename(filename) === filename &&
        /^[A-Za-z0-9][A-Za-z0-9 @._-]*\.mp4$/i.test(filename);
}

function resolveVideo(filename) {
    if (!isSafeVideoFilename(filename)) return null;

    try {
        const videosRoot = fs.realpathSync(videosPath);
        const videoPath = fs.realpathSync(path.join(videosRoot, filename));
        const relativePath = path.relative(videosRoot, videoPath);
        if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
            return null;
        }
        const stat = fs.statSync(videoPath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > maximumVideoBytes) return null;
        return { path: videoPath, size: stat.size };
    } catch {
        return null;
    }
}

function listMenuVideos() {
    try {
        return fs.readdirSync(videosPath, { withFileTypes: true })
            .filter(entry => entry.isFile() && isSafeVideoFilename(entry.name))
            .map(entry => entry.name)
            .filter(filename => resolveVideo(filename))
            .sort((left, right) => left.localeCompare(right));
    } catch {
        return [];
    }
}

function loadSelectedVideo() {
    const settings = getMenuVideoSettings();
    if (!settings.enabled) return null;
    return loadVideo(settings.filename);
}

function loadVideo(filename) {
    const resolved = resolveVideo(filename);
    if (!resolved) return null;

    try {
        return {
            filename,
            buffer: fs.readFileSync(resolved.path)
        };
    } catch {
        return null;
    }
}

function saveUploadedVideo(filename, buffer) {
    if (!isSafeVideoFilename(filename)) {
        throw new Error("Use a valid .mp4 filename without a path.");
    }
    if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > maximumVideoBytes) {
        throw new Error("The video must be a non-empty MP4 smaller than 64 MB.");
    }
    if (buffer.toString("ascii", 4, 8) !== "ftyp") {
        throw new Error("The uploaded file does not have a valid MP4 signature.");
    }

    fs.mkdirSync(videosPath, { recursive: true, mode: 0o700 });
    const filePath = path.join(videosPath, filename);
    fs.writeFileSync(filePath, buffer, { flag: "wx", mode: 0o600 });
    return { filename, size: buffer.length };
}

module.exports = {
    getMenuVideoSettings,
    isSafeVideoFilename,
    listMenuVideos,
    loadVideo,
    loadSelectedVideo,
    resolveVideo,
    saveUploadedVideo,
    saveMenuVideoSettings
};