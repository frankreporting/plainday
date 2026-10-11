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
        caches.set(file, props === null ? null : { frontmatter: { tags: props.tags ?? [], ...(props.status ? { status: props.status } : {}), ...(props.completed ? { completed: props.completed } : {}) } });
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
    "Projects/Freelance/Kestrel/›logs/2026-09-14 Homepage review.md": { tags: ["log"] },
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
    "90 Archive/Freelance/Marlowe/Marlowe.md": { tags: ["project"], status: "Done" },
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
    assert.deepEqual([log.to, log.skip], ["Projects/Household/›logs/2026-09-18 Printer call.md", null], "no logs folder yet: a new ›logs (OBS-164)");
    assert.deepEqual([folder.to, folder.skip], ["Projects/Household/Catalog", null]);
    const [spelled] = mover.plan([item("10 Inbox/2026-09-18 Printer call.md", { log: true })], "Projects/Household", () => false, "Projects/Household/›Logs");
    assert.equal(spelled.to, "Projects/Household/›Logs/2026-09-18 Printer call.md", "a logs folder spelled another way is used as it is");
    // By default the plan asks AddTaskNote, which finds the project's ›logs
    const kestrel = setup(VAULT).mover.plan([item("10 Inbox/2026-09-18 Printer call.md", { log: true })], "Projects/Freelance/Kestrel", () => false);
    assert.equal(kestrel[0].to, "Projects/Freelance/Kestrel/›logs/2026-09-18 Printer call.md");
});

