// Tests for Config/Scripts/update-vault.mjs (OBS-201), which installs the system's files from a
// clone's `main` into a vault. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// Each test runs the script on a throwaway clone (a git repository with invented files) and a
// throwaway vault, the way the close-out runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installs, plan, recordAfter } from "../update-vault.mjs";

const SCRIPT = fileURLToPath(new URL("../update-vault.mjs", import.meta.url));
const RECORD = "Config/Scripts/update-manifest.json";
const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
const map = (o) => new Map(Object.entries(o));

const write = (root, rel, text) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

// Every file in a folder, with its text, but git's own
function snapshot(root) {
    const out = {};
    const walk = (dir) => {
        for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
            const rel = dir ? `${dir}/${e.name}` : e.name;
            if (e.name === ".git") continue;
            if (e.isDirectory()) walk(rel);
            else out[rel] = read(root, rel);
        }
    };
    walk("");
    return out;
}

// What the repository has: the system, the four files the command also installed, notes, a class
// file, tests and the two scripts for working on it. All invented.
const REPO = {
    "manifest.json": '{"id":"plainday","name":"Plainday"}\n',
    "README.md": "readme v2\n",
    "CLAUDE.md": "claude v2\n",
    "Config/Manual.md": "manual v2\n",
    "Config/Templates/Task.md": "task template v2\n",
    "Config/Templates/Log.md": "log template v2\n",
    "Config/Templates/Area.md": "area template, new\n",
    "Config/Scripts/Templater/folderLook.js": "folder look v1\n",
    "Config/Scripts/tests/timeReport.test.mjs": "a test\n",
    "Config/Scripts/dev-vault.sh": "dev vault\n",
    "Config/Scripts/update-vault.mjs": "this script\n",
    "Projects/Projects.base": "projects base v2\n",
    "Reference/Invoices/Invoices.base": "invoices base v2\n",
    ".obsidian/daily-notes.json": '{"folder":"v2"}\n',
    ".obsidian/plugins/templater-obsidian/data.json": '{"templates_folder":"v2"}\n',
    "Welcome.md": "a demo note\n",
    "plugin/src/commands/timeReport.js": "export default class TimeReport {}\n",
};
// The four the command installed and the script leaves alone
const FOUR = ["Projects/Projects.base", "Reference/Invoices/Invoices.base", ".obsidian/daily-notes.json", ".obsidian/plugins/templater-obsidian/data.json"];

function tmp(t, name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `update-vault-${name}-`));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

// A clone whose main, and origin/main, hold `files`
function clone(t, files = REPO) {
    const dir = tmp(t, "clone");
    for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" }).toString().trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("add", "-A");
    git("commit", "-qm", "system");
    git("update-ref", "refs/remotes/origin/main", "main");
    return { dir, git };
}

function vault(t, files = {}, record = null) {
    const dir = tmp(t, "vault");
    write(dir, ".obsidian/app.json", "{}\n");
    for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
    if (record) write(dir, RECORD, JSON.stringify({ source: "/elsewhere", commit: "0000000", updated: "2026-01-01 00:00", files: record }, null, 2) + "\n");
    return dir;
}

function run(cloneDir, vaultDir, ...args) {
    const r = spawnSync(process.execPath, [SCRIPT, "--clone", cloneDir, "--vault", vaultDir, ...args], { encoding: "utf8" });
    return { status: r.status, out: r.stdout, err: r.stderr };
}

const record = (dir) => JSON.parse(read(dir, RECORD));

test("installs: Config, the README and CLAUDE.md, but the tests and the two scripts for working on it", () => {
    for (const p of ["Config/Manual.md", "Config/Templates/Task.md", "Config/Scripts/Templater/folderLook.js", "Config/Bases/Sidebar/Logs.base", "README.md", "CLAUDE.md"]) {
        assert.equal(installs(p), true, p);
    }
    for (const p of ["Config/Scripts/tests/timeReport.test.mjs", "Config/Scripts/dev-vault.sh", "Config/Scripts/update-vault.mjs", ...FOUR,
        "Welcome.md", "manifest.json", "plugin/src/commands/timeReport.js", ".obsidian/app.json", "CLAUDE.local.md"]) {
        assert.equal(installs(p), false, p);
    }
});

