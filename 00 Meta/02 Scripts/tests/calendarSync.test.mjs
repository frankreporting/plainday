// Tests for CustomJS/calendarSync.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it. The pure parts (applyOne, runOps,
// findBlock) are tested on note text; whole runs go through run() against an in-memory vault, with
// just enough of moment for the formats the sync uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../CustomJS/calendarSync.js", import.meta.url), "utf8");
const TODAY = "2026-09-15";
const DAYS = "Planner/days";
const EVENTS = "00 Meta/02 Scripts/Calendar/calendar-events.json";
const LEDGER = "00 Meta/02 Scripts/Calendar/calendar-sync.json";
const NOTE = "00 Meta/Calendar Sync.md";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// moment, for the calls the sync makes: moment(), moment(date, "YYYY-MM-DD", true), moment(iso)
function moment(input = `${TODAY}T09:00:00-04:00`) {
    const s = String(input);
    const date = s.slice(0, 10);
    const [y, m, d] = date.split("-").map(Number);
    const clock = () => {
        const [hh, mm] = s.slice(11, 16).split(":").map(Number);
        return `${hh % 12 || 12}:${String(mm).padStart(2, "0")}${hh < 12 ? "am" : "pm"}`;
    };
    const formats = {
        "h:mma": clock,
        "M/D": () => `${m}/${d}`,
        "M/D/YY dddd": () => `${m}/${d}/${String(y).slice(2)} ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`,
        "YYYY-MM-DD h:mma": () => `${date} ${clock()}`,
        "YYYYMMDDHHmmssSS": () => "2026091509000000",
    };
    const self = {
        date,
        startOf: () => self,
        isBefore: (other) => date < other.date,
        format: (f) => {
            if (!formats[f]) throw new Error(`moment stub: no format ${f}`);
            return formats[f]();
        },
    };
    return self;
}

function makeApp(files) {
    const map = new Map(Object.entries(files));
    const app = {
        isMobile: true,   // no fetcher: the events file is whatever the test wrote
        vault: {
            getFileByPath: (p) => (map.has(p) ? { path: p } : null),
            getFolderByPath: () => ({}),
            createFolder: async () => {},
            create: async (p, text) => { map.set(p, text); return { path: p }; },
            read: async (f) => map.get(f.path),
            process: async (f, fn) => { const t = fn(map.get(f.path)); map.set(f.path, t); return t; },
            adapter: {
                exists: async (p) => map.has(p),
                read: async (p) => map.get(p),
                write: async (p, t) => { map.set(p, t); },
            },
        },
        foldManager: { load: () => null },
        workspace: { getLeavesOfType: () => [] },
    };
    return { app, map };
}

function load(app = {}) {
    const context = vm.createContext({
        app,
        window: { moment },
        customJS: { Schedule: { dailyOpts: () => ({ folder: DAYS }) } },
        console,
    });
    return new (vm.runInContext(code + "\n;CalendarSync", context))();
}

const cs = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
const text = (...lines) => lines.join("\n");
const FM = ["---", "aliases: 9/16/26 Wednesday", "---"];
const note = (...lines) => text(...FM, ...lines, "");

// The ledger entry for a line the sync wrote, and the ops the planner makes
const ENTRY = {
    id: "E1", calendarId: "cal", title: "Planning", date: "2026-09-16",
    lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], confirmed: true,
};
const event = (over = {}) => ({
    key: "E1", id: "E1", calendarId: "cal", title: "Planning", date: "2026-09-16",
    start: "2026-09-16T16:00:00-04:00", end: "2026-09-16T16:30:00-04:00",
    allDay: false, recurring: false, status: "none", ...over,
});
const replace = (lines, entry = ENTRY) => ({ kind: "replace", key: "E1", entry, event: event(), lines });
const run = (before, op) => {
    const out = cs.runOps(before, [op]);
    return { text: out.text, outcome: out.outcomes[0].outcome, result: out.outcomes[0] };
};

// ------------------------------------------------------------------ same day, new time or title

test("⭕ added, then the event's time changes: time updated, ⭕ kept", () => {
    const before = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm", "- [ ] A task");
    const { text: after, outcome } = run(before, replace(["- [<] 5:00pm\tPlanning", "\t- 5:30pm"]));
    assert.equal(outcome, "replaced");
    assert.equal(after, note("- [<] 5:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 5:30pm", "- [ ] A task"));
});

test("⭕ and a time range added, then the title changes: title updated, both kept", () => {
    const before = note(
        "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]",
        "\t- 4:00pm - 4:30pm: 🆓",
        "\t\t- invoiced later",
        "\t- 4:45pm – ",
    );
    const { text: after, outcome } = run(before, replace(["- [<] 4:00pm\tPlanning (moved room)", "\t- 4:30pm"]));
    assert.equal(outcome, "replaced");
    assert.equal(after, note(
        "- [<] 4:00pm\tPlanning (moved room) [[Pinecone Studio|⭕]]",
        "\t- 4:00pm - 4:30pm: 🆓",
        "\t\t- invoiced later",
        "\t- 4:45pm – ",
    ));
});

test("end line kept beside a time entry is updated in place", () => {
    const before = note("- [<] 4:00pm\tPlanning", "\t- 4:30pm", "\t- 4:00pm - 4:20pm");
    const { text: after } = run(before, replace(["- [<] 4:00pm\tPlanning", "\t- 5:00pm"]));
    assert.equal(after, note("- [<] 4:00pm\tPlanning", "\t- 5:00pm", "\t- 4:00pm - 4:20pm"));
});

