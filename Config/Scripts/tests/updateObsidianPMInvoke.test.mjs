// Runs UpdateObsidianPM.invoke() against temporary folders, with Obsidian and the modals stubbed,
// so the part that actually writes files is covered. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// The class files run in Obsidian, where `require` exists; an ES module has none
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
    write(dir, "Config/Scripts/CustomJS/timeReport.js", "new report\n");
    write(dir, "Config/Templates/Task.md", "task template\n");
    write(dir, ".obsidian/plugins/templater-obsidian/data.json", '{"templates_folder":"Config/Templates"}\n');
    write(dir, "README.md", "readme\n");
    write(dir, "Welcome.md", "demo note\n");
    write(dir, "Reference/Planner/days/2026-09-16.md", "demo daily note\n");
    write(dir, "Config/Scripts/tests/demoVault.test.mjs", "demo test\n");
    write(dir, "Config/Scripts/tests/demo/renderReports.mjs", "writes notes\n");
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("add", "-A");
    git("commit", "-qm", "system");
}

// Obsidian, as much of it as the command uses. `answers` decides what the modals return.
function stubs(vaultDir, answers = {}) {
    const notices = [], trashed = [], moved = [], toggled = [];
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
            createFolder: async (p) => { fs.mkdirSync(rel(p)); },
        },
        fileManager: {
            trashFile: async (f) => { trashed.push(f.path); fs.rmSync(rel(f.path), { force: true }); },
            renameFile: async (f, to) => { moved.push([f.path, to]); fs.renameSync(rel(f.path), rel(to)); },
        },
        // Nothing turns a plugin off or on any more: the offer to reload CustomJS went with OBS-257
        plugins: { disablePlugin: async (id) => toggled.push(`off ${id}`), enablePlugin: async (id) => toggled.push(`on ${id}`) },
    };
    const context = {
        app,
        require: nodeRequire,
        process,
        console,
        window: { moment: () => ({ format: () => "2026-09-17 12:00" }) },
        customJS: { obsidian: {
            Notice: class { constructor(m) { notices.push(String(m)); } },
            // Enough of Obsidian's YAML for a settings note: `key: value` lines, and a line that
            // isn't one doesn't read
            getFrontMatterInfo: (text) => {
                const m = String(text).match(/^---\n([\s\S]*?)\n---/);
                return { exists: !!m, frontmatter: m ? m[1] : "" };
            },
            parseYaml: (yaml) => Object.fromEntries(yaml.split("\n").filter(Boolean).map((line) => {
                const m = line.match(/^([\w-]+):\s*(.*)$/);
                if (!m) throw new Error(`can't read ${line}`);
                return [m[1], m[2] === "" ? null : m[2].replace(/^"(.*)"$/, "$1")];
            })),
        } },
    };
    context.globalThis = context;
    return { context, notices, trashed, moved, toggled, answers };
}

// Loads the class in that context and replaces the three modal methods with the test's answers
function load(context, answers) {
    const UpdateObsidianPM = vm.runInContext(code + "\n;UpdateObsidianPM", vm.createContext(context));
    const up = new UpdateObsidianPM();
    up.ask = async () => answers.source ?? "";
    up.confirm = async (summary) => {
        answers.sawSummary = summary;
        return (typeof answers.confirm === "function" ? answers.confirm() : answers.confirm) ?? null;
    };
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

    assert.equal(read(f.vault, "Config/Scripts/CustomJS/timeReport.js"), "new report\n");
    assert.equal(read(f.vault, "Config/Templates/Task.md"), "task template\n");
    assert.equal(read(f.vault, "README.md"), "readme\n");
    assert.equal(exists(f.vault, ".obsidian/plugins/templater-obsidian/data.json"), true);
    for (const note of ["Welcome.md", "Reference/Planner/days/2026-09-16.md",
        "Config/Scripts/tests/demoVault.test.mjs", "Config/Scripts/tests/demo/renderReports.mjs"]) {
        assert.equal(exists(f.vault, note), false, note);
    }
    // it remembers where it came from and what it put there
    assert.equal(read(f.vault, "Config/Scripts/update-source").trim(), f.source);
    const manifest = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.deepEqual(Object.keys(manifest.files).sort(), [
        ".obsidian/plugins/templater-obsidian/data.json", "Config/Scripts/CustomJS/timeReport.js",
        "Config/Templates/Task.md", "README.md",
    ]);
    assert.match(manifest.commit, /^[0-9a-f]{7,}$/);
    // A class file landed, and the update ends with its notice: no offer to reload a plugin
    assert.match(f.notices.at(-1), /^Update Obsidian PM: 4 files copied/);
    assert.deepEqual(f.toggled, []);
});