test("plan: new, old, yours and the same; a dropped file only when main doesn't have it", () => {
    const source = map({ "Config/a.md": "a2", "Config/b.md": "b2", "Config/c.md": "c2", "Config/d.md": "d" });
    const vaultFiles = map({ "Config/b.md": "b1", "Config/c.md": "mine", "Config/d.md": "d", "Config/gone.md": "g", "Projects/Projects.base": "p1" });
    const installed = map({ "Config/b.md": "b1", "Config/c.md": "c1", "Config/d.md": "d", "Config/gone.md": "g", "Projects/Projects.base": "p1" });
    const onMain = new Set([...source.keys(), "Projects/Projects.base"]);
    assert.deepEqual(plan(source, vaultFiles, installed, onMain),
        { add: ["Config/a.md"], update: ["Config/b.md"], yours: ["Config/c.md"], same: ["Config/d.md"], dropped: ["Config/gone.md"] });
});

test("recordAfter: what's installed now; a file of yours keeps its old record, and what main doesn't install leaves", () => {
    const source = map({ "Config/a.md": "a2", "Config/c.md": "c2" });
    const after = recordAfter(source, map({ "Config/c.md": "c1", "Config/gone.md": "g", "Projects/Projects.base": "p1" }), ["Config/a.md"], []);
    assert.deepEqual(Object.fromEntries(after), { "Config/a.md": "a2", "Config/c.md": "c1" });
});