test("title turned into a log link, then the time changes: link kept; a rename changes only its text (OBS-10)", () => {
    const before = note("- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 4:30pm");
    const retimed = run(before, replace(["- [<] 3:00pm\tPlanning", "\t- 3:30pm"]));
    assert.equal(retimed.outcome, "replaced");
    assert.equal(retimed.text, note("- [<] 3:00pm\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 3:30pm"));

    const renamed = run(before, replace(["- [<] 4:00pm\tQ3 planning", "\t- 4:30pm"]));
    assert.equal(renamed.text, note("- [<] 4:00pm\t[[2026-09-16 Planning|Q3 planning]] [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
});

test("the sync's end line replaced by a time entry isn't written back", () => {
    const before = note("- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm");
    const { text: after, outcome } = run(before, replace(["- [<] 4:15pm\tPlanning", "\t- 4:45pm"]));
    assert.equal(outcome, "replaced");
    assert.equal(after, note("- [<] 4:15pm\tPlanning", "\t- 4:00pm - 4:30pm"));
});

test("all day ↔ timed: the end line comes and goes, annotations stay", () => {
    const allDay = { ...ENTRY, lines: ["- [<] All day\tPlanning"] };
    const toTimed = run(note("- [<] All day\tPlanning [[Pinecone Studio|⭕]]"), replace(["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], allDay));
    assert.equal(toTimed.text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm"));

    const toAllDay = run(note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm", "\t- 4:00pm - 4:10pm"), replace(["- [<] All day\tPlanning"]));
    assert.equal(toAllDay.text, note("- [<] All day\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:10pm"));
});

test("a line with other hand edits is still yours", () => {
    const edited = [
        ["a renamed title", ["- [<] 4:00pm\tPlanning with Quincy", "\t- 4:30pm"]],
        ["a 🔗 link", ["- [<] 4:00pm\tPlanning [[Agenda|🔗]]", "\t- 4:30pm"]],
        ["a note under it", ["- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm", "\t- bring the draft"]],
        ["a changed end time", ["- [<] 4:00pm\tPlanning", "\t- 4:45pm"]],
        ["a checked box", ["- [x] 4:00pm\tPlanning", "\t- 4:30pm"]],
        ["words after a log link", ["- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] notes", "\t- 4:30pm"]],
    ];
    for (const [what, lines] of edited) {
        const before = note(...lines);
        const { text: after, outcome } = run(before, replace(["- [<] 5:00pm\tPlanning", "\t- 5:30pm"]));
        assert.equal(outcome, "yours", what);
        assert.equal(after, before, what);
    }
});

test("an entry from a ledger written before annotations behaves as before", () => {
    const old = { id: "E1", calendarId: "cal", title: "Planning", date: "2026-09-16", lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], confirmed: true };
    const { text: after, outcome } = run(note("- [<] 4:00pm\tPlanning", "\t- 4:30pm"), replace(["- [<] 5:00pm\tPlanning", "\t- 5:30pm"], old));
    assert.equal(outcome, "replaced");
    assert.equal(after, note("- [<] 5:00pm\tPlanning", "\t- 5:30pm"));
});

// ------------------------------------------------------------------ canceled

const cancel = { kind: "cancel", key: "E1", entry: ENTRY };

test("canceled: the line is marked [-] and keeps everything under it, touched or not", () => {
    for (const lines of [
        ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"],
        ["- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm"],
        ["- [<] 4:00pm\t[[2026-09-16 Planning|Planning]]", "\t- 4:30pm"],
        ["- [<] 4:00pm\tPlanning with Quincy", "\t- 4:30pm", "\t- notes"],
    ]) {
        const { text: after, outcome } = run(note(...lines, "- [ ] A task"), cancel);
        assert.equal(outcome, "canceled", lines[0]);
        assert.equal(after, note(lines[0].replace("[<]", "[-]"), ...lines.slice(1), "- [ ] A task"));
    }
});

test("canceled, but you'd marked the line some other way: left as it is", () => {
    const before = note("- [x] 4:00pm\tPlanning", "\t- 4:30pm");
    const { text: after, outcome } = run(before, cancel);
    assert.equal(outcome, "yours");
    assert.equal(after, before);
});

// ------------------------------------------------------------------ moved to another day

const moveOut = { kind: "moveOut", key: "E1", entry: ENTRY, event: event({ date: "2026-09-18" }), lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"] };

test("moved with time entries: the old line is forwarded with them", () => {
    const before = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm", "- [ ] A task");
    const { text: after, outcome } = run(before, moveOut);
    assert.equal(outcome, "forwarded");
    assert.equal(after, note("- [>] [[2026-09-18|9/18]] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm", "- [ ] A task"));
});

test("moved with only a ⭕ or log link: the old line goes once the new line has them", () => {
    const before = note("- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 4:30pm", "- [ ] A task");
    const carry = { projects: ["[[Pinecone Studio|⭕]]"], log: "[[2026-09-16 Planning|Planning]]" };
    const { text: after, outcome } = run(before, { ...moveOut, carry, landed: { asIntended: true } });
    assert.equal(outcome, "removed");
    assert.equal(after, note("- [ ] A task"));

    // The new day already had a line for it (adopted), so the links never got there: forward instead
    assert.equal(run(before, { ...moveOut, carry, landed: { asIntended: false } }).outcome, "forwarded");
    // A ⭕ added between reading the old line and removing it
    assert.equal(run(before, { ...moveOut, carry: { projects: [], log: carry.log }, landed: { asIntended: true } }).outcome, "forwarded");
});

test("an insert carries the links it's given, but never time entries", () => {
    const op = {
        kind: "insert", key: "E1", event: event({ date: "2026-09-18" }), move: true,
        lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"],
        carry: { projects: ["[[Pinecone Studio|⭕]]"], log: "[[2026-09-16 Planning|Planning]]" },
    };
    const { text: after, outcome, result } = run(note("- [ ] A task"), op);
    assert.equal(outcome, "inserted");
    assert.equal(after, note("- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 4:30pm", "- [ ] A task"));
    assert.deepEqual(plain(result.lines), ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], "the ledger keeps the sync's own lines");
});

// ------------------------------------------------------------------ matching

test("two events at the same start with similar titles: the prefix rule still refuses to guess", () => {
    const lines = text(
        "- [<] 9:00am\tStandup - Design review",
        "\t- 9:30am",
        "- [<] 9:00am\tStandup - Retro",
        "\t- 9:30am",
    ).split("\n");
    assert.equal(cs.findBlock(lines, { lines: ["- [<] 9:00am\tStandup", "\t- 9:30am"] }), null);
});

test("a ⭕ link doesn't change which line is meant", () => {
    const lines = text(
        "- [<] 9:00am\tStandup - Design review",
        "\t- 9:30am",
        "- [<] 9:00am\tStandup [[Pinecone Studio|⭕]]",
        "\t- 9:00am - 9:30am",
    ).split("\n");
    assert.deepEqual(plain(cs.findBlock(lines, { lines: ["- [<] 9:00am\tStandup", "\t- 9:30am"] })), { from: 2, to: 3 });
});

// ------------------------------------------------------------------ whole runs

const CALENDAR_NOTE = text("---", "id: 1", "tags: ", "---", "", "## Calendars", "", "### Work", "- [x] Work", "");
let clock = 0;
const feed = (events) => ({
    generatedAt: `2026-09-15T10:${String(clock++).padStart(2, "0")}:00-04:00`,
    windowStart: TODAY, windowEnd: "2026-10-15", source: "test",
    calendars: [{ id: "cal", account: "Work", title: "Work" }],
    events: events.map((e) => ({ calendar: "Work", account: "Work", endsSameDay: true, ...e })),
});
const day = (date) => `${DAYS}/${date}.md`;
const body = (t) => t.split("\n").slice(3).join("\n").replace(/\n+$/, "");

async function sync(map, events) {
    map.set(EVENTS, JSON.stringify(feed(events)));
    const { app } = { app: sync.app };
    return load(app).run();
}
function vault(files = {}) {
    const { app, map } = makeApp({ [NOTE]: CALENDAR_NOTE, ...files });
    sync.app = app;
    return map;
}
const edit = (map, path, fn) => map.set(path, fn(map.get(path)));
const ledger = (map) => JSON.parse(map.get(LEDGER));

test("run: ⭕ and a time entry survive a time change, and nothing is 'yours'", async () => {
    const map = vault();
    await sync(map, [event()]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));

    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]]\n\t- 4:00pm - 4:30pm: 🆓"));
    await sync(map, [event()]);
    assert.deepEqual(ledger(map).events.E1.projects, ["[[Pinecone Studio|⭕]]"], "the project is remembered");

    const summary = await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]);
    assert.equal(summary, "Calendar sync: 1 updated");
    assert.match(map.get(NOTE), /- 2026-09-16 Planning \(time changed; check its time entries\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm: 🆓"));
    assert.doesNotMatch(map.get(NOTE), /this line is yours/);
    assert.deepEqual(ledger(map).events.E1.lines, ["- [<] 5:00pm\tPlanning", "\t- 5:30pm"]);

    // And a run with nothing new changes nothing
    const again = map.get(day("2026-09-16"));
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: nothing to change");
    assert.equal(map.get(day("2026-09-16")), again);
});

test("run: moved to another day, the ⭕ follows and the time entries stay", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]]\n\t- 4:00pm - 4:30pm"));
    await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [>] [[2026-09-18|9/18]] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm"));
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
    assert.deepEqual(ledger(map).events.E1.projects, ["[[Pinecone Studio|⭕]]"]);
});

