// Projects and areas made in code (ProjectNotes, OBS-123): New project, New area and Convert to project, on a
// stand-in vault with the real classes, and the new folder's look in Notebook Navigator (OBS-142, moved here
// from the Templater script folderLook.js). Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { standIn, YAML } from "./standInVault.mjs";
import { loadClass } from "../../../plugin/classShape.mjs";

const ProjectNotes = loadClass("projectNotes.js", vm.createContext({}));
const notes = new ProjectNotes();
const folderLook = { apply: (file, kind, navigator) => notes.look(file, kind, navigator), LOOKS: ProjectNotes.LOOKS };

const TAG_LOOKS = { project: { icon: "circle", color: "#ef4444" }, area: { icon: "archive", color: "#168a42" } };

// A Notebook Navigator with the public API calls the look uses, recording what it was asked
function fakeNavigator({ folderLooks = {}, tagLooks = TAG_LOOKS, pinned = [], settings = { enableFolderNotes: true, pinCreatedFolderNote: true } } = {}) {
    const calls = { setFolderMeta: [], pin: [] };
    const metadata = {
        getTagMeta: (tag) => tagLooks[tag] ?? null,
        getFolderMeta: (folder) => folderLooks[folder.path] ?? null,
        setFolderMeta: async (folder, meta) => {
            calls.setFolderMeta.push([folder.path, JSON.parse(JSON.stringify(meta))]);
            folderLooks[folder.path] = meta;
        },
        isPinned: (file, context) => context === "folder" && pinned.includes(file.path),
        pin: async (file, context) => calls.pin.push([file.path, context]),
    };
    return { navigator: { api: { metadata }, settings }, calls };
}

function folderNote(path) {
    const parts = path.split("/");
    const name = parts.pop().replace(/\.md$/, "");
    const folderPath = parts.join("/");
    return { path, basename: name, parent: { path: folderPath, name: folderPath.split("/").pop() } };
}

test("a new project's folder gets the project tag's look, and its note is pinned in it", async () => {
    const { navigator, calls } = fakeNavigator();
    await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
    assert.deepEqual(calls.setFolderMeta, [["Projects/Launch plan", { icon: "circle", color: "#ef4444" }]]);
    assert.deepEqual(calls.pin, [["Projects/Launch plan/Launch plan.md", "folder"]]);
});

test("a new area's folder gets the area tag's look", async () => {
    const { navigator, calls } = fakeNavigator();
    await folderLook.apply(folderNote("Projects/Hobbies/Hobbies.md"), "area", navigator);
    assert.deepEqual(calls.setFolderMeta, [["Projects/Hobbies", { icon: "archive", color: "#168a42" }]]);
});

test("a background color on the tag comes along; a tag with only an icon gives only the icon", async () => {
    const { navigator, calls } = fakeNavigator({
        tagLooks: { project: { icon: "star", color: undefined, backgroundColor: "#fff3c4" }, area: { icon: "box" } },
    });
    await folderLook.apply(folderNote("Projects/A/A.md"), "project", navigator);
    await folderLook.apply(folderNote("Projects/B/B.md"), "area", navigator);
    assert.deepEqual(calls.setFolderMeta, [
        ["Projects/A", { icon: "star", backgroundColor: "#fff3c4" }],
        ["Projects/B", { icon: "box" }],
    ]);
});

test("a folder that already has a look keeps it", async () => {
    const { navigator, calls } = fakeNavigator({ folderLooks: { "Projects/Launch plan": { icon: "rocket" } } });
    await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
    assert.deepEqual(calls.setFolderMeta, []);
    assert.equal(calls.pin.length, 1, "pinning doesn't depend on the look");
});