test("plan: already there is a skip, not a move; nothing is pulled up out of a folder in its own project", () => {
    const { mover } = setup({});
    const skips = (items, into) => mover.plan(items, into, () => false).map((s) => s.skip);
    const P = "Projects/Freelance/Pinecrest";
    assert.deepEqual(skips([item(`${P}/Write copy.md`, { homeFolder: P })], P), ["here"]);
    assert.deepEqual(skips([item(`${P}/Drafts/Write copy.md`, { homeFolder: P })], P), ["here"], "in a plain folder inside the project: already in it");
    assert.deepEqual(skips([item(`${P}/Drafts/brief.pdf`, { homeFolder: P })], P), ["here"], "any file");
    assert.deepEqual(skips([item(`${P}/›logs/2026-09-02 Kickoff.md`, { log: true, homeFolder: P })], P), ["here"]);
    assert.deepEqual(skips([item(`${P}/›logs/2025/2025-03-02 Kickoff.md`, { log: true, homeFolder: P })], P), ["here"], "a log in a folder inside logs/");
    assert.deepEqual(skips([item(`${P}/›Logs/2025/2025-03-02 Kickoff.md`, { log: true, homeFolder: P })], P), ["here"], "any case");
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

test("relinkStale: a ⭕ for the project the note left becomes the new one's, a line with none gets it, the lines' other ⭕s are their own (OBS-90)", () => {
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
        "- [ ] No project yet [[2026-09-30|🚩 9/30]] [[Draft wireframes|🗒️]]",
        "",
    ].join("\n");
    const relink = (from, home = pinecrest) => mover.relinkStale(text, { note, from, home, link: `[[${home.basename}|⭕]]`, resolve });
    const out = relink(kestrel);
    assert.deepEqual(out.text.split("\n"), [
        "- [/] Draft wireframes [[Pinecrest|⭕]] [[Draft wireframes|🔗]]",
        "\t- [ ] Sub-task [[Draft wireframes|🔗]] [[Household|🗃️]]",
        "- [ ] Draft wireframes [[Draft wireframes|🔗]] [[Pinecrest|⭕]]",
        "- [ ] Other task [[Write copy|🔗]] [[Kestrel|⭕]]",
        "- [ ] Draft wireframes [[Draft wireframes|🔗]] [[Gone project|⭕]]",
        "Draft wireframes [[Draft wireframes|🔗]] [[Kestrel|⭕]]",
        "- [x] Two of them [[Draft wireframes|🔗]] [[Household|🗃️]]",
        "- [ ] No project yet [[2026-09-30|🚩 9/30]] [[Pinecrest|⭕]] [[Draft wireframes|🗒️]]",
        "",
    ], "a 🗃️ for somewhere else, the new home's ⭕, another note's line, a broken link and a line that isn't a checklist item are left");
    assert.equal(out.relinked, 3);
    assert.equal(out.kept, 2, "the Household lines still count elsewhere");
    // A note that had no project, or didn't leave one: only the line with no ⭕ gets one
    for (const from of [null, pinecrest]) {
        const again = relink(from);
        assert.equal(again.relinked, 1, `from ${from?.basename}`);
        assert.equal(again.text.split("\n")[0], "- [/] Draft wireframes [[Draft wireframes|🔗]] [[Kestrel|⭕]]", "a ⭕ for anywhere else stays");
    }
    // An area gets its 🗃️
    assert.equal(mover.relinkStale("- [ ] Draft wireframes [[Draft wireframes|🗒️]]", { note, from: kestrel, home: file("Projects/Household/Household.md"), link: "[[Household|🗃️]]", resolve }).text,
        "- [ ] Draft wireframes [[Household|🗃️]] [[Draft wireframes|🗒️]]");
    // The line a command is writing itself is left to it
    assert.equal(mover.relinkStale(text, { note, from: kestrel, home: pinecrest, link: "[[Pinecrest|⭕]]", resolve, skip: 0 }).text.split("\n")[0], text.split("\n")[0]);
});

test("relinkStale: event lines, timed or not; code blocks, comments and line endings are left as they are", () => {
    const { mover, file } = setup(VAULT);
    const resolve = (l) => context.app.metadataCache.getFirstLinkpathDest(l);
    const log = file("Projects/Freelance/Kestrel/›logs/2026-09-14 Homepage review.md");
    const [kestrel, pinecrest] = [file("Projects/Freelance/Kestrel/Kestrel.md"), file("Projects/Freelance/Pinecrest/Pinecrest.md")];
    const args = { note: log, from: kestrel, home: pinecrest, link: "[[Pinecrest|⭕]]", resolve };
    const strip = (text) => mover.relinkStale(text, args).text;
    assert.equal(strip("- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\n- 10:45am\n"),
        "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Pinecrest|⭕]]\n- 10:45am\n");
    assert.equal(strip("- [<] [[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]"), "- [<] [[2026-09-14 Homepage review|Homepage review]] [[Pinecrest|⭕]]",
        "a log's line from before its event arrived");
    const hidden = "```\n- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\n```\n"
        + "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] %%billed [[Kestrel|⭕]]%%\n";
    assert.equal(strip(hidden), hidden);
    assert.equal(strip("- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\r\n- 10:45am\r\n"),
        "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Pinecrest|⭕]]\r\n- 10:45am\r\n");
    // A comment on the line: the link outside it comes off and the comment stays, and nothing is
    // added where it might land inside it; a link the comment repeats is left, and the line counts
    // as keeping it
    assert.equal(strip("- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]] %%billed 9/30%%"),
        "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] %%billed 9/30%%");
    const twice = "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]] %%was [[Kestrel|⭕]]%%";
    const out = mover.relinkStale(twice, args);
    assert.deepEqual([out.text, out.relinked, out.kept], [twice, 0, 1]);
});

test("relinkStale: right after a move, a lookup by name can return a stale entry at the old path; it still counts as the note", () => {
    // Seen in a vault with a rename-handling plugin: for under 50ms after a move, the vault holds a
    // second entry at the old path, and a lookup by name returns it when its path is shorter
    const { mover, file } = setup(VAULT);
    const oldPath = "Projects/Freelance/Kestrel/›logs/2026-09-14 Homepage review.md";
    // The log, moved into the catalog's logs/
    const log = { path: "Projects/Freelance/Kestrel/Catalog/›logs/2026-09-14 Homepage review.md", basename: "2026-09-14 Homepage review", extension: "md" };
    const [kestrel, catalog] = [file("Projects/Freelance/Kestrel/Kestrel.md"), file("Projects/Freelance/Kestrel/Catalog/Catalog.md")];
    const stale = { path: oldPath, basename: log.basename, extension: "md" };
    const resolve = (l) => (l === "2026-09-14 Homepage review" ? stale : context.app.metadataCache.getFirstLinkpathDest(l));
    const text = "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\n";
    const args = { note: log, from: kestrel, home: catalog, link: "[[Catalog|⭕]]", resolve };
    assert.equal(mover.relinkStale(text, args).relinked, 0, "without the old path, the stale entry isn't recognised");
    const out = mover.relinkStale(text, { ...args, oldPath });
    assert.equal(out.text, "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Catalog|⭕]]\n");
    const other = { path: "Projects/Elsewhere/2026-09-14 Homepage review.md", basename: log.basename, extension: "md" };
    assert.equal(mover.relinkStale(text, { ...args, oldPath, resolve: () => other }).relinked, 0, "a same-named note elsewhere is not the note");
});

test("move: a stale entry at the old path right after the move doesn't stop the ⭕ following the note", async () => {
    const t = setup(VAULT, {
        texts: { [DAY]: "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Kestrel|⭕]]\n" },
        links: { [DAY]: { "Projects/Freelance/Kestrel/›logs/2026-09-14 Homepage review.md": 1 } },
    });
    const log = t.file("Projects/Freelance/Kestrel/›logs/2026-09-14 Homepage review.md");
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
    assert.deepEqual(t.done.renamed, [[oldPath, "Projects/Freelance/Kestrel/Catalog/›logs/2026-09-14 Homepage review.md"]]);
    assert.equal(t.texts[DAY], "- [<] 10:00am\t[[2026-09-14 Homepage review|Homepage review]] [[Catalog|⭕]]\n");
    assert.deepEqual(notices, ["Moved 2026-09-14 Homepage review to Projects/Freelance/Kestrel/Catalog/›logs. A line linking it now links ⭕ Catalog"]);
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

test("move: a task note leaving its project asks, and the lines' ⭕ for that project becomes the new one's", async () => {
    const t = setup(VAULT, {
        texts: { [DAY]: "- [x] Draft wireframes [[Draft wireframes|🔗]] [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n- [x] Billed elsewhere [[Draft wireframes|🔗]] [[Household|🗃️]]\n" },
        links: { [DAY]: { "Projects/Freelance/Kestrel/Draft wireframes.md": 1 } },
    });
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    await t.mover.move([t.file("Projects/Freelance/Kestrel/Draft wireframes.md")]);
    assert.equal(t.asked.picker[0].options.placeholder, 'Move "Draft wireframes" to which project or area? (Esc: cancel)');
    assert.deepEqual(t.asked.confirm, [["Draft wireframes", "Kestrel", "Pinecrest"]]);
    assert.deepEqual(t.done.renamed, [["Projects/Freelance/Kestrel/Draft wireframes.md", "Projects/Freelance/Pinecrest/Draft wireframes.md"]]);
    assert.equal(t.texts[DAY], "- [x] Draft wireframes [[Pinecrest|⭕]] [[Draft wireframes|🔗]]\n\t- 9:00am - 10:00am\n- [x] Billed elsewhere [[Draft wireframes|🔗]] [[Household|🗃️]]\n");
    assert.deepEqual(notices, ["Moved Draft wireframes to Projects/Freelance/Pinecrest. A line linking it now links ⭕ Pinecrest. A line linking it has 🗃️ Household too, so that line's time still counts there, not in Pinecrest"]);
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

test("move: an Inbox log goes to the project's logs folder (a new ›logs) without asking, and a ⭕ its line already had stays", async () => {
    const daily = "30 Reference/36 Planner/days/2026-09-18.md";
    const t = setup(VAULT, {
        texts: { [daily]: "- [<] 2:00pm\t[[2026-09-18 Printer call|Printer call]] [[Kestrel|⭕]]\n- 2:30pm\n" },
        links: { [daily]: { "10 Inbox/2026-09-18 Printer call.md": 1, "Projects/Freelance/Kestrel/Kestrel.md": 1 } },
    });
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    await t.mover.move([t.file("10 Inbox/2026-09-18 Printer call.md")]);
    assert.deepEqual(t.asked.confirm, [], "it had no project to leave");
    assert.deepEqual(t.done.created, ["Projects/Freelance/Pinecrest/›logs"]);
    assert.deepEqual(t.done.renamed, [["10 Inbox/2026-09-18 Printer call.md", "Projects/Freelance/Pinecrest/›logs/2026-09-18 Printer call.md"]]);
    assert.deepEqual(t.done.written, [], "the line's ⭕ is its own choice");
    assert.deepEqual(notices, ["Moved 2026-09-18 Printer call to Projects/Freelance/Pinecrest/›logs. A line linking it has ⭕ Kestrel too, so that line's time still counts there, not in Pinecrest"]);
});

test("move: a note with no project moves without asking, and the lines that link it get its new area (OBS-90)", async () => {
    const t = setup(VAULT, { texts: { [DAY]: "- [ ] Loose idea [[Loose idea|🔗]]\n" }, links: { [DAY]: { "10 Inbox/Loose idea.md": 1 } } });
    t.answer({ pick: "Projects/Household/Household.md" });
    await t.mover.move([t.file("10 Inbox/Loose idea.md")]);
    assert.deepEqual(t.asked.confirm, []);
    assert.deepEqual(t.done.renamed, [["10 Inbox/Loose idea.md", "Projects/Household/Loose idea.md"]]);
    assert.equal(t.texts[DAY], "- [ ] Loose idea [[Household|🗃️]] [[Loose idea|🔗]]\n");
    assert.deepEqual(notices, ["Moved Loose idea to Projects/Household. A line linking it now links 🗃️ Household"]);

    // With nothing linking it, nothing is written
    const alone = setup(VAULT);
    alone.answer({ pick: "Projects/Household/Household.md" });
    await alone.mover.move([alone.file("10 Inbox/Loose idea.md")]);
    assert.deepEqual(alone.done.written, []);
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
    assert.deepEqual(m.titles((addItem) => nnFolder({ addItem, folder: t.file("Projects/Freelance/Kestrel/›logs") })), [], "a plain folder");

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

test("relinkStale: a 🗒️ note link (OBS-87) and an event's log at the end of its line (OBS-57) are the line's note too, in either order", () => {
    const { mover, file } = setup(VAULT);
    const resolve = (l) => context.app.metadataCache.getFirstLinkpathDest(l);
    const [kestrel, pinecrest] = [file("Projects/Freelance/Kestrel/Kestrel.md"), file("Projects/Freelance/Pinecrest/Pinecrest.md")];
    const task = file("Projects/Freelance/Kestrel/Draft wireframes.md");
    const relink = (text, note) => mover.relinkStale(text, { note, from: kestrel, home: pinecrest, link: "[[Pinecrest|⭕]]", resolve }).text;
    for (const line of ["- [/] Draft wireframes [[Draft wireframes|🗒️]] [[Kestrel|⭕]]", "- [/] Draft wireframes [[Kestrel|⭕]] [[Draft wireframes|🗒️]]"]) {
        assert.equal(relink(line, task), "- [/] Draft wireframes [[Pinecrest|⭕]] [[Draft wireframes|🗒️]]", line);
    }
    const log = file("Projects/Freelance/Kestrel/›logs/2026-09-14 Homepage review.md");
    assert.equal(relink("- [<] 10:00am\tHomepage review [[2026-09-14 Homepage review|🗒️]] [[Kestrel|⭕]]\n- 10:45am\n", log),
        "- [<] 10:00am\tHomepage review [[Pinecrest|⭕]] [[2026-09-14 Homepage review|🗒️]]\n- 10:45am\n");
    assert.equal(relink("- [<] 10:00am\tHomepage review ℹ️ [[Kestrel|⭕]] [[2026-09-14 Homepage review|🗒️]]", log),
        "- [<] 10:00am\tHomepage review ℹ️ [[Pinecrest|⭕]] [[2026-09-14 Homepage review|🗒️]]");
    assert.equal(relink("- [<] Homepage review [[2026-09-14 Homepage review|🗒]] [[Kestrel|⭕]]", log), "- [<] Homepage review [[Pinecrest|⭕]] [[2026-09-14 Homepage review|🗒]]",
        "a log's line with no time, typed on a phone");
});

// ------------------------------------------------------------------ OBS-90: every command's move

// The note at `path` open in the active editor, with the cursor on line `line`; edits land in `t.texts`
const editorOn = (t, path, line = 0) => {
    const lines = () => t.texts[path].split("\n");
    const editor = {
        getCursor: () => ({ line, ch: 0 }),
        getLine: (n) => lines()[n],
        getValue: () => t.texts[path],
        replaceRange: (s, from, to) => {
            const all = lines();
            all[from.line] = all[from.line].slice(0, from.ch) + s + all[to.line].slice(to.ch);
            t.texts[path] = all.join("\n");
        },
        setCursor: () => {},
    };
    t.app.workspace.activeLeaf = { view: { editor, file: t.file(path) } };
    t.app.workspace.getActiveFile = () => t.file(path);
    t.app.vault.cachedRead = t.app.vault.read;
    return editor;
};
const DAY2 = "30 Reference/36 Planner/days/2026-09-18.md";
const WIREFRAMES = "Projects/Freelance/Kestrel/Draft wireframes.md";

test("OBS-90 AddProjectLink: on a line with a note elsewhere, it asks, moves the note, sets the line's ⭕ before its 🗒️, and the other lines follow", async () => {
    const t = setup(VAULT, {
        texts: {
            [DAY]: "- [x] Draft wireframes [[Kestrel|⭕]] [[Draft wireframes|🗒️]]\n- [x] Same note, later [[Draft wireframes|🗒️]] [[Kestrel|⭕]]\n",
            [DAY2]: "- [>] Draft wireframes [[Draft wireframes|🗒️]]\n",
        },
        links: { [DAY]: { [WIREFRAMES]: 2 }, [DAY2]: { [WIREFRAMES]: 1 } },
    });
    editorOn(t, DAY, 0);
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    await context.customJS.AddProjectLink.invoke();
    assert.deepEqual(t.asked.confirm, [["Draft wireframes", "Kestrel", "Pinecrest"]]);
    assert.deepEqual(t.done.renamed, [[WIREFRAMES, "Projects/Freelance/Pinecrest/Draft wireframes.md"]]);
    assert.equal(t.texts[DAY], "- [x] Draft wireframes [[Pinecrest|⭕]] [[Draft wireframes|🗒️]]\n- [x] Same note, later [[Pinecrest|⭕]] [[Draft wireframes|🗒️]]\n",
        "its own line, and another line in the same note through the editor");
    assert.equal(t.texts[DAY2], "- [>] Draft wireframes [[Pinecrest|⭕]] [[Draft wireframes|🗒️]]\n", "a line in another note through the vault");
    assert.deepEqual(t.done.written, [DAY2], "the open note isn't written behind the editor's back");
    assert.deepEqual(notices, ["Moved Draft wireframes to Projects/Freelance/Pinecrest. 2 lines linking it now link ⭕ Pinecrest"]);
});

test("OBS-90 AddProjectLink: Leave it changes nothing; a note already in the project only gets its ⭕", async () => {
    const text = "- [x] Draft wireframes [[Draft wireframes|🗒️]]\n";
    const left = setup(VAULT, { texts: { [DAY]: text }, links: { [DAY]: { [WIREFRAMES]: 1 } } });
    editorOn(left, DAY);
    left.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md", confirm: "leave" });
    await context.customJS.AddProjectLink.invoke();
    assert.deepEqual([left.done.renamed, left.texts[DAY]], [[], text]);
    assert.deepEqual(notices, ["Draft wireframes stays in Kestrel, so nothing changed"]);

    const home = setup(VAULT, { texts: { [DAY]: text }, links: { [DAY]: { [WIREFRAMES]: 1 } } });
    editorOn(home, DAY);
    home.answer({ pick: "Projects/Freelance/Kestrel/Kestrel.md" });
    await context.customJS.AddProjectLink.invoke();
    assert.deepEqual(home.asked.confirm, []);
    assert.deepEqual(home.done.renamed, []);
    assert.equal(home.texts[DAY], "- [x] Draft wireframes [[Kestrel|⭕]] [[Draft wireframes|🗒️]]\n");
});

test("OBS-90 AddProjectLink: a note in no project moves without asking, unless other lines link it", async () => {
    const LOOSE = "10 Inbox/Loose idea.md";
    const alone = setup(VAULT, { texts: { [DAY]: "- [ ] Loose idea [[Loose idea|🗒️]]\n" }, links: { [DAY]: { [LOOSE]: 1 } } });
    editorOn(alone, DAY);
    alone.answer({ pick: "Projects/Household/Household.md" });
    await context.customJS.AddProjectLink.invoke();
    assert.deepEqual(alone.asked.confirm, []);
    assert.deepEqual(alone.done.renamed, [[LOOSE, "Projects/Household/Loose idea.md"]]);
    assert.equal(alone.texts[DAY], "- [ ] Loose idea [[Household|🗃️]] [[Loose idea|🗒️]]\n");

    for (const [where, texts, links] of [
        ["another note", { [DAY]: "- [ ] Loose idea [[Loose idea|🗒️]]\n", [DAY2]: "- [x] Earlier [[Loose idea|🗒️]]\n" }, { [DAY]: { [LOOSE]: 1 }, [DAY2]: { [LOOSE]: 1 } }],
        ["the same note", { [DAY]: "- [ ] Loose idea [[Loose idea|🗒️]]\n- [x] Earlier [[Loose idea|🗒️]]\n" }, { [DAY]: { [LOOSE]: 2 } }],
    ]) {
        const shared = setup(VAULT, { texts, links });
        editorOn(shared, DAY);
        shared.answer({ pick: "Projects/Household/Household.md", confirm: "leave" });
        await context.customJS.AddProjectLink.invoke();
        assert.deepEqual(shared.asked.confirm, [["Loose idea", null, "Household"]], where);
        assert.deepEqual(shared.done.renamed, [], where);
        assert.deepEqual(notices, ["Loose idea stays where it is, so nothing changed"], where);
    }
    // A mention that isn't a line's note doesn't count
    const mentioned = setup(VAULT, { texts: { [DAY]: "- [ ] Loose idea [[Loose idea|🗒️]]\n", [DAY2]: "See [[Loose idea]] later\n- [ ] Read [[Loose idea]] again\n" }, links: { [DAY]: { [LOOSE]: 1 }, [DAY2]: { [LOOSE]: 2 } } });
    editorOn(mentioned, DAY);
    mentioned.answer({ pick: "Projects/Household/Household.md" });
    await context.customJS.AddProjectLink.invoke();
    assert.deepEqual(mentioned.asked.confirm, []);
});

test("OBS-90 AddTaskNote.settle: where an existing note ends up and which project the line names", async () => {
    const t = setup({
        ...VAULT,
        "Projects/Freelance/Old Job/Old Job.md": { tags: ["project"], status: "Done" },
        "Projects/Freelance/Old Job/Old task.md": { tags: ["task"] },
    }, { texts: {}, links: {} });
    const { helper, file } = t;
    const line = (text) => helper.lineProjects(text, DAY);
    const settle = async (path, text, answers = {}) => {
        t.answer({ confirm: "move", ...answers });
        const out = await helper.settle(file(path), line(text));
        return out && { note: out.note.path, home: out.home?.basename ?? null, movedFrom: out.movedFrom };
    };
    // No ⭕ on the line: the note stays, and the line names where it's filed
    assert.deepEqual(await settle(WIREFRAMES, "- [ ] Draft wireframes"), { note: WIREFRAMES, home: "Kestrel", movedFrom: null });
    assert.deepEqual(await settle(WIREFRAMES, "- [ ] Draft wireframes [[Kestrel|⭕]]"), { note: WIREFRAMES, home: "Kestrel", movedFrom: null });
    // The line names another project: asked; Leave it names where the note stays
    assert.deepEqual(await settle(WIREFRAMES, "- [ ] Draft wireframes [[Pinecrest|⭕]]", { confirm: "leave" }), { note: WIREFRAMES, home: "Kestrel", movedFrom: null });
    assert.deepEqual(t.asked.confirm, [["Draft wireframes", "Kestrel", "Pinecrest"]]);
    assert.equal(await settle(WIREFRAMES, "- [ ] Draft wireframes [[Pinecrest|⭕]]", { confirm: null }), null, "Esc");
    assert.deepEqual(await settle(WIREFRAMES, "- [ ] Draft wireframes [[Pinecrest|⭕]]"),
        { note: "Projects/Freelance/Pinecrest/Draft wireframes.md", home: "Pinecrest", movedFrom: WIREFRAMES });
    // A note in no project goes where the line says, without asking
    t.asked.confirm.length = 0;
    assert.deepEqual(await settle("10 Inbox/Loose idea.md", "- [ ] Loose idea [[Household|🗃️]]"), { note: "Projects/Household/Loose idea.md", home: "Household", movedFrom: "10 Inbox/Loose idea.md" });
    assert.deepEqual(t.asked.confirm, []);
    // Nothing to name: a note in no project, one in a finished project (its time counts there, and
    // naming the area above would move it), and a project note itself
    assert.deepEqual(await settle("10 Inbox/2026-09-18 Printer call.md", "- [<] Printer call"), { note: "10 Inbox/2026-09-18 Printer call.md", home: null, movedFrom: null });
    assert.deepEqual(await settle("Projects/Freelance/Old Job/Old task.md", "- [ ] Old task"), { note: "Projects/Freelance/Old Job/Old task.md", home: null, movedFrom: null });
    assert.deepEqual(await settle("Projects/Freelance/Kestrel/Kestrel.md", "- [ ] Kestrel [[Pinecrest|⭕]]"), { note: "Projects/Freelance/Kestrel/Kestrel.md", home: null, movedFrom: null });
});

test("OBS-90 review: a note in a finished project, a project note that isn't a folder note, and notes that never move", async () => {
    const t = setup({
        ...VAULT,
        "Projects/Freelance/Old Job/Old Job.md": { tags: ["project"], status: "Canceled" },
        "Projects/Freelance/Old Job/Old task.md": { tags: ["task"] },
        "Projects/Household/Tires.md": { tags: ["task"] },
    }, { texts: {}, links: {} });
    const { helper, file } = t;
    const settle = async (path, text, answers = {}) => {
        t.answer({ confirm: "move", ...answers });
        const out = await helper.settle(file(path), helper.lineProjects(text, DAY));
        return out && { note: out.note.path, home: out.home?.basename ?? null, clear: out.clear };
    };
    // Left in a finished project: the line names nothing, and its ⭕ comes off, so the time still
    // counts where the note is (the area above would have moved it)
    t.asked.confirm.length = 0;
    assert.deepEqual(await settle("Projects/Freelance/Old Job/Old task.md", "- [ ] Old task [[Pinecrest|⭕]]", { confirm: "leave" }),
        { note: "Projects/Freelance/Old Job/Old task.md", home: null, clear: true });
    assert.deepEqual(t.asked.confirm, [["Old task", "Old Job", "Pinecrest"]], "asked From the finished project, not the area above it");
    // The line names the area the finished project sits in: that's a move out of it, asked first
    t.asked.confirm.length = 0;
    await settle("Projects/Freelance/Old Job/Old task.md", "- [ ] Old task [[Freelance|🗃️]]", { confirm: "leave" });
    assert.deepEqual(t.asked.confirm, [["Old task", "Old Job", "Freelance"]]);
    // A project note that isn't its folder's own note: a note in that folder is already where it'd go
    t.asked.confirm.length = 0;
    assert.deepEqual(await settle("Projects/Household/Tires.md", "- [ ] Tires [[Car checklist|⭕]]"), { note: "Projects/Household/Tires.md", home: "Car checklist", clear: false });
    assert.deepEqual([t.asked.confirm, t.done.renamed], [[], []]);
    // The system is never moved, whatever the line says
    assert.deepEqual(await settle("00 Meta/Manual.md", "- [ ] Manual [[Pinecrest|⭕]]"), { note: "00 Meta/Manual.md", home: null, clear: false });
    assert.deepEqual(t.done.renamed, []);
});

test("OBS-90 review: AddProjectLink doesn't move the system or a note already in the pick's folder, and still links the pick", async () => {
    const t = setup({ ...VAULT, "Projects/Household/Tires.md": { tags: ["task"] } }, {
        texts: { [DAY]: "- [ ] Read [[Manual|🗒️]]\n- [ ] Tires [[Tires|🗒️]]\n" },
        links: { [DAY]: { "00 Meta/Manual.md": 1, "Projects/Household/Tires.md": 1 } },
    });
    editorOn(t, DAY, 0);
    t.answer({ pick: "Projects/Freelance/Pinecrest/Pinecrest.md" });
    await context.customJS.AddProjectLink.invoke();
    assert.deepEqual([t.asked.confirm, t.done.renamed], [[], []]);
    assert.equal(t.texts[DAY].split("\n")[0], "- [ ] Read [[Pinecrest|⭕]] [[Manual|🗒️]]");
    assert.deepEqual(notices, ["Manual stays where it is, since nothing there is moved; the line links Pinecrest"]);
    editorOn(t, DAY, 1);
    t.answer({ pick: "Projects/Household/Car checklist.md" });
    await context.customJS.AddProjectLink.invoke();
    assert.deepEqual([t.asked.confirm, t.done.renamed], [[], []]);
    assert.equal(t.texts[DAY].split("\n")[1], "- [ ] Tires [[Car checklist|⭕]] [[Tires|🗒️]]");
});

test("OBS-90 review: after a command moves a note, its notice says which lines kept a ⭕ of their own", async () => {
    const t = setup(VAULT, {
        texts: { [DAY2]: "- [x] Own [[Household|🗃️]] [[Draft wireframes|🗒️]]\n- [x] Plain [[Draft wireframes|🗒️]]\n" },
        links: { [DAY2]: { [WIREFRAMES]: 2 } },
    });
    await t.helper.moveInto(t.file(WIREFRAMES), t.file("Projects/Freelance/Pinecrest/Pinecrest.md"));
    assert.equal(t.texts[DAY2], "- [x] Own [[Household|🗃️]] [[Draft wireframes|🗒️]]\n- [x] Plain [[Pinecrest|⭕]] [[Draft wireframes|🗒️]]\n");
    assert.deepEqual(notices, ["Moved Draft wireframes to Projects/Freelance/Pinecrest. A line linking it now links ⭕ Pinecrest. A line linking it has 🗃️ Household too, so that line's time still counts there, not in Pinecrest"]);
});

test("OBS-90 re-review: a log left in a finished project takes the line's ⭕ off; a move out of one leaves its lines' ⭕", async () => {
    const OLD = "Projects/Freelance/Old Job";
    const t = setup({
        ...VAULT,
        [`${OLD}/Old Job.md`]: { tags: ["project"], status: "canceled" },
        [`${OLD}/›logs/2026-09-14 Review.md`]: { tags: ["log"] },
        [`${OLD}/Old task.md`]: { tags: ["task"] },
    }, {
        texts: { [DAY]: "- [<] 2:00pm\tReview [[Pinecrest|⭕]]\n", [DAY2]: "- [x] Old task [[Old Job|⭕]] [[Old task|🗒️]]\n- [x] Loose [[Old task|🗒️]]\n" },
        links: { [DAY2]: { [`${OLD}/Old task.md`]: 2 } },
    });
    const editor = editorOn(t, DAY, 0);
    t.answer({ confirm: "leave" });
    await t.helper.linkEvent(editor, 0, "- [<] 2:00pm\tReview [[Pinecrest|⭕]]", "Review");
    assert.deepEqual(t.asked.confirm, [["2026-09-14 Review", "Old Job", "Pinecrest"]]);
    assert.equal(t.texts[DAY], "- [<] 2:00pm\tReview [[2026-09-14 Review|🗒️]]\n", "the log's time counts where it's filed");
    // Moving a note out of a finished project: a line's ⭕ for it stays (that time may be invoiced)
    await t.helper.moveInto(t.file(`${OLD}/Old task.md`), t.file("Projects/Freelance/Pinecrest/Pinecrest.md"));
    assert.equal(t.texts[DAY2], "- [x] Old task [[Old Job|⭕]] [[Old task|🗒️]]\n- [x] Loose [[Pinecrest|⭕]] [[Old task|🗒️]]\n");
});

test("OBS-125 isHome: a project or area whose status is Done or Canceled is no home; On Hold and completed alone still are", () => {
    const { helper, file } = setup({
        "Projects/Freelance/Freelance.md": { tags: ["area"] },
        "Projects/Old Area/Old Area.md": { tags: ["area"], status: "Canceled" },
        "Projects/Freelance/Done Job/Done Job.md": { tags: ["project"], status: "Done" },
        "Projects/Freelance/Done Job/Leftover.md": { tags: ["task"] },
        "Projects/Freelance/Dropped/Dropped.md": { tags: ["project"], status: "canceled" },
        "Projects/Freelance/Paused/Paused.md": { tags: ["project"], status: "On Hold" },
        "Projects/Freelance/Dated/Dated.md": { tags: ["project"], status: "Active", completed: "2026-09-30" },
        "Projects/Freelance/New/New.md": { tags: ["project"], status: "To Do" },
    });
    const home = (p) => helper.isHome(file(p));
    assert.equal(home("Projects/Freelance/Freelance.md"), true);
    assert.equal(home("Projects/Old Area/Old Area.md"), false, "a canceled area");
    assert.equal(home("Projects/Freelance/Done Job/Done Job.md"), false, "Done");
    assert.equal(home("Projects/Freelance/Dropped/Dropped.md"), false, "canceled, lowercase");
    assert.equal(home("Projects/Freelance/Paused/Paused.md"), true, "On Hold isn't finished");
    assert.equal(home("Projects/Freelance/Dated/Dated.md"), true, "completed is no longer read");
    assert.equal(home("Projects/Freelance/New/New.md"), true, "a new project's To Do");
    // A note in a finished project belongs to the area above it, as it did with `completed`
    assert.equal(helper.homeOf(file("Projects/Freelance/Done Job/Leftover.md")).basename, "Freelance");
});