test("invoke: a real note in the vault is never touched, even at a path the repository uses", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    write(f.vault, "Reference/Planner/days/2026-09-16.md", "MY REAL NOTE\n");
    write(f.vault, "Welcome.md", "my own welcome\n");
    await f.up.invoke();
    assert.equal(read(f.vault, "Reference/Planner/days/2026-09-16.md"), "MY REAL NOTE\n");
    assert.equal(read(f.vault, "Welcome.md"), "my own welcome\n");
});

test("invoke: a second run updates an old file and leaves one edited here alone", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();

    // the repository moves on; the vault has its own edit in the template
    write(f.source, "Config/Scripts/CustomJS/timeReport.js", "newer report\n");
    execFileSync("git", ["-C", f.source, "commit", "-qam", "update"], { stdio: "pipe" });
    write(f.vault, "Config/Templates/Task.md", "my own template\n");

    f.answers.confirm = { overwriteLocal: false, remove: true };
    await f.up.invoke();
    assert.equal(read(f.vault, "Config/Scripts/CustomJS/timeReport.js"), "newer report\n", "old version updated");
    assert.equal(read(f.vault, "Config/Templates/Task.md"), "my own template\n", "local edit kept");
    assert.match(f.answers.sawSummary, /Changed in this vault, would be overwritten: 1/);
    assert.match(f.answers.sawSummary, /Updated: 1/);
});

test("invoke: a file the repository dropped is removed, unless it was changed here", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();

    execFileSync("git", ["-C", f.source, "rm", "-q", "Config/Templates/Task.md"], { stdio: "pipe" });
    execFileSync("git", ["-C", f.source, "rm", "-q", "README.md"], { stdio: "pipe" });
    execFileSync("git", ["-C", f.source, "commit", "-qm", "drop"], { stdio: "pipe" });
    write(f.vault, "README.md", "I edited this\n");

    await f.up.invoke();
    assert.equal(exists(f.vault, "Config/Templates/Task.md"), false, "dropped file removed");
    assert.deepEqual(f.trashed, ["Config/Templates/Task.md"], "removed through the vault's trash");
    assert.equal(read(f.vault, "README.md"), "I edited this\n", "edited here, so kept");
    const manifest = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.equal("Config/Templates/Task.md" in manifest.files, false);
});

test("invoke: cancelling writes nothing, and a second thought about removals is honoured", async (t) => {
    const f = fixture({ confirm: null });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();
    assert.equal(exists(f.vault, "Config/Scripts/CustomJS/timeReport.js"), false);
    assert.equal(exists(f.vault, "Config/Scripts/update-manifest.json"), false);

    // install, then drop a file in the repository but say no to removing it
    f.answers.confirm = { overwriteLocal: true, remove: true };
    await f.up.invoke();
    execFileSync("git", ["-C", f.source, "rm", "-q", "Config/Templates/Task.md"], { stdio: "pipe" });
    execFileSync("git", ["-C", f.source, "commit", "-qm", "drop"], { stdio: "pipe" });
    f.answers.confirm = { overwriteLocal: false, remove: false };
    await f.up.invoke();
    assert.equal(exists(f.vault, "Config/Templates/Task.md"), true, "kept when removals are declined");
});