test("run: a ⭕ added since the last run moves with the event, and the old line goes", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]"));
    await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.equal(body(map.get(day("2026-09-16"))), "");
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
});

test("run: canceled is marked [-] and reported; back in the calendar, it's [<] again and kept current", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 4:30pm", "\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, []), "Calendar sync: 1 canceled");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [-] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm"));
    assert.match(map.get(NOTE), /\*\*Canceled \(marked \[-\]\)\*\*\n\n- 2026-09-16 Planning\n/);
    assert.equal(ledger(map).events.E1, undefined);
    assert.equal(await sync(map, []), "Calendar sync: nothing to change");

    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 restored");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 updated");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning", "\t- 4:00pm - 4:30pm"));
});

test("run: a canceled line you deleted: the event, if it returns, is written afresh", async () => {
    const map = vault();
    await sync(map, [event()]);
    await sync(map, []);
    edit(map, day("2026-09-16"), () => note());
    await sync(map, [event()]);
    assert.equal(ledger(map).canceled.E1, undefined);
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 added");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: an event whose ID changes keeps its line (it isn't canceled, or forgotten as deleted)", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\tPlanning [[Pinecone Studio|⭕]]"));
    assert.equal(await sync(map, [event({ key: "E9", id: "E9" })]), "Calendar sync: 1 adopted");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
    assert.deepEqual(Object.keys(ledger(map).events), ["E9"]);
    assert.deepEqual(ledger(map).dismissed, {});
    assert.equal(await sync(map, [event({ key: "E9", id: "E9" })]), "Calendar sync: nothing to change");
});

test("run: a new event doesn't adopt a line another event still has", async () => {
    const map = vault();
    await sync(map, [event()]);
    await sync(map, [event(), event({ key: "E2", id: "E2" })]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm", "- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.equal(await sync(map, [event(), event({ key: "E2", id: "E2" })]), "Calendar sync: nothing to change");
});

test("run: a ledger from before this change loads and behaves as before", async () => {
    const map = vault({
        [LEDGER]: JSON.stringify({ version: 1, updatedAt: "2026-09-15T08:00:00-04:00", events: { E1: { ...ENTRY } }, dismissed: {} }),
        [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning", "\t- 4:30pm"),
    });
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [event({ title: "Planning 2" })]), "Calendar sync: 1 updated");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning 2", "\t- 4:30pm"));
});

// ------------------------------------------------------------------ recurring series

const weekly = (date, over = {}) => event({
    key: `S1@${date}`, id: "S1", title: "Weekly sync", date, recurring: true,
    start: `${date}T10:00:00-04:00`, end: `${date}T10:30:00-04:00`, ...over,
});
const SERIES = ["2026-09-16", "2026-09-23", "2026-09-30"];