test("tags Navigator gives no look: a project gets a red circle and an area a green archive", async () => {
    const { navigator, calls } = fakeNavigator({ tagLooks: {} });
    await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
    await folderLook.apply(folderNote("Projects/Hobbies/Hobbies.md"), "area", navigator);
    assert.deepEqual(calls.setFolderMeta, [
        ["Projects/Launch plan", { icon: "circle", color: "#ef4444" }],
        ["Projects/Hobbies", { icon: "archive", color: "#168a42" }],
    ]);
    assert.deepEqual(calls.pin, [["Projects/Launch plan/Launch plan.md", "folder"], ["Projects/Hobbies/Hobbies.md", "folder"]]);
});

test("a tag whose look is empty, or a Navigator without getTagMeta, gets the system's look", async () => {
    const { navigator, calls } = fakeNavigator({ tagLooks: { project: { icon: undefined, color: undefined } } });
    await folderLook.apply(folderNote("Projects/A/A.md"), "project", navigator);
    delete navigator.api.metadata.getTagMeta;
    await folderLook.apply(folderNote("Projects/B/B.md"), "area", navigator);
    assert.deepEqual(calls.setFolderMeta, [
        ["Projects/A", { icon: "circle", color: "#ef4444" }],
        ["Projects/B", { icon: "archive", color: "#168a42" }],
    ]);
});

test("the system's looks aren't changed by a folder's look", async () => {
    const { navigator } = fakeNavigator({ tagLooks: {} });
    await folderLook.apply(folderNote("Projects/A/A.md"), "project", navigator);
    navigator.api.metadata.getFolderMeta({ path: "Projects/A" }).icon = "rocket";
    assert.equal(folderLook.LOOKS.project.icon, "circle");
});

test("pinning follows Navigator's own settings: Pin created folder notes, with folder notes on", async () => {
    for (const settings of [
        { enableFolderNotes: true, pinCreatedFolderNote: false },
        { enableFolderNotes: false, pinCreatedFolderNote: true },
        null,
    ]) {
        const { navigator, calls } = fakeNavigator({ settings });
        await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
        assert.deepEqual(calls.pin, [], JSON.stringify(settings));
        assert.equal(calls.setFolderMeta.length, 1);
    }
});

test("a note already pinned in its folder isn't pinned again", async () => {
    const { navigator, calls } = fakeNavigator({ pinned: ["Projects/Launch plan/Launch plan.md"] });
    await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
    assert.deepEqual(calls.pin, []);
});

test("without Navigator, or with an older one lacking these calls, nothing happens", async () => {
    const file = folderNote("Projects/Launch plan/Launch plan.md");
    await folderLook.apply(file, "project", null);
    await folderLook.apply(file, "project", { settings: { enableFolderNotes: true, pinCreatedFolderNote: true } });
    await folderLook.apply(file, "project", { api: { metadata: {} }, settings: { enableFolderNotes: true, pinCreatedFolderNote: true } });
});

test("only a folder note: a note not named like its folder, or at the vault root, is left alone", async () => {
    const { navigator, calls } = fakeNavigator();
    await folderLook.apply(folderNote("Inbox/Launch plan.md"), "project", navigator);
    await folderLook.apply({ path: "Launch plan.md", basename: "Launch plan", parent: { path: "/", name: "" } }, "project", navigator);
    await folderLook.apply({ path: "x.md", basename: "x", parent: null }, "project", navigator);
    assert.deepEqual(calls, { setFolderMeta: [], pin: [] });
});


// ------------------------------------------------------------------ making one (OBS-123)

