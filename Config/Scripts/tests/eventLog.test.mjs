// Event logs made in code (EventLog, OBS-122): Add note on an event line, New event log, a ⋯ link clicked to a
// log not made yet (FinishLinkedLogs), and CalNav's Open Log Note (openLog), on a stand-in vault with the real
// classes. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { standIn, NN, PLANNER, YAML } from "./standInVault.mjs";
import { loadClass } from "../../../plugin/classShape.mjs";
import { plainName } from "./dayNames.mjs";

const day = (d) => `${PLANNER}/days/${d}.md`;
const KES = "Projects/Freelance/Kestrel/Kestrel.md";
const LOGS = "Projects/Freelance/Kestrel/›logs";
const TPL = "Templates/Log.md";
const NOTES = {
    [KES]: "---\ntags: [project]\naliases:\n  - Kestrel Outfitters\n---\n",
    [day("2026-09-17")]: [
        "- [<] 9:00am\tKestrel standup [[Kestrel|⭕]] ^e-q7m2xk",
        "\t- 9:20am",
        "- [<] 1:00pm\tCall with Rafe [[Kestrel|⭕]]",
        "\t- 1:30pm",
        "- [<] 7:30am\tRun with the club",
        "\t- 8:30am",
        "- [ ] Send the invoice",
        "",
    ].join("\n"),
};
const plain = (x) => JSON.parse(JSON.stringify(x));
// A log as Plainday writes it: its alias, its tag, its parent, its day and times, an empty `who`
const logText = ({ alias, parent = "", date, time = "", endTime = "", body = "" }) => [
    "---", "aliases:", `  - ${alias}`, "tags:", "  - log", parent ? `parent: ${JSON.stringify(parent)}` : "parent:", `date: ${date}`,
    time ? `time: ${time}` : "time:", endTime ? `endTime: ${endTime}` : "endTime:", "who:", "---", body,
].join("\n");

test("Add note on an event line makes its log without Templater: in its project's ›logs, Plainday's properties in one write, the line linked before its ID (OBS-122)", async () => {
    const v = standIn({ notes: NOTES, open: day("2026-09-17"), at: 0 });
    await v.addTaskNote();
    const notes = v.notes();
    assert.equal(notes[day("2026-09-17")].split("\n")[0], "- [<] 9:00am\tKestrel standup [[Kestrel|⭕]] [[2026-09-17 Kestrel standup|⋯]] ^e-q7m2xk");
    assert.equal(notes[`${LOGS}/2026-09-17 Kestrel standup.md`],
        logText({ alias: "9/17/26 Kestrel standup", parent: "[[Kestrel|Kestrel Outfitters]]", date: "2026-09-17", time: "9:00am", endTime: "9:20am" }));
    assert.equal(v.app.workspace.getActiveFile().path, day("2026-09-17"), "you stay in the daily note");
    assert.deepEqual(v.notices, []);
    // A line whose ⭕ names nothing: the Inbox, with an empty parent, and the times still
    const w = standIn({ notes: NOTES, open: day("2026-09-17"), at: 4 });
    await w.addTaskNote();
    assert.equal(w.notes()["Inbox/2026-09-17 Run with the club.md"], logText({ alias: "9/17/26 Run with the club", date: "2026-09-17", time: "7:30am", endTime: "8:30am" }));
});

