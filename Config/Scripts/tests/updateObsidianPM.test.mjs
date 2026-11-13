// Tests for plugin/src/classes/updateObsidianPM.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm; only the planning, which doesn't
// touch `app`, the file system or git, is tested.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { classFiles, classScript } from "../../../plugin/classShape.mjs";

const here = new URL(".", import.meta.url);
const UpdateObsidianPM = vm.runInContext(
    classScript("updateObsidianPM.js") + "\n;UpdateObsidianPM",
    vm.createContext({}),
);
const up = new UpdateObsidianPM();
const map = (o) => new Map(Object.entries(o));
// Objects made inside the vm context have that context's prototypes; compare as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

const SCRIPT = "Config/Scripts/Templater/recordEvent.js";
const TEMPLATE = "Config/Templates/Task.md";
const SETTINGS = ".obsidian/plugins/templater-obsidian/data.json";
// Installed until OBS-257, when the class files stopped running under CustomJS
const CUSTOMJS_SETTINGS = ".obsidian/plugins/customjs/data.json";

test("installs: the system, never notes, the class files or the tests", () => {
    for (const path of [SCRIPT, TEMPLATE, SETTINGS, "README.md", "CLAUDE.md", "Reference/Invoices/Invoices.base", "Projects/Projects.base",
        ".obsidian/daily-notes.json"]) {
        assert.equal(up.installs(path), true, path);
    }
    for (const path of ["Welcome.md", "Projects/Freelance/Freelance.md", "Projects/Projects.md", "Projects/Freelance/Projects.base", "Reference/Planner/days/2026-09-16.md",
        "Config/Invoice Settings.md", "Reference/Invoices/1001-KES.md",
        "Archive/Freelance/Marlowe Bakery Rebrand/Marlowe Bakery Rebrand.md", "Inbox/Desk lamp for the studio.md",
        ".gitignore", "CLAUDE.local.md", ".obsidian/app.json", ".obsidian/hotkeys.json", ".obsidian/types.json", CUSTOMJS_SETTINGS,
        "Config/Scripts/tests/demoVault.test.mjs", "Config/Scripts/tests/demo/renderReports.mjs",
        "Config/Scripts/dev-vault.sh", "Config/Scripts/tests/devVault.test.mjs",
        "Config/Scripts/tests/timeReport.test.mjs", "Config/Scripts/tests/standInVault.mjs", "Config/Scripts/tests/fixtures/x.json",
        "plugin/src/commands/timeReport.js", "plugin/src/main.js", "manifest.json", "main.js"]) {
        assert.equal(up.installs(path), false, path);
    }
});

test("plan: a first install is all new", () => {
    const plan = up.plan(map({ [SCRIPT]: "a", [TEMPLATE]: "b", "Welcome.md": "c" }), new Map());
    assert.deepEqual(plain(plan.add), [SCRIPT, TEMPLATE]);
    assert.deepEqual(plain([plan.update, plan.local, plan.remove, plan.keep, plan.same]), [[], [], [], [], []]);
});

test("plan: an old version is an update; the same content is nothing to do", () => {
    const source = map({ [SCRIPT]: "new", [TEMPLATE]: "same" });
    const vault = map({ [SCRIPT]: "old", [TEMPLATE]: "same" });
    const plan = up.plan(source, vault, map({ [SCRIPT]: "old", [TEMPLATE]: "same" }));
    assert.deepEqual(plain(plan.update), [SCRIPT]);
    assert.deepEqual(plain(plan.same), [TEMPLATE]);
    assert.deepEqual(plain(plan.local), []);
});

test("plan: a file changed in the vault is never quietly overwritten", () => {
    // installed "old", the vault now has "mine", the repository has "new"
    const plan = up.plan(map({ [SCRIPT]: "new" }), map({ [SCRIPT]: "mine" }), map({ [SCRIPT]: "old" }));
    assert.deepEqual(plain(plan.local), [SCRIPT]);
    assert.deepEqual(plain(plan.update), []);
    // and neither is a file that was never installed by this command
    const first = up.plan(map({ [SCRIPT]: "new" }), map({ [SCRIPT]: "theirs" }), new Map());
    assert.deepEqual(plain(first.local), [SCRIPT]);
});

