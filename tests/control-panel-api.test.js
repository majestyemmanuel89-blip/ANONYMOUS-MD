const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anonymous-md-panel-api-"));
const settingsPath = path.join(temporaryDirectory, "settings.json");
process.env.ANONYMOUS_MD_SETTINGS_PATH = settingsPath;
process.env.ANONYMOUS_MD_VIDEOS_PATH = path.join(temporaryDirectory, "videos");
process.env.PANEL_ADMIN_PASSWORD = "test-admin-password-123";
process.env.PANEL_SESSION_SECRET = "test-session-secret-0123456789-abcdefgh";
fs.writeFileSync(settingsPath, JSON.stringify({
    botName: "ANONYMOUS MD",
    prefix: ".",
    mode: "public",
    apiKey: "never-return-this-test-value"
}));

const { createPanelRouter } = require("../lib/control-panel-api");
const { getCommandGroups } = require("../commands/core");
const { canExecuteCommand, commandModules } = require("../lib/command-handler");

after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    delete process.env.PANEL_ADMIN_PASSWORD;
    delete process.env.PANEL_SESSION_SECRET;
});

function createManager() {
    const records = new Map([
        ["account-1", {
            id: "account-1",
            type: "primary",
            number: "2348012345678",
            status: "connected",
            lastConnectedAt: "2026-10-27T10:00:00.000Z",
            sock: { authState: { creds: { privateKey: "never-return-this" } } }
        }]
    ]);
    let connectionOptions;
    return {
        records,
        get connectionOptions() { return connectionOptions; },
        getPrimaryId: () => "account-1",
        list: () => [...records.values()].map(({ sock, ...session }) => session),
        get: id => records.get(id) || null,
        connect: async options => {
            connectionOptions = options;
            const id = "secondary-1";
            records.set(id, {
                id,
                type: "secondary",
                number: options.number,
                status: "connecting",
                lastConnectedAt: null
            });
            options.onPairingCode("REAL-CODE-FROM-CONNECTOR");
            return id;
        },
        reconnect: async () => {},
        disconnect: async () => {},
        logout: async () => {},
        deleteSession: async id => records.delete(id),
        clearAllSessions: async () => {
            const clearedSessionIds = [...records.keys()];
            records.clear();
            return { clearedSessionIds, primarySessionId: "account-1" };
        },
        markConnected: () => {}
    };
}

async function createServer() {
    const sessionManager = createManager();
    const app = require("express")();
    app.use("/api", createPanelRouter({
        sessionManager,
        commandModules,
        getCommandGroups,
        canExecuteCommand,
        runtime: () => "0d 0h 0m 7s",
        startedAt: Date.now()
    }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    return { server, baseUrl, sessionManager };
}

async function login(baseUrl) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: process.env.PANEL_ADMIN_PASSWORD })
    });
    const data = await response.json();
    const cookie = response.headers.get("set-cookie").split(";")[0];
    return { response, data, cookie };
}

async function closeServer(server) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("admin API requires configured credentials and returns a protected session", async () => {
    const { server, baseUrl } = await createServer();
    try {
        const { response, data, cookie } = await login(baseUrl);
        assert.equal(response.status, 200);
        assert.equal(data.authenticated, true);
        assert.ok(data.csrfToken);
        assert.match(cookie, /^anonymous_md_admin=/);

        const overview = await fetch(`${baseUrl}/api/admin/overview`, { headers: { Cookie: cookie } });
        const stats = await overview.json();
        assert.equal(overview.status, 200);
        assert.equal(stats.totalSessions, 1);
        assert.equal(stats.onlineNow, 1);
        assert.equal(stats.uptime, "0d 0h 0m 7s");
        assert.equal(JSON.stringify(stats).includes("never-return-this"), false);
    } finally {
        await closeServer(server);
    }
});

test("admin login stays unavailable when secrets are missing or too short", async () => {
    const savedPassword = process.env.PANEL_ADMIN_PASSWORD;
    const savedSecret = process.env.PANEL_SESSION_SECRET;
    delete process.env.PANEL_ADMIN_PASSWORD;
    process.env.PANEL_SESSION_SECRET = "too-short";
    const { server, baseUrl } = await createServer();
    try {
        const status = await fetch(`${baseUrl}/api/auth/session`);
        assert.deepEqual(await status.json(), {
            configured: false,
            authenticated: false,
            csrfToken: null
        });
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: "anything" })
        });
        assert.equal(response.status, 503);
        assert.match((await response.json()).error, /PANEL_ADMIN_PASSWORD/);
    } finally {
        process.env.PANEL_ADMIN_PASSWORD = savedPassword;
        process.env.PANEL_SESSION_SECRET = savedSecret;
        await closeServer(server);
    }
});

test("admin password accepts ten characters and rejects fewer", async () => {
    const savedPassword = process.env.PANEL_ADMIN_PASSWORD;
    try {
        process.env.PANEL_ADMIN_PASSWORD = "1234567890";
        const { server, baseUrl } = await createServer();
        try {
            const response = await fetch(`${baseUrl}/api/auth/session`);
            assert.equal((await response.json()).configured, true);
        } finally {
            await closeServer(server);
        }

        process.env.PANEL_ADMIN_PASSWORD = "123456789";
        const { server: shortPasswordServer, baseUrl: shortPasswordBaseUrl } = await createServer();
        try {
            const response = await fetch(`${shortPasswordBaseUrl}/api/auth/session`);
            assert.equal((await response.json()).configured, false);
        } finally {
            await closeServer(shortPasswordServer);
        }
    } finally {
        process.env.PANEL_ADMIN_PASSWORD = savedPassword;
    }
});

