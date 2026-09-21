// Runs UpdateObsidianPM.invoke() against temporary folders, with Obsidian and the modals stubbed,
// so the part that actually writes files is covered. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// CustomJS scripts run in Obsidian, where `require` exists; an ES module has none
const nodeRequire = createRequire(import.meta.url);

const here = new URL(".", import.meta.url);
const code = fs.readFileSync(new URL("../CustomJS/updateObsidianPM.js", here), "utf8");

const write = (root, rel, text) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

// A clone: a git repository holding a few system files, a note and a demo-only test file
function makeSource(dir) {
    write(dir, "00 Meta/02 Scripts/CustomJS/timeReport.js", "new report\n");
    write(dir, "00 Meta/01 Templates/Task.md", "task template\n");
    write(dir, ".obsidian/plugins/customjs/data.json", '{"jsFolder":"00 Meta/02 Scripts/CustomJS/"}\n');
    write(dir, "README.md", "readme\n");
    write(dir, "Welcome.md", "demo note\n");
    write(dir, "30 Reference/36 Planner/days/2026-09-16.md", "demo daily note\n");
    write(dir, "00 Meta/02 Scripts/tests/demoVault.test.mjs", "demo test\n");
    write(dir, "00 Meta/02 Scripts/tests/demo/renderReports.mjs", "writes notes\n");
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("add", "-A");
    git("commit", "-qm", "system");
}

// Obsidian, as much of it as the command uses. `answers` decides what the modals return.
function stubs(vaultDir, answers = {}) {
    const notices = [], trashed = [];
    const rel = (p) => path.join(vaultDir, p);
    const app = {
        isMobile: false,
        vault: {
            adapter: {
                getBasePath: () => vaultDir,
                exists: async (p) => fs.existsSync(rel(p)),
                read: async (p) => fs.readFileSync(rel(p), "utf8"),
                write: async (p, text) => { write(vaultDir, p, text); },
            },
            getAbstractFileByPath: (p) => (fs.existsSync(rel(p)) ? { path: p } : null),
        },
        fileManager: { trashFile: async (f) => { trashed.push(f.path); fs.rmSync(rel(f.path), { force: true }); } },
        plugins: { disablePlugin: async () => {}, enablePlugin: async () => {} },
    };
    const context = {
        app,
        require: nodeRequire,
        process,
        console,
        window: { moment: () => ({ format: () => "2026-09-17 12:00" }) },
        customJS: { obsidian: { Notice: class { constructor(m) { notices.push(String(m)); } } } },
    };
    context.globalThis = context;
    return { context, notices, trashed, answers };
}

// Loads the class in that context and replaces the three modal methods with the test's answers
function load(context, answers) {
    const UpdateObsidianPM = vm.runInContext(code + "\n;UpdateObsidianPM", vm.createContext(context));
    const up = new UpdateObsidianPM();
    up.ask = async () => answers.source ?? "";
    up.confirm = async (summary) => { answers.sawSummary = summary; return answers.confirm ?? null; };
    up.confirmReload = async () => Boolean(answers.reload);
    return up;
}

function fixture(answers = {}) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-pm-update-"));
    const source = path.join(base, "clone"), vault = path.join(base, "vault");
    fs.mkdirSync(source); fs.mkdirSync(vault);
    makeSource(source);
    const s = stubs(vault, { source, confirm: { overwriteLocal: false, remove: true }, ...answers });
    return { base, source, vault, up: load(s.context, s.answers), ...s };
}

test("invoke: a first install copies the system, and never a note or a demo test", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();

    assert.equal(read(f.vault, "00 Meta/02 Scripts/CustomJS/timeReport.js"), "new report\n");
    assert.equal(read(f.vault, "00 Meta/01 Templates/Task.md"), "task template\n");
    assert.equal(read(f.vault, "README.md"), "readme\n");
    assert.equal(exists(f.vault, ".obsidian/plugins/customjs/data.json"), true);
    for (const note of ["Welcome.md", "30 Reference/36 Planner/days/2026-09-16.md",
        "00 Meta/02 Scripts/tests/demoVault.test.mjs", "00 Meta/02 Scripts/tests/demo/renderReports.mjs"]) {
        assert.equal(exists(f.vault, note), false, note);
    }
    // it remembers where it came from and what it put there
    assert.equal(read(f.vault, "00 Meta/02 Scripts/update-source").trim(), f.source);
    const manifest = JSON.parse(read(f.vault, "00 Meta/02 Scripts/update-manifest.json"));
    assert.deepEqual(Object.keys(manifest.files).sort(), [
        ".obsidian/plugins/customjs/data.json", "00 Meta/01 Templates/Task.md",
        "00 Meta/02 Scripts/CustomJS/timeReport.js", "README.md",
    ]);
    assert.match(manifest.commit, /^[0-9a-f]{7,}$/);
    assert.match(f.notices.join(" "), /4 files copied/);
});

test("invoke: a real note in the vault is never touched, even at a path the repository uses", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    write(f.vault, "30 Reference/36 Planner/days/2026-09-16.md", "MY REAL NOTE\n");
    write(f.vault, "Welcome.md", "my own welcome\n");
    await f.up.invoke();
    assert.equal(read(f.vault, "30 Reference/36 Planner/days/2026-09-16.md"), "MY REAL NOTE\n");
    assert.equal(read(f.vault, "Welcome.md"), "my own welcome\n");
});