const DAY = "Reference/Planner/days/2026-09-18.md";
const KESTREL = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Outfitters 2026.md";
const NOTES = {
    "Projects/Freelance/Freelance.md": "---\ntags: [area]\naliases:\n  - 🗃️.Freelance\n---\n",
    [KESTREL]: "---\ntags: [project]\naliases:\n  - ⭕.Kestrel Outfitters 2026\n---\n",
    [DAY]: "- [ ] Sketch ideas for the Holiday Window Display\n",
};
const TPL = "Config/Templates/Project.md";
// A new project as Plainday writes it: the old Project template's properties, in its order, without `id`
const projectText = ({ name, start = "", due = "", body = "" }) => [
    "---", "aliases:", `  - "⭕.${name}"`, "tags:", "  - project", "status: To Do", "parent:", start ? `start: ${start}` : "start:", due ? `due: ${due}` : "due:",
    "who:", "client:", "bill_to:", "rate:", "rate_type:", "max_hours:", "include_subprojects: false", "---", body,
].join("\n");
const props = (text) => YAML.parseYaml(YAML.getFrontMatterInfo(text).frontmatter);
// Templater as far as write_template_to_file goes: `run(text)` is the note after the template, as Templater 2 leaves
// it (the template's properties added to the note's, its text after them)
const withTemplater = (v, run) => {
    const settings = v.app.plugins.getPlugin("templater-obsidian").settings;
    const ran = [];
    v.app.plugins.getPlugin = (id) => (id === "templater-obsidian" ? { settings, templater: {
        write_template_to_file: async (t, f) => { ran.push(`${t.path} on ${f.path}`); await v.app.vault.process(f, run); },
    } } : null);
    return ran;
};

test("make: a project in a folder of its name at the top of Projects, its note inside, Plainday's properties in one write, its dates from its name", async () => {
    const v = standIn({ notes: NOTES });
    const held = [];
    const hold = v.plainday.PeriodicNotes.hold.bind(v.plainday.PeriodicNotes);
    v.plainday.PeriodicNotes.hold = (path) => { held.push([path, !!v.app.vault.getFolderByPath("Projects/Harbor Mural")]); hold(path); };
    const file = await v.plainday.ProjectNotes.make({ kind: "project", name: "Harbor Mural 2026-10-01 2026-11-15" });
    assert.equal(file.path, "Projects/Harbor Mural/Harbor Mural.md");
    assert.equal(v.notes()[file.path], projectText({ name: "Harbor Mural", start: "2026-10-01", due: "2026-11-15" }));
    assert.deepEqual(held[0], [file.path, false], "Templater's trigger is kept off the note from before its folder appears");
    assert.deepEqual(v.notices, []);
    // No dates: empty start and due; one date: the start
    await v.plainday.ProjectNotes.make({ kind: "project", name: "Ferry Timetable Poster" });
    assert.equal(v.notes()["Projects/Ferry Timetable Poster/Ferry Timetable Poster.md"], projectText({ name: "Ferry Timetable Poster" }));
    await v.plainday.ProjectNotes.make({ kind: "project", name: "2026-10-05  Lantern   Walk" });
    assert.equal(v.notes()["Projects/Lantern Walk/Lantern Walk.md"], projectText({ name: "Lantern Walk", start: "2026-10-05" }));
});

test("make: an area gets its alias and its tag, and keeps a date in its name", async () => {
    const v = standIn({ notes: NOTES });
    const file = await v.plainday.ProjectNotes.make({ kind: "area", name: "Studio" });
    assert.equal(file.path, "Projects/Studio/Studio.md");
    assert.equal(v.notes()[file.path], '---\naliases:\n  - "🗃️.Studio"\ntags:\n  - area\n---\n');
    assert.equal((await v.plainday.ProjectNotes.make({ kind: "area", name: "Season 2026-10-01" })).path, "Projects/Season 2026-10-01/Season 2026-10-01.md");
});

test("make: the Projects folder as Settings → Plainday → Folders has it, made when it isn't there yet", async () => {
    const v = standIn({ notes: NOTES, folders: { projects: "Work/Clients" } });
    const file = await v.plainday.ProjectNotes.make({ kind: "project", name: "Harbor Mural" });
    assert.equal(file.path, "Work/Clients/Harbor Mural/Harbor Mural.md");
    assert.ok(v.app.vault.getFolderByPath("Work/Clients/Harbor Mural"));
});