test("invoke: it refuses a folder that isn't a clone, and the vault itself", async (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    f.answers.source = path.join(f.base, "nowhere");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /No obsidian-pm clone/);

    f.answers.source = f.vault;
    write(f.vault, "Config/Scripts/CustomJS/x.js", "x\n");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /that's this vault|not a clone/i);
    assert.equal(exists(f.vault, "Config/Scripts/update-manifest.json"), false);
});

test("invoke: a clone with an uncommitted edit is refused before anything is written", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    // the clone is the dev vault, and the app rewrote a note there while a branch was under test
    write(f.source, "Reference/Planner/days/2026-09-16.md", "rewritten by the startup report\n");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /1 uncommitted change \(Reference\/Planner\/days\/2026-09-16\.md\)/);
    assert.match(f.notices.at(-1), /dev-vault\.sh done/);
    assert.equal(f.answers.sawSummary, undefined, "no dialog");
    assert.equal(exists(f.vault, "Config/Scripts/CustomJS/timeReport.js"), false, "nothing installed");
    assert.equal(exists(f.vault, "Config/Scripts/update-manifest.json"), false);
});

test("invoke: a clone on a branch, or detached at a commit under test, is refused", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const git = (...args) => execFileSync("git", ["-C", f.source, ...args], { stdio: "pipe" });
    git("checkout", "-qb", "me/obs-7-thing");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /on branch `me\/obs-7-thing`, not `main`/);
    assert.equal(exists(f.vault, "Config/Scripts/update-manifest.json"), false);

    git("checkout", "-q", "--detach", "main");
    await f.up.invoke();
    assert.match(f.notices.at(-1), /detached at [0-9a-f]{7}/);
    assert.equal(exists(f.vault, "Config/Scripts/update-manifest.json"), false);

    // back on main and clean: it installs
    git("checkout", "-q", "main");
    await f.up.invoke();
    assert.equal(exists(f.vault, "Config/Scripts/update-manifest.json"), true);
});

test("invoke: an edit hidden with skip-worktree in the clone is still shown", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    // the clone's settings are edited and hidden from git, as a demo vault's were
    const settings = ".obsidian/plugins/templater-obsidian/data.json";
    write(f.source, settings, '{"templates_folder":"edited locally"}\n');
    execFileSync("git", ["-C", f.source, "update-index", "--skip-worktree", settings], { stdio: "pipe" });
    // git itself reports nothing
    assert.equal(execFileSync("git", ["-C", f.source, "diff", "--name-only", "HEAD"], { encoding: "utf8" }).trim(), "");

    await f.up.invoke();
    assert.match(f.answers.sawSummary, /\*\*Hidden from git in the clone: 1\*\*/);
    assert.match(f.answers.sawSummary, /- \.obsidian\/plugins\/templater-obsidian\/data\.json/);
});

test("invoke: nothing to do says so", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();
    await f.up.invoke();
    assert.match(f.notices.at(-1), /up to date/);
});

// The dialog can sit open for as long as it likes, and the clone can move underneath it. What the
// guard checked is checked again when Update is clicked; `answers.confirm` as a function stands in
// for whatever happened while the dialog was open.
const nothingWritten = (f, why) => {
    assert.equal(exists(f.vault, "Config/Scripts/CustomJS/timeReport.js"), false, `${why}: nothing installed`);
    assert.equal(exists(f.vault, "Config/Scripts/update-manifest.json"), false, `${why}: no manifest`);
    assert.match(f.notices.at(-1), /clone changed while the dialog was open/i, why);
    assert.match(f.notices.at(-1), /run this again/i, why);
};

test("invoke: a clone that moved to a branch while the dialog was open installs nothing", async (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    f.answers.confirm = () => {
        execFileSync("git", ["-C", f.source, "checkout", "-qb", "me/obs-9-under-test"], { stdio: "pipe" });
        return { overwriteLocal: true, remove: true };
    };
    await f.up.invoke();
    nothingWritten(f, "branch");
    assert.match(f.notices.at(-1), /on branch `me\/obs-9-under-test`, not `main`/);
});