// Test plan step 2
test("a run with a record adds, updates, leaves yours and the dropped as they are, and never touches the four", (t) => {
    const c = clone(t);
    const old = {
        "Config/Templates/Task.md": "task template v1\n",      // as installed: updated
        "Config/Templates/Log.md": "my own log template\n",     // changed in the vault: yours
        "Config/Manual.md": "manual v2\n",                      // already the same
        "Config/Templates/Dropped.md": "dropped template\n",   // the repository dropped it
        "Projects/Projects.base": "projects base, my sort\n",
        "Reference/Invoices/Invoices.base": "invoices base v1\n",
        ".obsidian/daily-notes.json": '{"folder":"mine"}\n',
        ".obsidian/plugins/templater-obsidian/data.json": '{"templates_folder":"v1"}\n',
        "Work/Invoices/Invoices.base": "invoices base v1, where the command placed it\n",
        "Config/Bases/Invoices.base": "invoices base v1, where the command kept it with no invoice folder\n",
        "A real note.md": "mine\n",
    };
    const v = vault(t, old, {
        "Config/Templates/Task.md": sha1("task template v1\n"),
        "Config/Templates/Log.md": sha1("log template v1\n"),
        "Config/Manual.md": sha1("manual v1\n"),
        "Config/Templates/Dropped.md": sha1("dropped template\n"),
        "Projects/Projects.base": sha1("projects base v1\n"),
        "Reference/Invoices/Invoices.base": sha1("invoices base v1\n"),
        "Work/Invoices/Invoices.base": sha1("invoices base v1, where the command placed it\n"),
        "Config/Bases/Invoices.base": sha1("invoices base v1, where the command kept it with no invoice folder\n"),
        ".obsidian/daily-notes.json": sha1('{"folder":"v1"}\n'),
        ".obsidian/plugins/templater-obsidian/data.json": sha1('{"templates_folder":"v1"}\n'),
    });
    const r = run(c.dir, v, "--dry-run");
    assert.equal(r.status, 0, r.err);
    const before = snapshot(v);
    assert.match(r.out, /Dry run: nothing is written/);

    const real = run(c.dir, v);
    assert.equal(real.status, 0, real.err);
    assert.equal(real.out.replace(/^.*\n/, ""), r.out.replace(/^.*\n/, "").replace(/Would add/, "Added").replace(/Would update/, "Updated").replace(/Would copy/, "Copied"),
        "the dry run said what the run did");
    assert.equal(read(v, "Config/Templates/Area.md"), "area template, new\n", "a template the vault lacked is added");
    assert.equal(read(v, "Config/Templates/Task.md"), "task template v2\n", "an old version is updated");
    assert.equal(read(v, "README.md"), "readme v2\n");
    assert.equal(read(v, "Config/Scripts/Templater/folderLook.js"), "folder look v1\n");
    assert.equal(read(v, "Config/Templates/Log.md"), "my own log template\n", "yours is left as it is");
    assert.equal(read(v, "Config/Templates/Dropped.md"), "dropped template\n", "a dropped file stays");
    for (const p of [...FOUR, "Work/Invoices/Invoices.base", "Config/Bases/Invoices.base", "A real note.md"]) assert.equal(read(v, p), old[p], `${p} byte for byte as before`);
    for (const p of ["Welcome.md", "manifest.json", "Config/Scripts/dev-vault.sh", "Config/Scripts/update-vault.mjs", "Config/Scripts/tests/timeReport.test.mjs", "plugin/src/commands/timeReport.js"]) {
        assert.equal(exists(v, p), false, `${p} never installed`);
    }
    assert.deepEqual(fs.readdirSync(path.join(v, "Config/Templates")).filter((n) => n.startsWith(".")), [], "no temp file left");

    assert.match(real.out, /Yours, left as they are: 1 .*\n {2}Config\/Templates\/Log\.md\n/);
    assert.match(real.out, /Added: 4\n {2}CLAUDE\.md\n {2}Config\/Scripts\/Templater\/folderLook\.js\n {2}Config\/Templates\/Area\.md\n {2}README\.md\n/);
    assert.match(real.out, /Updated: 1\n {2}Config\/Templates\/Task\.md\n/);
    assert.match(real.out, /Dropped by the repository, left in the vault as yours: 1\n {2}Config\/Templates\/Dropped\.md\n/);
    for (const p of [...FOUR, "Work/Invoices/Invoices.base", "Config/Bases/Invoices.base"]) assert.equal(real.out.includes(p), false, `${p} isn't listed`);
    assert.match(real.out, /Copied 5 files; 1 already up to date\./);

    const rec = record(v);
    assert.deepEqual(Object.keys(rec), ["source", "commit", "updated", "files"]);
    assert.equal(rec.source, fs.realpathSync(c.dir));
    assert.equal(rec.commit, c.git("rev-parse", "--short", "main"));
    assert.deepEqual(rec.files, {
        "CLAUDE.md": sha1("claude v2\n"),
        "Config/Manual.md": sha1("manual v2\n"),
        "Config/Scripts/Templater/folderLook.js": sha1("folder look v1\n"),
        "Config/Templates/Area.md": sha1("area template, new\n"),
        // still what was installed, so it stays yours
        "Config/Templates/Log.md": sha1("log template v1\n"),
        "Config/Templates/Task.md": sha1("task template v2\n"),
        "README.md": sha1("readme v2\n"),
    });
    // the dry run wrote nothing
    assert.equal(before[RECORD].includes("0000000"), true);

    // Test plan step 3: a second run changes nothing, and says so
    const after = snapshot(v);
    const again = run(c.dir, v);
    assert.equal(again.status, 0, again.err);
    assert.deepEqual(snapshot(v), after);
    assert.match(again.out, /Nothing to copy: 6 files already up to date\./);
    assert.match(again.out, /Yours, left as they are: 1/);
    assert.doesNotMatch(again.out, /Dropped/, "a dropped file is listed once");
});

// Test plan step 4
test("a clone on a branch, with an uncommitted edit, still installs main's versions", (t) => {
    const c = clone(t);
    c.git("switch", "-q", "-c", "me/obs-n-test");
    write(c.dir, "Config/Templates/Task.md", "task template on a branch\n");
    c.git("commit", "-qam", "on a branch");
    write(c.dir, "Config/Templates/Log.md", "log template, uncommitted\n");
    const v = vault(t, {}, {});
    const r = run(c.dir, v);
    assert.equal(r.status, 0, r.err);
    assert.equal(read(v, "Config/Templates/Task.md"), "task template v2\n");
    assert.equal(read(v, "Config/Templates/Log.md"), "log template v2\n");
});