test("problem: a name another note has, a folder already in Projects, a character a file can't hold, or only dates, can't be used; make throws on one", async () => {
    const v = standIn({ notes: { ...NOTES, "Projects/Orchard Tour/Orchard Tour plan.md": "plans\n", "Inbox/Mosaic.md": "" } });
    const p = v.plainday.ProjectNotes;
    assert.equal(p.problem("kestrel outfitters 2026"), "A note named “kestrel outfitters 2026” already exists. Give this one another name.", "any case, anywhere");
    assert.equal(p.problem("Mosaic", "area"), "A note named “Mosaic” already exists. Give this one another name.");
    assert.equal(p.problem("Kestrel Outfitters 2026 2026-10-01"), "A note named “Kestrel Outfitters 2026” already exists. Give this one another name.", "checked after its dates come out");
    assert.equal(p.problem("Orchard tour"), "A folder named “Orchard Tour” is already in Projects. Give this one another name.", "its name after its dates come out, in any case");
    assert.equal(p.problem("Orchard Tour 2026-10-01"), "A folder named “Orchard Tour” is already in Projects. Give this one another name.");
    assert.equal(p.problem("Freelance", "area"), "A note named “Freelance” already exists. Give this one another name.");
    assert.equal(p.problem("Q4: launch"), "A name can't contain “:”. Files and links can't hold it.");
    assert.equal(p.problem("a#b|c"), "A name can't contain “#” or “|”. Files and links can't hold them.");
    assert.equal(p.problem("two\nlines"), "A name can't contain a line break. Files and links can't hold it.");
    assert.equal(p.problem("a\r\nb: c"), "A name can't contain a line break or “:”. Files and links can't hold them.");
    assert.equal(p.problem("2026-10-01 2026-11-15"), "A project's dates become its start and due, so its name needs words too.");
    assert.equal(p.problem("   "), "Type a name for the project.");
    assert.equal(p.problem("", "area"), "Type a name for the area.");
    assert.equal(p.problem("Harbor Mural 2026-10-01"), "");
    await assert.rejects(p.make({ kind: "project", name: "Orchard Tour" }), /already in Projects/);
    assert.deepEqual(Object.keys(v.notes()).filter((k) => k.startsWith("Projects/Orchard Tour/")), ["Projects/Orchard Tour/Orchard Tour plan.md"], "nothing goes into that folder");
});

test("another plugin makes the folder's note as the folder appears (Folder Notes): Plainday's properties go into that note, its own kept, in either order", async () => {
    const path = "Projects/Lantern Walk/Lantern Walk.md";
    // Its note made before Plainday's write: Plainday's create finds it there
    const v = standIn({ notes: NOTES });
    const createFolder = v.app.vault.createFolder;
    v.app.vault.createFolder = async (p) => { const f = await createFolder(p); if (p === "Projects/Lantern Walk") await v.app.vault.create(path, ""); return f; };
    const file = await v.plainday.ProjectNotes.make({ kind: "project", name: "Lantern Walk" });
    assert.equal(file.path, path);
    assert.equal(v.notes()[path], projectText({ name: "Lantern Walk" }));
    assert.deepEqual(Object.keys(v.notes()).filter((k) => k.startsWith("Projects/Lantern Walk/")), [path], "one note");
    // Its empty write landing after Plainday's
    const w = standIn({ notes: NOTES });
    const create = w.app.vault.create;
    w.app.vault.create = async (p, text) => { const f = await create(p, text); if (p === path) await w.app.vault.process(f, () => ""); return f; };
    await w.plainday.ProjectNotes.make({ kind: "project", name: "Lantern Walk" });
    assert.equal(w.notes()[path], projectText({ name: "Lantern Walk" }));
    // A note that plugin gave properties and text of its own keeps them, with Plainday's added
    const x = standIn({ notes: NOTES });
    const made = x.app.vault.createFolder;
    x.app.vault.createFolder = async (p) => { const f = await made(p); if (p === "Projects/Lantern Walk") await x.app.vault.create(path, "---\ncreated: 2026-09-16\nstatus: Active\n---\nFolder notes here\n"); return f; };
    await x.plainday.ProjectNotes.make({ kind: "project", name: "Lantern Walk" });
    const fm = props(x.notes()[path]);
    assert.deepEqual([fm.status, fm.created, fm.tags, fm.aliases], ["Active", "2026-09-16", ["project"], ["⭕.Lantern Walk"]]);
    assert.match(x.notes()[path], /---\nFolder notes here\n$/);
});