test("plan: a dropped file is removed only when it's still what was installed", () => {
    const source = map({ [SCRIPT]: "new" });
    const installed = map({ [SCRIPT]: "new", [TEMPLATE]: "old", "Config/gone.md": "x" });
    const plan = up.plan(source, map({ [SCRIPT]: "new", [TEMPLATE]: "old", "Config/gone.md": "edited" }), installed);
    assert.deepEqual(plain(plan.remove), [TEMPLATE]);
    assert.deepEqual(plain(plan.keep), ["Config/gone.md"]);
    // a file the vault no longer has is neither
    const gone = up.plan(source, map({ [SCRIPT]: "new" }), installed);
    assert.deepEqual(plain([gone.remove, gone.keep]), [[], []]);
});

test("plan: CustomJS's settings and CalendarSyncRange, installed before OBS-257 and unchanged, are removed", () => {
    const range = "Config/Scripts/CustomJS/calendarSyncRange.js";
    const installed = map({ [SCRIPT]: "a", [CUSTOMJS_SETTINGS]: "s", [range]: "r" });
    const plan = up.plan(map({ [SCRIPT]: "a" }), installed, installed);
    assert.deepEqual(plain(plan.remove), [CUSTOMJS_SETTINGS, range]);
    assert.deepEqual(plain([plan.add, plan.update, plan.local, plan.keep]), [[], [], [], []]);
});

// ------------------------------------------------------------------ the class files in plugin/src/ (OBS-270, OBS-271)