test("make: an event line of that title gets the log's link; with none, a line is added after the day's events; a log of that name is found, not made again (OBS-122)", async () => {
    const v = standIn({ notes: NOTES, open: day("2026-09-17"), at: 6 });
    const log = v.plainday.EventLog;
    const linked = await log.make({ date: "2026-09-17", title: "Call with Rafe" });
    assert.equal(linked.made, true);
    assert.equal(linked.file.path, `${LOGS}/2026-09-17 Call with Rafe.md`);
    assert.equal(v.notes()[day("2026-09-17")].split("\n")[2], "- [<] 1:00pm\tCall with Rafe [[Kestrel|⭕]] [[2026-09-17 Call with Rafe|⋯]]");
    assert.match(v.notes()[linked.file.path], /\ntime: 1:00pm\nendTime: 1:30pm\n/);
    const added = await log.make({ date: "2026-09-17", title: "Coffee with Odile" });
    const lines = v.notes()[day("2026-09-17")].split("\n");
    assert.equal(lines[6], "- [<] Coffee with Odile [[2026-09-17 Coffee with Odile|⋯]]", "after the events, above the tasks");
    assert.equal(lines[7], "- [ ] Send the invoice");
    assert.equal(v.notes()[added.file.path], logText({ alias: "9/17/26 Coffee with Odile", date: "2026-09-17" }));
    assert.equal(added.file.path, "Inbox/2026-09-17 Coffee with Odile.md");
    const again = await log.make({ date: "2026-09-17", title: "Coffee with Odile" });
    assert.deepEqual([again.made, again.file.path], [false, added.file.path]);
    assert.equal(v.notes()[day("2026-09-17")].split("\n").filter((l) => l.includes("Coffee with Odile")).length, 1, "one line");
    // A title with nothing a file can be named after makes nothing
    assert.equal(await log.make({ date: "2026-09-17", title: " ??? " }), null);
    assert.equal(v.notices.at(-1), "No title to name the log");
    // A day with no note yet: the note is made, then the line goes in it
    const fresh = await log.make({ date: "2026-09-19", title: "Kickoff" });
    assert.equal(fresh.file.path, "Inbox/2026-09-19 Kickoff.md");
    assert.match(v.notes()[day("2026-09-19")], /- \[<\] Kickoff \[\[2026-09-19 Kickoff\|⋯\]\]\n$/);
});