test("invoke: a second run updates an old file and leaves one edited here alone", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();

    // the repository moves on; the vault has its own edit in the template
    write(f.source, "00 Meta/02 Scripts/CustomJS/timeReport.js", "newer report\n");
    execFileSync("git", ["-C", f.source, "commit", "-qam", "update"], { stdio: "pipe" });
    write(f.vault, "00 Meta/01 Templates/Task.md", "my own template\n");

    f.answers.confirm = { overwriteLocal: false, remove: true };
    await f.up.invoke();
    assert.equal(read(f.vault, "00 Meta/02 Scripts/CustomJS/timeReport.js"), "newer report\n", "old version updated");
    assert.equal(read(f.vault, "00 Meta/01 Templates/Task.md"), "my own template\n", "local edit kept");
    assert.match(f.answers.sawSummary, /Changed in this vault, would be overwritten: 1/);
    assert.match(f.answers.sawSummary, /Updated: 1/);
});

test("invoke: a file the repository dropped is removed, unless it was changed here", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();

    execFileSync("git", ["-C", f.source, "rm", "-q", "00 Meta/01 Templates/Task.md"], { stdio: "pipe" });
    execFileSync("git", ["-C", f.source, "rm", "-q", "README.md"], { stdio: "pipe" });
    execFileSync("git", ["-C", f.source, "commit", "-qm", "drop"], { stdio: "pipe" });
    write(f.vault, "README.md", "I edited this\n");

    await f.up.invoke();
    assert.equal(exists(f.vault, "00 Meta/01 Templates/Task.md"), false, "dropped file removed");
    assert.deepEqual(f.trashed, ["00 Meta/01 Templates/Task.md"], "removed through the vault's trash");
    assert.equal(read(f.vault, "README.md"), "I edited this\n", "edited here, so kept");
    const manifest = JSON.parse(read(f.vault, "00 Meta/02 Scripts/update-manifest.json"));
    assert.equal("00 Meta/01 Templates/Task.md" in manifest.files, false);
});

test("invoke: cancelling writes nothing, and a second thought about removals is honoured", async (t) => {
    const f = fixture({ confirm: null });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();
    assert.equal(exists(f.vault, "00 Meta/02 Scripts/CustomJS/timeReport.js"), false);
    assert.equal(exists(f.vault, "00 Meta/02 Scripts/update-manifest.json"), false);

    // install, then drop a file in the repository but say no to removing it
    f.answers.confirm = { overwriteLocal: true, remove: true };
    await f.up.invoke();
    execFileSync("git", ["-C", f.source, "rm", "-q", "00 Meta/01 Templates/Task.md"], { stdio: "pipe" });
    execFileSync("git", ["-C", f.source, "commit", "-qm", "drop"], { stdio: "pipe" });
    f.answers.confirm = { overwriteLocal: false, remove: false };
    await f.up.invoke();
    assert.equal(exists(f.vault, "00 Meta/01 Templates/Task.md"), true, "kept when removals are declined");
});

test("invoke: it refuses a folder that isn't a clone, and the vault itself", async (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    f.answers.source = path.join(f.base, "nowhere");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /No obsidian-pm clone/);

    f.answers.source = f.vault;
    write(f.vault, "00 Meta/02 Scripts/CustomJS/x.js", "x\n");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /that's this vault|not a clone/i);
    assert.equal(exists(f.vault, "00 Meta/02 Scripts/update-manifest.json"), false);
});

test("invoke: a clone with an uncommitted edit is refused before anything is written", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    // the clone is the dev vault, and the app rewrote a note there while a branch was under test
    write(f.source, "30 Reference/36 Planner/days/2026-09-16.md", "rewritten by the startup report\n");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /1 uncommitted change \(30 Reference\/36 Planner\/days\/2026-09-16\.md\)/);
    assert.match(f.notices.at(-1), /dev-vault\.sh done/);
    assert.equal(f.answers.sawSummary, undefined, "no dialog");
    assert.equal(exists(f.vault, "00 Meta/02 Scripts/CustomJS/timeReport.js"), false, "nothing installed");
    assert.equal(exists(f.vault, "00 Meta/02 Scripts/update-manifest.json"), false);
});

test("invoke: a clone on a branch, or detached at a commit under test, is refused", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const git = (...args) => execFileSync("git", ["-C", f.source, ...args], { stdio: "pipe" });
    git("checkout", "-qb", "me/obs-7-thing");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /on branch `me\/obs-7-thing`, not `main`/);
    assert.equal(exists(f.vault, "00 Meta/02 Scripts/update-manifest.json"), false);

    git("checkout", "-q", "--detach", "main");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /detached at [0-9a-f]{7}/);
    assert.equal(exists(f.vault, "00 Meta/02 Scripts/update-manifest.json"), false);

    // back on main and clean: it installs
    git("checkout", "-q", "main");
    await f.up.invoke();
    assert.equal(exists(f.vault, "00 Meta/02 Scripts/update-manifest.json"), true);
});

test("invoke: an edit hidden with skip-worktree in the clone is still shown", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    // the clone's settings are edited and hidden from git, as a demo vault's were
    const settings = ".obsidian/plugins/customjs/data.json";
    write(f.source, settings, '{"jsFolder":"edited locally"}\n');
    execFileSync("git", ["-C", f.source, "update-index", "--skip-worktree", settings], { stdio: "pipe" });
    // git itself reports nothing
    assert.equal(execFileSync("git", ["-C", f.source, "diff", "--name-only", "HEAD"], { encoding: "utf8" }).trim(), "");

    await f.up.invoke();
    assert.match(f.answers.sawSummary, /\*\*Hidden from git in the clone: 1\*\*/);
    assert.match(f.answers.sawSummary, /- \.obsidian\/plugins\/customjs\/data\.json/);
});

test("invoke: nothing to do says so", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();
    await f.up.invoke();
    assert.match(f.notices.at(-1), /up to date/);
});