test("invoke: a clone dirtied while the dialog was open installs nothing", async (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    f.answers.confirm = () => {
        write(f.source, "Reference/Planner/days/2026-09-16.md", "rewritten by the startup report\n");
        return { overwriteLocal: true, remove: true };
    };
    await f.up.invoke();
    nothingWritten(f, "dirty");
    assert.match(f.notices.at(-1), /1 uncommitted change/);
});

test("invoke: a clone that moved to another commit while the dialog was open installs nothing", async (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    f.answers.confirm = () => {
        // pulled in another terminal: still main, still clean, different files
        write(f.source, "Config/Scripts/CustomJS/timeReport.js", "newer report\n");
        execFileSync("git", ["-C", f.source, "commit", "-qam", "pulled"], { stdio: "pipe" });
        return { overwriteLocal: true, remove: true };
    };
    await f.up.invoke();
    nothingWritten(f, "commit");
    assert.match(f.notices.at(-1), /moved from [0-9a-f]{7} to [0-9a-f]{7}/);
});

test("invoke: a clone deleted while the dialog was open installs nothing", async (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    f.answers.confirm = () => {
        fs.rmSync(f.source, { recursive: true, force: true });
        return { overwriteLocal: true, remove: true };
    };
    await f.up.invoke();
    nothingWritten(f, "deleted");
    assert.match(f.notices.at(-1), /no longer there/);
});

test("invoke: a copy that fails partway still records what landed, and names what didn't", async (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    // A source file made unreadable shows in `git status` (git can't hash it), so the re-check
    // refuses it as a dirty tree. What the re-check can't see is the vault's side: a folder sitting
    // where the third file, in copy order, is meant to land.
    const blocked = "Config/Templates/Task.md";
    f.answers.confirm = () => {
        fs.mkdirSync(path.join(f.vault, blocked), { recursive: true });
        return { overwriteLocal: true, remove: true };
    };
    await f.up.invoke();
    // copy order: .obsidian/…/data.json, Config/Scripts/…/timeReport.js, Config/Templates/Task.md, README.md
    assert.equal(exists(f.vault, ".obsidian/plugins/templater-obsidian/data.json"), true);
    assert.equal(exists(f.vault, "Config/Scripts/CustomJS/timeReport.js"), true);
    assert.equal(fs.statSync(path.join(f.vault, blocked)).isDirectory(), true, "the failed file");
    assert.equal(exists(f.vault, "README.md"), false, "stopped at the failure");
    const manifest = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.deepEqual(Object.keys(manifest.files).sort(), [".obsidian/plugins/templater-obsidian/data.json", "Config/Scripts/CustomJS/timeReport.js"],
        "the manifest matches what's on disk");
    assert.equal(manifest.failed, blocked);
    assert.match(f.notices.at(-1), /2 of 4 files copied/);
    assert.match(f.notices.at(-1), /Task\.md failed/);
    assert.match(f.notices.at(-1), /EISDIR/);
    assert.equal(read(f.vault, "Config/Scripts/update-source").trim(), f.source, "the clone's path is kept too");
    assert.deepEqual(f.toggled, [], "no plugin reloaded");

    // once the folder is out of the way, the next run finishes the install: the two that landed
    // are up to date, the other two are new, and nothing is called a local edit
    fs.rmSync(path.join(f.vault, blocked), { recursive: true });
    f.answers.confirm = { overwriteLocal: false, remove: true };
    await f.up.invoke();
    assert.doesNotMatch(f.answers.sawSummary, /Changed in this vault/);
    assert.match(f.answers.sawSummary, /\*\*New: 2\*\*/);
    assert.equal(read(f.vault, blocked), "task template\n");
    assert.equal(read(f.vault, "README.md"), "readme\n");
    const finished = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.equal("failed" in finished, false, "a finished install carries no failure");
    assert.equal(Object.keys(finished.files).length, 4);
});

