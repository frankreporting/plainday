// Tests for CustomJS/schedule.js (the parts that don't need an editor). Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../CustomJS/schedule.js", import.meta.url), "utf8");
const load = (app) => new (vm.runInContext(code + "\n;Schedule", vm.createContext({ app })))();
const file = (path) => ({ basename: path.split("/").pop().replace(/\.md$/, ""), parent: { path: path.slice(0, path.lastIndexOf("/")) } });

const PLANNER = "30 Reference/36 Planner";
const app = (nn) => ({
    internalPlugins: { plugins: { "daily-notes": { instance: { options: { folder: `${PLANNER}/days`, format: "YYYY-MM-DD" } } } } },
    plugins: { plugins: nn ? { "notebook-navigator": { settings: nn } } : {} },
});
const NN = { vaultProfiles: [{ periodicNotesFolder: PLANNER }], calendarCustomMonthPattern: "[months]/YYYY-MM" };

test("monthly notes: YYYY-MM in the Planner's months folder only (OBS-9)", () => {
    const s = load(app(NN));
    assert.equal(s.monthsFolder(), `${PLANNER}/months`);
    assert.equal(s.isMonthlyNote(file(`${PLANNER}/months/2026-09.md`)), true);
    assert.equal(s.isMonthlyNote(file("30 Reference/37 Journal/2025-03.md")), false, "Journal notes aren't monthly notes");
    assert.equal(s.isMonthlyNote(file(`${PLANNER}/2026-09.md`)), false);
    assert.equal(s.isMonthlyNote(file(`${PLANNER}/months/2026-09-07.md`)), false);
});

test("monthly notes: the months folder follows Notebook Navigator, or sits beside the daily notes", () => {
    assert.equal(load(app({ ...NN, calendarCustomMonthPattern: "[periodic/months]/YYYY-MM" })).monthsFolder(), `${PLANNER}/periodic/months`);
    // A month pattern with a date in its folder isn't one fixed folder: fall back
    assert.equal(load(app({ ...NN, calendarCustomMonthPattern: "YYYY/[months]/MM" })).monthsFolder(), `${PLANNER}/months`);
    assert.equal(load(app(null)).monthsFolder(), `${PLANNER}/months`);
});

test("Schedule reads 🗒️, 🗒 and 🔗 as a task's note link, and writes 🗒️ (OBS-87)", () => {
    const Schedule = vm.runInContext(code + "\n;Schedule", vm.createContext({}));
    for (const mark of ["🗒️", "🗒", "🔗", "🔗️"]) assert.ok(Schedule.NOTE_LINK.test(`Draft the brief [[Draft the brief|${mark}]]`), mark);
    assert.ok(!Schedule.NOTE_LINK.test("Draft the brief [[Studio|⭕]]"));
    assert.equal(Schedule.NOTE_MARK, "🗒️");
    // The two links it writes (a worked-on task's note, found or made through AddTaskNote, and a line
    // sent from another note) both use the mark, and none is written with 🔗
    assert.equal((code.match(/Schedule\.NOTE_MARK/g) ?? []).length, 2);
    assert.doesNotMatch(code, /\|🔗\]\]`/);
});

// Schedule beside AddTaskNote, on a stand-in vault of notes at `paths` ([path, tags]), whose folders
// know their parents
const withVault = (paths) => {
    const folders = new Map();
    const folder = (path) => {
        if (!path) return { path: "/", name: "", parent: null };
        if (!folders.has(path)) folders.set(path, { path, name: path.split("/").pop(), parent: folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "") });
        return folders.get(path);
    };
    const files = paths.map(([path, tags, more = {}]) => ({ path, name: path.split("/").pop(), basename: path.split("/").pop().replace(/\.md$/, ""), extension: "md", parent: folder(path.slice(0, path.lastIndexOf("/"))), cache: { frontmatter: { tags, ...more } } }));
    const app = {
        vault: { getMarkdownFiles: () => files, getFileByPath: (p) => files.find((f) => f.path === p) ?? null },
        metadataCache: {
            getFileCache: (f) => f.cache ?? null,
            getFirstLinkpathDest: (name) => files.find((f) => f.basename.toLowerCase() === name.toLowerCase()) ?? null,
        },
    };
    const context = vm.createContext({ app, customJS: { obsidian: { getAllTags: (cache) => cache.frontmatter.tags.map((t) => `#${t}`) } } });
    const AddTaskNote = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", import.meta.url), "utf8") + "\n;AddTaskNote", context);
    context.customJS.AddTaskNote = new AddTaskNote();
    return { schedule: new (vm.runInContext(code + "\n;Schedule", context))(), file: (p) => files.find((f) => f.path === p) };
};
const DEMO = [
    ["Projects/Freelance/Freelance.md", ["area"]],
    ["Projects/Freelance/Kestrel/Kestrel.md", ["project"]],
    ["Projects/Freelance/Kestrel/Draft wireframes.md", ["task"]],
    ["Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md", ["log"]],
    ["Projects/Household/Household.md", ["area"]],
    ["Projects/Household/Fix the gate.md", ["task"]],
    ["Projects/Freelance/Old Job/Old Job.md", ["project"], { completed: true }],
    ["Projects/Freelance/Old Job/Old sub.md", ["task"]],
    ["10 Inbox/Loose idea.md", []],
];

