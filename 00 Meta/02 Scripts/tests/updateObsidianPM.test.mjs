// Tests for CustomJS/updateObsidianPM.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it; only the planning, which doesn't
// touch `app`, the file system or git, is tested.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const UpdateObsidianPM = vm.runInContext(
    fs.readFileSync(new URL("../CustomJS/updateObsidianPM.js", here), "utf8") + "\n;UpdateObsidianPM",
    vm.createContext({}),
);
const up = new UpdateObsidianPM();
const map = (o) => new Map(Object.entries(o));
// Objects made inside the vm context have that context's prototypes; compare as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

const SCRIPT = "00 Meta/02 Scripts/CustomJS/timeReport.js";
const TEMPLATE = "00 Meta/01 Templates/Task.md";
const SETTINGS = ".obsidian/plugins/customjs/data.json";

test("installs: the system, never notes, never the demo's own test files", () => {
    for (const path of [SCRIPT, TEMPLATE, SETTINGS, "README.md", "CLAUDE.md", "00 Meta/04 Bases/Projects.base",
        ".obsidian/daily-notes.json", ".obsidian/plugins/templater-obsidian/data.json"]) {
        assert.equal(up.installs(path), true, path);
    }
    for (const path of ["Welcome.md", "Projects/Freelance/Freelance.md", "30 Reference/36 Planner/days/2026-09-16.md",
        "90 Archive/Freelance/Marlowe Bakery Rebrand/Marlowe Bakery Rebrand.md", "10 Inbox/Desk lamp for the studio.md",
        ".gitignore", "CLAUDE.local.md", ".obsidian/app.json", ".obsidian/hotkeys.json", ".obsidian/types.json",
        "00 Meta/02 Scripts/tests/demoVault.test.mjs", "00 Meta/02 Scripts/tests/demo/renderReports.mjs"]) {
        assert.equal(up.installs(path), false, path);
    }
});

test("plan: a first install is all new", () => {
    const plan = up.plan(map({ [SCRIPT]: "a", [TEMPLATE]: "b", "Welcome.md": "c" }), new Map());
    assert.deepEqual(plain(plan.add), [TEMPLATE, SCRIPT]);
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
    const installed = map({ [SCRIPT]: "new", [TEMPLATE]: "old", "00 Meta/gone.md": "x" });
    const plan = up.plan(source, map({ [SCRIPT]: "new", [TEMPLATE]: "old", "00 Meta/gone.md": "edited" }), installed);
    assert.deepEqual(plain(plan.remove), [TEMPLATE]);
    assert.deepEqual(plain(plan.keep), ["00 Meta/gone.md"]);
    // a file the vault no longer has is neither
    const gone = up.plan(source, map({ [SCRIPT]: "new" }), installed);
    assert.deepEqual(plain([gone.remove, gone.keep]), [[], []]);
});

test("plan: notes are never in any list, whatever the repository holds", () => {
    const plan = up.plan(map({
        "Welcome.md": "a", "Projects/Freelance/Freelance.md": "b", "30 Reference/36 Planner/days/2026-09-16.md": "c",
        "00 Meta/02 Scripts/tests/demo/renderReports.mjs": "d", [SCRIPT]: "e",
    }), map({ "30 Reference/36 Planner/days/2026-09-16.md": "my real note" }));
    assert.deepEqual(plain(plan.add), [SCRIPT]);
    for (const list of [plan.update, plan.local, plan.remove, plan.keep, plan.same]) assert.deepEqual(plain(list), []);
});

test("steps: what gets copied and deleted follows the answers", () => {
    const plan = { add: ["a"], update: ["b"], local: ["c"], remove: ["d"], keep: ["e"], same: ["f"] };
    assert.deepEqual(plain(up.steps(plan)), { copy: ["a", "b"], delete: ["d"] });
    // removing is the default, so asking only to overwrite still removes
    assert.deepEqual(plain(up.steps(plan, { overwriteLocal: true })), { copy: ["a", "b", "c"], delete: ["d"] });
    assert.deepEqual(plain(up.steps(plan, { remove: false })), { copy: ["a", "b"], delete: [] });
});