// Test plan step 5
test("a clone whose main is behind origin/main is refused, and nothing is written", (t) => {
    const c = clone(t);
    write(c.dir, "Config/Templates/Task.md", "task template v3\n");
    c.git("commit", "-qam", "merged elsewhere");
    c.git("update-ref", "refs/remotes/origin/main", "main");
    c.git("reset", "-q", "--hard", "HEAD~1");
    const v = vault(t, { "Config/Templates/Task.md": "task template v1\n" }, { "Config/Templates/Task.md": sha1("task template v1\n") });
    const before = snapshot(v);
    const r = run(c.dir, v);
    assert.equal(r.status, 1);
    assert.match(r.err, /main isn't origin\/main\. Pull it first/);
    assert.deepEqual(snapshot(v), before);
});

// Test plan step 6
test("with no record, it adds what's missing and lists every file that differs as yours", (t) => {
    const c = clone(t);
    const v = vault(t, { "Config/Templates/Task.md": "an older task template\n", "Config/Manual.md": "manual v2\n", "Projects/Projects.base": "a base\n" });
    const r = run(c.dir, v);
    assert.equal(r.status, 0, r.err);
    assert.equal(read(v, "Config/Templates/Task.md"), "an older task template\n", "nothing overwritten");
    assert.equal(read(v, "Projects/Projects.base"), "a base\n");
    assert.equal(read(v, "Config/Templates/Log.md"), "log template v2\n", "what's missing is added");
    assert.match(r.out, /No record of an earlier install in this vault/);
    assert.match(r.out, /Yours, left as they are: 1 .*\n {2}Config\/Templates\/Task\.md\n/);
    assert.equal(record(v).files["Config/Templates/Task.md"], undefined, "still not installed by it");
    assert.equal(record(v).files["Config/Manual.md"], sha1("manual v2\n"), "the same is recorded, so a later update reaches it");
});

test("it refuses the clone itself, one of its worktrees, a folder that isn't a vault, and one that isn't a clone", (t) => {
    const c = clone(t);
    write(c.dir, ".obsidian/app.json", "{}\n");
    let r = run(c.dir, c.dir);
    assert.equal(r.status, 1);
    assert.match(r.err, /is the clone or one of its worktrees/);
    const tree = path.join(tmp(t, "trees"), "worktree");
    c.git("worktree", "add", "-q", tree, "-b", "a-worktree");
    write(tree, ".obsidian/app.json", "{}\n");
    r = run(c.dir, tree);
    assert.match(r.err, /is the clone or one of its worktrees/);
    r = run(c.dir, tmp(t, "plain"));
    assert.match(r.err, /isn't a vault/);
    const other = clone(t, { "manifest.json": '{"id":"another-plugin"}\n', "Config/Manual.md": "x\n" });
    r = run(other.dir, vault(t));
    assert.match(r.err, /isn't a clone of Plainday's repository/);
});

test("a write that fails stops there, and the record says what landed", (t) => {
    const c = clone(t);
    // A folder where a template goes: the rename into place fails
    const v = vault(t, { "Config/Templates/Task.md/inside.md": "a note in the way\n" }, {});
    const r = run(c.dir, v);
    assert.equal(r.status, 1);
    assert.match(r.err, /stopped at Config\/Templates\/Task\.md/);
    const rec = record(v);
    assert.match(rec.failed, /^Config\/Templates\/Task\.md/);
    assert.equal(rec.files["Config/Templates/Area.md"], sha1("area template, new\n"), "what landed before it is recorded");
    assert.equal(rec.files["README.md"], undefined, "what came after it isn't");
    assert.deepEqual(fs.readdirSync(path.join(v, "Config/Templates")).filter((n) => n.startsWith(".")), [], "no temp file left");
    // Once the way is clear, the next run finishes and clears `failed`
    fs.rmSync(path.join(v, "Config/Templates/Task.md"), { recursive: true });
    const again = run(c.dir, v);
    assert.equal(again.status, 0, again.err);
    assert.equal(record(v).failed, undefined);
    assert.equal(read(v, "README.md"), "readme v2\n");
});

test("a vault file that's there but can't be read stops the run, and is never replaced", (t) => {
    if (process.getuid?.() === 0) return t.skip("root reads anything");
    const c = clone(t);
    const v = vault(t, { "Config/Templates/Task.md": "an edit that can't be read right now\n" }, {});
    const file = path.join(v, "Config/Templates/Task.md");
    fs.chmodSync(file, 0o000);
    const r = run(c.dir, v);
    assert.equal(r.status, 1);
    assert.match(r.err, /couldn't read Config\/Templates\/Task\.md in the vault/);
    fs.chmodSync(file, 0o644);
    assert.equal(read(v, "Config/Templates/Task.md"), "an edit that can't be read right now\n");
    assert.equal(exists(v, "README.md"), false, "nothing was written");
});