test("run: the Calendar Sync note lists recurring series, and a ⭕ there reaches every upcoming line", async () => {
    const map = vault();
    await sync(map, [...SERIES.map((d) => weekly(d)), event()]);
    assert.match(map.get(NOTE), /## Recurring events\n\n[^\n]*\n\n- Weekly sync\n/);
    assert.doesNotMatch(map.get(NOTE), /- Planning\n/, "one-off events aren't listed");
    assert.ok(map.get(NOTE).indexOf("## Recurring events") < map.get(NOTE).indexOf("## Last run"));

    edit(map, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Pinecone Studio|⭕]]\n"));
    assert.equal(await sync(map, [...SERIES.map((d) => weekly(d)), event()]), "Calendar sync: 3 linked");
    for (const d of SERIES) assert.match(map.get(day(d)), /- \[<\] 10:00am\tWeekly sync \[\[Pinecone Studio\|⭕\]\]\n\t- 10:30am/);
    assert.match(map.get(NOTE), /- Weekly sync \[\[Pinecone Studio\|⭕\]\]\n/, "the mapping stays");
    assert.doesNotMatch(map.get(day("2026-09-16")), /Planning \[\[/);

    // A ⭕ you take off one instance stays off
    edit(map, day("2026-09-23"), (t) => t.replace(" [[Pinecone Studio|⭕]]", ""));
    assert.equal(await sync(map, SERIES.map((d) => weekly(d)).concat(event())), "Calendar sync: nothing to change");
    assert.doesNotMatch(map.get(day("2026-09-23")), /⭕/);

    // A new instance gets it when it's written
    const more = [...SERIES, "2026-10-07"];
    await sync(map, [...more.map((d) => weekly(d)), event()]);
    assert.match(map.get(day("2026-10-07")), /Weekly sync \[\[Pinecone Studio\|⭕\]\]/);

    // Changing the mapping swaps the link where the sync put it; one you set differently stays
    edit(map, day("2026-09-30"), (t) => t.replace("[[Pinecone Studio|⭕]]", "[[Budget Book|⭕]]"));
    edit(map, NOTE, (t) => t.replace("- Weekly sync [[Pinecone Studio|⭕]]", "- Weekly sync [[Kestrel|⭕]]"));
    await sync(map, [...more.map((d) => weekly(d)), event()]);
    assert.match(map.get(day("2026-09-16")), /Weekly sync \[\[Kestrel\|⭕\]\]\n/);
    assert.doesNotMatch(map.get(day("2026-09-23")), /⭕/);
    assert.match(map.get(day("2026-09-30")), /Weekly sync \[\[Budget Book\|⭕\]\]\n/);

    // Taking the mapping away leaves the links alone, and a series gone from the feed drops off
    // the list unless it's mapped
    edit(map, NOTE, (t) => t.replace(" [[Kestrel|⭕]]", ""));
    await sync(map, [...more.map((d) => weekly(d)), event()]);
    assert.match(map.get(day("2026-09-16")), /Weekly sync \[\[Kestrel\|⭕\]\]\n/);
    await sync(map, [event()]);
    assert.doesNotMatch(map.get(NOTE), /- Weekly sync/);
});

test("run: series links skip lines with time entries or a log link, and survive a retime once taken off", async () => {
    const map = vault();
    await sync(map, SERIES.map((d) => weekly(d)));
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 10:30am", "\t- 10:00am - 10:40am"));
    edit(map, day("2026-09-23"), (t) => t.replace("\tWeekly sync", "\t[[2026-09-23 Weekly sync|Weekly sync]]"));
    edit(map, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Pinecone Studio|⭕️]]\n"));
    assert.equal(await sync(map, SERIES.map((d) => weekly(d))), "Calendar sync: 1 linked");
    assert.doesNotMatch(map.get(day("2026-09-16")), /⭕/, "time already logged keeps its project");
    assert.doesNotMatch(map.get(day("2026-09-23")), /⭕/, "a log's project comes from the log");
    assert.match(map.get(day("2026-09-30")), /\tWeekly sync \[\[Pinecone Studio\|⭕️\]\]\n/, "the link is written as you typed it");

    // Taken off, then the event is retimed: the ledger still knows, so it isn't put back
    edit(map, day("2026-09-30"), (t) => t.replace(" [[Pinecone Studio|⭕️]]", ""));
    await sync(map, SERIES.map((d) => weekly(d)));
    const later = SERIES.map((d) => weekly(d, d === "2026-09-30" ? { start: `${d}T11:00:00-04:00`, end: `${d}T11:30:00-04:00` } : {}));
    await sync(map, later);
    await sync(map, later);
    assert.match(map.get(day("2026-09-30")), /- \[<\] 11:00am\tWeekly sync\n/);

    // Nor after the mapping is taken away while the event changes, and then put back
    edit(map, NOTE, (t) => t.replace(" [[Pinecone Studio|⭕️]]", ""));
    const again = SERIES.map((d) => weekly(d, d === "2026-09-30" ? { title: "Weekly sync", start: `${d}T12:00:00-04:00`, end: `${d}T12:30:00-04:00` } : {}));
    await sync(map, again);
    edit(map, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Pinecone Studio|⭕️]]\n"));
    await sync(map, again);
    assert.match(map.get(day("2026-09-30")), /- \[<\] 12:00pm\tWeekly sync\n/);
});

test("run: no series links in a held run, or for a calendar you've unticked", async () => {
    const map = vault();
    const others = Array.from({ length: 11 }, (_, i) => event({ key: `X${i}`, id: `X${i}`, title: `One-off ${i}` }));
    await sync(map, [...SERIES.map((d) => weekly(d)), ...others]);
    edit(map, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Pinecone Studio|⭕]]\n"));
    assert.match(await sync(map, SERIES.map((d) => weekly(d))), /held back/);
    for (const d of SERIES) assert.doesNotMatch(map.get(day(d)), /⭕/);

    const unticked = vault();
    await sync(unticked, SERIES.map((d) => weekly(d)));
    edit(unticked, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Pinecone Studio|⭕]]\n").replace("- [x] Work", "- [ ] Work"));
    await sync(unticked, SERIES.map((d) => weekly(d)));
    for (const d of SERIES) assert.doesNotMatch(unticked.get(day(d)), /⭕/);
});