test("sentLine: a line sent from a project or area links it before any note link; from a note, that note's project, then the note (OBS-90)", () => {
    const { schedule, file } = withVault(DEMO);
    const project = file("Projects/Freelance/Kestrel/Kestrel.md");
    assert.equal(schedule.sentLine("- [ ] Sign-off call", project), "- [ ] Sign-off call [[Kestrel|⭕]]", "no trailing space");
    assert.equal(schedule.sentLine("- [ ] Shot list [[Shot list|🗒️]]", project), "- [ ] Shot list [[Kestrel|⭕]] [[Shot list|🗒️]]", "before the line's own note");
    assert.equal(schedule.sentLine("- [ ] Mow", file("Projects/Household/Household.md")), "- [ ] Mow [[Household|🗃️]]");
    assert.equal(schedule.sentLine("- [ ] Sign-off call [[Household|🗃️]]", project), "- [ ] Sign-off call [[Household|🗃️]]", "a line with its own ⭕ or 🗃️ keeps it");
    // From a task note or a log: its project, then the link back to it
    assert.equal(schedule.sentLine("- [/] Mobile layout ", file("Projects/Freelance/Kestrel/Draft wireframes.md")),
        "- [/] Mobile layout [[Kestrel|⭕]] [[Draft wireframes|🗒️]]");
    assert.equal(schedule.sentLine("- [ ] Send the notes", file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md")),
        "- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Homepage review|🗒️]]");
    assert.equal(schedule.sentLine("- [ ] Send the notes [[Household|🗃️]]", file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md")),
        "- [ ] Send the notes [[Household|🗃️]] [[2026-09-14 Homepage review|🗒️]]", "its own ⭕ or 🗃️ instead");
    assert.equal(schedule.sentLine("- [ ] Think it over", file("10 Inbox/Loose idea.md")), "- [ ] Think it over [[Loose idea|🗒️]]", "a note in no project");
    // A sub-task with a note of its own keeps it as its note, named with its own project, and gets no second note link
    assert.equal(schedule.sentLine("- [ ] Fix the gate [[Fix the gate|🗒️]]", file("Projects/Freelance/Kestrel/Draft wireframes.md")),
        "- [ ] Fix the gate [[Household|🗃️]] [[Fix the gate|🗒️]]");
    assert.equal(schedule.sentLine("- [ ] Fix the gate [[Fix the gate|🗒️]]", project), "- [ ] Fix the gate [[Household|🗃️]] [[Fix the gate|🗒️]]", "from a project note too");
    assert.equal(schedule.sentLine("- [ ] New idea [[Not made yet|🗒️]]", project), "- [ ] New idea [[Kestrel|⭕]] [[Not made yet|🗒️]]", "a note that doesn't exist yet: the source's project");
    // A note in a finished project names none: its time counts there, not in the source's project
    assert.equal(schedule.sentLine("- [ ] Old sub [[Old sub|🗒️]]", project), "- [ ] Old sub [[Old sub|🗒️]]");
    // A ⭕ in the text is the title's, not the line's: the line still gets its own
    assert.equal(schedule.sentLine("- [ ] Talk to [[Household|🗃️]] about it", file("Projects/Freelance/Kestrel/Draft wireframes.md")),
        "- [ ] Talk to [[Household|🗃️]] about it [[Kestrel|⭕]] [[Draft wireframes|🗒️]]");
    // A block ID stays last
    assert.equal(schedule.sentLine("- [ ] Send the notes ^a1b2", file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md")),
        "- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Homepage review|🗒️]] ^a1b2");
});

test("withNote: a worked-on task's lines keep their ⭕ as the note's project, name without dates, the 🗒️ last (OBS-90)", () => {
    const { schedule } = withVault(DEMO);
    const found = { name: "Draft wireframes", linktext: "Draft wireframes", homeLink: "[[Kestrel|⭕]]", projectLinks: ["[[Kestrel|⭕]]"] };
    const line = "- [>] 2026-09-18 Draft wireframes [[Kestrel|⭕]]";
    assert.equal(schedule.withNote(line, 6, "2026-09-18 Draft wireframes", found), "- [>] Draft wireframes [[Kestrel|⭕]] [[Draft wireframes|🗒️]]");
    // The note stayed in another project (Leave it): the line's ⭕ follows it
    const left = { ...found, homeLink: "[[Household|🗃️]]" };
    assert.equal(schedule.withNote("- [ ] Draft wireframes [[Kestrel|⭕]]", 6, "Draft wireframes", left), "- [ ] Draft wireframes [[Household|🗃️]] [[Draft wireframes|🗒️]]");
    // A due date stays ahead of both
    assert.equal(schedule.withNote("- [/] Draft wireframes [[2026-09-30|🚩 9/30]]", 6, "Draft wireframes", { ...found, projectLinks: [] }),
        "- [/] Draft wireframes [[2026-09-30|🚩 9/30]] [[Kestrel|⭕]] [[Draft wireframes|🗒️]]");
    // A name that also appears in the checkbox's text isn't replaced there
    assert.equal(schedule.withNote("- [x] x", 6, "x", { name: "x", linktext: "x", homeLink: null, projectLinks: [] }), "- [x] x [[x|🗒️]]");
});
