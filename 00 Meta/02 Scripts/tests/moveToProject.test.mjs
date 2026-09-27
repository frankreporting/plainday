// Tests for CustomJS/moveToProject.js and moveToProjectMenu.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// The classes are loaded with vm beside AddTaskNote, AddProjectLink and TimeReport, whose helpers
// they use through `customJS`, the way CustomJS evaluates them. The planning and the line edits
// are pure; the move itself runs against a small stand-in for the vault that records what was
// renamed and written. That checks the order of things and what's asked, not Obsidian's own move
// and link updates, which are checked in a dev vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const notices = [];
const logged = [];
const context = vm.createContext({
    customJS: {}, app: null, window: {}, setTimeout, clearTimeout,
    console: { ...console, info: (...a) => logged.push(a) },
    Notice: class { constructor(message) { notices.push(message); } },
});
const load = (file, name) => vm.runInContext(fs.readFileSync(new URL(`../CustomJS/${file}`, here), "utf8") + `\n;${name}`, context);
const AddTaskNote = load("addTaskNote.js", "AddTaskNote");
const AddProjectLink = load("addProjectLink.js", "AddProjectLink");
const TimeReport = load("timeReport.js", "TimeReport");
const MoveToProject = load("moveToProject.js", "MoveToProject");
const MoveToProjectMenu = load("moveToProjectMenu.js", "MoveToProjectMenu");