test("run: moved onto a day that already has a line for it, the old line is forwarded, links and all", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\t[[2026-09-16 Planning|Planning]]"));
    map.set(day("2026-09-18"), note("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    const summary = await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.match(summary, /1 adopted/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [>] [[2026-09-18|9/18]] 4:00pm\t[[2026-09-16 Planning|Planning]]", "\t- 4:30pm"));
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: a line that's yours is forwarded when its event moves, and its ⭕ still goes along", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]]\n\t- 4:30pm\n\t- bring the draft"));
    await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.match(map.get(day("2026-09-16")), /- \[>\] \[\[2026-09-18\|9\/18\]\] 4:00pm\tPlanning \[\[Pinecone Studio\|⭕\]\]\n\t- 4:30pm\n\t- bring the draft/);
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
});

test("notes under a time entry: deeper by tabs or spaces; a note beside it is yours", () => {
    const synced = ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"];
    assert.ok(cs.annotations(["- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm", "\t    - with spaces", "\t\t\t- deeper"], synced));
    assert.equal(cs.annotations(["- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm", "    - same depth in spaces"], synced), null);
    assert.equal(cs.annotations(["- [<] 4:00pm\tPlanning", "\t- 4:30pm", "\t\t- under the end time"], synced), null);
});

test("calendar ticks are read from the Calendars section only", () => {
    const t = text("## Calendars", "### Work", "- [x] Work", "## Recurring events", "- [x] Standup", "### Other", "- [x] Thing");
    assert.deepEqual([...cs.tickedTitles(t)], ["Work/Work"]);
});

const moved = (over = {}) => event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00", ...over });

test("run: moved and renamed to a title that can't sit in a link: the old line keeps the log link, forwarded", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\t[[2026-09-16 Planning|Planning]]"));
    await sync(map, [moved({ title: "Planning | Q3" })]);
    assert.match(map.get(day("2026-09-16")), /- \[>\] \[\[2026-09-18\|9\/18\]\] 4:00pm\t\[\[2026-09-16 Planning\|Planning\]\]/);
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning | Q3", "\t- 4:30pm"));
});

test("run: moved after you deleted its line: the new line is still recorded", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), () => note());
    await sync(map, [moved()]);
    assert.equal(ledger(map).events.E1.date, "2026-09-18");
    assert.equal(await sync(map, [moved()]), "Calendar sync: nothing to change");
});

test("run: a ⭕ you typed that matches the series isn't swapped when the mapping changes", async () => {
    const map = vault();
    await sync(map, [weekly("2026-09-16")]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tWeekly sync", "\tWeekly sync [[Pinecone Studio|⭕]]"));
    edit(map, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Pinecone Studio|⭕]]\n"));
    await sync(map, [weekly("2026-09-16")]);
    edit(map, NOTE, (t) => t.replace("[[Pinecone Studio|⭕]]", "[[Kestrel|⭕]]"));
    await sync(map, [weekly("2026-09-16")]);
    assert.match(map.get(day("2026-09-16")), /Weekly sync \[\[Pinecone Studio\|⭕\]\]\n/);
});

test("run: what you write in Recurring events stays; only plain titles of series that are gone drop off", async () => {
    const map = vault();
    await sync(map, [weekly("2026-09-16")]);
    edit(map, NOTE, (t) => t.replace("- Weekly sync\n", "Some words of yours.\n\n- Weekly sync\n- Board call [[Kestrel|⭕]] %% Q3 only %%\n- Old series\n- Retro [[Pinecone Studio|⭕]]\n"));
    await sync(map, [weekly("2026-09-16"), weekly("2026-09-16", { key: "S2@2026-09-16", id: "S2", title: "Design crit" })]);
    const section = map.get(NOTE).split("## Recurring events")[1].split("## Last run")[0];
    assert.match(section, /Some words of yours\.\n\n- Weekly sync\n- Board call \[\[Kestrel\|⭕\]\] %% Q3 only %%\n- Retro \[\[Pinecone Studio\|⭕\]\]\n- Design crit\n/);
    assert.doesNotMatch(section, /Old series/);
});

test("run: time entries past a blank line under an event aren't left behind under another one", async () => {
    const review = event({ key: "E2", id: "E2", title: "Review", start: "2026-09-16T15:00:00-04:00", end: "2026-09-16T15:30:00-04:00" });
    const map = vault();
    await sync(map, [review, event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]]\n\t- 4:30pm\n\n\t- 4:00pm - 4:45pm: billed"));
    const later = event({ start: "2026-09-16T14:00:00-04:00", end: "2026-09-16T14:30:00-04:00" });
    assert.equal(await sync(map, [review, later]), "Calendar sync: 1 left for you");
    assert.match(map.get(day("2026-09-16")), /- \[<\] 3:00pm\tReview\n\t- 3:30pm\n- \[<\] 4:00pm\tPlanning \[\[Pinecone Studio\|⭕\]\]\n\t- 4:30pm\n\n\t- 4:00pm - 4:45pm: billed/);
});

const section = (map) => map.get(NOTE).split("## Recurring events")[1].split("## Last run")[0];

test("run: a series follows its ID: renamed in the calendar, its line in the note is renamed and keeps the project", async () => {
    const map = vault();
    await sync(map, SERIES.map((d) => weekly(d)));
    edit(map, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Pinecone Studio|⭕]] \n"));
    await sync(map, SERIES.map((d) => weekly(d)));
    assert.equal(ledger(map).seriesTitles.S1, "Weekly sync");

    const renamed = [...SERIES, "2026-10-07"].map((d) => weekly(d, { title: "Weekly sync (studio)" }));
    await sync(map, renamed);
    assert.match(section(map), /\n- Weekly sync \(studio\) \[\[Pinecone Studio\|⭕\]\]\n/);
    assert.doesNotMatch(section(map), /- Weekly sync\n|- Weekly sync \[/);
    for (const d of SERIES) assert.match(map.get(day(d)), /\tWeekly sync \(studio\) \[\[Pinecone Studio\|⭕\]\]\n/);
    assert.match(map.get(day("2026-10-07")), /\tWeekly sync \(studio\) \[\[Pinecone Studio\|⭕\]\]\n/, "a new occurrence gets it too");
    assert.equal(ledger(map).seriesTitles.S1, "Weekly sync (studio)");
});