test("invoke: a file edited under skip-worktree while the dialog was open is not what the dialog showed, so it isn't copied", async (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    // git status, the branch and HEAD all read the same as when the plan was built
    const settings = ".obsidian/plugins/templater-obsidian/data.json";
    f.answers.confirm = () => {
        execFileSync("git", ["-C", f.source, "update-index", "--skip-worktree", settings], { stdio: "pipe" });
        write(f.source, settings, '{"templates_folder":"edited while the dialog was open"}\n');
        return { overwriteLocal: true, remove: true };
    };
    await f.up.invoke();
    // it's the first file in copy order, so nothing lands at all
    assert.equal(exists(f.vault, settings), false, "the edited file");
    assert.equal(exists(f.vault, "Config/Scripts/CustomJS/timeReport.js"), false, "nothing after it either");
    assert.match(f.notices.at(-1), /0 of 4 files copied/);
    assert.match(f.notices.at(-1), /data\.json/);
    assert.match(f.notices.at(-1), /changed while the dialog was open/i);
    const manifest = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.deepEqual(manifest.files, {}, "the manifest matches what's on disk");
    assert.equal(manifest.failed, settings);
});

test("invoke: a removal that fails still records the copies that landed", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    await f.up.invoke();

    // the repository updates one file and drops two; the vault's trash refuses the second removal
    write(f.source, "Config/Scripts/CustomJS/timeReport.js", "newer report\n");
    execFileSync("git", ["-C", f.source, "rm", "-q", "Config/Templates/Task.md", "README.md"], { stdio: "pipe" });
    execFileSync("git", ["-C", f.source, "commit", "-qam", "update and drop"], { stdio: "pipe" });
    const trashFile = f.context.app.fileManager.trashFile;
    f.context.app.fileManager.trashFile = async (file) => {
        if (file.path === "README.md") throw new Error("Trash isn't available");
        return trashFile(file);
    };
    await f.up.invoke();
    assert.equal(read(f.vault, "Config/Scripts/CustomJS/timeReport.js"), "newer report\n");
    assert.equal(exists(f.vault, "Config/Templates/Task.md"), false, "the first removal went through");
    assert.equal(exists(f.vault, "README.md"), true, "the second didn't");
    assert.match(f.notices.at(-1), /1 of 1 files? copied/);
    assert.match(f.notices.at(-1), /README\.md failed/);
    assert.match(f.notices.at(-1), /Trash isn't available/);
    const manifest = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.equal("Config/Templates/Task.md" in manifest.files, false, "removed, so forgotten");
    assert.equal("README.md" in manifest.files, true, "still there, so still recorded");
    assert.equal(manifest.failed, "README.md");

    // the next run sees the update as done and offers the removal again
    f.context.app.fileManager.trashFile = trashFile;
    await f.up.invoke();
    assert.doesNotMatch(f.answers.sawSummary, /Changed in this vault/);
    assert.match(f.answers.sawSummary, /\*\*Removed: 1\*\*/);
    assert.equal(exists(f.vault, "README.md"), false);
});

// ------------------------------------------------------------------ the bases (OBS-112)

// The base as the repository keeps it, beside the demo's invoices, and where a vault gets it with no
// invoice folder
const SRC = "Reference/Invoices/Invoices.base";
const BASE = "Config/Bases/Invoices.base";
const settingsNote = (folder) => `---\nname: Juniper Hale\nfolder: ${folder}\nlast_number: 1000\n---\nYour details for invoices.\n`;

