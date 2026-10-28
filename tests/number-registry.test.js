const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anonymous-md-numbers-"));
process.env.ANONYMOUS_MD_NUMBER_REGISTRY = path.join(temporaryDirectory, "numbers.json");

const registry = require("../lib/number-registry");

after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("number normalization validates country-code digit strings and masks output", () => {
    assert.equal(registry.normalizeNumber("+1 (234) 567-8901"), "12345678901");
    assert.equal(registry.normalizeNumber("123456"), null);
    assert.equal(registry.normalizeNumber("1234567abc"), null);
    assert.equal(registry.maskNumber("12345678901"), "+12***01");
});

test("registered numbers reject duplicates and require the matching confirmation", async () => {
    assert.deepEqual(registry.addNumber("+1 234 567 8901"), {
        ok: true,
        number: "12345678901"
    });
    assert.equal(registry.addNumber("12345678901").reason, "duplicate");

    const owner = "owner@s.whatsapp.net";
    let removed = false;
    const code = registry.createConfirmation(owner, () => {
        removed = true;
        return registry.removeNumber("12345678901");
    });

    assert.equal((await registry.confirmAction(owner, "000000")).reason, "incorrect");
    assert.equal(removed, false);
    const confirmed = await registry.confirmAction(owner, code);
    assert.equal(confirmed.ok, true);
    assert.equal(removed, true);
    assert.deepEqual(registry.readNumbers(), []);
});

test("number correction rejects duplicate targets and updates only the registry", () => {
    registry.addNumber("12345678901");
    registry.addNumber("12345678902");
    assert.equal(registry.correctNumber("12345678901", "12345678902").reason, "duplicate");
    assert.deepEqual(registry.correctNumber("12345678901", "12345678903"), {
        ok: true,
        oldNumber: "12345678901",
        newNumber: "12345678903"
    });
    assert.deepEqual(registry.readNumbers(), ["12345678903", "12345678902"]);
});