test("run: occurrences of one series with different titles share its project", async () => {
    const map = vault();
    const anniversary = (date, age) => weekly(date, { key: `B1@${date}`, id: "B1", title: `${age}th Anniversary`, allDay: true });
    await sync(map, [anniversary("2026-09-16", 12), anniversary("2026-10-16", 13)]);
    assert.match(section(map), /\n- 12th Anniversary\n/);
    assert.doesNotMatch(section(map), /13th/, "listed once, by the next occurrence's title");
    edit(map, NOTE, (t) => t.replace("- 12th Anniversary\n", "- 12th Anniversary [[Budget Book|⭕]]\n"));
    await sync(map, [anniversary("2026-09-16", 12), anniversary("2026-10-16", 13)]);
    assert.match(map.get(day("2026-10-16")), /- \[<\] All day\t13th Anniversary \[\[Budget Book\|⭕\]\]/);
});

test("run: when a renamed series' old title still belongs to another series, the line is copied, not moved", async () => {
    const map = vault();
    const standup = (id, title) => weekly("2026-09-16", { key: `${id}@2026-09-16`, id, title });
    await sync(map, [standup("S1", "Standup"), standup("S2", "Standup")]);
    edit(map, NOTE, (t) => t.replace("- Standup\n", "- Standup [[Kestrel|⭕]]\n"));
    await sync(map, [standup("S1", "Standup"), standup("S2", "Standup")]);
    await sync(map, [standup("S1", "Standup"), standup("S2", "Standup B")]);
    assert.match(section(map), /\n- Standup \[\[Kestrel\|⭕\]\]\n- Standup B \[\[Kestrel\|⭕\]\]\n/);
});