// The clone gains both bases, the demo's invoice and the demo's settings note
function withBases(f) {
    write(f.source, SRC, "invoices base\n");
    write(f.source, "Projects/Projects.base", "projects base\n");
    write(f.source, "Reference/Invoices/1001-KES.md", "demo invoice\n");
    write(f.source, "Config/Invoice Settings.md", settingsNote("Reference/Invoices"));
    execFileSync("git", ["-C", f.source, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", f.source, "commit", "-qm", "bases"], { stdio: "pipe" });
}

test("invoke: the Projects base goes in Projects, and the Invoices base in Config until a folder is set", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: false, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    withBases(f);
    await f.up.invoke();
    assert.equal(read(f.vault, "Projects/Projects.base"), "projects base\n");
    assert.equal(read(f.vault, BASE), "invoices base\n");
    assert.doesNotMatch(f.answers.sawSummary, /goes in/);
    // the demo's invoice, its settings and its folder never reach a vault
    for (const p of ["Config/Invoice Settings.md", "Reference/Invoices/1001-KES.md", SRC]) assert.equal(exists(f.vault, p), false, p);
    assert.doesNotMatch(f.answers.sawSummary, /Invoice Settings\.md|1001-KES/);
});

test("invoke: your own Invoice Settings are never listed or touched, whatever the demo's say", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: true, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    write(f.vault, "Config/Invoice Settings.md", "---\nname: Someone Else\n---\n");
    withBases(f);
    await f.up.invoke();
    assert.equal(read(f.vault, "Config/Invoice Settings.md"), "---\nname: Someone Else\n---\n");
    assert.doesNotMatch(f.answers.sawSummary, /Invoice Settings\.md/);
    const manifest = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.equal("Config/Invoice Settings.md" in manifest.files, false);
});

test("invoke: a vault that keeps its invoices where the demo does gets the base there, moved from Config", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: false, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    withBases(f);
    await f.up.invoke();
    write(f.vault, "Config/Invoice Settings.md", settingsNote("Reference/Invoices"));
    await f.up.invoke();
    assert.equal(read(f.vault, SRC), "invoices base\n");
    assert.equal(exists(f.vault, BASE), false);
    assert.deepEqual(f.moved, [[BASE, SRC]]);
});

test("invoke: setting `folder` moves the Invoices base there as it is, spelled as the vault spells it, and it updates there", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: false, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    withBases(f);
    await f.up.invoke();

    // the folder exists already, in another case; the settings name it with a trailing slash
    fs.mkdirSync(path.join(f.vault, "Business/Invoices"), { recursive: true });
    write(f.vault, "Config/Invoice Settings.md", settingsNote("business/invoices/"));
    await f.up.invoke();
    const placed = "Business/Invoices/Invoices.base";
    assert.equal(read(f.vault, placed), "invoices base\n");
    assert.equal(exists(f.vault, BASE), false);
    assert.deepEqual(f.moved, [[BASE, placed]], "moved through Obsidian, so links follow");
    assert.deepEqual(f.trashed, [], "nothing trashed");
    assert.match(f.answers.sawSummary, /The Invoices base goes in `Business\/Invoices`/);
    assert.match(f.answers.sawSummary, /\*\*Moved: 1\*\*/);
    let manifest = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.equal(manifest.files[placed] !== undefined, true);
    assert.equal(BASE in manifest.files, false);

    // the repository changes the base: the copy beside the invoices takes it
    write(f.source, SRC, "invoices base v2\n");
    execFileSync("git", ["-C", f.source, "commit", "-qam", "base v2"], { stdio: "pipe" });
    await f.up.invoke();
    assert.equal(read(f.vault, placed), "invoices base v2\n");
    assert.match(f.answers.sawSummary, /\*\*Updated: 1\*\*/);
    assert.equal(exists(f.vault, BASE), false, "never in two places");

    // sorting in the base writes into its file: from then on it's yours, and an update leaves it alone
    write(f.vault, placed, "sorted by status\n");
    write(f.source, SRC, "invoices base v3\n");
    execFileSync("git", ["-C", f.source, "commit", "-qam", "base v3"], { stdio: "pipe" });
    await f.up.invoke();
    assert.equal(read(f.vault, placed), "sorted by status\n");
    assert.match(f.answers.sawSummary, /Changed in this vault, would be overwritten: 1\*\*\n- Business\/Invoices\/Invoices\.base/);
    manifest = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json"));
    assert.equal(manifest.files[placed] !== undefined, true);

    // taking the repository's version puts yours in the trash first
    f.answers.confirm = { overwriteLocal: true, remove: true };
    await f.up.invoke();
    assert.equal(read(f.vault, placed), "invoices base v3\n");
    assert.deepEqual(f.trashed, [placed]);
});