test("manifestAfter: records what's installed now, and forgets what the repository dropped", () => {
    const source = map({ [SCRIPT]: "new", [TEMPLATE]: "b" });
    const previous = map({ [SCRIPT]: "old", "00 Meta/gone.md": "x", "00 Meta/kept.md": "y" });
    const after = up.manifestAfter(source, previous, { copy: [SCRIPT], delete: ["00 Meta/gone.md"] });
    assert.deepEqual(plain([...after]), [[SCRIPT, "new"]]);
    // a file left alone because it was changed here is dropped from the manifest too, since the
    // repository no longer has it: the next run sees it as the vault's own file
    assert.equal(after.has("00 Meta/kept.md"), false);
});

test("summary: the decisions come first, and an up-to-date vault says so", () => {
    const plan = up.plan(map({ [SCRIPT]: "new" }), map({ [SCRIPT]: "new" }), map({ [SCRIPT]: "new" }));
    assert.match(up.summary(plan), /^Already up to date \(1 files\)\.$/);
    const busy = up.summary({ add: ["a"], update: ["b"], local: ["c"], remove: ["d"], keep: ["e"], same: [] },
        { source: "/Users/x/src/obsidian-pm", commit: "abc1234" });
    assert.match(busy, /^From `\/Users\/x\/src\/obsidian-pm` at abc1234\n\n\*\*Changed in this vault, would be overwritten: 1\*\*\n- c\n/);
    assert.ok(busy.includes("**New: 1**") && busy.includes("**Updated: 1**"));
    assert.ok(busy.includes("**Removed: 1** (the repository no longer has these)"));
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
    const many = Array.from({ length: 20 }, (_, i) => `00 Meta/f${String(i).padStart(2, "0")}.md`);
    const text = up.summary({ add: many, update: [], local: [], remove: [], keep: [], same: [] });
    assert.ok(text.includes("**New: 20**"));
    assert.equal(text.split("\n").filter((l) => l.startsWith("- 00 Meta/")).length, 8);
    assert.ok(text.includes("- …and 12 more"));
    // every path shows when it fits
    assert.equal(up.summary({ add: many.slice(0, 8), update: [], local: [], remove: [], keep: [], same: [] })
        .split("\n").filter((l) => l.startsWith("- ")).length, 8);
});

test("summary: uncommitted files in the clone are called out, and only the ones it would copy", () => {
    const plan = { add: ["00 Meta/a.md"], update: [], local: [], remove: [], keep: [], same: [] };
    const text = up.summary(plan, { dirty: ["00 Meta/a.md", "Welcome.md", "30 Reference/note.md"] });
    assert.ok(text.includes("**Uncommitted in the clone: 1** (copied as they are on disk, not as the repository has them)"));
    assert.ok(text.includes("- 00 Meta/a.md"));
    assert.ok(!up.summary(plan).includes("Uncommitted in the clone"), "a clean clone says nothing");
    assert.ok(!up.summary(plan, { dirty: ["Welcome.md"] }).includes("Uncommitted in the clone"), "notes don't count");
});

test("summary: files hidden from git in the clone are called out too", () => {
    const plan = { add: ["00 Meta/a.md"], update: [], local: [], remove: [], keep: [], same: [] };
    const settings = ".obsidian/plugins/customjs/data.json";
    const text = up.summary(plan, { hidden: [settings, "Welcome.md"] });
    assert.ok(text.includes("**Hidden from git in the clone: 1** (skip-worktree: git shows no change, but this copies what's on disk)"));
    assert.ok(text.includes(`- ${settings}`));
    assert.ok(!up.summary(plan).includes("Hidden from git"));
});

test("done: what to say afterwards", () => {
    assert.equal(up.done({ copy: ["a", "b"], delete: ["c"] }, "abc1234"), "2 files copied, 1 removed (abc1234)");
    assert.equal(up.done({ copy: ["a"], delete: [] }), "1 file copied");
    assert.equal(up.done({ copy: [], delete: [] }), "Nothing to do");
});