test("the Log template, when there is one: without Templater a plain one is filled in, its properties combined and Plainday's kept; one with Templater code is skipped (OBS-122)", async () => {
    const tpl = "---\ntopic:\ndate: 2020-01-01\naliases:\n  - Meeting\n---\n## Agenda\n\n{{title}}\n";
    const v = standIn({ notes: { ...NOTES, [TPL]: tpl }, open: day("2026-09-17"), at: 0 });
    await v.addTaskNote();
    const text = v.notes()[`${LOGS}/2026-09-17 Kestrel standup.md`];
    const fm = YAML.parseYaml(YAML.getFrontMatterInfo(text).frontmatter);
    assert.equal(fm.date, "2026-09-17", "Plainday's date wins");
    assert.ok("topic" in fm, "the template's own property is kept");
    assert.deepEqual(fm.aliases, ["9/17/26 Kestrel standup", "Meeting"], "Plainday's alias first, the template's after it");
    assert.match(text, /\n---\n## Agenda\n\n2026-09-17 Kestrel standup\n$/, "its text below the properties, filled in");
    // Templater code with Templater off: made without it, and said so
    const w = standIn({ notes: { ...NOTES, [TPL]: "<% tp.date.now() %>\n" }, open: day("2026-09-17"), at: 0 });
    await w.addTaskNote();
    assert.equal(w.notes()[`${LOGS}/2026-09-17 Kestrel standup.md`],
        logText({ alias: "9/17/26 Kestrel standup", parent: "[[Kestrel|Kestrel Outfitters]]", date: "2026-09-17", time: "9:00am", endTime: "9:20am" }));
    assert.deepEqual(w.notices, ["Log holds Templater code and Templater is off, so the new log was made without it."]);
});

test("the Log template through Templater: its properties added, then Plainday's values and alias first again, and log among the tags (OBS-122)", async () => {
    const v = standIn({ notes: { ...NOTES, [TPL]: "---\ndate: 2020-01-01\ntopic: Planning\n---\n## Agenda\n" }, open: day("2026-09-17"), at: 0 });
    const ran = [];
    v.app.plugins.getPlugin = (id) => (id === "templater-obsidian" ? { templater: {
        // Templater 2 adds a template's properties to the note's and its text after them
        write_template_to_file: async (t, f) => {
            ran.push(`${t.path} on ${f.path}`);
            await v.app.vault.process(f, (text) => text.replace("who:\n", "who:\ntopic: Planning\n").replace(/^(---\n[\s\S]*?\n)date: 2026-09-17\n/, "$1date: 2020-01-01\n") + "## Agenda\n");
        },
    } } : null);
    await v.addTaskNote();
    const path = `${LOGS}/2026-09-17 Kestrel standup.md`;
    assert.deepEqual(ran, [`${TPL} on ${path}`]);
    const fm = YAML.parseYaml(YAML.getFrontMatterInfo(v.notes()[path]).frontmatter);
    assert.equal(fm.date, "2026-09-17", "Plainday's date put back");
    assert.equal(fm.topic, "Planning");
    assert.match(v.notes()[path], /## Agenda\n$/);
});

test("a Log template's id goes first, before the log's alias: through Templater, which adds it last, and without, in the one write (OBS-317)", async () => {
    const path = `${LOGS}/2026-09-17 Kestrel standup.md`;
    const first = (text) => text.split("\n").slice(0, 4).join("\n");
    // Through Templater, as the template adds it: after Plainday's properties; nothing of Plainday's to put back
    const v = standIn({ notes: { ...NOTES, [TPL]: "(the template)" }, open: day("2026-09-17"), at: 0 });
    v.app.plugins.getPlugin = (id) => (id === "templater-obsidian" ? { templater: {
        write_template_to_file: async (t, f) => v.app.vault.process(f, (text) => text.replace("who:\n", "who:\nid: 2026091712000000\n")),
    } } : null);
    await v.addTaskNote();
    assert.equal(first(v.notes()[path]), "---\nid: 2026091712000000\naliases:\n  - 9/17/26 Kestrel standup");
    assert.equal(v.notes()[path].replace("id: 2026091712000000\n", ""),
        logText({ alias: "9/17/26 Kestrel standup", parent: "[[Kestrel|Kestrel Outfitters]]", date: "2026-09-17", time: "9:00am", endTime: "9:20am" }), "nothing else moved");
    // Without Templater, a plain template with an id and a property of its own: the id first, its own after Plainday's
    const w = standIn({ notes: { ...NOTES, [TPL]: "---\ntopic: Planning\nid: 2026091712000000\n---\n" }, open: day("2026-09-17"), at: 0 });
    await w.addTaskNote();
    assert.equal(first(w.notes()[path]), "---\nid: 2026091712000000\naliases:\n  - 9/17/26 Kestrel standup");
    assert.match(w.notes()[path], /\nwho:\ntopic: Planning\n---\n$/);
});

test("finish: a blank note an event line's ⋯ links becomes its log, filed where the line says; any other blank dated note is left alone (OBS-122)", async () => {
    const notes = { ...NOTES, [day("2026-09-18")]: "- [<] 10:30am\tWireframe sign-off [[Kestrel|⭕]] [[2026-09-18 Wireframe sign-off|⋯]]\n\t- 11:00am\n" };
    const v = standIn({ notes: { ...notes, "2026-09-18 Wireframe sign-off.md": "", "2026-09-19 Kickoff.md": "" } });
    const log = v.plainday.EventLog;
    assert.equal(await log.finish(v.app.vault.getFileByPath("2026-09-18 Wireframe sign-off.md")), "finished");
    const path = `${LOGS}/2026-09-18 Wireframe sign-off.md`;
    assert.equal(v.notes()[path], logText({ alias: "9/18/26 Wireframe sign-off", parent: "[[Kestrel|Kestrel Outfitters]]", date: "2026-09-18", time: "10:30am", endTime: "11:00am" }));
    assert.equal(v.notes()["2026-09-18 Wireframe sign-off.md"], undefined, "moved, not copied");
    assert.equal(await log.finish(v.app.vault.getFileByPath("2026-09-19 Kickoff.md")), null, "no line links it");
    assert.equal(v.notes()["2026-09-19 Kickoff.md"], "");
    // One with something in it already is someone else's
    const w = standIn({ notes: { ...notes, "2026-09-18 Wireframe sign-off.md": "Notes\n" } });
    assert.equal(await w.plainday.EventLog.finish(w.app.vault.getFileByPath("2026-09-18 Wireframe sign-off.md")), null);
    assert.equal(w.notes()["2026-09-18 Wireframe sign-off.md"], "Notes\n");
});

test("FinishLinkedLogs finishes only a note made blank here just now, named with a day and a title, that Templater isn't writing (OBS-122)", async () => {
    const finished = [];
    let pending = new Set();
    const files = new Map();
    const app = { vault: { getFileByPath: (p) => files.get(p) ?? null } };
    // The real EventLog reads a name's day, by the demo's names; what it would finish is recorded
    const plainday = { plugin: {}, PeriodicNotes: { pending: () => pending, reader: () => plainName } };
    plainday.EventLog = Object.assign(new (loadClass("eventLog.js", vm.createContext({ app, plainday })))(), {
        making: new Map([["2026-09-18 Ours", 1]]), finish: async (f) => { finished.push(f.path); return "finished"; },
    });
    const C = loadClass("finishLinkedLogs.js", vm.createContext({ app, plainday, window: {}, setTimeout, console }));
    const f = new C();
    const note = (path, { size = 0, ctime = 1000, extension = "md" } = {}) => {
        const file = { path, basename: path.split("/").pop().replace(/\.md$/, ""), extension, stat: { size, ctime } };
        files.set(path, file);
        return file;
    };
    assert.equal(await f.onCreate(note("2026-09-18 Wireframe sign-off.md"), 2000), "finished");
    for (const [why, file] of [
        ["no title", note("2026-09-18.md")], ["not a day", note("Kickoff.md")], ["a week, not a day", note("2026w38 Review.md")], ["Plainday is making it", note("Inbox/2026-09-18 Ours.md")],
        ["it has text", note("2026-09-18 Notes.md", { size: 12 })], ["it arrived (an old creation time)", note("2026-09-18 Synced.md", { ctime: 1000 - 6000 })],
        ["not a note", note("2026-09-18 Board.canvas", { extension: "canvas" })],
    ]) assert.equal(await f.onCreate(file, 2000), null, why);
    pending = new Set(["2026-09-18 Templated.md"]);
    assert.equal(await f.onCreate(note("2026-09-18 Templated.md"), 2000), null, "Templater is writing it (CalNav's older path)");
    assert.deepEqual(finished, ["2026-09-18 Wireframe sign-off.md"]);
});

test("openLog, for CalNav: finds the event's line as CalNav did, links it before its ID, makes the log and opens it; a second call opens the same log (OBS-122)", async () => {
    const v = standIn({ notes: NOTES, open: KES });
    // The stand-in's moment, which also reads an event's start as CalNav sends it, a local time
    const base = v.globals.moment;
    const moment = (text, ...rest) => {
        const at = rest.length ? null : String(text ?? "").match(/T(\d{2}):(\d{2})/);
        if (!at) return base(text, ...rest);
        const h = Number(at[1]);
        return { format: (f) => (f === "h:mma" ? `${h % 12 || 12}:${at[2]}${h < 12 ? "am" : "pm"}` : assert.fail(`format ${f}`)) };
    };
    Object.assign(moment, base);
    v.plainday.EventLog = new (loadClass("eventLog.js", vm.createContext({ ...v.globals, moment })))();
    const opened = [];
    v.app.workspace.getLeaf = () => ({ openFile: async (f) => { opened.push(f.path); } });
    const r = plain(await v.plainday.EventLog.openLog({ date: "2026-09-17", title: "Kestrel standup", start: "2026-09-17T09:00:00", allDay: false }));
    const path = `${LOGS}/2026-09-17 Kestrel standup.md`;
    assert.deepEqual(r, { status: "created", name: "2026-09-17 Kestrel standup", path, linked: true, dailyNote: true });
    assert.equal(v.notes()[day("2026-09-17")].split("\n")[0], "- [<] 9:00am\tKestrel standup [[Kestrel|⭕]] [[2026-09-17 Kestrel standup|⋯]] ^e-q7m2xk");
    assert.match(v.notes()[path], /\ntime: 9:00am\nendTime: 9:20am\n/);
    const again = plain(await v.plainday.EventLog.openLog({ date: "2026-09-17", title: "Kestrel standup", start: "2026-09-17T09:00:00" }));
    assert.equal(again.status, "opened");
    assert.deepEqual(opened, [path, path]);
    assert.equal(v.notes()[day("2026-09-17")].split("\n").filter((l) => l.includes("Kestrel standup")).length, 1, "one line, one link");
    // No line for the event: a log named for it, in the Inbox, and a line added
    const none = plain(await v.plainday.EventLog.openLog({ date: "2026-09-17", title: "Hallway chat", allDay: true }));
    assert.deepEqual([none.status, none.path, none.linked], ["created", "Inbox/2026-09-17 Hallway chat.md", false]);
    assert.deepEqual(plain(await v.plainday.EventLog.openLog({ date: "someday", title: "x" })), { error: "someday isn't a date" });
});

test("New event log: the day of the daily note you're in, else today; the title typed makes the log and opens it (OBS-122)", async () => {
    const v = standIn({ notes: NOTES, open: day("2026-09-17"), today: "2026-09-16" });
    const NewEventLog = loadClass("newEventLog.js", v.globals);
    const cmd = new NewEventLog();
    assert.equal(cmd.day(), "2026-09-17");
    v.open(KES, 0);
    assert.equal(cmd.day(), "2026-09-16", "anywhere else, today");
    v.open(day("2026-09-17"), 0);
    const opened = [];
    v.plainday.EventLog.open = async (f) => { opened.push(f.path); };
    cmd.ask = async (date) => (date === "2026-09-17" ? "Call with Rafe" : null);
    await cmd.invoke();
    assert.deepEqual(opened, [`${LOGS}/2026-09-17 Call with Rafe.md`]);
    cmd.ask = async () => null;
    await cmd.invoke();
    assert.equal(opened.length, 1, "nothing typed, nothing made");
    // The box says the day in words near today, else as Plainday writes dates
    assert.deepEqual(["2026-09-16", "2026-09-17", "2026-09-15", "2026-11-21"].map((d) => cmd.when(d, "2026-09-16")),
        ["Today", "Tomorrow", "Yesterday", "Sat 11/21/26"]);
});

test("in a vault whose daily notes are named DD-MM-YYYY, a log is named with the day's name, its date still YYYY-MM-DD: Add note, New event log, a clicked link (OBS-300)", async () => {
    const DD = { ...NN, calendarIntegrationMode: "notebook-navigator", calendarCustomFilePattern: "[days]/DD-MM-YYYY" };
    const dd = (d) => `${PLANNER}/days/${d}.md`;
    const notes = {
        [KES]: NOTES[KES], [dd("17-09-2026")]: NOTES[day("2026-09-17")],
        [dd("18-09-2026")]: "- [<] 10:30am\tWireframe sign-off [[Kestrel|⭕]] [[18-09-2026 Wireframe sign-off|⋯]]\n\t- 11:00am\n",
        "18-09-2026 Wireframe sign-off.md": "",
    };
    const v = standIn({ nn: DD, notes, open: dd("17-09-2026"), at: 0 });
    await v.addTaskNote();
    assert.equal(v.notes()[dd("17-09-2026")].split("\n")[0], "- [<] 9:00am\tKestrel standup [[Kestrel|⭕]] [[17-09-2026 Kestrel standup|⋯]] ^e-q7m2xk");
    assert.equal(v.notes()[`${LOGS}/17-09-2026 Kestrel standup.md`],
        logText({ alias: "9/17/26 Kestrel standup", parent: "[[Kestrel|Kestrel Outfitters]]", date: "2026-09-17", time: "9:00am", endTime: "9:20am" }));
    // New event log takes the day from the daily note's name, read the same way
    const cmd = new (loadClass("newEventLog.js", v.globals))();
    assert.equal(cmd.day(), "2026-09-17");
    v.plainday.EventLog.open = async () => {};
    cmd.ask = async () => "Coffee with Odile";
    await cmd.invoke();
    assert.equal(v.notes()[dd("17-09-2026")].split("\n")[6], "- [<] Coffee with Odile [[17-09-2026 Coffee with Odile|⋯]]");
    assert.equal(v.notes()["Inbox/17-09-2026 Coffee with Odile.md"], logText({ alias: "9/17/26 Coffee with Odile", date: "2026-09-17" }));
    // A clicked ⋯ to a log named the day's way becomes that log
    const log = v.plainday.EventLog;
    assert.equal(await log.finish(v.app.vault.getFileByPath("18-09-2026 Wireframe sign-off.md")), "finished");
    assert.equal(v.notes()[`${LOGS}/18-09-2026 Wireframe sign-off.md`],
        logText({ alias: "9/18/26 Wireframe sign-off", parent: "[[Kestrel|Kestrel Outfitters]]", date: "2026-09-18", time: "10:30am", endTime: "11:00am" }));
    // A name spelled YYYY-MM-DD isn't a day's log in this vault; CalNav's openLog names its log the day's way too
    assert.equal(log.dayOf("2026-09-17 Kestrel standup"), null);
    assert.equal(log.nameFor("2026-09-16", "Sync: Q3 plan"), "16-09-2026 Sync - Q3 plan");
});