test("invoke: a base you sorted before `folder` was set moves with your sort, and stays yours", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: false, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    withBases(f);
    await f.up.invoke();
    write(f.vault, BASE, "sorted by status\n");
    write(f.vault, "Config/Invoice Settings.md", settingsNote("Business/Invoices"));
    await f.up.invoke();
    const placed = "Business/Invoices/Invoices.base";
    assert.equal(read(f.vault, placed), "sorted by status\n", "your sort came along");
    assert.equal(exists(f.vault, BASE), false, "no copy left behind in Config");
    assert.match(f.answers.sawSummary, /Changed in this vault, would be overwritten: 1\*\*\n- Business\/Invoices\/Invoices\.base/);
    // and the next run still knows it's yours, not something new
    await f.up.invoke();
    assert.match(f.answers.sawSummary, /Changed in this vault, would be overwritten: 1/);
    assert.doesNotMatch(f.answers.sawSummary, /\*\*New/);
});

test("invoke: settings that don't read, or a `folder` that isn't one, leave the base where it is", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: false, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    withBases(f);
    write(f.vault, "Config/Invoice Settings.md", settingsNote("Business/Invoices"));
    await f.up.invoke();
    const placed = "Business/Invoices/Invoices.base";
    assert.equal(read(f.vault, placed), "invoices base\n");
    const before = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json")).files;

    for (const [settings, why] of [
        ["---\nname: Juniper Hale\nnot yaml at all\n---\n", /properties don't read/],
        [settingsNote("../outside"), /`folder` in Invoice Settings isn't a folder in the vault \(\.\.\/outside\)/],
        [settingsNote("README.md/Invoices"), /goes through README\.md, which is a file/],
    ]) {
        write(f.vault, "Config/Invoice Settings.md", settings);
        write(f.source, "Config/Scripts/CustomJS/timeReport.js", `report ${Math.random()}\n`);
        execFileSync("git", ["-C", f.source, "commit", "-qam", "report"], { stdio: "pipe" });
        f.notices.length = 0;
        await f.up.invoke();
        assert.ok(f.notices.some((n) => why.test(n) && /left where it is/.test(n)), f.notices.join("\n"));
        assert.equal(read(f.vault, placed), "invoices base\n", "still where it was");
        assert.equal(exists(f.vault, BASE), false, "and not back in Config");
        assert.equal(exists(f.base, "outside/Invoices.base"), false);
        assert.deepEqual(f.trashed, []);
        assert.match(f.answers.sawSummary, /The Invoices base is left as it is this time/);
        const files = JSON.parse(read(f.vault, "Config/Scripts/update-manifest.json")).files;
        assert.equal(files[placed], before[placed], "its record kept");
    }
});

test("invoke: a file already in place is recorded, even when there's nothing to copy", async (t) => {
    const f = fixture({ confirm: { overwriteLocal: false, remove: true } });
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    withBases(f);
    await f.up.invoke();
    // a Projects base put in place by hand on another install, matching the repository
    const manifestPath = "Config/Scripts/update-manifest.json";
    const m = JSON.parse(read(f.vault, manifestPath));
    delete m.files["Projects/Projects.base"];
    write(f.vault, manifestPath, JSON.stringify(m));
    await f.up.invoke();
    assert.match(f.notices.at(-1), /up to date/);
    assert.equal("Projects/Projects.base" in JSON.parse(read(f.vault, manifestPath)).files, true);
    // so the repository's next version updates it
    write(f.source, "Projects/Projects.base", "projects base v2\n");
    execFileSync("git", ["-C", f.source, "commit", "-qam", "projects v2"], { stdio: "pipe" });
    await f.up.invoke();
    assert.equal(read(f.vault, "Projects/Projects.base"), "projects base v2\n");
});