test("run: an event deleted and then made again (a new ID) takes back the line marked canceled", async () => {
    const map = vault();
    await sync(map, [event()]);
    await sync(map, []);
    assert.equal(await sync(map, [event({ key: "E9", id: "E9" })]), "Calendar sync: 1 adopted");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.deepEqual(ledger(map).canceled, {});
    assert.equal(await sync(map, [event({ key: "E9", id: "E9", start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 updated");

    // A [-] you set yourself is yours: a matching new event is adopted but the mark stays
    const own = vault({ [day("2026-09-16")]: note("- [-] 4:00pm\tPlanning", "\t- 4:30pm") });
    await sync(own, [event()]);
    assert.equal(body(own.get(day("2026-09-16"))), text("- [-] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: a calendar that comes back with new IDs (an account added again) adopts its lines rather than duplicating them", async () => {
    const map = vault();
    await sync(map, [event()]);
    map.set(NOTE, map.get(NOTE).replace("- [x] Work", "- [ ] Work\n### Work again\n- [x] Work"));
    map.set(EVENTS, JSON.stringify({
        ...feed([]), calendars: [{ id: "cal2", account: "Work again", title: "Work" }],
        events: [{ ...event({ key: "N1", id: "N1" }), calendarId: "cal2", calendar: "Work", account: "Work again", endsSameDay: true }],
    }));
    assert.equal(await load(sync.app).run(), "Calendar sync: 1 adopted");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.deepEqual(Object.keys(ledger(map).events), ["N1"]);
});

test("run: new events still go in time order past a line marked canceled", async () => {
    const map = vault();
    const at = (id, h) => event({ key: id, id, title: id, start: `2026-09-16T${h}:00:00-04:00`, end: `2026-09-16T${h}:30:00-04:00` });
    await sync(map, [at("A", "09"), at("B", "10"), at("C", "11")]);
    await sync(map, [at("A", "09"), at("C", "11")]);
    await sync(map, [at("A", "09"), at("C", "11"), at("D", "12"), at("Z", "10")]);
    assert.equal(body(map.get(day("2026-09-16"))), text(
        "- [<] 9:00am\tA", "\t- 9:30am", "- [-] 10:00am\tB", "\t- 10:30am", "- [<] 10:00am\tZ", "\t- 10:30am",
        "- [<] 11:00am\tC", "\t- 11:30am", "- [<] 12:00pm\tD", "\t- 12:30pm",
    ));
});

test("run: a canceled line whose [-] you changed isn't reported restored, and a lost ledger write doesn't strand a [-]", async () => {
    const map = vault();
    await sync(map, [event()]);
    await sync(map, []);
    edit(map, day("2026-09-16"), (t) => t.replace("[-]", "[x]"));
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.match(map.get(day("2026-09-16")), /- \[x\] 4:00pm\tPlanning/);

    const lost = vault();
    await sync(lost, [event()]);
    const saved = lost.get(LEDGER);
    await sync(lost, []);
    lost.set(LEDGER, saved.replace(/"updatedAt": "[^"]*"/, '"updatedAt": "2026-09-15T09:00:00-04:00"'));
    assert.equal(await sync(lost, []), "Calendar sync: 1 canceled");
    assert.equal(await sync(lost, [event()]), "Calendar sync: 1 restored");
    assert.match(lost.get(day("2026-09-16")), /- \[<\] 4:00pm\tPlanning/);
});

test("run: a held run doesn't restore canceled lines", async () => {
    const map = vault();
    const others = Array.from({ length: 11 }, (_, i) => event({ key: `X${i}`, id: `X${i}`, title: `One-off ${i}` }));
    await sync(map, [event(), ...others]);
    await sync(map, others);
    assert.match(await sync(map, [event()]), /held back/);
    assert.match(map.get(day("2026-09-16")), /- \[-\] 4:00pm\tPlanning\n/);
});

test("run: deleting one of two identical lines is still noticed when the other event is canceled", async () => {
    const map = vault();
    const e2 = event({ key: "E2", id: "E2" });
    await sync(map, [event(), e2]);
    await sync(map, [event(), e2]);
    edit(map, day("2026-09-16"), (t) => t.replace("- [<] 4:00pm\tPlanning\n\t- 4:30pm\n", ""));
    await sync(map, [e2]);
    assert.equal(Object.keys(ledger(map).dismissed).length, 1);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: series renamed in one run: chains, swaps and a shared line each keep the right project", async () => {
    const occ = (id, title) => weekly("2026-09-16", { key: `${id}@2026-09-16`, id, title });
    const setUp = async (events, links) => {
        const map = vault();
        await sync(map, events);
        edit(map, NOTE, (t) => Object.entries(links).reduce((acc, [title, link]) => acc.replace(`- ${title}\n`, `- ${title} ${link}\n`), t));
        await sync(map, events);
        return map;
    };
    const chain = await setUp([occ("S1", "Alpha"), occ("S2", "Beta")], { Alpha: "[[P1|⭕]]", Beta: "[[P2|⭕]]" });
    await sync(chain, [occ("S1", "Beta"), occ("S2", "Gamma")]);
    assert.match(section(chain), /\n- Beta \[\[P1\|⭕\]\]\n- Gamma \[\[P2\|⭕\]\]\n/);
    assert.doesNotMatch(section(chain), /Alpha/);

    const swap = await setUp([occ("S1", "Alpha"), occ("S2", "Beta")], { Alpha: "[[P1|⭕]]", Beta: "[[P2|⭕]]" });
    await sync(swap, [occ("S1", "Beta"), occ("S2", "Alpha")]);
    assert.match(section(swap), /\n- Alpha \[\[P2\|⭕\]\]\n- Beta \[\[P1\|⭕\]\]\n/);

    const shared = await setUp([occ("S1", "Standup"), occ("S2", "Standup")], { Standup: "[[Kestrel|⭕]]" });
    await sync(shared, [occ("S1", "Standup A"), occ("S2", "Standup B")]);
    assert.match(section(shared), /\n- Standup A \[\[Kestrel\|⭕\]\]\n- Standup B \[\[Kestrel\|⭕\]\]\n/);
    assert.doesNotMatch(section(shared), /- Standup \[/);
});

test("run: an event made again with a new end time takes over the old line and updates its end time", async () => {
    const map = vault();
    const days = ["2026-09-16", "2026-09-17"];
    const oneOff = (d) => event({ key: `D${d}`, id: `D${d}`, title: "Daily", date: d, start: `${d}T09:00:00-04:00`, end: `${d}T09:15:00-04:00` });
    await sync(map, days.map(oneOff));
    edit(map, day("2026-09-17"), (t) => t.replace("\tDaily", "\tDaily [[Pinecone Studio|⭕]]"));
    const series = days.map((d) => weekly(d, { key: `R1@${d}`, id: "R1", title: "Daily", start: `${d}T09:00:00-04:00`, end: `${d}T09:30:00-04:00` }));
    assert.equal(await sync(map, series), "Calendar sync: 2 adopted");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 9:00am\tDaily", "\t- 9:30am"));
    assert.equal(body(map.get(day("2026-09-17"))), text("- [<] 9:00am\tDaily [[Pinecone Studio|⭕]]", "\t- 9:30am"));
    assert.match(map.get(NOTE), /- 2026-09-16 Daily \(end time updated\)/);
    assert.equal(await sync(map, series), "Calendar sync: nothing to change");

    // A line with a note of yours is taken over as it is
    const noted = vault({ [day("2026-09-16")]: note("- [<] 9:00am\tDaily", "\t- 9:15am", "\t- bring slides") });
    await sync(noted, [series[0]]);
    assert.equal(body(noted.get(day("2026-09-16"))), text("- [<] 9:00am\tDaily", "\t- 9:15am", "\t- bring slides"));
});

test("run: a series split with \"this and future events\" (a new series ID) renames its lines instead of canceling them", async () => {
    const map = vault();
    const occ = (id, title, d, h = "10") => weekly(d, { key: `${id}@${d}`, id, title, start: `${d}T${h}:00:00-04:00`, end: `${d}T${h}:30:00-04:00` });
    const before = SERIES.map((d) => occ("S1", "Weekly sync", d));
    await sync(map, before);
    edit(map, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Pinecone Studio|⭕]]\n"));
    await sync(map, before);
    edit(map, day("2026-09-30"), (t) => t.replace("\t- 10:30am", "\t- 10:30am\n\t- 10:00am - 10:20am"));

    const after = [occ("S1", "Weekly sync", "2026-09-16"), occ("S2", "Studio sync", "2026-09-23"), occ("S2", "Studio sync", "2026-09-30")];
    assert.equal(await sync(map, after), "Calendar sync: 2 updated");
    assert.match(map.get(day("2026-09-16")), /- \[<\] 10:00am\tWeekly sync \[\[Pinecone Studio\|⭕\]\]\n/);
    assert.equal(body(map.get(day("2026-09-23"))), text("- [<] 10:00am\tStudio sync [[Pinecone Studio|⭕]]", "\t- 10:30am"));
    assert.equal(body(map.get(day("2026-09-30"))), text("- [<] 10:00am\tStudio sync [[Pinecone Studio|⭕]]", "\t- 10:30am", "\t- 10:00am - 10:20am"));
    assert.match(section(map), /\n- Weekly sync \[\[Pinecone Studio\|⭕\]\]\n- Studio sync \[\[Pinecone Studio\|⭕\]\]\n/);
    assert.deepEqual(Object.keys(ledger(map).events).sort(), ["S1@2026-09-16", "S2@2026-09-23", "S2@2026-09-30"]);
    assert.deepEqual(ledger(map).canceled, {});
    assert.equal(await sync(map, after), "Calendar sync: nothing to change");

    // The whole rest of the series split off (no old occurrences left): the line moves over, not copied
    const whole = vault();
    const two = ["2026-09-23", "2026-09-30"];
    await sync(whole, two.map((d) => occ("S1", "Weekly sync", d)));
    edit(whole, NOTE, (t) => t.replace("- Weekly sync\n", "- Weekly sync [[Kestrel|⭕]]\n"));
    await sync(whole, two.map((d) => occ("S1", "Weekly sync", d)));
    await sync(whole, two.map((d) => occ("S2", "Studio sync", d)));
    assert.match(section(whole), /\n- Studio sync \[\[Kestrel\|⭕\]\]\n/);
    assert.doesNotMatch(section(whole), /Weekly sync/);

    // At a different time it's a different event: canceled, and the new one added
    const moved = vault();
    await sync(moved, before);
    assert.equal(await sync(moved, [occ("S1", "Weekly sync", "2026-09-16"), occ("S2", "Studio sync", "2026-09-23", "11"), occ("S2", "Studio sync", "2026-09-30", "11")]), "Calendar sync: 2 added, 2 canceled");
});

// ------------------------------------------------------------------ free events (OBS-47)

test("lines: a timed free event gets ℹ️ after its title; all-day, busy, tentative, unknown and an old events file don't", () => {
    assert.deepEqual(plain(cs.lines(event({ availability: "free" }))), ["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"]);
    assert.deepEqual(plain(cs.lines(event({ availability: "free", allDay: true }))), ["- [<] All day\tPlanning"]);
    for (const availability of ["busy", "tentative", "unavailable", "unknown", undefined]) {
        assert.deepEqual(plain(cs.lines(event({ availability }))), ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], String(availability));
    }
});

test("splitTail and head: the mark and ⭕ links come off the end in either order, and don't change which line is meant", () => {
    assert.deepEqual(plain(cs.splitTail("Planning ℹ️ [[Pinecone Studio|⭕]]")), { rest: "Planning", projects: ["[[Pinecone Studio|⭕]]"], free: true });
    assert.deepEqual(plain(cs.splitTail("Planning [[Pinecone Studio|⭕]] ℹ")), { rest: "Planning", projects: ["[[Pinecone Studio|⭕]]"], free: true });
    assert.deepEqual(plain(cs.splitTail("ℹ️")), { rest: "ℹ️", projects: [], free: false });
    assert.deepEqual(plain(cs.splitTail("Planningℹ️")), { rest: "Planningℹ️", projects: [], free: false }, "no whitespace before it: part of the title");
    assert.deepEqual(plain(cs.head("- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]]")), { start: "4:00pm", title: "Planning" });
    const lines = note("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm").split("\n");
    assert.deepEqual(plain(cs.findBlock(lines, { lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"] })), { from: 3, to: 4 });
});

test("run: busy → free → busy on an untouched line: the mark comes and goes, the report says so, the ledger carries it", async () => {
    const map = vault();
    await sync(map, [event()]);
    assert.equal(await sync(map, [event({ availability: "free" })]), "Calendar sync: 1 updated");
    assert.match(map.get(NOTE), /- 2026-09-16 Planning \(now free\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"));
    assert.deepEqual(ledger(map).events.E1.lines, ["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"]);
    assert.equal(await sync(map, [event({ availability: "free" })]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [event({ availability: "busy" })]), "Calendar sync: 1 updated");
    assert.match(map.get(NOTE), /- 2026-09-16 Planning \(now busy\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: free → busy keeps the log link, the ⭕ and the time entry; the mark sits between the title and the links", async () => {
    const map = vault();
    await sync(map, [event({ availability: "free" })]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ℹ️\n\t- 4:30pm", "\t[[2026-09-16 Planning|Planning]] ℹ️ [[Pinecone Studio|⭕]]\n\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [event({ availability: "free", title: "Planning call" })]), "Calendar sync: 1 updated");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\t[[2026-09-16 Planning|Planning call]] ℹ️ [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [event({ title: "Planning call" })]), "Calendar sync: 1 updated");
    assert.match(map.get(NOTE), /Planning call \(now busy\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\t[[2026-09-16 Planning|Planning call]] [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm"));
});

test("run: the mark is the sync's: taken off or added by hand, the line is yours, and it's still found", async () => {
    const map = vault();
    await sync(map, [event({ availability: "free" })]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ℹ️", "\tPlanning"));
    assert.equal(await sync(map, [event({ availability: "free", start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 left for you");
    assert.match(map.get(NOTE), /this line is yours/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));

    const map2 = vault();
    await sync(map2, [event()]);
    edit(map2, day("2026-09-16"), (t) => t.replace("\tPlanning", "\tPlanning ℹ️"));
    assert.equal(await sync(map2, [event({ title: "Planning call" })]), "Calendar sync: 1 left for you");
    assert.doesNotMatch(map2.get(NOTE), /you deleted/);
});

test("run: a free event that moves takes its mark along; a ledger from before this change gets the mark on its next run", async () => {
    const map = vault();
    await sync(map, [event({ availability: "free" })]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ℹ️", "\tPlanning ℹ️ [[Pinecone Studio|⭕]]"));
    await sync(map, [event({ availability: "free", date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]]", "\t- 4:30pm"));

    // A line written before the sync knew about availability, and its ledger entry
    const old = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm") });
    old.set(LEDGER, JSON.stringify({ version: 1, updatedAt: null, events: { E1: { ...ENTRY, projects: ["[[Pinecone Studio|⭕]]"] } }, dismissed: {} }));
    assert.equal(await sync(old, [event({ availability: "free" })]), "Calendar sync: 1 updated");
    assert.match(old.get(NOTE), /Planning \(now free\)/);
    assert.equal(body(old.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
});

test("run: a first run adopts a hand-written or older line and gives a free event its mark", async () => {
    const map = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm") });
    assert.equal(await sync(map, [event({ availability: "free" })]), "Calendar sync: 1 adopted");
    assert.match(map.get(NOTE), /Planning \(now free\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
    // And a busy one adopting a line that has the mark by hand: the mark comes off
    const map2 = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm") });
    assert.equal(await sync(map2, [event()]), "Calendar sync: 1 adopted");
    assert.match(map2.get(NOTE), /Planning \(now busy\)/);
    assert.equal(body(map2.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: adopting a line whose end line a time entry replaced changes only the mark, and writes no end line back", async () => {
    // A first run (no ledger): the line is in the sync's shape but for the entry in place of the end
    const map = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm") });
    assert.equal(await sync(map, [event({ availability: "free" })]), "Calendar sync: 1 adopted");
    assert.match(map.get(NOTE), /Planning \(now free\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:00pm - 4:30pm"));
    // Deleted, then made again with a new ID as busy: the [-] line is revived and the mark comes off
    await sync(map, []);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [-] 4:00pm\tPlanning ℹ️", "\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [event({ key: "E2", id: "E2" })]), "Calendar sync: 1 adopted");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm"));
});