test("pairing endpoint uses the real connection callback and requires CSRF protection", async () => {
    const { server, baseUrl, sessionManager } = await createServer();
    try {
        const { data, cookie } = await login(baseUrl);
        const denied = await fetch(`${baseUrl}/api/admin/sessions/pair`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ number: "2348098765432" })
        });
        assert.equal(denied.status, 403);

        const duplicate = await fetch(`${baseUrl}/api/admin/sessions/pair`, {
            method: "POST",
            headers: {
                Cookie: cookie,
                "Content-Type": "application/json",
                "X-CSRF-Token": data.csrfToken
            },
            body: JSON.stringify({ number: "2348012345678" })
        });
        assert.equal(duplicate.status, 409);
        assert.equal(sessionManager.connectionOptions, undefined);

        const response = await fetch(`${baseUrl}/api/admin/sessions/pair`, {
            method: "POST",
            headers: {
                Cookie: cookie,
                "Content-Type": "application/json",
                "X-CSRF-Token": data.csrfToken
            },
            body: JSON.stringify({ number: "+234 809 876 5432" })
        });
        const result = await response.json();
        assert.equal(response.status, 201);
        assert.equal(result.sessionId, "secondary-1");
        assert.equal(result.pairingCode, "REAL-CODE-FROM-CONNECTOR");
        assert.equal(sessionManager.connectionOptions.number, "2348098765432");
        assert.equal(sessionManager.connectionOptions.method, "code");
    } finally {
        await closeServer(server);
    }
});

test("session responses mask phone numbers and never serialize credentials", async () => {
    const { server, baseUrl } = await createServer();
    try {
        const { cookie } = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/admin/sessions`, { headers: { Cookie: cookie } });
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(body, /234\*{3,}\d{2}/);
        assert.doesNotMatch(body, /2348012345678/);
        assert.doesNotMatch(body, /never-return-this/);
    } finally {
        await closeServer(server);
    }
});

test("clearing all sessions requires CSRF and explicit confirmation", async () => {
    const { server, baseUrl, sessionManager } = await createServer();
    try {
        const { data, cookie } = await login(baseUrl);
        const denied = await fetch(`${baseUrl}/api/admin/sessions/clear`, {
            method: "POST",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: true })
        });
        assert.equal(denied.status, 403);

        const unconfirmed = await fetch(`${baseUrl}/api/admin/sessions/clear`, {
            method: "POST",
            headers: {
                Cookie: cookie,
                "Content-Type": "application/json",
                "X-CSRF-Token": data.csrfToken
            },
            body: JSON.stringify({ confirm: false })
        });
        assert.equal(unconfirmed.status, 400);

        const response = await fetch(`${baseUrl}/api/admin/sessions/clear`, {
            method: "POST",
            headers: {
                Cookie: cookie,
                "Content-Type": "application/json",
                "X-CSRF-Token": data.csrfToken
            },
            body: JSON.stringify({ confirm: true })
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            success: true,
            clearedSessions: 1,
            primarySessionId: "account-1"
        });
        assert.equal(sessionManager.records.size, 0);
    } finally {
        await closeServer(server);
    }
});

test("settings endpoint returns only the editable allowlist", async () => {
    const { server, baseUrl } = await createServer();
    try {
        const { data, cookie } = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/admin/settings`, {
            method: "PATCH",
            headers: {
                Cookie: cookie,
                "Content-Type": "application/json",
                "X-CSRF-Token": data.csrfToken
            },
            body: JSON.stringify({ prefix: "!", mode: "private" })
        });
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(body, /"prefix":"!"/);
        assert.match(body, /"mode":"private"/);
        assert.doesNotMatch(body, /never-return-this-test-value/);
    } finally {
        await closeServer(server);
    }
});

test("destructive session operations require explicit confirmation", async () => {
    const { server, baseUrl } = await createServer();
    try {
        const { data, cookie } = await login(baseUrl);
        const response = await fetch(`${baseUrl}/api/admin/sessions/account-1/logout`, {
            method: "POST",
            headers: {
                Cookie: cookie,
                "Content-Type": "application/json",
                "X-CSRF-Token": data.csrfToken
            },
            body: JSON.stringify({ confirm: false })
        });

        test("menu-video upload is authenticated, signature checked, and streamed from the library", async () => {
            const { server, baseUrl } = await createServer();
            try {
                const { data, cookie } = await login(baseUrl);
                const video = Buffer.alloc(24);
                video.write("ftyp", 4, "ascii");
                const headers = {
                    Cookie: cookie,
                    "Content-Type": "video/mp4",
                    "X-CSRF-Token": data.csrfToken
                };
                const upload = await fetch(`${baseUrl}/api/admin/menu-videos?filename=panel-test.mp4`, {
                    method: "POST",
                    headers,
                    body: video
                });
                assert.equal(upload.status, 201);
                assert.deepEqual((await upload.json()).video, { filename: "panel-test.mp4", size: 24 });

                const listing = await fetch(`${baseUrl}/api/admin/menu-videos`, { headers: { Cookie: cookie } });
                assert.ok((await listing.json()).videos.some(item => item.filename === "panel-test.mp4"));

                const stream = await fetch(`${baseUrl}/api/admin/menu-videos/panel-test.mp4`, { headers: { Cookie: cookie } });
                assert.equal(stream.status, 200);
                assert.equal((await stream.arrayBuffer()).byteLength, 24);

                const invalid = await fetch(`${baseUrl}/api/admin/menu-videos?filename=invalid.mp4`, {
                    method: "POST",
                    headers,
                    body: Buffer.from("not an mp4")
                });
                assert.equal(invalid.status, 400);
            } finally {
                await closeServer(server);
            }
        });
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /confirmation/i);
    } finally {
        await closeServer(server);
    }
});