const REPO = new URL("../../../", here);
const tracked = execFileSync("git", ["-C", REPO.pathname, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
// By file name, as they were in Config/Scripts/CustomJS/ before OBS-270
const CLASS_FILES = classFiles().map((f) => f.split("/")[1]).sort();

test("a clone is a folder whose manifest.json is Plainday's", () => {
    assert.equal(up.isManifest(fs.readFileSync(new URL("manifest.json", REPO), "utf8")), true, "this repository's");
    for (const text of ['{"id":"another-plugin"}', '{"name":"Plainday"}', "null", "", "{not json"]) {
        assert.equal(up.isManifest(text), false, text);
    }
});

test("installs: of this repository's files, the templates, the manual and the Templater scripts, and no class file or test", () => {
    const installed = tracked.filter((p) => up.installs(p));
    assert.deepEqual(installed.filter((p) => !p.startsWith("Config/") && !p.includes("/")).sort(), ["CLAUDE.md", "README.md"]);
    assert.deepEqual(installed.filter((p) => /^(plugin|\.github)\/|^Config\/Scripts\/(tests\/|dev-vault\.sh$)/.test(p)), []);
    assert.ok(installed.includes("Config/Manual.md"));
    for (const p of tracked.filter((q) => /^Config\/(Templates|Scripts\/Templater)\//.test(q))) assert.ok(installed.includes(p), p);
    assert.ok(installed.some((p) => p.startsWith("Config/Scripts/Templater/")), "the Templater scripts are there to install");
    assert.equal(CLASS_FILES.length > 20, true, "the class files are where the build reads them");
});

test("plan: a vault installed before OBS-270 gets its class files and tests offered as removals, and keeps an edited test", () => {
    // What the vault's install record lists: every class file at its old path, and every test the
    // repository had that the old rules installed (all but the demo's own and dev-vault.sh's)
    const oldTests = tracked.filter((p) => p.startsWith("Config/Scripts/tests/")
        && !p.startsWith("Config/Scripts/tests/demo/") && !["Config/Scripts/tests/demoVault.test.mjs", "Config/Scripts/tests/devVault.test.mjs"].includes(p));
    const oldClasses = CLASS_FILES.map((f) => `Config/Scripts/CustomJS/${f}`);
    const source = new Map(tracked.filter((p) => up.installs(p)).map((p) => [p, "same"]));
    const installed = new Map([...source, ...[...oldClasses, ...oldTests].map((p) => [p, "old"])]);
    const plan = up.plan(source, installed, installed);
    assert.deepEqual(plain(plan.remove), [...oldClasses, ...oldTests].sort());
    assert.deepEqual(plain([plan.add, plan.update, plan.local, plan.keep]), [[], [], [], []]);
    // A test edited in the vault stays, and a private test was never installed, so it's in no list
    const edited = oldTests[0];
    const vault = new Map([...installed, [edited, "edited"], ["Config/Scripts/tests/mine.private.test.mjs", "mine"]]);
    const kept = up.plan(source, vault, installed);
    assert.deepEqual(plain(kept.keep), [edited]);
    assert.equal(plain(kept.remove).includes(edited), false);
    for (const list of Object.values(plain(kept))) {
        if (Array.isArray(list)) assert.equal(list.some((p) => String(p?.to ?? p).includes("private")), false);
    }
});

test("plan: notes are never in any list, whatever the repository holds", () => {
    const plan = up.plan(map({
        "Welcome.md": "a", "Projects/Freelance/Freelance.md": "b", "Reference/Planner/days/2026-09-16.md": "c",
        "Config/Scripts/tests/demo/renderReports.mjs": "d", [SCRIPT]: "e",
    }), map({ "Reference/Planner/days/2026-09-16.md": "my real note" }));
    assert.deepEqual(plain(plan.add), [SCRIPT]);
    for (const list of [plan.update, plan.local, plan.remove, plan.keep, plan.same]) assert.deepEqual(plain(list), []);
});

// ------------------------------------------------------------------ the Invoices base beside the invoices (OBS-112)

// The base as the repository keeps it (beside the demo's invoices), and its place in a vault with no
// invoice folder (where every version before OBS-112 put it)
const SRC = "Reference/Invoices/Invoices.base";
const BASE = "Config/Bases/Invoices.base";
const PLACED = "Business/Invoices/Invoices.base";

test("folderOf: reads Invoice Settings' `folder` exactly as Billing does", () => {
    const Billing = vm.runInContext(classScript("billing.js") + "\n;Billing", vm.createContext({}));
    const billing = new Billing();
    for (const raw of ["Business/Invoices", " /a//b/ ", "Business /Invoices", "a\nb", "Config/x", "archive", "x/Config", "", "  ", "/", null, undefined, "../x", "a/../b", ".obsidian", "a/.trash",
        "a/ /b", "C:\\x", "a\\b", "[[x]]", "x#1", "a|b", 2026, ["a"], { a: 1 }, true, "Business/Invoices 2026"]) {
        assert.deepEqual(plain(up.folderOf(raw)), plain(billing.folderOf(raw)), String(raw));
    }
});

test("placed: the Invoices base goes in the invoice folder, else in Config/Bases; everything else where it is", () => {
    const source = map({ [SCRIPT]: "a", [SRC]: "b", "Projects/Projects.base": "c" });
    const none = up.placed(source);
    assert.deepEqual(plain([...none.files]), [[SCRIPT, "a"], [BASE, "b"], ["Projects/Projects.base", "c"]]);
    assert.deepEqual(plain([...none.origin]), [[BASE, SRC]]);
    const there = up.placed(source, { invoiceFolder: "Business/Invoices" });
    assert.deepEqual(plain([...there.files]), [[SCRIPT, "a"], [PLACED, "b"], ["Projects/Projects.base", "c"]]);
    assert.deepEqual(plain([...there.origin]), [[PLACED, SRC]]);
    // the demo's own folder: where the repository keeps it already
    const same = up.placed(source, { invoiceFolder: "Reference/Invoices" });
    assert.deepEqual(plain([...same.files.keys()]), [SCRIPT, SRC, "Projects/Projects.base"]);
    assert.equal(same.origin.size, 0);
    // a folder that puts it onto another installed file, in any case, sends it to Config/Bases
    for (const invoiceFolder of ["Projects", "PROJECTS"]) {
        const clash = up.placed(map({ [SRC]: "b", "Projects/Invoices.base": "x" }), { invoiceFolder });
        assert.deepEqual(plain([...clash.files.keys()]), [BASE, "Projects/Invoices.base"], invoiceFolder);
    }
    // held, it's left out
    assert.deepEqual(plain([...up.placed(source, { invoiceFolder: "Business/Invoices", hold: true }).files.keys()]), [SCRIPT, "Projects/Projects.base"]);
});

test("plan: an old copy in Config/Bases that an older update stopped recording still moves", () => {
    // the command before OBS-112 drops the record of a base it kept because you'd sorted it
    const { files, origin } = up.placed(map({ [SRC]: "base" }), { invoiceFolder: "Business/Invoices" });
    const plan = up.plan(files, map({ [BASE]: "sorted" }), new Map(), origin);
    assert.deepEqual(plain([plan.move, plan.local, plan.add]), [[{ from: BASE, to: PLACED }], [PLACED], []]);
    // with no invoice folder it's already home
    const home = up.placed(map({ [SRC]: "base" }));
    const there = up.plan(home.files, map({ [BASE]: "sorted" }), new Map(), home.origin);
    assert.deepEqual(plain([there.move, there.local]), [[], [BASE]]);
});

test("plan: a base set to go elsewhere moves there as it is, then updates like any installed file", () => {
    const { files, origin } = up.placed(map({ [SCRIPT]: "new", [SRC]: "base" }), { invoiceFolder: "Business/Invoices" });
    const move = [{ from: BASE, to: PLACED }];
    // never changed: it moves, and it's what the repository has, so nothing else
    const plain1 = up.plan(files, map({ [SCRIPT]: "new", [BASE]: "base" }), map({ [SCRIPT]: "new", [BASE]: "base" }), origin);
    assert.deepEqual(plain([plain1.move, plain1.same]), [move, [PLACED, SCRIPT]]);
    assert.deepEqual(plain([plain1.add, plain1.update, plain1.local, plain1.remove, plain1.keep]), [[], [], [], [], []]);
    // an old version: it moves, then updates
    const old = up.plan(files, map({ [SCRIPT]: "new", [BASE]: "base v0" }), map({ [SCRIPT]: "new", [BASE]: "base v0" }), origin);
    assert.deepEqual(plain([old.move, old.update]), [move, [PLACED]]);
    // one you sorted or filtered (a base saves that into its file): it moves with your changes, and stays yours
    const edited = up.plan(files, map({ [SCRIPT]: "new", [BASE]: "sorted" }), map({ [SCRIPT]: "new", [BASE]: "base" }), origin);
    assert.deepEqual(plain([edited.move, edited.local, edited.keep, edited.add]), [move, [PLACED], [], []]);
    // a base of your own already at that place is never quietly overwritten, and the installed copy stays put
    const yours = up.plan(files, map({ [SCRIPT]: "new", [BASE]: "base", [PLACED]: "mine" }), map({ [SCRIPT]: "new", [BASE]: "base" }), origin);
    assert.deepEqual(plain([yours.move, yours.local, yours.remove]), [[], [PLACED], [BASE]]);
    // nothing installed before: it's new there
    const first = up.plan(files, map({ [SCRIPT]: "new" }), map({ [SCRIPT]: "new" }), origin);
    assert.deepEqual(plain([first.move, first.add]), [[], [PLACED]]);
    // once placed, it updates there
    const later = up.placed(map({ [SCRIPT]: "new", [SRC]: "base v2" }), { invoiceFolder: "Business/Invoices" });
    const update = up.plan(later.files, map({ [SCRIPT]: "new", [PLACED]: "base" }), map({ [SCRIPT]: "new", [PLACED]: "base" }), later.origin);
    assert.deepEqual(plain([update.update, update.add, update.remove, update.move]), [[PLACED], [], [], []]);
});

test("plan: a changed `folder` moves the base again, and a cleared one moves it back to Config", () => {
    const installed = map({ [PLACED]: "base" });
    const next = up.placed(map({ [SRC]: "base" }), { invoiceFolder: "Records/Invoices" });
    const moved = up.plan(next.files, installed, installed, next.origin);
    assert.deepEqual(plain([moved.move, moved.add, moved.remove]), [[{ from: PLACED, to: "Records/Invoices/Invoices.base" }], [], []]);
    const cleared = up.placed(map({ [SRC]: "base" }));
    const back = up.plan(cleared.files, installed, installed, cleared.origin);
    assert.deepEqual(plain([back.move, back.add, back.remove]), [[{ from: PLACED, to: BASE }], [], []]);
});

test("plan: a folder renamed only in case is the same folder, so the base is never removed from under itself", () => {
    // `folder` was Business/Invoices; the folder is renamed to Business/invoices and the setting follows.
    // On a Mac the old path still finds the same file.
    const now = up.placed(map({ [SRC]: "base" }), { invoiceFolder: "Business/invoices" });
    const at = "Business/invoices/Invoices.base";
    const plan = up.plan(now.files, map({ [at]: "base", [PLACED]: "base" }), map({ [PLACED]: "base" }), now.origin);
    assert.deepEqual(plain([plan.same, plan.remove, plan.keep, plan.move]), [[at], [], [], []]);
    // and the manifest takes the new spelling
    const after = up.manifestAfter(now.files, map({ [PLACED]: "base" }), up.steps(plan));
    assert.deepEqual(plain([...after]), [[at, "base"]]);
});

test("plan: a place outside what's installed counts only for the file placed there", () => {
    // without its origin, a path outside Config is a note's path, and never planned
    assert.deepEqual(plain(up.plan(map({ [PLACED]: "base" }), new Map()).add), []);
    assert.deepEqual(plain(up.plan(map({ [PLACED]: "base" }), new Map(), new Map(), map({ [PLACED]: SRC })).add), [PLACED]);
    // and an origin can't smuggle in a note
    assert.deepEqual(plain(up.plan(map({ "Welcome.md": "x" }), new Map(), new Map(), map({ "Welcome.md": "Welcome.md" })).add), []);
});

test("summary: says where the Invoices base goes, and what moves", () => {
    const plan = { add: [], update: [PLACED], local: [], remove: [], keep: [], same: [], move: [{ from: BASE, to: PLACED }] };
    const text = up.summary(plan, { invoiceFolder: "Business/Invoices" });
    assert.ok(text.includes("The Invoices base goes in `Business/Invoices`, the `folder` in Invoice Settings."), text);
    assert.ok(text.includes(`**Moved: 1** (to where it belongs now, as it is)\n- ${BASE} → ${PLACED}`), text);
    assert.ok(!up.summary(plan).includes("goes in"));
    assert.match(up.summary({ ...plan, move: [], update: [] }, { held: true }), /The Invoices base is left as it is this time/);
    // a move alone is something to do
    assert.doesNotMatch(up.summary({ ...plan, update: [] }), /Already up to date/);
});

test("steps: what gets copied and deleted follows the answers", () => {
    const plan = { add: ["a"], update: ["b"], local: ["c"], remove: ["d"], keep: ["e"], same: ["f"], move: [{ from: "g", to: "h" }] };
    assert.deepEqual(plain(up.steps(plan)), { move: [{ from: "g", to: "h" }], copy: ["a", "b"], delete: ["d"], same: ["f"] });
    // removing is the default, so asking only to overwrite still removes
    assert.deepEqual(plain(up.steps(plan, { overwriteLocal: true })).copy, ["a", "b", "c"]);
    assert.deepEqual(plain(up.steps(plan, { remove: false })).delete, []);
});

test("manifestAfter: records what's installed now, and forgets what the repository dropped", () => {
    const source = map({ [SCRIPT]: "new", [TEMPLATE]: "b" });
    const previous = map({ [SCRIPT]: "old", "Config/gone.md": "x", "Config/kept.md": "y" });
    const after = up.manifestAfter(source, previous, { copy: [SCRIPT], delete: ["Config/gone.md"] });
    assert.deepEqual(plain([...after]), [[SCRIPT, "new"]]);
    // a file left alone because it was changed here is dropped from the manifest too, since the
    // repository no longer has it: the next run sees it as the vault's own file
    assert.equal(after.has("Config/kept.md"), false);
});

test("manifestAfter: a file already up to date is recorded, so a later update reaches it (OBS-112)", () => {
    // put there by hand, or matching by chance: it was never recorded
    const source = map({ [SCRIPT]: "v1" });
    const after = up.manifestAfter(source, new Map(), up.steps(up.plan(source, map({ [SCRIPT]: "v1" }), new Map())));
    assert.deepEqual(plain([...after]), [[SCRIPT, "v1"]]);
    // so when the repository moves on, it's an update, not a change of yours
    const next = up.plan(map({ [SCRIPT]: "v2" }), map({ [SCRIPT]: "v1" }), after);
    assert.deepEqual(plain(next.update), [SCRIPT]);
});

test("manifestAfter: a moved file takes its record along; an edit of yours is still yours", () => {
    const source = map({ [PLACED]: "v2" });
    const steps = { move: [{ from: BASE, to: PLACED }], copy: [], delete: [], same: [] };
    const after = up.manifestAfter(source, map({ [BASE]: "v1" }), steps);
    assert.deepEqual(plain([...after]), [[PLACED, "v1"]]);
    // moved and updated: the repository's version
    assert.deepEqual(plain([...up.manifestAfter(source, map({ [BASE]: "v1" }), { ...steps, copy: [PLACED] })]), [[PLACED, "v2"]]);
});

test("summary: the decisions come first, and an up-to-date vault says so", () => {
    const plan = up.plan(map({ [SCRIPT]: "new" }), map({ [SCRIPT]: "new" }), map({ [SCRIPT]: "new" }));
    assert.match(up.summary(plan), /^Already up to date \(1 files\)\.$/);
    const busy = up.summary({ add: ["a"], update: ["b"], local: ["c"], remove: ["d"], keep: ["e"], same: [] },
        { source: "/Users/x/src/obsidian-pm", commit: "abc1234" });
    assert.match(busy, /^From `\/Users\/x\/src\/obsidian-pm` at abc1234\n\n\*\*Changed in this vault, would be overwritten: 1\*\*\n- c\n/);
    assert.ok(busy.includes("**New: 1**") && busy.includes("**Updated: 1**"));
    assert.ok(busy.includes("**Removed: 1** (the repository doesn't install these any more)"));
    assert.ok(busy.includes("**Kept, changed here since it was installed: 1**"));
});

test("summary: a first install says why everything looks changed", () => {
    const plan = { add: [], update: [], local: ["a"], remove: [], keep: [], same: [] };
    const first = up.summary(plan, { firstRun: true });
    assert.match(first, /No record of an earlier install here/);
    assert.ok(first.includes("**Differs from the repository: 1**"));
    assert.ok(!up.summary(plan).includes("No record of an earlier install"));
});

test("summary: a long list is cut and counted", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Config/f${String(i).padStart(2, "0")}.md`);
    const text = up.summary({ add: many, update: [], local: [], remove: [], keep: [], same: [] });
    assert.ok(text.includes("**New: 20**"));
    assert.equal(text.split("\n").filter((l) => l.startsWith("- Config/")).length, 8);
    assert.ok(text.includes("- …and 12 more"));
    // every path shows when it fits
    assert.equal(up.summary({ add: many.slice(0, 8), update: [], local: [], remove: [], keep: [], same: [] })
        .split("\n").filter((l) => l.startsWith("- ")).length, 8);
});

test("refusal: only main with a clean tree installs", () => {
    assert.equal(up.refusal({ branch: "main", commit: "abc1234", dirty: [] }), null);
    const branch = up.refusal({ branch: "me/obs-7-thing", commit: "abc1234", dirty: [] });
    assert.match(branch, /on branch `me\/obs-7-thing`, not `main`/);
    assert.match(branch, /dev-vault\.sh done/);
    const detached = up.refusal({ branch: "", commit: "abc1234", dirty: [] });
    assert.match(detached, /detached at abc1234/);
    const dirty = up.refusal({ branch: "main", commit: "abc1234", dirty: ["Welcome.md", "Reference/note.md"] });
    assert.match(dirty, /2 uncommitted changes \(Welcome\.md, …\)/);
    assert.match(up.refusal({ branch: "main", commit: "abc1234", dirty: ["Welcome.md"] }), /1 uncommitted change \(Welcome\.md\)/);
    // a note counts too: the whole tree is restored by `done`, and a rewritten note means it hasn't run
    assert.notEqual(up.refusal({ branch: "main", commit: "abc1234", dirty: ["Welcome.md"] }), null);
});

test("summary: files hidden from git in the clone are called out too", () => {
    const plan = { add: ["Config/a.md"], update: [], local: [], remove: [], keep: [], same: [] };
    const settings = SETTINGS;
    const text = up.summary(plan, { hidden: [settings, "Welcome.md"] });
    assert.ok(text.includes("**Hidden from git in the clone: 1** (skip-worktree: git shows no change, but this copies what's on disk)"));
    assert.ok(text.includes(`- ${settings}`));
    assert.ok(!up.summary(plan).includes("Hidden from git"));
});

test("done: what to say afterwards", () => {
    assert.equal(up.done({ copy: ["a", "b"], delete: ["c"] }, "abc1234"), "2 files copied, 1 removed (abc1234)");
    assert.equal(up.done({ copy: ["a"], delete: [] }), "1 file copied");
    assert.equal(up.done({ copy: [], delete: [] }), "Nothing to do");
    assert.equal(up.done({ move: [{ from: "a", to: "b" }], copy: ["b"], delete: [] }), "1 moved, 1 file copied");
});