// Fresh instances on a stand-in vault. `notes` maps each path to its tags (null: no cache, as for
// a PDF); `texts` holds the text of the notes that get read; `links` is resolvedLinks.
function setup(notes, { texts = {}, links = {}, active = null } = {}) {
    const root = { path: "/", name: "", children: [], parent: null };
    const folders = [];
    const files = [];
    const folderAt = (path) => {
        if (!path) return root;
        let f = folders.find((d) => d.path === path);
        if (f) return f;
        const parent = folderAt(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
        f = { path, name: path.split("/").pop(), children: [], parent };
        parent.children.push(f);
        folders.push(f);
        return f;
    };
    const caches = new Map();
    for (const [path, props] of Object.entries(notes)) {
        const name = path.split("/").pop();
        const file = { path, name, basename: name.slice(0, name.lastIndexOf(".")), extension: name.slice(name.lastIndexOf(".") + 1) };
        file.parent = folderAt(path.slice(0, path.lastIndexOf("/")));
        file.parent.children.push(file);
        files.push(file);
        caches.set(file, props === null ? null : { frontmatter: { tags: props.tags ?? [], ...(props.completed ? { completed: true } : {}) } });
    }
    const byPath = (p) => [...files, ...folders].find((f) => f.path === p) ?? null;
    const done = { renamed: [], created: [], written: [] };
    const app = {
        vault: {
            getFileByPath: (p) => files.find((f) => f.path === p) ?? null,
            getAbstractFileByPath: byPath,
            getAbstractFileByPathInsensitive: (p) => [...files, ...folders].find((f) => f.path.toLowerCase() === p.toLowerCase()) ?? null,
            getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
            createFolder: async (p) => { done.created.push(p); folderAt(p); },
            read: async (f) => texts[f.path],
            process: async (f, fn) => { texts[f.path] = fn(texts[f.path]); done.written.push(f.path); },
        },
        metadataCache: {
            getFileCache: (f) => caches.get(f) ?? null,
            getFirstLinkpathDest: (linkpath) => files.find((f) => f.extension === "md"
                && (f.basename.toLowerCase() === linkpath.toLowerCase() || f.path.replace(/\.md$/, "") === linkpath)) ?? null,
            resolvedLinks: links,
        },
        fileManager: {
            renameFile: async (file, to) => {
                const from = file.path;
                done.renamed.push([from, to]);
                file.parent.children.splice(file.parent.children.indexOf(file), 1);
                for (const f of [...files, ...folders]) if (f.path.startsWith(`${from}/`)) f.path = to + f.path.slice(from.length);
                file.path = to;
                file.name = to.split("/").pop();
                if (!file.children) file.basename = file.name.slice(0, file.name.lastIndexOf("."));
                file.parent = folderAt(to.slice(0, to.lastIndexOf("/")));
                file.parent.children.push(file);
            },
        },
        workspace: { getActiveFile: () => (active ? byPath(active) : null), activeLeaf: null },
        plugins: { enabledPlugins: new Set(["customjs"]), plugins: {} },
    };
    context.app = app;
    const helper = new AddTaskNote();
    const mover = new MoveToProject();
    context.customJS.AddTaskNote = helper;
    context.customJS.AddProjectLink = new AddProjectLink();
    context.customJS.TimeReport = new TimeReport();
    context.customJS.MoveToProject = mover;
    const snapshotted = [];
    context.customJS.RefoldDailyNotes = { onLeave: async (f) => { snapshotted.push(f.path); } };
    notices.length = 0;
    logged.length = 0;
    const asked = { picker: [], confirm: [] };
    // The menu and the confirm answer as told; `pick` is a path, or null for Esc
    const answer = ({ pick = null, confirm = "move" } = {}) => {
        helper.pickHome = async (name, preferred, options) => { asked.picker.push({ name, options }); return pick && byPath(pick); };
        helper.confirmMove = async (note, from, to) => { asked.confirm.push([note.basename, from?.basename ?? null, to.basename]); return confirm; };
    };
    return { app, helper, mover, file: byPath, done, texts, asked, answer, snapshotted };
}

// A demo-shaped vault: an area with two projects, one with a sub-project and logs, an Inbox log
const VAULT = {
    "Projects/Freelance/Freelance.md": { tags: ["area"] },
    "Projects/Freelance/Kestrel/Kestrel.md": { tags: ["project"] },
    "Projects/Freelance/Kestrel/Draft wireframes.md": { tags: ["task"] },
    "Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md": { tags: ["log"] },
    "Projects/Freelance/Kestrel/Catalog/Catalog.md": { tags: ["project"] },
    "Projects/Freelance/Kestrel/Catalog/Shot list.md": { tags: ["task"] },
    "Projects/Freelance/Pinecrest/Pinecrest.md": { tags: ["project"] },
    "Projects/Freelance/Pinecrest/Write copy.md": { tags: ["task"] },
    "Projects/Household/Household.md": { tags: ["area"] },
    "Projects/Household/Car checklist.md": { tags: ["project"] },
    "10 Inbox/2026-09-18 Printer call.md": { tags: ["log"] },
    "10 Inbox/Loose idea.md": { tags: [] },
    "00 Meta/Manual.md": { tags: [] },
    "30 Reference/36 Planner/days/2026-09-18.md": { tags: [] },
    "30 Reference/36 Planner/days/2026-09-14.md": { tags: [] },
    "90 Archive/Freelance/Marlowe/Marlowe.md": { tags: ["project"], completed: true },
    "90 Archive/Freelance/Marlowe/Final invoice.md": { tags: ["task"] },
};
const DAY = "30 Reference/36 Planner/days/2026-09-14.md";
const item = (path, more = {}) => ({ path, name: path.split("/").pop(), folder: false, log: false, homeFolder: null, ...more });

test("plan: a note goes into the project's folder, a log into its logs/, a project as its whole folder", () => {
    const { mover } = setup({});
    const [note, log, folder] = mover.plan([
        item("10 Inbox/Loose idea.md"),
        item("10 Inbox/2026-09-18 Printer call.md", { log: true }),
        item("Projects/Freelance/Kestrel/Catalog", { folder: true }),
    ], "Projects/Household", () => false);
    assert.deepEqual([note.to, note.skip], ["Projects/Household/Loose idea.md", null]);
    assert.deepEqual([log.to, log.skip], ["Projects/Household/logs/2026-09-18 Printer call.md", null]);
    assert.deepEqual([folder.to, folder.skip], ["Projects/Household/Catalog", null]);
    const [spelled] = mover.plan([item("10 Inbox/2026-09-18 Printer call.md", { log: true })], "Projects/Household", () => false, "Projects/Household/Logs");
    assert.equal(spelled.to, "Projects/Household/Logs/2026-09-18 Printer call.md", "a logs folder spelled another way is used as it is");
});

test("plan: already there is a skip, not a move; nothing is pulled up out of a folder in its own project", () => {
    const { mover } = setup({});
    const skips = (items, into) => mover.plan(items, into, () => false).map((s) => s.skip);
    const P = "Projects/Freelance/Pinecrest";
    assert.deepEqual(skips([item(`${P}/Write copy.md`, { homeFolder: P })], P), ["here"]);
    assert.deepEqual(skips([item(`${P}/Drafts/Write copy.md`, { homeFolder: P })], P), ["here"], "in a plain folder inside the project: already in it");
    assert.deepEqual(skips([item(`${P}/Drafts/brief.pdf`, { homeFolder: P })], P), ["here"], "any file");
    assert.deepEqual(skips([item(`${P}/logs/2026-09-02 Kickoff.md`, { log: true, homeFolder: P })], P), ["here"]);
    assert.deepEqual(skips([item(`${P}/logs/2025/2025-03-02 Kickoff.md`, { log: true, homeFolder: P })], P), ["here"], "a log in a folder inside logs/");
    // A log that's in its project but not in its logs/ gets filed there
    assert.deepEqual(skips([item(`${P}/2026-09-02 Kickoff.md`, { log: true, homeFolder: P })], P), [null]);
    assert.deepEqual(skips([item("Projects/Freelance/Kestrel", { folder: true })], "Projects/Freelance"), ["here"]);
    // Something with no project worked out is still already there when it's at the very path
    assert.deepEqual(skips([item("Projects/Household/Car checklist.md")], "Projects/Household"), ["here"]);
    // A sub-project's note moved up to its parent does move
    assert.deepEqual(skips([item("Projects/Freelance/Kestrel/Catalog/Shot list.md", { homeFolder: "Projects/Freelance/Kestrel/Catalog" })], "Projects/Freelance/Kestrel"), [null]);
});

test("plan: a folder can't go into itself or anything inside it", () => {
    const { mover } = setup({});
    const K = item("Projects/Freelance/Kestrel", { folder: true });
    assert.equal(mover.plan([K], "Projects/Freelance/Kestrel", () => false)[0].skip, "loop");
    assert.equal(mover.plan([K], "Projects/Freelance/Kestrel/Catalog", () => false)[0].skip, "loop");
    assert.equal(mover.plan([K], "Projects/Freelance/Kestrel 2", () => false)[0].skip, null, "a sibling whose name starts the same isn't inside it");
});

test("plan: a name already at the target clashes, in any case, and so does a second item going to the same place", () => {
    const { mover } = setup({});
    const taken = new Set(["projects/household/loose idea.md"]);
    const steps = mover.plan([item("10 Inbox/Loose Idea.md"), item("10 Inbox/Budget.md"), item("30 Reference/Budget.md")],
        "Projects/Household", (p) => taken.has(p.toLowerCase()));
    assert.deepEqual(steps.map((s) => s.skip), ["clash", null, "clash"]);
});

test("plan: what's inside a folder that's moving goes along with it, whatever order they come in", () => {
    const { mover } = setup({});
    const steps = mover.plan([
        item("Projects/Freelance/Kestrel/Catalog/Shot list.md", { homeFolder: "Projects/Freelance/Kestrel/Catalog" }),
        item("Projects/Freelance/Kestrel", { folder: true }),
        item("Projects/Freelance/Kestrel/Catalog", { folder: true }),
    ], "Projects/Household", () => false);
    assert.deepEqual(steps.map((s) => s.skip), ["inside", null, "inside"]);
});

test("unlinkStale: only a link to the project the note left comes off; the lines' other ⭕s are their own", () => {
    const { mover, file } = setup(VAULT);
    const resolve = (l) => context.app.metadataCache.getFirstLinkpathDest(l);
    const note = file("Projects/Freelance/Kestrel/Draft wireframes.md");
    const [kestrel, pinecrest] = [file("Projects/Freelance/Kestrel/Kestrel.md"), file("Projects/Freelance/Pinecrest/Pinecrest.md")];
    const text = [
        "- [/] Draft wireframes [[Draft wireframes|🔗]] [[Kestrel|⭕]]",
        "\t- [ ] Sub-task [[Draft wireframes|🔗]] [[Household|🗃️]]",
        "- [ ] Draft wireframes [[Draft wireframes|🔗]] [[Pinecrest|⭕]]",
        "- [ ] Other task [[Write copy|🔗]] [[Kestrel|⭕]]",
        "- [ ] Draft wireframes [[Draft wireframes|🔗]] [[Gone project|⭕]]",
        "Draft wireframes [[Draft wireframes|🔗]] [[Kestrel|⭕]]",
        "- [x] Two of them [[Draft wireframes|🔗]] [[Kestrel|⭕]] [[Household|🗃️]]",
        "",
    ].join("\n");
    const out = mover.unlinkStale(text, note, kestrel, pinecrest, resolve);
    assert.deepEqual(out.text.split("\n"), [
        "- [/] Draft wireframes [[Draft wireframes|🔗]]",
        "\t- [ ] Sub-task [[Draft wireframes|🔗]] [[Household|🗃️]]",
        "- [ ] Draft wireframes [[Draft wireframes|🔗]] [[Pinecrest|⭕]]",
        "- [ ] Other task [[Write copy|🔗]] [[Kestrel|⭕]]",
        "- [ ] Draft wireframes [[Draft wireframes|🔗]] [[Gone project|⭕]]",
        "Draft wireframes [[Draft wireframes|🔗]] [[Kestrel|⭕]]",
        "- [x] Two of them [[Draft wireframes|🔗]] [[Household|🗃️]]",
        "",
    ], "a 🗃️ for somewhere else, the new home's ⭕, another note's line, a broken link and a line that isn't a checklist item are left");
    assert.equal(out.unlinked, 2);
    assert.equal(out.kept, 2, "the Household lines still count elsewhere");
    assert.deepEqual([mover.unlinkStale(text, note, null, pinecrest, resolve).unlinked, mover.unlinkStale(text, note, pinecrest, pinecrest, resolve).unlinked], [0, 0],
        "a note that had no project, or didn't leave one, takes nothing off");
});

test("unlinkStale: event lines, timed or not; code blocks, comments and line endings are left as they are", () => {
    const { mover, file } = setup(VAULT);
    const resolve = (l) => context.app.metadataCache.getFirstLinkpathDest(l);
    const log = file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md");
    const [kestrel, pinecrest] = [file("Projects/Freelance/Kestrel/Kestrel.md"), file("Projects/Freelance/Pinecrest/Pinecrest.md")];
    const strip = (text) => mover.unlinkStale(text, log, kestrel, pinecrest, resolve).text;
    assert.equal(strip("- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\n- 10:45am\n"),
        "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]]\n- 10:45am\n");
    assert.equal(strip("- [<] [[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]"), "- [<] [[2026-09-14 Homepage review|Homepage review]]",
        "a log's line from before its event arrived");
    const hidden = "```\n- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\n```\n"
        + "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] %%billed [[Kestrel|⭕]]%%\n";
    assert.equal(strip(hidden), hidden);
    assert.equal(strip("- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\r\n- 10:45am\r\n"),
        "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]]\r\n- 10:45am\r\n");
    // A comment on the line: the link outside it comes off and the comment stays; a link the
    // comment repeats is left, and the line counts as keeping it
    assert.equal(strip("- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]] %%billed 9/30%%"),
        "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] %%billed 9/30%%");
    const twice = "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]] %%was [[Kestrel|⭕]]%%";
    const out = mover.unlinkStale(twice, log, kestrel, pinecrest, resolve);
    assert.deepEqual([out.text, out.unlinked, out.kept], [twice, 0, 1]);
});

test("unlinkStale: right after a move, a lookup by name can return a stale entry at the old path; it still counts as the note", () => {
    // Seen in a vault with a rename-handling plugin: for under 50ms after a move, the vault holds a
    // second entry at the old path, and a lookup by name returns it when its path is shorter
    const { mover, file } = setup(VAULT);
    const oldPath = "Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md";
    // The log, moved into the catalog's logs/
    const log = { path: "Projects/Freelance/Kestrel/Catalog/logs/2026-09-14 Homepage review.md", basename: "2026-09-14 Homepage review", extension: "md" };
    const [kestrel, catalog] = [file("Projects/Freelance/Kestrel/Kestrel.md"), file("Projects/Freelance/Kestrel/Catalog/Catalog.md")];
    const stale = { path: oldPath, basename: log.basename, extension: "md" };
    const resolve = (l) => (l === "2026-09-14 Homepage review" ? stale : context.app.metadataCache.getFirstLinkpathDest(l));
    const text = "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\n";
    assert.equal(mover.unlinkStale(text, log, kestrel, catalog, resolve).unlinked, 0, "without the old path, the stale entry isn't recognised");
    const out = mover.unlinkStale(text, log, kestrel, catalog, resolve, oldPath);
    assert.equal(out.text, "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]]\n");
    const other = { path: "Projects/Elsewhere/2026-09-14 Homepage review.md", basename: log.basename, extension: "md" };
    assert.equal(mover.unlinkStale(text, log, kestrel, catalog, () => other, oldPath).unlinked, 0, "a same-named note elsewhere is not the note");
});

test("move: a stale entry at the old path right after the move doesn't stop the ⭕ coming off", async () => {
    const t = setup(VAULT, {
        texts: { [DAY]: "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\n" },
        links: { [DAY]: { "Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md": 1 } },
    });
    const log = t.file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md");
    const oldPath = log.path;
    // After the rename, a lookup by name returns a stale entry at the old path, as the real vault did
    const lookup = t.app.metadataCache.getFirstLinkpathDest;
    const rename = t.app.fileManager.renameFile;
    t.app.fileManager.renameFile = async (f, to) => {
        await rename(f, to);
        t.app.metadataCache.getFirstLinkpathDest = (l) => (l === log.basename ? { path: oldPath, basename: log.basename, extension: "md" } : lookup(l));
    };
    t.answer({ pick: "Projects/Freelance/Kestrel/Catalog/Catalog.md" });
    await t.mover.move([log]);
    assert.deepEqual(t.done.renamed, [[oldPath, "Projects/Freelance/Kestrel/Catalog/logs/2026-09-14 Homepage review.md"]]);
    assert.equal(t.texts[DAY], "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]]\n");
    assert.deepEqual(notices, ["Moved 2026-09-14 Homepage review to Projects/Freelance/Kestrel/Catalog/logs. Took the ⭕ Kestrel off 1 line linking it"]);
});

test("itemFor: a project or area's folder note moves as its folder, finished or not; other notes by themselves", () => {
    const { mover, file } = setup({ ...VAULT, "Projects/Freelance/Pinecrest/doc.pdf": null, "Projects/Freelance/Plain/Plain.md": { tags: [] } });
    const K = mover.itemFor(file("Projects/Freelance/Kestrel/Kestrel.md"));
    assert.deepEqual([K.path, K.folder, K.home, K.label, K.from.basename, K.note.basename], ["Projects/Freelance/Kestrel", true, true, "Kestrel", "Freelance", "Kestrel"]);
    assert.equal(mover.itemFor(file("Projects/Freelance/Kestrel")).path, "Projects/Freelance/Kestrel", "the folder itself");
    assert.equal(mover.itemFor(file("90 Archive/Freelance/Marlowe/Marlowe.md")).folder, true, "a finished project too");
    const car = mover.itemFor(file("Projects/Household/Car checklist.md"));
    assert.deepEqual([car.folder, car.home, car.from.basename], [false, true, "Household"], "a project note with no folder of its own moves alone");
    assert.equal(mover.itemFor(file("Projects/Freelance/Plain")), null, "a folder that isn't a project's or an area's");
    const task = mover.itemFor(file("Projects/Freelance/Kestrel/Draft wireframes.md"));
    assert.deepEqual([task.folder, task.home, task.log, task.homeFolder, task.label], [false, false, false, "Projects/Freelance/Kestrel", "Draft wireframes"]);
    assert.equal(mover.itemFor(file("10 Inbox/2026-09-18 Printer call.md")).log, true, "tagged #log, outside any logs/ folder");
    const pdf = mover.itemFor(file("Projects/Freelance/Pinecrest/doc.pdf"));
    assert.deepEqual([pdf.log, pdf.label, pdf.homeFolder], [false, "doc.pdf", "Projects/Freelance/Pinecrest"]);
    assert.ok(mover.movable([file("10 Inbox/Loose idea.md")]));
    assert.ok(!mover.movable([file("00 Meta/Manual.md")]), "the system stays put");
    assert.ok(!mover.movable([file("30 Reference/36 Planner/days/2026-09-18.md")]), "so do daily notes");
    assert.ok(!mover.movable([file("90 Archive/Freelance/Marlowe/Final invoice.md")]), "and archived work");
    assert.ok(!mover.movable([file("Projects/Freelance/Plain")]));
    assert.ok(mover.movable([file("Projects/Freelance/Kestrel/Kestrel.md")]));
    assert.ok(!mover.movable([file("Projects/Freelance/Kestrel/Kestrel.md")], { homes: false }), "not from a link's menu");
});

test("move: a task note leaving its project asks, and the lines' ⭕ for that project comes off", async () => {
    const t = setup(VAULT, {
        texts: { [DAY]: "- [x] Draft wireframes [[Draft wireframes|🔗]] [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n- [x] Billed elsewhere [[Draft wireframes|🔗]] [[Household|🗃️]]\n" },
        links: { [DAY]: { "Projects/Freelance/Kestrel/Draft wireframes.md": 1 } },
    });
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    await t.mover.move([t.file("Projects/Freelance/Kestrel/Draft wireframes.md")]);
    assert.equal(t.asked.picker[0].options.placeholder, 'Move "Draft wireframes" to which project or area? (Esc: cancel)');
    assert.deepEqual(t.asked.confirm, [["Draft wireframes", "Kestrel", "Pinecrest"]]);
    assert.deepEqual(t.done.renamed, [["Projects/Freelance/Kestrel/Draft wireframes.md", "Projects/Freelance/Pinecrest/Draft wireframes.md"]]);
    assert.equal(t.texts[DAY], "- [x] Draft wireframes [[Draft wireframes|🔗]]\n\t- 9:00am - 10:00am\n- [x] Billed elsewhere [[Draft wireframes|🔗]] [[Household|🗃️]]\n");
    assert.deepEqual(notices, ["Moved Draft wireframes to Projects/Freelance/Pinecrest. Took the ⭕ Kestrel off 1 line linking it. A line linking it has 🗃️ Household too, so that line's time still counts there, not in Pinecrest"]);
    assert.deepEqual(logged.map((a) => Array.from(a[1])), [[DAY]], "the notes changed go to the console");
    assert.deepEqual(t.snapshotted, [DAY], "and their fold snapshot is taken again");
});

test("move: Leave it and Esc on the confirm change nothing", async () => {
    const t = setup(VAULT);
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md", confirm: "leave" });
    await t.mover.move([t.file("Projects/Freelance/Kestrel/Draft wireframes.md")]);
    assert.deepEqual(t.done.renamed, []);
    assert.deepEqual(notices, ["Draft wireframes stays in Kestrel, so nothing changed"]);

    const again = setup(VAULT);
    again.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md", confirm: null });
    await again.mover.move([again.file("Projects/Freelance/Kestrel/Draft wireframes.md")]);
    assert.deepEqual(again.done.renamed, []);
    assert.deepEqual(notices, ["Nothing was moved"]);
});

test("move: an Inbox log goes to the project's logs/ without asking, and a ⭕ its line already had stays", async () => {
    const daily = "30 Reference/36 Planner/days/2026-09-18.md";
    const t = setup(VAULT, {
        texts: { [daily]: "- [<] 2:00pm\t[[2026-09-18 Printer call|Printer call]] [[Kestrel|⭕]]\n- 2:30pm\n" },
        links: { [daily]: { "10 Inbox/2026-09-18 Printer call.md": 1, "Projects/Freelance/Kestrel/Kestrel.md": 1 } },
    });
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    await t.mover.move([t.file("10 Inbox/2026-09-18 Printer call.md")]);
    assert.deepEqual(t.asked.confirm, [], "it had no project to leave");
    assert.deepEqual(t.done.created, ["Projects/Freelance/Pinecrest/logs"]);
    assert.deepEqual(t.done.renamed, [["10 Inbox/2026-09-18 Printer call.md", "Projects/Freelance/Pinecrest/logs/2026-09-18 Printer call.md"]]);
    assert.deepEqual(t.done.written, [], "the line's ⭕ is its own choice");
    assert.deepEqual(notices, ["Moved 2026-09-18 Printer call to Projects/Freelance/Pinecrest/logs. A line linking it has ⭕ Kestrel too, so that line's time still counts there, not in Pinecrest"]);
});

test("move: a note with no project and nothing counting elsewhere moves without asking or writing", async () => {
    const t = setup(VAULT, { texts: { [DAY]: "- [ ] Loose idea [[Loose idea|🔗]]\n" }, links: { [DAY]: { "10 Inbox/Loose idea.md": 1 } } });
    t.answer({ pick: "Projects/Household/Household.md" });
    await t.mover.move([t.file("10 Inbox/Loose idea.md")]);
    assert.deepEqual(t.asked.confirm, []);
    assert.deepEqual(t.done.renamed, [["10 Inbox/Loose idea.md", "Projects/Household/Loose idea.md"]]);
    assert.deepEqual(t.done.written, []);
    assert.deepEqual(notices, ["Moved Loose idea to Projects/Household"]);
});

test("move: a project asks as a project, moves its whole folder, and the menu leaves out it and what's inside it", async () => {
    const t = setup(VAULT, { texts: { [DAY]: "- [x] Shots [[Shot list|🔗]] [[Kestrel|⭕]]\n" }, links: { [DAY]: { "Projects/Freelance/Kestrel/Catalog/Shot list.md": 1 } } });
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    const [kestrel, catalog, car, pinecrest, freelance] = ["Freelance/Kestrel/Kestrel", "Freelance/Kestrel/Catalog/Catalog",
        "Household/Car checklist", "Freelance/Pinecrest/Pinecrest", "Freelance/Freelance"].map((p) => t.file(`Projects/${p}.md`));
    // What the menu leaves out, read while it's open
    let excluded;
    const pick = t.helper.pickHome;
    t.helper.pickHome = async (...a) => { excluded = [kestrel, catalog, car, pinecrest, freelance].map(a[2].exclude); return pick(...a); };
    await t.mover.move([kestrel]);
    assert.deepEqual(Array.from(excluded), [true, true, true, false, false], "itself, its sub-project, and a project note with no folder to hold anything");
    assert.deepEqual(t.asked.confirm, [["Kestrel", "Freelance", "Pinecrest"]], "its parent's totals and any rate it inherits change");
    assert.deepEqual(t.done.renamed, [["Projects/Freelance/Kestrel", "Projects/Freelance/Pinecrest/Kestrel"]]);
    assert.equal(t.file("Projects/Freelance/Pinecrest/Kestrel/Catalog/Shot list.md")?.name, "Shot list.md", "its notes came along");
    assert.deepEqual(t.done.written, [], "its notes keep their project, so their lines are left alone");
    assert.deepEqual(notices, ["Moved Kestrel with everything in it to Projects/Freelance/Pinecrest"]);
});

test("move: an area at the top asks with no From", async () => {
    const t = setup(VAULT);
    t.answer({ pick: "Projects/Freelance/Freelance.md" });
    await t.mover.move([t.file("Projects/Household/Household.md")]);
    assert.deepEqual(t.asked.confirm, [["Household", null, "Freelance"]]);
    assert.deepEqual(t.done.renamed, [["Projects/Household", "Projects/Freelance/Household"]]);
});

test("move: a clash is refused with a notice, and so is a note already there", async () => {
    const t = setup({ ...VAULT, "10 Inbox/Write copy.md": { tags: ["task"] } });
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    await t.mover.move([t.file("10 Inbox/Write copy.md")]);
    assert.deepEqual(t.done.renamed, []);
    assert.deepEqual(notices, ["Projects/Freelance/Pinecrest already has a note named Write copy, so it wasn't moved"]);

    const there = setup(VAULT);
    there.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    await there.mover.move([there.file("Projects/Freelance/Pinecrest/Write copy.md")]);
    assert.deepEqual(there.done.renamed, []);
    assert.deepEqual(notices, ["Write copy is already in Pinecrest"]);
});

test("move: a project that moved while the confirm was open isn't filled in at its old path", async () => {
    const t = setup(VAULT);
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    t.helper.confirmMove = async () => { await t.app.fileManager.renameFile(t.file("Projects/Freelance/Pinecrest"), "Projects/Household/Pinecrest"); return "move"; };
    await t.mover.move([t.file("Projects/Freelance/Kestrel/Draft wireframes.md")]);
    assert.deepEqual(t.done.renamed, [["Projects/Freelance/Pinecrest", "Projects/Household/Pinecrest"]], "only the move made meanwhile");
    assert.deepEqual(t.done.created, []);
    assert.deepEqual(notices, ["Draft wireframes or Pinecrest moved meanwhile, so Draft wireframes wasn't moved"]);
});

test("move: several at once don't ask; a note inside a moving project goes along; the notice counts them", async () => {
    const t = setup(VAULT);
    t.answer({ pick: "Projects/Household/Household.md" });
    await t.mover.move([
        t.file("Projects/Freelance/Pinecrest/Write copy.md"),
        t.file("Projects/Freelance/Kestrel/Catalog/Shot list.md"),
        t.file("Projects/Freelance/Kestrel/Catalog/Catalog.md"),
        t.file("00 Meta/Manual.md"),
    ]);
    assert.equal(t.asked.picker[0].options.placeholder, 'Move "3 items" to which project or area? (Esc: cancel)');
    assert.deepEqual(t.asked.confirm, []);
    assert.deepEqual(t.done.renamed, [
        ["Projects/Freelance/Pinecrest/Write copy.md", "Projects/Household/Write copy.md"],
        ["Projects/Freelance/Kestrel/Catalog", "Projects/Household/Catalog"],
    ]);
    assert.deepEqual(notices, ["Moved 1 note and 1 folder to Household", "Manual stays where it is: nothing in 00 Meta, 36 Planner or 90 Archive is moved"]);
});

test("move: Esc in the menu changes nothing, and nothing movable means no menu at all", async () => {
    const t = setup(VAULT);
    t.answer({ pick: null });
    await t.mover.move([t.file("10 Inbox/Loose idea.md")]);
    assert.deepEqual(t.done.renamed, []);
    assert.deepEqual(notices, ["No project or area picked, so nothing changed"]);

    const kept = setup(VAULT);
    kept.answer({ pick: "Projects/Household/Household.md" });
    await kept.mover.move([kept.file("30 Reference/36 Planner/days/2026-09-18.md"), kept.file("90 Archive/Freelance/Marlowe/Marlowe.md")]);
    assert.deepEqual(kept.asked.picker, []);
    assert.deepEqual(notices, ["2026-09-18 stays where it is: nothing in 00 Meta, 36 Planner or 90 Archive is moved\nMarlowe stays where it is: nothing in 00 Meta, 36 Planner or 90 Archive is moved"]);
});

test("invoke: the note you're on, or Notebook Navigator's selection while it has the focus", () => {
    const t = setup(VAULT, { active: "10 Inbox/Loose idea.md" });
    assert.deepEqual(Array.from(t.mover.selected(), (f) => f.path), ["10 Inbox/Loose idea.md"]);
    const picked = [t.file("Projects/Freelance/Pinecrest/Write copy.md"), t.file("10 Inbox/2026-09-18 Printer call.md")];
    t.app.plugins.plugins["notebook-navigator"] = { api: { selection: { getCurrent: () => ({ files: picked, focused: picked[0] }) } } };
    assert.deepEqual(Array.from(t.mover.selected(), (f) => f.path), ["10 Inbox/Loose idea.md"], "the navigator doesn't have the focus");
    t.app.workspace.activeLeaf = { view: { getViewType: () => "notebook-navigator" } };
    assert.deepEqual(t.mover.selected(), picked);
});

// Workspace events and Notebook Navigator's menu API, just enough to see what's registered
function menus(t, { navigator = true } = {}) {
    const events = [];
    t.app.workspace.on = (name, fn) => { const ref = { name, fn }; events.push(ref); return ref; };
    t.app.workspace.offref = (ref) => events.splice(events.indexOf(ref), 1);
    const nn = { file: new Set(), folder: new Set() };
    const makeApi = () => ({ menus: {
        registerFileMenu: (fn) => { nn.file.add(fn); return () => nn.file.delete(fn); },
        registerFolderMenu: (fn) => { nn.folder.add(fn); return () => nn.folder.delete(fn); },
    } });
    t.app.plugins.enabledPlugins.add("notebook-navigator");
    t.app.plugins.plugins["notebook-navigator"] = navigator ? { api: makeApi() } : {};
    const on = (name) => events.find((e) => e.name === name).fn;
    // What a menu shows, through an event or an extension
    const titles = (register) => {
        const shown = [];
        const item = { setTitle(title) { shown.push(title); return item; }, setIcon() { return item; }, onClick() { return item; } };
        register((build) => build(item));
        return shown;
    };
    return { events, nn, makeApi, on, titles };
}

test("MoveToProjectMenu: adds the item to Obsidian's file menus and Notebook Navigator's, once, and only for what moves", async () => {
    const t = setup(VAULT);
    const m = menus(t);
    const menu = new MoveToProjectMenu();
    await menu.invoke();
    await menu.invoke();   // CustomJS runs startup scripts again when a script changes
    assert.deepEqual(m.events.map((e) => e.name), ["file-menu", "files-menu", "layout-change"]);
    assert.equal(m.nn.file.size, 1);
    assert.equal(m.nn.folder.size, 1);

    const fileMenu = (file, source = "more-options") => m.titles((addItem) => m.on("file-menu")({ addItem }, file, source));
    assert.deepEqual(fileMenu(t.file("10 Inbox/Loose idea.md")), ["Move to project…"]);
    assert.deepEqual(fileMenu(t.file("00 Meta/Manual.md")), []);
    assert.deepEqual(fileMenu(t.file("Projects/Freelance/Kestrel/Kestrel.md")), ["Move to project…"]);
    assert.deepEqual(fileMenu(t.file("Projects/Freelance/Kestrel/Kestrel.md"), "link-context-menu"), [], "a ⭕ link's menu doesn't offer to move the project");
    assert.deepEqual(fileMenu(t.file("10 Inbox/Loose idea.md"), "link-context-menu"), ["Move to project…"]);
    const filesMenu = (files) => m.titles((addItem) => m.on("files-menu")({ addItem }, files));
    assert.deepEqual(filesMenu([t.file("00 Meta/Manual.md"), t.file("10 Inbox/Loose idea.md")]), ["Move to project…"]);
    const [nnFile] = m.nn.file;
    const [nnFolder] = m.nn.folder;
    assert.deepEqual(m.titles((addItem) => nnFile({ addItem, file: t.file("10 Inbox/Loose idea.md"), selection: { mode: "single", files: [t.file("10 Inbox/Loose idea.md")] } })), ["Move to project…"]);
    assert.deepEqual(m.titles((addItem) => nnFolder({ addItem, folder: t.file("Projects/Freelance/Kestrel") })), ["Move to project…"]);
    assert.deepEqual(m.titles((addItem) => nnFolder({ addItem, folder: t.file("Projects/Freelance/Kestrel/logs") })), [], "a plain folder");

    t.app.plugins.enabledPlugins.delete("customjs");
    assert.deepEqual(fileMenu(t.file("10 Inbox/Loose idea.md")), [], "CustomJS switched off: no item");

    menu.deconstructor();
    assert.deepEqual(m.events, []);
    assert.equal(m.nn.file.size + m.nn.folder.size, 0);
});

test("MoveToProjectMenu: waits for Notebook Navigator to finish loading, and follows it when it reloads", async () => {
    const t = setup(VAULT);
    const m = menus(t, { navigator: false });
    MoveToProjectMenu.RETRY_MS = 5;
    const menu = new MoveToProjectMenu();
    await menu.invoke();
    assert.equal(m.nn.file.size, 0);
    m.on("layout-change")();   // Obsidian changes the layout often while it starts: the retry keeps going
    t.app.plugins.plugins["notebook-navigator"] = { api: m.makeApi() };
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual([m.nn.file.size, m.nn.folder.size], [1, 1]);
    m.on("layout-change")();
    assert.deepEqual([m.nn.file.size, m.nn.folder.size], [1, 1], "the same API: nothing added twice");
    // Reloaded: a new API object that knows nothing of our items
    m.nn.file.clear();
    m.nn.folder.clear();
    t.app.plugins.plugins["notebook-navigator"] = { api: m.makeApi() };
    m.on("layout-change")();
    assert.deepEqual([m.nn.file.size, m.nn.folder.size], [1, 1]);
    menu.deconstructor();
});

test("MoveToProject and MoveToProjectMenu are registered, the menus before the time report's startup run", () => {
    const settings = JSON.parse(fs.readFileSync(new URL("../../../.obsidian/plugins/customjs/data.json", here), "utf8"));
    assert.ok(settings.registeredInvocableScriptNames.includes("MoveToProject"));
    assert.ok(!settings.registeredInvocableScriptNames.includes("MoveToProjectMenu"));
    const startup = settings.startupScriptNames;
    assert.ok(startup.includes("MoveToProjectMenu") && startup.indexOf("MoveToProjectMenu") < startup.indexOf("TimeReportOnStartup"), "the report can take a while");
});

test("unlinkStale: a 🗒️ note link (OBS-87) and an event's log at the end of its line (OBS-57) are the line's note too", () => {
    const { mover, file } = setup(VAULT);
    const resolve = (l) => context.app.metadataCache.getFirstLinkpathDest(l);
    const [kestrel, pinecrest] = [file("Projects/Freelance/Kestrel/Kestrel.md"), file("Projects/Freelance/Pinecrest/Pinecrest.md")];
    const task = file("Projects/Freelance/Kestrel/Draft wireframes.md");
    assert.equal(mover.unlinkStale("- [/] Draft wireframes [[Draft wireframes|🗒️]] [[Kestrel|⭕]]", task, kestrel, pinecrest, resolve).text,
        "- [/] Draft wireframes [[Draft wireframes|🗒️]]");
    const log = file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md");
    const strip = (text) => mover.unlinkStale(text, log, kestrel, pinecrest, resolve).text;
    assert.equal(strip("- [<] 10:00am\tHomepage review [[2026-09-14 Homepage review|🗒️]] [[Kestrel|⭕]]\n- 10:45am\n"),
        "- [<] 10:00am\tHomepage review [[2026-09-14 Homepage review|🗒️]]\n- 10:45am\n");
    assert.equal(strip("- [<] Homepage review [[2026-09-14 Homepage review|🗒]] [[Kestrel|⭕]]"), "- [<] Homepage review [[2026-09-14 Homepage review|🗒]]",
        "a log's line with no time, typed on a phone");
});