test("the Project template without Templater: a plain one filled in and combined, Plainday's alias first, the name's dates and its own values kept; one with Templater code is left out, with a notice", async () => {
    const tpl = "---\nstatus: Active\nrate_type: hourly\nstart: 2020-01-01\nwho:\nparent:\naliases:\n  - Mural\ntopic: Murals\nid: 20260916\n---\n## {{title}}\n\nStarted {{date}}\n";
    const v = standIn({ notes: { ...NOTES, [TPL]: tpl } });
    const file = await v.plainday.ProjectNotes.make({ kind: "project", name: "Harbor Mural 2026-10-01" });
    const text = v.notes()[file.path];
    const fm = props(text);
    assert.deepEqual(fm.aliases, ["⭕.Harbor Mural", "Mural"], "Plainday's alias first");
    assert.deepEqual([fm.status, fm.rate_type, fm.start, fm.topic, fm.include_subprojects], ["Active", "hourly", "2026-10-01", "Murals", "false"], "the template's values fill or replace Plainday's, but not the name's dates");
    assert.match(text, /\ninclude_subprojects: false\ntopic: Murals\n---\n## Harbor Mural\n\nStarted 2026-09-16\n$/, "the template's other properties after Plainday's, its text filled in");
    assert.match(text, /^---\nid: "?20260916"?\naliases:\n/, "its id first");
    assert.deepEqual(v.notices, []);
    // With Templater code and no Templater: made without it
    const w = standIn({ notes: { ...NOTES, [TPL]: '---\nid: <% tp.date.now("YYYYMMDDHHmmssSS") %>\n---\n' } });
    const plain = await w.plainday.ProjectNotes.make({ kind: "project", name: "Ferry Timetable Poster" });
    assert.equal(w.notes()[plain.path], projectText({ name: "Ferry Timetable Poster" }));
    assert.deepEqual(w.notices, ["Project holds Templater code and Templater is off, so the new project was made without it."]);
    // The Area template's row, set in Settings → Plainday → Note templates
    const x = standIn({ notes: { ...NOTES, "Templates/My area.md": "---\nicon: box\n---\n" } });
    x.plainday.Settings.get().templates.area = "Templates/My area.md";
    const area = await x.plainday.ProjectNotes.make({ kind: "area", name: "Studio" });
    assert.equal(x.notes()[area.path], '---\naliases:\n  - "🗃️.Studio"\ntags:\n  - area\nicon: box\n---\n');
});

test("the Project template through Templater: run on the closed note, then the name's dates and Plainday's values a template emptied put back; its cursor marker taken out and remembered", async () => {
    const v = standIn({ notes: { ...NOTES, [TPL]: "(the template)" } });
    const ran = withTemplater(v, (text) => text
        .replace("status: To Do\n", "status: Active\n").replace("start: 2026-10-01\n", "start: 2020-01-01\n").replace("include_subprojects: false\n", "include_subprojects:\n")
        .replace(/\n---\n$/, "\nid: 2026091612000000\n---\nIntro <% tp.file.cursor(1) %> and more\n"));
    const file = await v.plainday.ProjectNotes.make({ kind: "project", name: "Harbor Mural 2026-10-01" });
    assert.deepEqual(ran, [`${TPL} on ${file.path}`]);
    const text = v.notes()[file.path];
    const fm = props(text);
    assert.deepEqual([fm.status, fm.start, fm.id, fm.include_subprojects], ["Active", "2026-10-01", "2026091612000000", "false"]);
    assert.ok(text.startsWith("---\nid: 2026091612000000\naliases:\n"), "the template's id first, as in every note");
    assert.doesNotMatch(text, /<%/, "no Templater code left in the note (OBS-177)");
    const at = v.plainday.ProjectNotes.cursorAt;
    assert.equal(at.path, file.path);
    assert.ok(text.slice(0, at.offset).endsWith("Intro "), "the cursor goes where the marker was");
});

test("New project: the name box's name made, then opened once read, with the cursor below the properties", async () => {
    const v = standIn({ notes: NOTES, open: DAY, at: 0 });
    const p = v.plainday.ProjectNotes;
    const asked = [];
    p.ask = async (kind, value) => { asked.push([kind, value]); return "Harbor Mural 2026-10-01 2026-11-15"; };
    const opened = [];
    v.app.workspace.getLeaf = () => ({ openFile: async (f, opts) => { opened.push([f.path, JSON.parse(JSON.stringify(opts))]); v.open(f.path, 0); } });
    Object.defineProperty(v.app.workspace, "activeEditor", { get: () => v.app.workspace.getActiveViewOfType() });
    const file = await p.create("project");
    assert.deepEqual(asked.map(([kind]) => kind), ["project"]);
    assert.deepEqual(opened, [[file.path, { state: { mode: "source" }, eState: { focus: true } }]]);
    const last = v.notes()[file.path].split("\n").length - 1;
    assert.deepEqual(v.placed(), { line: last, ch: 0 }, "below the properties, in the empty body");
    // Closed: nothing made
    p.ask = async () => null;
    assert.equal(await p.create("area"), null);
    assert.ok(!Object.keys(v.notes()).some((k) => k.startsWith("Projects/") && /Area/.test(k)));
});

test("Convert to project: the selection becomes a link to the new project, made in its folder without opening it; a name that can't be used opens the box, and a new name links under the words selected", async () => {
    const v = standIn({ notes: NOTES, open: DAY, at: 0 });
    v.select(27, 49);
    await v.plainday.ConvertToProject.invoke();
    assert.equal(v.notes()[DAY], "- [ ] Sketch ideas for the [[Holiday Window Display]]\n");
    assert.equal(v.notes()["Projects/Holiday Window Display/Holiday Window Display.md"], projectText({ name: "Holiday Window Display" }));
    assert.ok(!Object.keys(v.notes()).some((k) => k.startsWith("Inbox/")), "never in the Inbox");
    // The name taken: the box, with the selection and why; a new name there links under the selected words
    const w = standIn({ notes: { ...NOTES, [DAY]: "- [ ] Plan the Kestrel Outfitters 2026 launch\n" }, open: DAY, at: 0 });
    const asked = [];
    w.plainday.ProjectNotes.ask = async (kind, value, reason) => { asked.push([kind, value, reason]); return "Kestrel Outfitters 2027"; };
    w.select(15, 38);
    await w.plainday.ConvertToProject.invoke();
    assert.deepEqual(asked, [["project", "Kestrel Outfitters 2026", "A note named “Kestrel Outfitters 2026” already exists. Give this one another name."]]);
    assert.equal(w.notes()[DAY], "- [ ] Plan the [[Kestrel Outfitters 2027|Kestrel Outfitters 2026]] launch\n");
    assert.ok(w.notes()["Projects/Kestrel Outfitters 2027/Kestrel Outfitters 2027.md"]);
    // A name with a $ in it is linked as it is
    const y = standIn({ notes: { ...NOTES, [DAY]: "- [ ] Raise $$ for the mural\n" }, open: DAY, at: 0 });
    y.select(12, 14);
    await y.plainday.ConvertToProject.invoke();
    assert.equal(y.notes()[DAY], "- [ ] Raise [[$$]] for the mural\n", "not read as a replacement pattern");
    // Esc: nothing made, the line as it was
    const x = standIn({ notes: { ...NOTES, [DAY]: "- [ ] Q4: launch\n" }, open: DAY, at: 0 });
    x.plainday.ProjectNotes.ask = async () => null;
    x.select(6, 16);
    await x.plainday.ConvertToProject.invoke();
    assert.equal(x.notes()[DAY], "- [ ] Q4: launch\n");
    assert.deepEqual(Object.keys(x.notes()).filter((k) => k.startsWith("Projects/Q4")), []);
});
