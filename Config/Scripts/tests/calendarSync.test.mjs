// Tests for plugin/src/commands/calendarSync.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm. The pure parts (runOps, parseHead,
// parseBlock) are tested on note text; whole runs go through run() against an in-memory vault, with
// stand-ins for Plainday's settings (the calendars and their links), the calendar reader (the events
// each calendar gives) and this device's local storage (the cache), and just enough of moment for
// the formats the sync uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { classScript } from "../../../plugin/classShape.mjs";

const code = classScript("calendarSync.js");
const TODAY = "2026-09-15";
const DAYS = "Planner/days";
const NOTE = "Config/Calendar Sync.md";
const OLD_LEDGER = "Config/Scripts/Calendar/calendar-sync.json";
const ERROR_LOG = "Config/Error Log.md";
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
        "YYYY-MM-DD": () => date,
        "DD-MM-YYYY": () => `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`,
        "YYYY-MM-DD h:mma": () => `${date} ${clock()}`,
        "YYYYMMDDHHmmssSS": () => "2026091509000000",
        "M/D h:mma": () => `${m}/${d} ${clock()}`,
    };
    const self = {
        date,
        startOf: () => self,
        isBefore: (other) => date < other.date,
        isValid: () => /^\d{4}-\d{2}-\d{2}$/.test(date),
        format: (f) => {
            if (!formats[f]) throw new Error(`moment stub: no format ${f}`);
            return formats[f]();
        },
    };
    return self;
}

function makeApp(files) {
    const map = new Map(Object.entries(files));
    const local = new Map();
    const app = {
        isMobile: true,   // the error log isn't made, only written when it's there
        vault: {
            getFileByPath: (p) => (map.has(p) ? { path: p } : null),
            getFolderByPath: () => ({}),
            createFolder: async () => {},
            create: async (p, text) => { map.set(p, text); return { path: p }; },
            read: async (f) => map.get(f.path),
            cachedRead: async (f) => map.get(f.path),
            process: async (f, fn) => { const t = fn(map.get(f.path)); map.set(f.path, t); return t; },
            adapter: {
                exists: async (p) => map.has(p),
                read: async (p) => map.get(p),
                write: async (p, t) => { map.set(p, t); },
            },
        },
        // This device's local storage: what saveLocalStorage keeps, as Obsidian does, a copy
        loadLocalStorage: (k) => (local.has(k) ? JSON.parse(local.get(k)) : null),
        saveLocalStorage: (k, v) => { if (v === null || v === undefined) local.delete(k); else local.set(k, JSON.stringify(v)); },
        local,
        foldManager: { load: () => null },
        workspace: { getLeavesOfType: () => [] },
        // Enough of the metadata cache and the frontmatter editor for a log's `time` and `endTime`
        metadataCache: {
            getFirstLinkpathDest: (name) => {
                const p = [...map.keys()].find((k) => k === `${name}.md` || k.endsWith(`/${name}.md`));
                return p ? { path: p } : null;
            },
            getFileCache: (f) => ({ frontmatter: frontmatterOf(map.get(f.path)) }),
        },
        fileManager: {
            processFrontMatter: async (f, fn) => {
                const fm = frontmatterOf(map.get(f.path));
                fn(fm);
                const body = map.get(f.path).replace(/^---\n[\s\S]*?\n---\n?/, "");
                map.set(f.path, `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`);
            },
        },
    };
    return { app, map };
}

// `key: value` lines between the --- markers, as strings
function frontmatterOf(text) {
    const block = String(text ?? "").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    return Object.fromEntries(block.split("\n").filter((l) => l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
}

// The calendars and their links (Settings), and what each calendar's read gives (CalendarFeed): one
// calendar, Work, on and linked, unless a test changes `state`
function newState() {
    return {
        calendars: { range: "1 month", list: [{ id: "cal", name: "Work", account: "Work", address: "", on: true }], recurring: [] },
        links: { cal: "https://calendar.example.com/work.ics" },
        reads: {},   // calendar ID -> what load() gives: { events, failed } or { problem }
        format: "YYYY-MM-DD",
        saves: 0,
    };
}

function stand(state) {
    const Settings = {
        get: () => ({ calendars: state.calendars }),
        link: (id) => state.links[id] ?? null,
        rangeDays: () => 30,
        set: async (section, values) => { Object.assign({ calendars: state.calendars }[section], values); state.saves++; },
        recurringOf: (v) => (Array.isArray(v) ? v : null),
        syncHere: () => state.syncHere !== false,
    };
    const CalendarFeed = {
        loads: [],
        window: () => ({ start: new Date(`${TODAY}T00:00:00`), end: new Date("2026-10-16T00:00:00"), windowStart: TODAY, windowEnd: "2026-10-15" }),
        load: async (link, { calendar }) => {
            CalendarFeed.loads.push(calendar.id);
            await state.duringLoad?.();
            const got = state.reads[calendar.id] ?? { events: [], failed: [] };
            return got.problem ? { problem: got.problem } : { events: got.events, failed: got.failed ?? [], outside: got.outside ?? [], stats: { downloadMs: 5, readMs: 2, wallMs: 4 } };
        },
        feed: (reads, w) => ({
            windowStart: w.windowStart, windowEnd: w.windowEnd,
            calendars: reads.map(({ calendar }) => ({ id: calendar.id, title: calendar.name, account: calendar.account })),
            events: reads.flatMap((r) => r.events),
        }),
    };
    const Schedule = {
        dailyOpts: () => ({ folder: DAYS, format: state.format }),
        dailyNotePath: (m) => `${DAYS}/${m.format(state.format)}.md`,
    };
    return { Settings, CalendarFeed, Schedule };
}

function load(app = {}, state = newState(), extra = {}) {
    const context = vm.createContext({
        app,
        moment,
        Notice: class { constructor(m) { (state.notices ??= []).push(m); } hide() {} },
        window: { setTimeout, clearTimeout },
        Platform: { isMacOS: true },
        performance,
        plainday: { ...stand(state), ...extra },
        console,
    });
    return new (vm.runInContext(code + "\n;CalendarSync", context))();
}

const cs = load();
const plain = (x) => JSON.parse(JSON.stringify(x));
const text = (...lines) => lines.join("\n");
const FM = ["---", "aliases: 9/16/26 Wednesday", "---"];
const note = (...lines) => text(...FM, ...lines, "");

// Line IDs are shown as their events' keys (` ^E1`) in expectations: `named` turns the IDs in a note
// into keys, `unnamed` the keys into IDs
const keys = new Set(["E1", "E2", "E3"]);
const lid = (key) => cs.lineId(key);
const named = (t) => t.replace(/ \^(e-[a-z0-9]{6})(?=\s|$)/gm, (m, id) => { const k = [...keys].find((key) => lid(key) === id); return k ? ` ^${k}` : m; });
const unnamed = (t) => t.replace(/ \^([A-Za-z0-9@.-]+)(?=\s|$)/gm, (m, k) => (keys.has(k) ? ` ^${lid(k)}` : m));

const event = (over = {}) => ({
    key: "E1", id: "E1", calendarId: "cal", title: "Planning", date: "2026-09-16",
    start: "2026-09-16T16:00:00-04:00", end: "2026-09-16T16:30:00-04:00",
    allDay: false, recurring: false, status: "none", ...over,
});
const at = (h, over = {}) => event({ start: `2026-09-16T${h}:00:00-04:00`, end: `2026-09-16T${h}:30:00-04:00`, ...over });
const moved = (over = {}) => event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00", ...over });

// One event's line written into a note's text, as a run does it: { text (IDs shown as keys), outcome,
// result }. `remembered` is what this device remembers of the line (its ℹ️, say).
const write = (before, e = event(), { carry = null, series = null, remembered = null } = {}) => {
    keys.add(e.key);
    const op = { kind: "event", key: e.key, lid: lid(e.key), event: e, title: cs.title(e), lines: cs.lines(e), carry, series };
    const ctx = { cache: { lines: remembered ? { [lid(e.key)]: remembered } : {} } };
    const out = cs.runOps(unnamed(before), [op], ctx);
    return { text: named(out.text), outcome: out.outcomes[0].outcome, result: out.outcomes[0], wrote: out.outcomes[0].wrote };
};

// ------------------------------------------------------------------ who owns what on the line

test("the calendar's part is written from the event; ⭕, 🗃️, 🆓, the log link, the end line's note and what's under the line are kept", () => {
    const before = note(
        "- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[Household|🗃️]] [[2026-09-16 Planning|⋯]] ^E1",
        "\t- 4:30pm: bring the draft",
        "\t- 4:00pm - 4:20pm",
        "\t\t- invoiced later",
        "\t- a note",
        "- [ ] A task",
    );
    const { text: after, outcome, result } = write(before, event({ start: "2026-09-16T16:00:00-04:00", end: "2026-09-16T16:45:00-04:00" }));
    assert.equal(outcome, "updated");
    assert.deepEqual(plain(result.changed), ["time changed; check its time entries"]);
    assert.equal(after, note(
        "- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[Household|🗃️]] [[2026-09-16 Planning|⋯]] ^E1",
        "\t- 4:45pm: bring the draft",
        "\t- 4:00pm - 4:20pm",
        "\t\t- invoiced later",
        "\t- a note",
        "- [ ] A task",
    ));
    // Nothing new: nothing written
    assert.equal(write(after, event({ end: "2026-09-16T16:45:00-04:00" })).outcome, "present");
});

test("a title or time edited by hand is written back; words after the title are yours; an edited title takes the words before your first link or mark with it", () => {
    // Words typed after the title stay, word for word
    const kept = write(note("- [<] 4:15pm\tPlanning with Quincy [[Pinecone Studio|⭕]] moved again ^E1", "\t- 5:00pm"));
    assert.equal(kept.outcome, "updated");
    assert.equal(kept.text, note("- [<] 4:00pm\tPlanning with Quincy [[Pinecone Studio|⭕]] moved again ^E1", "\t- 4:30pm"));
    // Words right after the title with no space, after a comma, colon or slash: kept as typed
    for (const typed of ["Planning, bring laptop", "Planning: bring laptop [[Pinecone Studio|⭕]]", "Planning? ask Quincy", "Planning/review [[Pinecone Studio|⭕]]", "Planning (moved)"]) {
        assert.equal(write(note(`- [<] 4:00pm\t${typed} ^E1`, "\t- 4:30pm")).outcome, "present", typed);
    }
    assert.equal(write(note("- [<] 4:00pm\tPlannings [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm")).text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"), "a letter after it: an edited title");
    // An edited title: the words before your first link or mark are taken for the title
    const edited = write(note("- [<] 4:00pm\tPlaning call bring laptop [[Pinecone Studio|⭕]] 🆓 ^E1", "\t- 4:30pm"));
    assert.equal(edited.text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] 🆓 ^E1", "\t- 4:30pm"));
    // The title this device last wrote is found though the calendar has renamed the event since
    const renamed = write(note("- [<] 4:00pm\tPlanning bring laptop [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"), event({ title: "Planning call" }), { remembered: { key: "E1", date: "2026-09-16", title: "Planning" } });
    assert.equal(renamed.text, note("- [<] 4:00pm\tPlanning call bring laptop [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"));
    assert.equal(renamed.wrote.title, "Planning call");
    // A calendar title holding 🆓 or a link is the title, not your part
    const odd = event({ title: "Retro 🆓 lunch [[Agenda]]" });
    const first = write(note(), odd);
    assert.equal(first.text, note("- [<] 4:00pm\tRetro 🆓 lunch [[Agenda]] ^E1", "\t- 4:30pm"));
    assert.equal(write(first.text, odd).outcome, "present");
});

test("an ID with links typed after it is still the line's, and goes back to the end", () => {
    const before = note("- [<] 4:00pm\tPlanning ^E1 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm");
    const { text: after, outcome } = write(before);
    assert.equal(outcome, "updated");
    assert.equal(after, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm"));
});

test("a line with a box of yours is kept current, its box as you set it (as before Plainday)", () => {
    for (const box of ["x", "!", "/", "-"]) {
        const { text: after, outcome } = write(note(`- [${box}] 4:00pm\tPlanning with Quincy ^E1`, "\t- 4:30pm"), at(17));
        assert.equal(outcome, "updated", box);
        assert.equal(after, note(`- [${box}] 5:00pm\tPlanning with Quincy ^E1`, "\t- 5:30pm"), box);
    }
});
test("a [-] the sync wrote goes back to [<] when its event is in the calendar again; one you set stays", () => {
    const remembered = { key: "E1", date: "2026-09-16", canceled: true };
    const { text: after, outcome } = write(note("- [-] 4:00pm\tPlanning ^E1", "\t- 4:00pm - 4:20pm"), event(), { remembered });
    assert.equal(outcome, "restored");
    assert.equal(after, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:20pm"));
    assert.equal(write(note("- [-] 4:00pm\tPlanning ^E1", "\t- 4:30pm")).outcome, "present", "one you set stays [-]");
});
test("ℹ️: a new line gets it when its event is free; after that the calendar's latest change wins, and yours stays in between", () => {
    const free = event({ availability: "free" });
    const was = (f) => ({ remembered: { key: "E1", date: "2026-09-16", free: f } });
    // A new line: right after the title, before a series' ⭕
    const fresh = write(note(), free, { series: { links: ["[[Pinecone Studio|⭕]]"] } });
    assert.equal(fresh.text, note("- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"));
    assert.equal(fresh.wrote.free, true);
    // Busy at the last sync, free now: at the start of the run of links that ends the line, after your words
    const toFree = write(note("- [<] 4:00pm\tPlanning bring laptop [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"), free, was(false));
    assert.equal(toFree.text, note("- [<] 4:00pm\tPlanning bring laptop ℹ️ [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"));
    assert.deepEqual(plain(toFree.result.changed), ["now free"]);
    // Words at the end: after them, where the time report reads it
    assert.equal(write(note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] bring laptop ^E1", "\t- 4:30pm"), free, was(false)).text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] bring laptop ℹ️ ^E1", "\t- 4:30pm"));
    // Free at the last sync, busy now: every ℹ️ in your part goes
    const toBusy = write(note("- [<] 4:00pm\tPlanning ℹ️ bring laptop ℹ️ [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"), event(), was(true));
    assert.equal(toBusy.text, note("- [<] 4:00pm\tPlanning bring laptop [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"));
    assert.deepEqual(plain(toBusy.result.changed), ["now busy"]);
    assert.equal(toBusy.wrote.free, false);
    // No change since the last sync, or nothing remembered: yours stays, on or off
    assert.equal(write(note("- [<] 4:00pm\tPlanning ℹ️ ^E1", "\t- 4:30pm"), event(), was(false)).outcome, "present");
    assert.equal(write(note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"), free, was(true)).outcome, "present");
    assert.equal(write(note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"), free).outcome, "present");
    assert.equal(write(note("- [<] 4:15pm\tPlanning ℹ️ ^E1", "\t- 4:30pm"), event(), was(false)).text, note("- [<] 4:00pm\tPlanning ℹ️ ^E1", "\t- 4:30pm"), "and through a retime");
    // All day: left alone
    assert.equal(write(note("- [<] All day\tPlanning ^E1"), event({ allDay: true, availability: "free" }), was(false)).outcome, "present");
});

test("all day ↔ timed: the end line comes and goes; one with a note stays as it was", () => {
    const toTimed = write(note("- [<] All day\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- a note"));
    assert.equal(toTimed.text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "\t- a note"));
    const toAllDay = write(note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm: bring the draft", "\t- 4:00pm - 4:10pm"), event({ allDay: true }));
    assert.equal(toAllDay.text, note("- [<] All day\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm: bring the draft", "\t- 4:00pm - 4:10pm"));
    assert.equal(write(toAllDay.text, event({ allDay: true })).outcome, "present", "and stays so");
});

test("an end line taken off, or replaced by a time entry, is written back first", () => {
    const { text: after } = write(note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:00pm - 4:30pm"));
    assert.equal(after, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:30pm"));
});

test("the end line is the one with the end time this device wrote, wherever it is under the line; with nothing remembered, the first line, else one is written above", () => {
    const before = note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:00pm - 4:20pm", "\t\t- 5:00pm", "\t- 4:30pm");
    const later = event({ end: "2026-09-16T16:45:00-04:00" });
    const remembered = { key: "E1", date: "2026-09-16", end: "4:30pm" };
    assert.equal(write(before, later, { remembered }).text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:45pm", "\t- 4:00pm - 4:20pm", "\t\t- 5:00pm"));
    assert.equal(write(before, later).text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:45pm", "\t- 4:00pm - 4:20pm", "\t\t- 5:00pm", "\t- 4:30pm"));
    assert.equal(write(before, later, { remembered }).wrote.end, "4:45pm");
});

test("a calendar title ending in 🆓 or ℹ️ loses it, so the line reads the same next time; a timed event ending on another day gets no end line", () => {
    assert.deepEqual(plain(cs.lines(event({ title: "Retro 🆓" }))), ["- [<] 4:00pm\tRetro", "\t- 4:30pm"]);
    assert.deepEqual(plain(cs.lines(event({ title: "Retro ℹ️" }))), ["- [<] 4:00pm\tRetro", "\t- 4:30pm"]);
    assert.deepEqual(plain(cs.lines(event({ endsSameDay: false, end: "2026-09-18T09:00:00-04:00" }))), ["- [<] 4:00pm\tPlanning"]);
    const { text: after } = write(note(), event({ title: "Retro 🆓" }));
    assert.equal(write(after, event({ title: "Retro 🆓" })).outcome, "present");
});

test("lines: a timed free event gets ℹ️ after its title; all-day, busy, tentative and unknown don't", () => {
    assert.deepEqual(plain(cs.lines(event({ availability: "free" }))), ["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"]);
    for (const availability of ["busy", "tentative", undefined]) assert.deepEqual(plain(cs.lines(event({ availability }))), ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"]);
    assert.deepEqual(plain(cs.lines(event({ availability: "free", allDay: true }))), ["- [<] All day\tPlanning"]);
});

// ------------------------------------------------------------------ copies, lines from before, new lines

test("two copies of a line in a note become one, from the event, with everything under either; the first copy's part wins", () => {
    const before = note(
        "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:20pm",
        "- [ ] A task",
        "- [<] 4:15pm\tPlanning [[Kestrel|⭕]] 🆓 ^E1", "\t- 4:30pm", "\t- bring the draft",
    );
    const { text: after, outcome, result } = write(before);
    assert.equal(outcome, "merged");
    assert.equal(result.differs, true);
    assert.equal(after, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:20pm", "\t- bring the draft", "- [ ] A task"));
    // The first copy with a part of yours, when the first has none
    assert.equal(write(note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "- [<] 4:00pm\tPlanning 🆓 ^E1", "\t- 4:30pm")).text, note("- [<] 4:00pm\tPlanning 🆓 ^E1", "\t- 4:30pm"));
    // Plain copies: one line, and the same part says nothing
    const same = write(note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    assert.equal(same.text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    assert.equal(same.result.differs, false);
});

test("a line from before IDs is taken over by its start and title, keeping what's yours, and given the ID", () => {
    const before = note("- [<] 9:00am\tStandup", "- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 4:30pm", "\t- 4:00pm - 4:20pm");
    const { text: after, outcome } = write(before);
    assert.equal(outcome, "adopted");
    assert.equal(after, note("- [<] 9:00am\tStandup", "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:20pm"));
    // A line with another event's ID isn't taken, nor one nested under a task
    keys.add("E2");
    const taken = write(note("- [<] 4:00pm\tPlanning ^E2", "\t- 4:30pm", "- [ ] Prepare", "\t- [<] 4:00pm\tPlanning", "\t\t- 4:30pm"));
    assert.equal(taken.outcome, "added");
    assert.match(taken.text, /- \[<\] 4:00pm\tPlanning \^E2\n\t- 4:30pm\n- \[<\] 4:00pm\tPlanning \^E1\n\t- 4:30pm\n- \[ \] Prepare/);
    // The title, then words of yours: taken over the same way, the words kept
    assert.equal(write(note("- [<] 4:00pm\tPlanning - Q3", "\t- 4:30pm")).text, note("- [<] 4:00pm\tPlanning - Q3 ^E1", "\t- 4:30pm"));    // A line from before marked another way takes the ID and stays as it is
    assert.equal(write(note("- [x] 4:00pm\tPlanning", "\t- 4:30pm")).text, note("- [x] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
});

test("a log's line with no time is taken over: the sync's shape with the log link at the end, ⭕, 🆓 and what's under it kept", () => {
    const before = note("- [<] 9:00am\tStandup", "\t- 9:15am", "- [<] [[2026-09-16 Planning|Planning]] 🆓 [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:20pm", "- [ ] A task");
    const { text: after, outcome, result } = write(before);
    assert.equal(outcome, "adopted");
    assert.deepEqual(plain(result.changed), ["time added"]);
    assert.equal(after, note("- [<] 9:00am\tStandup", "\t- 9:15am", "- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:20pm", "- [ ] A task"));
    // The note link at the end, as the Log template writes it now
    assert.equal(write(note("- [<] Planning [[2026-09-16 Planning|⋯]]")).text, note("- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm"));
    // Another title isn't it: the timed line goes above the timeless one, which stays
    const other = write(before, event({ title: "Retro" }));
    assert.equal(other.outcome, "added");
    assert.match(other.text, /\t- 9:15am\n- \[<\] 4:00pm\tRetro \^E1\n\t- 4:30pm\n- \[<\] \[\[2026-09-16 Planning/);
});

test("a new line goes in time order, takes a series' ⭕, and steps past an ID a task in the note has", () => {
    const before = note("- [<] All day\tOffsite", "- [<] 9:00am\tStandup", "\t- 9:15am", "- [<] 5:00pm\tDrinks", "- [ ] A task");
    const { text: after, outcome } = write(before, event(), { series: { links: ["[[Pinecone Studio|⭕]]"], key: "[[Pinecone Studio|⭕]]" } });
    assert.equal(outcome, "added");
    assert.equal(after, note("- [<] All day\tOffsite", "- [<] 9:00am\tStandup", "\t- 9:15am", "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "- [<] 5:00pm\tDrinks", "- [ ] A task"));
    // A series' ⭕ goes only on a new line
    assert.equal(write(note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"), event(), { series: { links: ["[[Kestrel|⭕]]"], key: "[[Kestrel|⭕]]" } }).outcome, "present");
    const clash = write(note(`- [ ] Book the room ^${lid("E1")}`));
    assert.match(clash.text, new RegExp(`- \\[<\\] 4:00pm\\tPlanning \\^${cs.lineId("E1", 1)}\\n`));
});

test("a moved line's part comes along: its ⭕, 🆓, log link, and what's under it unless it stays behind", () => {
    const old = note("- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm: bring the draft", "\t- a note");
    const block = cs.parseBlock(unnamed(old).split("\n").slice(3, 6));
    const { text: after, outcome } = write(note(), moved(), { carry: { parts: [block] } });
    assert.equal(outcome, "moved");
    assert.equal(after, note("- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm: bring the draft", "\t- a note"));
});

test("leaveIn: a moved line goes, or is forwarded when time entries or lines past a blank line are under it, whatever its box", () => {
    // `expect`: the line as the run read it, so one changed since stays
    const leave = (before, expect = []) => { const r = cs.runOps(unnamed(before), [{ kind: "leave", key: "E1", lid: lid("E1"), to: "2026-09-18", title: "Planning", expect: expect.map(unnamed) }]); return { text: named(r.text), outcome: r.outcomes[0].outcome }; };
    const read = text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "\t- a note");
    const gone = leave(note(read, "- [ ] A task"), [read]);
    assert.equal(gone.outcome, "moved");
    assert.equal(gone.text, note("- [ ] A task"));
    const typed = leave(note(read, "\t- typed meanwhile", "- [ ] A task"), [read]);
    assert.equal(typed.outcome, "forwarded", "a line changed since it was read stays");
    assert.match(typed.text, /- \[>\] \[\[2026-09-18\|9\/18\]\] 4:00pm\tPlanning \[\[Pinecone Studio\|⭕\]\]\n\t- 4:30pm\n\t- a note\n\t- typed meanwhile/);
    const fwd = leave(note("- [<] 9:00am\tStandup", "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:00pm - 4:20pm", "- [<] 5:00pm\tDrinks", "- [ ] A task"));
    assert.equal(fwd.outcome, "forwarded");
    assert.equal(fwd.text, note("- [<] 9:00am\tStandup", "- [<] 5:00pm\tDrinks", "- [>] [[2026-09-18|9/18]] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:20pm", "- [ ] A task"));
    const detached = leave(note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "", "\t- 4:00pm - 4:45pm: billed"));
    assert.equal(detached.outcome, "forwarded");
    const mine = text("- [x] 4:00pm\tPlanning ^E1", "\t- 4:30pm");
    assert.equal(leave(note(mine), [mine]).outcome, "moved", "a box of yours moves with it");
});

test("cancelIn: [<] turns [-] with what's under it kept; a line marked another way stays", () => {
    const cancel = (before) => { const r = cs.runOps(unnamed(before), [{ kind: "cancel", key: "E1", lid: lid("E1"), title: "Planning" }]); return { text: named(r.text), outcome: r.outcomes[0].outcome }; };
    const done = cancel(note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:00pm - 4:20pm"));
    assert.equal(done.outcome, "canceled");
    assert.equal(done.text, note("- [-] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:00pm - 4:20pm"));
    assert.equal(cancel(done.text).outcome, "present");
    const mine = note("- [x] 4:00pm\tPlanning ^E1");
    assert.equal(cancel(mine).text, mine);
});

test("parseHead: the title the line starts with, your part after it as written, the ID left out wherever it is; an edited title ends at your first link or mark; the old wrapped log title", () => {
    const h = cs.parseHead(unnamed("- [<] 9:30am\tReview bring laptop [[Acme|⭕️]] ℹ 🆓️ ^E1 [[2026-09-16 Review|↗️]]"), ["Review"]);
    assert.deepEqual(plain(h), { box: "<", start: "9:30am", title: "Review", tail: " bring laptop [[Acme|⭕️]] ℹ 🆓️ [[2026-09-16 Review|↗️]]", notes: ["[[2026-09-16 Review|⋯]]"], free: true, lid: lid("E1") });
    assert.deepEqual(plain(cs.parseHead("- [<] 9:30am\tReveiw notes [[Acme|⭕]] more", ["Review"])), { box: "<", start: "9:30am", title: "Reveiw notes", tail: " [[Acme|⭕]] more", notes: [], free: false, lid: null });
    assert.equal(cs.parseHead("- [<] 9:30am\tReviewing", ["Review"]).title, "Reviewing", "a title starts a line only when a space follows it");
    const old = cs.parseHead("- [<] 9:30am\t[[2026-09-16 Review|Review]] [[Acme|⭕]]", ["Review"]);
    assert.equal(old.title, "Review");
    assert.equal(old.tail, " [[Acme|⭕]] [[2026-09-16 Review|⋯]]");
    assert.equal(cs.parseHead("- [ ] A task"), null);
});

test("lineId: e- and six letters and digits from the event's key, the same every time; steps are other IDs", () => {
    const a = cs.lineId("E1"), b = load().lineId("E1");
    assert.match(a, /^e-[a-z0-9]{6}$/);
    assert.equal(a, b, "every device works out the same one");
    assert.notEqual(cs.lineId("E1", 1), a);
    assert.notEqual(cs.lineId("S1@2026-09-16"), cs.lineId("S1@2026-09-23"), "each occurrence its own");
    assert.deepEqual(plain(cs.lineIds("E1")), [a, cs.lineId("E1", 1), cs.lineId("E1", 2)]);
});

test("the ID is read at the end of a line, ahead of links typed after it, or with words after it", () => {
    const id = lid("E1");
    assert.equal(cs.lidOf(`- [<] 9:30am\tReview ^${id}`), id);
    assert.equal(cs.lidOf(`- [<] 9:30am\tReview ^${id} [[Acme|⭕]] [[2026-09-16 Review|⋯]]`), id);
    assert.equal(cs.lidOf(`- [<] 9:30am\tReview ^${id} and more words`), null, "text after it: not a block ID");
    assert.equal(cs.lidIn(`- [<] 9:30am\tReview ^${id} and more words`), id, "but the sync still finds it");
    assert.equal(cs.withLid("- [<] 9:30am\tReview [[Acme|⭕]] ^old", id), `- [<] 9:30am\tReview [[Acme|⭕]] ^${id}`);
    assert.deepEqual(plain(cs.head(`- [<] 9:30am\tReview [[Acme|⭕]] ^${id}`)), { start: "9:30am", title: "Review" });
});

test("splitTail: a 🆓 and ℹ️ come off the end with the ⭕ links, in any order; without the flag a note link stays in the title (CalNav reads it that way)", () => {
    assert.deepEqual(plain(cs.splitTail("Retro ℹ️ 🆓 [[Acme|⭕]]")), { rest: "Retro", projects: ["[[Acme|⭕]]"], free: true, nonbillable: true, log: null });
    assert.deepEqual(plain(cs.splitTail("Retro [[Acme|⭕]] 🆓")), { rest: "Retro", projects: ["[[Acme|⭕]]"], free: false, nonbillable: true, log: null });
    assert.equal(cs.splitTail("Retro [[2026-09-16 Retro|⋯]]").rest, "Retro [[2026-09-16 Retro|⋯]]");
    assert.equal(cs.splitTail("Retro [[2026-09-16 Retro|⋯]] [[Acme|⭕]]", true).log, "[[2026-09-16 Retro|⋯]]");
});

test("isLog: a note in a ›logs folder (AddTaskNote's name, any case) or tagged #log; without AddTaskNote only the tag counts (OBS-164)", () => {
    const isLogsFolderName = (name) => /^›logs$/i.test(name);
    const s = load({}, newState(), { AddTaskNote: { isLogsFolderName } });
    assert.equal(s.isLog({ path: "Projects/Studio/›logs/2026-09-16 Planning.md" }, {}), true);
    assert.equal(s.isLog({ path: "Projects/Studio/›LOGS/2026-09-16 Planning.md" }, {}), true);
    assert.equal(s.isLog({ path: "Projects/Studio/Planning.md" }, { frontmatter: { tags: ["log"] } }), true);
    assert.equal(s.isLog({ path: "Projects/Studio/Planning.md" }, { tags: [{ tag: "#log" }] }), true);
    assert.equal(s.isLog({ path: "Projects/Studio/Planning.md" }, {}), false);
    assert.equal(cs.isLog({ path: "Projects/Studio/›logs/2026-09-16 Planning.md" }, {}), false);
});

// ------------------------------------------------------------------ whole runs

// A vault, this device's state (settings, links, reads) and its cache; `sync(map, events)` runs Sync
// calendars with the Work calendar giving `events`. The device's clock: a real time on the test day,
// an hour on for each run (a run asks it many times).
let clock = Date.UTC(2026, 8, 15, 13);
const day = (date) => `${DAYS}/${date}.md`;
const body = (t) => named(String(t ?? "").split("\n").slice(3).join("\n").replace(/\n+$/, ""));

async function sync(map, events, { now } = {}) {
    for (const e of events) keys.add(e.key);
    const device = devices.get(map);
    device.state.reads.cal = { events: events.map((e) => ({ calendar: "Work", account: "Work", endsSameDay: true, ...e })), failed: [], outside: device.outside ?? [] };
    const s = load(device.app, device.state, device.extra ?? {});
    const t = now !== undefined ? now : (clock += 60 * 60 * 1000);
    s.now = () => t;
    return s.run();
}
const devices = new WeakMap();
function vault(files = {}) {
    const { app, map } = makeApp(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, unnamed(v)])));
    devices.set(map, { app, state: newState() });
    return map;
}
const device = (map) => devices.get(map);
// A note edited by hand, its IDs shown as their events' keys while `fn` edits it
const edit = (map, path, fn) => map.set(path, unnamed(fn(named(map.get(path)))));
const cache = (map) => device(map).app.loadLocalStorage("plainday-calendar-cache");
const last = (map) => device(map).app.loadLocalStorage("plainday-calendar-last");
const LISTS = ["added", "adopted", "updated", "restored", "moved", "forwarded", "canceled", "removed", "merged", "skipped"];
const reported = (map) => { const r = last(map); return LISTS.flatMap((k) => r[k].map((i) => `- ${i}\n`)).join(""); };
// Recurring events' projects, in Plainday's settings
const recurring = (map) => device(map).state.calendars.recurring;
const setLinks = (map, title, links) => {
    const list = recurring(map).filter((r) => r.title !== title);
    const where = recurring(map).findIndex((r) => r.title === title);
    if (links.length) list.splice(where === -1 ? list.length : where, 0, { title, links });
    device(map).state.calendars.recurring = list;
};
const later = (minutes) => clock + minutes * 60 * 1000;

test("run: each event line ends in its event's ID; a second run with nothing new changes nothing", async () => {
    const map = vault();
    assert.equal(await sync(map, [event(), at(9, { key: "E2", id: "E2", title: "Standup" })]), "Calendar sync: 2 added");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 9:00am\tStandup ^E2", "\t- 9:30am", "- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    const was = map.get(day("2026-09-16"));
    assert.equal(await sync(map, [event(), at(9, { key: "E2", id: "E2", title: "Standup" })]), "Calendar sync: nothing to change");
    assert.equal(map.get(day("2026-09-16")), was);
    assert.deepEqual(Object.keys(cache(map).lines).sort(), [lid("E1"), lid("E2")].sort());
});

test("run: your part of the line after the title stays word for word; an edited title is written back and takes the words before your ⭕ with it (2.6b)", async () => {
    const map = vault();
    const standup = (over = {}) => at(9, { key: "E2", id: "E2", title: "Kestrel standup", ...over });
    await sync(map, [standup()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tKestrel standup ^E2", "\tKestrel standup bring laptop [[Budget Book|⭕]] ^E2\n\t- ask about the proofs"));
    assert.equal(await sync(map, [standup()]), "Calendar sync: 1 updated", "the end line goes back first");
    assert.equal(await sync(map, [standup()]), "Calendar sync: nothing to change");
    edit(map, day("2026-09-16"), (t) => t.replace("\tKestrel standup bring laptop", "\tStandup with Quincy bring laptop"));
    assert.equal(await sync(map, [standup()]), "Calendar sync: 1 updated");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 9:00am\tKestrel standup [[Budget Book|⭕]] ^E2", "\t- 9:30am", "\t- ask about the proofs"));
    // Renamed in the calendar: the remembered title is found, and your words stay
    edit(map, day("2026-09-16"), (t) => t.replace("\tKestrel standup [[Budget", "\tKestrel standup bring laptop [[Budget"));
    await sync(map, [standup({ title: "Kestrel sync" })]);
    assert.match(body(map.get(day("2026-09-16"))), /\tKestrel sync bring laptop \[\[Budget Book\|⭕\]\] \^E2/);
});

test("run: notes that start with a time stay as written; a line typed right under an event keeps the end line, which goes back first (2.6c)", async () => {
    const map = vault();
    const review = (over = {}) => at(9, { key: "E2", id: "E2", title: "Design review", ...over });
    const shoot = event({ key: "E3", id: "E3", title: "Catalog shoot", allDay: true });
    await sync(map, [review(), shoot]);
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 9:30am", "\t- 9:30am\n\t- 5:00am: prep the room").replace("\tCatalog shoot ^E3", "\tCatalog shoot ^E3\n\t- 1:00pm: workshop"));
    assert.equal(await sync(map, [review(), shoot]), "Calendar sync: nothing to change");
    await sync(map, [review({ start: "2026-09-16T09:10:00-04:00", end: "2026-09-16T09:40:00-04:00" }), shoot]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] All day\tCatalog shoot ^E3", "\t- 1:00pm: workshop", "- [<] 9:10am\tDesign review ^E2", "\t- 9:40am", "\t- 5:00am: prep the room"));
    // A note typed right under the event line, above its end time
    edit(map, day("2026-09-16"), (t) => t.replace("\tDesign review ^E2\n", "\tDesign review ^E2\n\t- bring the boards\n"));
    await sync(map, [review({ start: "2026-09-16T09:10:00-04:00", end: "2026-09-16T09:50:00-04:00" }), shoot]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] All day\tCatalog shoot ^E3", "\t- 1:00pm: workshop", "- [<] 9:10am\tDesign review ^E2", "\t- 9:50am", "\t- bring the boards", "\t- 5:00am: prep the room"));
});

test("run: ⭕ and a time entry survive a time change, and the report says to check the entry", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm\n\t- 4:00pm - 4:30pm: 🆓"));
    assert.equal(await sync(map, [at(17)]), "Calendar sync: 1 updated");
    assert.match(reported(map), /- 2026-09-16 Planning \(time changed; check its time entries\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 5:30pm", "\t- 4:00pm - 4:30pm: 🆓"));
});

test("run: a deleted line comes back; a line marked [x] is kept current, and moves with its event, keeping its box (2.9)", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), () => note());
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 added");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    edit(map, day("2026-09-16"), (t) => t.replace("[<]", "[x]"));
    assert.equal(await sync(map, [at(17)]), "Calendar sync: 1 updated");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [x] 5:00pm\tPlanning ^E1", "\t- 5:30pm"));
    assert.equal(await sync(map, [moved()]), "Calendar sync: 1 moved");
    assert.equal(body(map.get(day("2026-09-18"))), text("- [x] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
});
test("run: moved to another day, the line moves with your part and keeps its ID; with time entries it's forwarded, and the new line takes your links (2.7)", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] ^E1\n\t- 4:30pm: bring the draft\n\t- a note"));
    assert.equal(await sync(map, [moved()]), "Calendar sync: 1 moved");
    assert.deepEqual(last(map).moved, ["2026-09-16 → 2026-09-18 Planning"]);
    assert.equal(body(map.get(day("2026-09-16"))), "");
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm: bring the draft", "\t- a note"));

    edit(map, day("2026-09-18"), (t) => t.replace("\t- a note", "\t- 4:00pm - 4:20pm"));
    assert.equal(await sync(map, [moved({ date: "2026-09-19", start: "2026-09-19T16:00:00-04:00", end: "2026-09-19T16:30:00-04:00" })]), "Calendar sync: 1 forwarded");
    assert.equal(body(map.get(day("2026-09-18"))), text("- [>] [[2026-09-19|9/19]] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm: bring the draft", "\t- 4:00pm - 4:20pm"));
    assert.equal(body(map.get(day("2026-09-19"))), text("- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm"));
    assert.equal(await sync(map, [moved({ date: "2026-09-19", start: "2026-09-19T16:00:00-04:00", end: "2026-09-19T16:30:00-04:00" })]), "Calendar sync: nothing to change");
});

test("run: canceled after a second read, 10 minutes on, still lacks it; [<] again when it returns (2.8)", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 4:30pm", "\t- 4:30pm\n\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [], { now: later(0) }), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [], { now: later(5) }), "Calendar sync: nothing to change", "too soon");
    assert.equal(await sync(map, [], { now: later(11) }), "Calendar sync: 1 canceled");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [-] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, []), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [at(17)]), "Calendar sync: 1 restored");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning ^E1", "\t- 5:30pm", "\t- 4:00pm - 4:30pm"));
});

test("run: an event read 10 minutes or more before is canceled at the first sync that misses it, so one canceled on its own day is marked before the day ends (2.8)", async () => {
    const map = vault();
    await sync(map, [event(), at(9, { key: "E2", id: "E2", title: "Standup" })]);
    assert.equal(await sync(map, [at(9, { key: "E2", id: "E2", title: "Standup" })], { now: later(30) }), "Calendar sync: 1 canceled");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 9:00am\tStandup ^E2", "\t- 9:30am", "- [-] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    // Missed once and back: nothing changes; missed again later: canceled then
    keys.add("E3");
    const fresh = at(11, { key: "E3", id: "E3", title: "Review" });
    await sync(map, [fresh], { now: later(40) });
    assert.equal(await sync(map, [], { now: later(42) }), "Calendar sync: nothing to change", "read 2 minutes before: it waits");
    assert.equal(await sync(map, [fresh], { now: later(44) }), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [], { now: later(60) }), "Calendar sync: 1 canceled");
});

test("run: a line whose calendar is off, unlinked, unreadable, or skipped by the reader isn't canceled", async () => {
    const cases = {
        off: (d) => { d.state.calendars.list[0].on = false; },
        unlinked: (d) => { delete d.state.links.cal; },
    };
    for (const [what, change] of Object.entries(cases)) {
        const map = vault();
        await sync(map, [event()]);
        change(device(map));
        await sync(map, [], { now: later(0) });
        await sync(map, [], { now: later(20) });
        assert.match(map.get(day("2026-09-16")), /- \[<\] 4:00pm\tPlanning/, what);
    }
    const map = vault();
    await sync(map, [event()]);
    for (const read of [{ problem: "unreachable" }, { events: [], failed: [{ uid: "E1", title: "Planning" }] }]) {
        const s = () => { const d = device(map); d.state.reads.cal = read; const x = load(d.app, d.state); x.now = () => (clock += 20 * 60 * 1000); return x.run(); };
        await s();
        await s();
        assert.match(map.get(day("2026-09-16")), /- \[<\] 4:00pm\tPlanning/, JSON.stringify(read));
    }
});

test("run: a device that doesn't remember a line marks nothing canceled, and leaves an ℹ️ on a busy event", async () => {
    const map = vault();
    await sync(map, [event({ availability: "free" })]);
    device(map).app.saveLocalStorage("plainday-calendar-cache", null);
    await sync(map, [event({ key: "E2", id: "E2", title: "Other" })], { now: later(0) });
    await sync(map, [event({ key: "E2", id: "E2", title: "Other" })], { now: later(20) });
    assert.match(map.get(day("2026-09-16")), /- \[<\] 4:00pm\tPlanning ℹ️/);
    // Its event back, busy now: with nothing remembered, the ℹ️ might be yours, so it stays
    assert.equal(await sync(map, [event(), event({ key: "E2", id: "E2", title: "Other" })]), "Calendar sync: nothing to change");
    assert.match(map.get(day("2026-09-16")), /- \[<\] 4:00pm\tPlanning ℹ️/);
});

test("run: ℹ️ follows the calendar's latest change between free and busy; one you take off or add in between stays (2.9b, 2.9c)", async () => {
    const map = vault();
    const focus = (over = {}) => at(12, { key: "E2", id: "E2", title: "Focus block", availability: "free", ...over });
    const review = (over = {}) => at(9, { key: "E3", id: "E3", title: "Design review", ...over });
    const note16 = () => body(map.get(day("2026-09-16")));
    await sync(map, [focus(), review()]);
    assert.match(note16(), /\tFocus block ℹ️ \^E2/);
    // 2.9b: taken off by hand, it stays off while the calendar doesn't change; busy, then free again: back
    edit(map, day("2026-09-16"), (t) => t.replace("Focus block ℹ️", "Focus block"));
    assert.equal(await sync(map, [focus(), review()]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [focus({ availability: "busy" }), review()]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [focus(), review()]), "Calendar sync: 1 updated");
    assert.match(reported(map), /Focus block \(now free\)/);
    assert.match(note16(), /\tFocus block ℹ️ \^E2/);
    // 2.9c: added to a busy event, it stays through a retime and a switch to free; busy again takes it off
    const later = { start: "2026-09-16T09:10:00-04:00", end: "2026-09-16T09:40:00-04:00" };
    edit(map, day("2026-09-16"), (t) => t.replace("\tDesign review ^E3", "\tDesign review ℹ️ ^E3"));
    assert.equal(await sync(map, [focus(), review()]), "Calendar sync: nothing to change");
    await sync(map, [focus(), review(later)]);
    assert.match(note16(), /- \[<\] 9:10am\tDesign review ℹ️ \^E3\n\t- 9:40am/);
    assert.equal(await sync(map, [focus(), review({ ...later, availability: "free" })]), "Calendar sync: nothing to change");
    await sync(map, [focus(), review(later)]);
    assert.match(note16(), /- \[<\] 9:10am\tDesign review \^E3\n\t- 9:40am/);
});

test("run: two lines with one ID in a note become one, with everything under either (2.10)", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 4:30pm", "\t- 4:30pm\n\t- 4:00pm - 4:20pm\n- [<] 4:00pm\tPlanning ^E1\n\t- 4:30pm\n\t- bring the draft"));
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 doubled line merged");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:20pm", "\t- bring the draft"));
    // A copy on another day joins the event's line, and goes
    map.set(day("2026-09-17"), unnamed(note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "\t- a note")));
    await sync(map, [event()]);
    assert.equal(body(map.get(day("2026-09-17"))), "");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:20pm", "\t- bring the draft", "\t- a note"));
});

test("run: links typed after an ID: the line is still the event's, its links kept, the ID back at the end (2.15b)", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("^E1", "^E1 [[Pinecone Studio|⭕]]"));
    await sync(map, [event()]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"));
});

test("run: a vault from before (2.16): lines with no ID are taken over and given IDs, nothing twice; the old record's deleted lines aren't read", async () => {
    const map = vault({
        [OLD_LEDGER]: JSON.stringify({ version: 1, events: {}, dismissed: { "MAC-2": "2026-09-17" } }),
        [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:20pm", "- [x] 6:00pm\tDrinks", "\t- 7:00pm"),
    });
    const dentist = event({ key: "D1", id: "D1", title: "Dentist", date: "2026-09-17", start: "2026-09-17T08:00:00-04:00", end: "2026-09-17T09:00:00-04:00" });
    const drinks = at(18, { key: "E2", id: "E2", title: "Drinks", end: "2026-09-16T19:00:00-04:00" });
    assert.equal(await sync(map, [event(), dentist, drinks]), "Calendar sync: 1 added, 2 adopted");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "\t- 4:00pm - 4:20pm", "- [x] 6:00pm\tDrinks ^E2", "\t- 7:00pm"));
    assert.match(map.get(day("2026-09-17")), /Dentist/);
    assert.equal(await sync(map, [event(), dentist, drinks]), "Calendar sync: nothing to change");
    assert.ok(map.has(OLD_LEDGER), "the old file is left for you");
});

test("run: two events with the same start and title get a line each, and keep them", async () => {
    const map = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning", "\t- 4:30pm") });
    await sync(map, [event(), event({ key: "E2", id: "E2" })]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "- [<] 4:00pm\tPlanning ^E2", "\t- 4:30pm"));
    assert.equal(await sync(map, [event(), event({ key: "E2", id: "E2" })]), "Calendar sync: nothing to change");
});

test("run: an event-shaped line nested under a task is the task's subtask, never an event's line", async () => {
    keys.add("E1");
    const map = vault({ [day("2026-09-16")]: note("- [ ] Prepare launch", "\t- [<] 4:00pm\tPlanning ^E1", "\t- [ ] Write the brief") });
    await sync(map, [event()]);
    await sync(map, [moved()]);
    assert.match(body(map.get(day("2026-09-16"))), /- \[ \] Prepare launch\n\t- \[<\] 4:00pm\tPlanning \^E1\n\t- \[ \] Write the brief/);
});

test("run: an event that steps past a task's ID in its note keeps that line, with nothing remembered too", async () => {
    keys.add("E1");
    const map = vault({ [day("2026-09-16")]: note(`- [ ] Book the room ^${lid("E1")}`) });
    await sync(map, [event()]);
    const step = cs.lineId("E1", 1);
    assert.match(map.get(day("2026-09-16")), new RegExp(`\\tPlanning \\^${step}\\n`));
    device(map).app.saveLocalStorage("plainday-calendar-cache", null);
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
});

test("run: a log's line with no time is taken over when its event arrives, and its log takes the line's times", async () => {
    const LOG = "Projects/Studio/logs/2026-09-16 Planning.md";
    const map = vault({
        [day("2026-09-16")]: note("- [<] [[2026-09-16 Planning|Planning]]", "- [ ] A task"),
        [LOG]: "---\ntags: log\ndate: 2026-09-16\ntime: \nendTime: \n---\n## Notes\n",
    });
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 adopted");
    assert.match(reported(map), /Planning \(time added; log times updated\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] ^E1", "\t- 4:30pm", "- [ ] A task"));
    assert.equal(map.get(LOG), "---\ntags: log\ndate: 2026-09-16\ntime: 4:00pm\nendTime: 4:30pm\n---\n## Notes\n");
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [at(17)]), "Calendar sync: 1 updated");
    assert.match(reported(map), /Planning \(log times updated\)/);
    assert.equal(map.get(LOG), "---\ntags: log\ndate: 2026-09-16\ntime: 5:00pm\nendTime: 5:30pm\n---\n## Notes\n");
    // Moved: the new line carries the link, and the log's times follow
    assert.equal(await sync(map, [event({ date: "2026-09-17", start: "2026-09-17T09:00:00-04:00", end: "2026-09-17T09:45:00-04:00" })]), "Calendar sync: 1 moved");
    assert.equal(map.get(LOG), "---\ntags: log\ndate: 2026-09-16\ntime: 9:00am\nendTime: 9:45am\n---\n## Notes\n");
    // A ⋯ pointing at a note that isn't a log leaves it alone
    const TASK = "Projects/Studio/Draft the brief.md";
    const other = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning [[Draft the brief|⋯]]", "\t- 4:30pm"), [TASK]: "---\ntime: 9:00am\n---\n" });
    await sync(other, [at(17)]);
    assert.equal(other.get(TASK), "---\ntime: 9:00am\n---\n");
});

test("run: moved onto a day with its line from before IDs: that line takes the event, with the old day's part, and the old line goes", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1", "\tPlanning [[Pinecone Studio|⭕]] ^E1"));
    map.set(day("2026-09-18"), unnamed(note("- [<] 4:00pm\tPlanning", "\t- 4:30pm", "\t- bring the draft")));
    assert.equal(await sync(map, [moved()]), "Calendar sync: 1 adopted, 1 moved");
    assert.equal(body(map.get(day("2026-09-16"))), "");
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm", "\t- bring the draft"));
});

test("run: moved onto a day where a task has its ID: the new line steps to its next ID, the old one goes, and the next run settles", async () => {
    const map = vault();
    await sync(map, [event({ availability: "free" })]);
    map.set(day("2026-09-18"), note(`- [ ] Book the room ^${lid("E1")}`));
    assert.equal(await sync(map, [moved({ availability: "free" })]), "Calendar sync: 1 moved");
    assert.match(map.get(day("2026-09-18")), new RegExp(`\\tPlanning ℹ️ \\^${cs.lineId("E1", 1)}\\n`));
    assert.equal(body(map.get(day("2026-09-16"))), "");
    assert.equal(cache(map).lines[cs.lineId("E1", 1)].free, true, "the sync's ℹ️ goes with it");
    assert.equal(await sync(map, [moved({ availability: "free" })]), "Calendar sync: nothing to change");
});

test("run: a calendar taken out of the settings leaves its lines as they are", async () => {
    const map = vault();
    const d = device(map);
    d.state.calendars.list.push({ id: "home", name: "Home", account: "iCloud", address: "", on: true });
    d.state.links.home = "https://calendar.example.com/home.ics";
    d.state.reads.home = { events: [event({ key: "H1", id: "H1", title: "Dentist", calendarId: "home", start: "2026-09-16T08:00:00-04:00", end: "2026-09-16T09:00:00-04:00" })], failed: [] };
    await sync(map, [event()]);
    d.state.calendars.list = d.state.calendars.list.filter((c) => c.id !== "home");
    await sync(map, [event()], { now: later(0) });
    await sync(map, [event()], { now: later(20) });
    assert.match(map.get(day("2026-09-16")), /- \[<\] 8:00am\tDentist/);
});

test("run: an event with two copies of its line marks both canceled when it's gone", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 4:30pm", "\t- 4:30pm\n- [ ] A task\n- [<] 4:00pm\tPlanning ^E1"));
    await sync(map, [], { now: later(0) });
    assert.equal(await sync(map, [], { now: later(20) }), "Calendar sync: 1 canceled");
    assert.equal((map.get(day("2026-09-16")).match(/- \[-\] 4:00pm\tPlanning/g) ?? []).length, 2);
});

// ------------------------------------------------------------------ from the sixth review (OBS-275)

test("a note of yours that starts with a time: never the end line under an all-day line or one ending on another day; under a timed line, only when it's first and nothing is remembered", () => {
    const conf = note("- [<] All day\tDesign conference ^E1", "\t- 9:30am: keynote", "\t- 1:00pm: workshop", "\t- 10:00am", "\t\t- doors open then");
    assert.equal(write(conf, event({ title: "Design conference", allDay: true })).outcome, "present");
    // Remembered: the end line is the one with the end time this device wrote, and goes first
    const timed = note("- [<] 4:00pm\tPlanning ^E1", "\t- 3:00pm: prep the room", "\t- 4:30pm");
    const remembered = { key: "E1", date: "2026-09-16", end: "4:30pm" };
    assert.equal(write(timed, event({ end: "2026-09-16T16:45:00-04:00" }), { remembered }).text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:45pm", "\t- 3:00pm: prep the room"));
    // Below the end line, it's always yours (2.6c)
    const below = note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "\t- 3:00pm: prep the room");
    assert.equal(write(below, event({ end: "2026-09-16T16:45:00-04:00" })).text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:45pm", "\t- 3:00pm: prep the room"));
    // An event ending on another day has no end line: a note under it that starts with a time stays
    const multi = note("- [<] 4:00pm\tPlanning ^E1", "\t- 9:15am: call the venue");
    assert.equal(write(multi, event({ endsSameDay: false, end: "2026-09-18T09:00:00-04:00" })).outcome, "present");
    assert.equal(write(multi, event({ end: "2026-09-16T16:30:00-04:00" }), { remembered: { key: "E1", date: "2026-09-16", end: false } }).text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "\t- 9:15am: call the venue"), "and when it gains an end time, its end line goes above");
    // An evening event's end can be after midnight
    const late = write(note("- [<] 10:00pm\tLate launch ^E1", "\t- 1:00am"), event({ title: "Late launch", start: "2026-09-16T22:00:00-04:00", end: "2026-09-17T01:30:00-04:00" }));
    assert.equal(late.text, note("- [<] 10:00pm\tLate launch ^E1", "\t- 1:30am"));
});

test("two lines the same under one event line both stay when it's rewritten; copies' different end notes are all kept", () => {
    const twice = note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "\t- [ ] send the deck", "\t- [ ] send the deck", "\t- 4:00pm - 4:15pm", "\t- 4:00pm - 4:15pm");
    assert.equal(write(twice, event({ end: "2026-09-16T16:45:00-04:00" })).text, twice.replace("\t- 4:30pm", "\t- 4:45pm"));
    const copies = note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm: bring the draft", "- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm: book the room");
    assert.equal(write(copies).text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm: bring the draft", "\t- book the room"));
});

test("a line from before IDs goes to its own event: not to one whose title starts the same, not a [-] line, and a log's line only when one event has its title", () => {
    keys.add("E2");
    const before = note("- [<] 4:00pm\tPlanning review [[Pinecone Studio|⭕]]", "\t- 4:30pm", "\t- 4:00pm - 4:20pm");
    assert.equal(write(before, event()).outcome, "adopted", "the title, then words of yours");
    const day = [{ key: "E2", start: "4:00pm", title: "Planning review" }];
    const shared = cs.runOps(unnamed(before), [{ kind: "event", key: "E1", lid: lid("E1"), event: event(), title: "Planning", lines: cs.lines(event()), day }], { cache: { lines: {} } });
    assert.equal(shared.outcomes[0].outcome, "added", "not when another event at that time has that title");    assert.equal(write(note("- [-] 4:00pm\tPlanning", "\t- 4:30pm")).outcome, "added", "a [-] line isn't taken");
    const logLine = note("- [<] 1-1 [[2026-09-16 1-1|⋯]]");
    const two = cs.runOps(logLine, [{ kind: "event", key: "E1", lid: lid("E1"), event: event({ title: "1-1" }), title: "1-1", lines: cs.lines(event({ title: "1-1" })), day: [{ key: "E2", start: "10:00am", title: "1-1" }] }], { cache: { lines: {} }, free: new Map() });
    assert.equal(two.outcomes[0].outcome, "added", "two 1-1s that day: the log's line waits");
});

test("a title ending in ` ^v2` loses it; a CRLF note is read and keeps its line endings; a line taken over steps past a task's ID", () => {
    assert.equal(cs.title(event({ title: "Release ^v2" })), "Release");
    const crlf = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm").replace(/\n/g, "\r\n");
    const out = write(crlf);
    assert.equal(out.outcome, "adopted");
    assert.equal(out.text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm").replace(/\n/g, "\r\n"));
    const clash = write(note("- [<] 4:00pm\tPlanning", "\t- 4:30pm", `- [ ] Book the room ^${lid("E1")}`));
    assert.match(clash.text, new RegExp(`\\tPlanning \\^${cs.lineId("E1", 1)}\\n`));
});

test("run: a canceled line with time entries is forwarded, [-] and all, when its event comes back on another day", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 4:30pm", "\t- 4:30pm\n\t- 4:00pm - 4:20pm"));
    await sync(map, [], { now: later(0) });
    await sync(map, [], { now: later(20) });
    assert.equal(await sync(map, [moved()]), "Calendar sync: 1 forwarded");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [>] [[2026-09-18|9/18]] 4:00pm\tPlanning", "\t- 4:30pm", "\t- 4:00pm - 4:20pm"));
});

test("run: a numbered or mistyped time entry keeps a moved line behind, forwarded; and a line moved onto its old line on the new day joins it, keeping that line's box", async () => {
    for (const entry of ["\t1. 4:00pm - 4:20pm", "\t- 4:00 - 4:20pm"]) {
        const map = vault();
        await sync(map, [event()]);
        edit(map, day("2026-09-16"), (t) => t.replace("\t- 4:30pm", `\t- 4:30pm\n${entry}`));
        assert.equal(await sync(map, [moved()]), "Calendar sync: 1 forwarded", entry);
    }
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm: bring the draft"));
    map.set(day("2026-09-18"), note("- [x] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.equal(await sync(map, [moved()]), "Calendar sync: 1 adopted, 1 moved");
    assert.equal(body(map.get(day("2026-09-16"))), "");
    assert.equal(body(map.get(day("2026-09-18"))), text("- [x] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm: bring the draft"));
});

test("run: a copy on another day with different links: the event's line keeps its own, and the report says so", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1", "\tPlanning [[Pinecone Studio|⭕]] ^E1"));
    map.set(day("2026-09-17"), unnamed(note("- [<] 4:00pm\tPlanning [[Kestrel|⭕]] ^E1", "\t- 4:30pm")));
    await sync(map, [event()]);
    assert.match(reported(map), /2026-09-16 Planning — its line on another day had different links, so this one's are kept/);
    assert.match(map.get(day("2026-09-16")), /Planning \[\[Pinecone Studio\|⭕\]\] \^/);
});

// ------------------------------------------------------------------ from the seventh review (OBS-275)

test("run: an afternoon event that ends after midnight keeps one end line and settles", async () => {
    const map = vault();
    const party = event({ title: "Launch party", start: "2026-09-16T17:00:00-04:00", end: "2026-09-17T00:00:00-04:00" });
    await sync(map, [party]);
    assert.equal(await sync(map, [party]), "Calendar sync: nothing to change");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tLaunch party ^E1", "\t- 12:00am"));
});

test("run: lines of yours below a blank line under an event stay with it: nothing is inserted between, and they move or merge with it", async () => {
    const map = vault();
    await sync(map, [at(9, { title: "Standup" })]);
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 9:30am", "\t- 9:30am\n\n\t- 9:00am - 9:20am\n\t- notes for the standup"));
    await sync(map, [at(9, { title: "Standup" }), at(10, { key: "E2", id: "E2", title: "Client call" })]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 9:00am\tStandup ^E1", "\t- 9:30am", "", "\t- 9:00am - 9:20am", "\t- notes for the standup", "- [<] 10:00am\tClient call ^E2", "\t- 10:30am"));
    // A copy with lines below a blank line merges with them
    const copy = vault();
    await sync(copy, [at(9, { title: "Standup" }), at(10, { key: "E2", id: "E2", title: "Client call" })]);
    edit(copy, day("2026-09-16"), (t) => `${t.replace(/\n+$/, "")}\n- [<] 9:00am\tStandup ^E1\n\t- 9:30am\n\n\t- standup notes\n`);
    assert.equal(await sync(copy, [at(9, { title: "Standup" }), at(10, { key: "E2", id: "E2", title: "Client call" })]), "Calendar sync: 1 doubled line merged");
    assert.equal(body(copy.get(day("2026-09-16"))), text("- [<] 9:00am\tStandup ^E1", "\t- 9:30am", "", "\t- standup notes", "- [<] 10:00am\tClient call ^E2", "\t- 10:30am"));
});

test("🆓 after the title is kept wherever it is; one typed before the title is part of an edited title; an ℹ️ on a line from before IDs stays", () => {
    assert.equal(write(note("- [<] 4:00pm\tPlanning (🆓) ^E1", "\t- 4:30pm")).text, note("- [<] 4:00pm\tPlanning (🆓) ^E1", "\t- 4:30pm"));
    assert.equal(write(note("- [<] 4:00pm\tPlanning 🆓 internal ^E1", "\t- 4:30pm")).outcome, "present");
    assert.equal(write(note("- [<] 4:00pm\t🆓 Planning ^E1", "\t- 4:30pm")).text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    assert.equal(write(note("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm")).text, note("- [<] 4:00pm\tPlanning ℹ️ ^E1", "\t- 4:30pm"), "nothing remembered: left as it is");
});

test("a line from before with a block link of yours isn't taken over: the event gets a line beside it; a note with a template's raw code gets events after it; a line marked [x] still sorts by time", () => {
    const own = write(note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^x7k2p9", "\t- 4:30pm"));
    assert.equal(own.outcome, "added");
    assert.equal(own.text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^x7k2p9", "\t- 4:30pm", "- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    const raw = "<%* tR += await tp.file.include('[[Daily Note]]') %>\n";
    assert.equal(write(raw).text, `<%* tR += await tp.file.include('[[Daily Note]]') %>\n- [<] 4:00pm\tPlanning ^E1\n\t- 4:30pm\n`);
    keys.add("E2");
    const sorted = write(note("- [<] 9:00am\tStandup", "- [x] 10:00am\tReview ^E2", "- [ ] A task"), at(14, { title: "Late call" }));
    assert.equal(sorted.text, note("- [<] 9:00am\tStandup", "- [x] 10:00am\tReview ^E2", "- [<] 2:00pm\tLate call ^E1", "\t- 2:30pm", "- [ ] A task"));
});

test("copies merging into an event with no end time now keep every end line with a note, as it was", () => {
    const copies = note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm", "- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm: bring the signed contract");
    assert.equal(write(copies, event({ endsSameDay: false, end: "2026-09-18T09:00:00-04:00" })).text, note("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm: bring the signed contract"));
});

test("run: a log two event lines link keeps its own times", async () => {
    const LOG = "Projects/Studio/logs/2026-09-16 One on one.md";
    const map = vault({ [LOG]: "---\ntags: log\ntime: \nendTime: \n---\n" });
    const one = (d, key) => event({ key, id: key, title: "1-1", date: d, start: `${d}T10:00:00-04:00`, end: `${d}T10:30:00-04:00` });
    await sync(map, [one("2026-09-16", "E1"), one("2026-09-23", "E2")]);
    for (const d of ["2026-09-16", "2026-09-23"]) edit(map, day(d), (t) => t.replace("\t1-1 ^", "\t1-1 [[2026-09-16 One on one|⋯]] ^"));
    assert.equal(await sync(map, [one("2026-09-16", "E1"), one("2026-09-23", "E2")]), "Calendar sync: nothing to change");
    assert.equal(map.get(LOG), "---\ntags: log\ntime: \nendTime: \n---\n");
});

// ------------------------------------------------------------------ recurring series

const weekly = (date, over = {}) => event({
    key: `S1@${date}`, id: "S1", title: "Weekly sync", date, recurring: true,
    start: `${date}T10:00:00-04:00`, end: `${date}T10:30:00-04:00`, ...over,
});
const SERIES = ["2026-09-16", "2026-09-23", "2026-09-30"];

test("run: a recurring series' ⭕ in Plainday's settings goes on its new lines; a ⭕ you change or take off stays as you left it", async () => {
    const map = vault();
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    await sync(map, SERIES.map((d) => weekly(d)));
    for (const d of SERIES) assert.match(map.get(day(d)), /- \[<\] 10:00am\tWeekly sync \[\[Pinecone Studio\|⭕\]\] \^e-[a-z0-9]{6}\n\t- 10:30am/);
    edit(map, day("2026-09-23"), (t) => t.replace(" [[Pinecone Studio|⭕]]", ""));
    edit(map, day("2026-09-30"), (t) => t.replace("[[Pinecone Studio|⭕]]", "[[Budget Book|⭕]]"));
    const more = [...SERIES, "2026-10-07"];
    assert.equal(await sync(map, more.map((d) => weekly(d))), "Calendar sync: 1 added");
    assert.doesNotMatch(map.get(day("2026-09-23")), /⭕/);
    assert.match(map.get(day("2026-09-30")), /Weekly sync \[\[Budget Book\|⭕\]\]/);
    assert.match(map.get(day("2026-10-07")), /Weekly sync \[\[Pinecone Studio\|⭕\]\]/);
    // Changing the series' project changes nothing already written (the panel will, OBS-276)
    setLinks(map, "Weekly sync", ["[[Kestrel|⭕]]"]);
    assert.equal(await sync(map, more.map((d) => weekly(d))), "Calendar sync: nothing to change");
});

test("run: a series follows its ID: renamed in the calendar, its entry in the settings is renamed and keeps the project", async () => {
    const map = vault();
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    await sync(map, SERIES.map((d) => weekly(d)));
    assert.equal(cache(map).seriesTitles.S1, "Weekly sync");
    const renamed = [...SERIES, "2026-10-07"].map((d) => weekly(d, { title: "Weekly sync (studio)" }));
    await sync(map, renamed);
    assert.deepEqual(plain(recurring(map)), [{ title: "Weekly sync (studio)", links: ["[[Pinecone Studio|⭕]]"] }]);
    for (const d of SERIES) assert.match(map.get(day(d)), /\tWeekly sync \(studio\) \[\[Pinecone Studio\|⭕\]\] \^/);
    assert.match(map.get(day("2026-10-07")), /\tWeekly sync \(studio\) \[\[Pinecone Studio\|⭕\]\]/, "a new occurrence gets it");
    assert.equal(cache(map).seriesTitles.S1, "Weekly sync (studio)");
});

test("run: an event moved further ahead than the range: its line goes, and comes back when its day is in range; one with time entries under it stays", async () => {
    const map = vault();
    keys.add("E2");
    const call = at(13, { key: "E2", id: "E2", title: "Vendor call" });
    await sync(map, [event(), call]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm\n\t- bring the deck").replace("\tVendor call ^E2\n\t- 1:30pm", "\tVendor call ^E2\n\t- 1:30pm\n\t- 1:00pm - 1:20pm"));
    device(map).outside = ["E1", "E2"];
    assert.equal(await sync(map, [], { now: later(30) }), "Calendar sync: 1 removed");
    assert.match(reported(map), /Planning \(moved past the sync range\)/);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 1:00pm\tVendor call ^E2", "\t- 1:30pm", "\t- 1:00pm - 1:20pm"));
    // In range again: a line of its own on its new day
    device(map).outside = [];
    keys.add("E1");
    assert.equal(await sync(map, [moved({ key: "E1", id: "E1" }), call], { now: later(40) }), "Calendar sync: 1 added");
    assert.match(body(map.get(day("2026-09-18"))), /- \[<\] 4:00pm\tPlanning \^E1/);
});

test("run: a series split by a \"this and future events\" edit: the new series takes over the old one's lines in the same places, with everything of yours, and its project follows the new title", async () => {
    const map = vault();
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    await sync(map, SERIES.map((d) => weekly(d)));
    edit(map, day("2026-09-30"), (t) => t.replace("\t- 10:30am", "\t- 10:30am\n\t- agenda: budget"));
    // From 9/23 on, a new series with a new ID and a new title, at the same times
    const split = (d) => weekly(d, { key: `S2@${d}`, id: "S2", title: "Weekly sync (new)" });
    keys.add("S2@2026-09-23"); keys.add("S2@2026-09-30"); keys.add("S2@2026-10-07");
    const said = await sync(map, [weekly("2026-09-16"), split("2026-09-23"), split("2026-09-30"), split("2026-10-07")]);
    assert.equal(said, "Calendar sync: 1 added, 2 updated");
    assert.match(map.get(day("2026-09-16")), /\tWeekly sync \[\[Pinecone Studio\|⭕\]\] \^/);
    for (const d of ["2026-09-23", "2026-09-30", "2026-10-07"]) assert.match(map.get(day(d)), /- \[<\] 10:00am\tWeekly sync \(new\) \[\[Pinecone Studio\|⭕\]\] \^/, d);
    assert.match(map.get(day("2026-09-30")), /\t- 10:30am\n\t- agenda: budget/);
    assert.doesNotMatch([...map.values()].join("\n"), /- \[-\]/);
    assert.deepEqual(plain(recurring(map).find((r) => r.title === "Weekly sync (new)")?.links), ["[[Pinecone Studio|⭕]]"]);
    assert.equal(await sync(map, [weekly("2026-09-16"), split("2026-09-23"), split("2026-09-30"), split("2026-10-07")]), "Calendar sync: nothing to change");
});

test("renameSeries: a swap in one run keeps each project with its series; a copy goes after the entry it came from", () => {
    const list = [{ title: "A", links: ["[[PA|⭕]]"] }, { title: "B", links: ["[[PB|⭕]]"] }];
    assert.deepEqual(plain(cs.renameSeries(list, [{ from: "A", to: "B", copy: false }, { from: "B", to: "A", copy: false }])), [{ title: "A", links: ["[[PB|⭕]]"] }, { title: "B", links: ["[[PA|⭕]]"] }]);
    assert.deepEqual(plain(cs.renameSeries(list, [{ from: "A", to: "C", copy: true }])), [list[0], { title: "C", links: ["[[PA|⭕]]"] }, list[1]]);
});

test("run: recurring events' projects are read from the old Calendar Sync note once, into the settings", async () => {
    const map = vault({ [NOTE]: text("---", "id: 1", "---", "", "## Recurring events", "", "- Weekly sync [[Pinecone Studio|⭕]]", "- Board call", "", "## Last run", "") });
    device(map).state.calendars.recurring = null;
    const before = map.get(NOTE);
    assert.equal(await sync(map, SERIES.map((d) => weekly(d))), "Calendar sync: 3 added");
    assert.deepEqual(plain(recurring(map)), [{ title: "Weekly sync", links: ["[[Pinecone Studio|⭕]]"] }]);
    for (const d of SERIES) assert.match(map.get(day(d)), /Weekly sync \[\[Pinecone Studio\|⭕\]\]/);
    assert.equal(map.get(NOTE), before, "the note isn't changed");
    edit(map, NOTE, (t) => t.replace("- Board call", "- Board call [[Kestrel|⭕]]"));
    const saves = device(map).state.saves;
    await sync(map, SERIES.map((d) => weekly(d)));
    assert.equal(device(map).state.saves, saves, "read once");
});

// ------------------------------------------------------------------ calendars, devices, messages

test("run: only calendars that are on and have a link on this device are read; with none, nothing goes over the network", async () => {
    const map = vault();
    const d = device(map);
    d.state.calendars.list.push({ id: "off", name: "Off", account: "", address: "", on: false }, { id: "nolink", name: "Elsewhere", account: "", address: "", on: true });
    d.state.links.off = "https://calendar.example.com/off.ics";
    const feed = stand(d.state).CalendarFeed;
    d.state.reads.cal = { events: [event()], failed: [] };
    assert.equal(await load(d.app, d.state, { CalendarFeed: feed }).run(), "Calendar sync: 1 added");
    assert.deepEqual(feed.loads, ["cal"]);

    const none = vault();
    const n = device(none);
    n.state.calendars.list = [];
    const quiet = stand(n.state).CalendarFeed;
    assert.equal(await load(n.app, n.state, { CalendarFeed: quiet }).run(), "No calendars to sync yet: add one in Settings → Plainday → Calendars");
    n.state.calendars.list = [{ id: "x", name: "X", account: "", address: "", on: true }];
    assert.equal(await load(n.app, n.state, { CalendarFeed: quiet }).run(), "No calendar is switched on with a link on this device: see Settings → Plainday → Calendars");
    assert.deepEqual(quiet.loads, []);
    assert.equal(none.size, 0, "no note written");
});

test("run: on a device that isn't the one that syncs, Sync calendars says so, writes nothing and downloads nothing", async () => {
    const map = vault();
    const d = device(map);
    d.state.syncHere = false;
    const feed = stand(d.state).CalendarFeed;
    d.state.reads.cal = { events: [event()], failed: [] };
    assert.equal(await load(d.app, d.state, { CalendarFeed: feed }).run(), "This device doesn't sync calendars. To sync them here, turn on Settings → Plainday → Calendars → Sync calendars on this device, and keep it off on your other devices.");
    assert.deepEqual(feed.loads, []);
    assert.equal(map.size, 0);
});

test("run: a calendar that couldn't be read keeps its lines, and the summary names it; an event the reader skipped too", async () => {
    const map = vault();
    const d = device(map);
    d.state.calendars.list.push({ id: "home", name: "Home", account: "iCloud", address: "", on: true });
    d.state.links.home = "https://calendar.example.com/home.ics";
    d.state.reads.home = { events: [event({ key: "H1", id: "H1", title: "Dentist", calendarId: "home", start: "2026-09-16T08:00:00-04:00", end: "2026-09-16T09:00:00-04:00" })], failed: [] };
    await sync(map, [event()]);
    d.state.reads.home = { problem: "unreachable" };
    await sync(map, [], { now: later(0) });
    assert.equal(await sync(map, [], { now: later(20) }), "Calendar sync: 1 canceled. Not synced: Home (couldn't be reached)");
    assert.match(map.get(day("2026-09-16")), /- \[<\] 8:00am\tDentist/);
    d.state.reads.home = { events: [], failed: [{ uid: "H1", title: "Dentist" }] };
    assert.equal(await sync(map, []), "Calendar sync: nothing to change. 1 event skipped, which the calendar sync can't read: see the error log");
    assert.match(map.get(day("2026-09-16")), /- \[<\] 8:00am\tDentist/);
});

test("run: a link that stopped working: the error log names the calendar and this device, a toast once, and never the link", async () => {
    const map = vault({ [ERROR_LOG]: "---\nid: 1\ntags:\n---\n\n## Calendar sync\n\nUpdated 9/14 8:00am · 1 open\n\n- Link stopped working · Studio (on iPhone)\n" });
    const d = device(map);
    d.state.calendars.list[0].name = "Studio";
    d.state.reads.cal = { problem: "dead" };
    const toasts = [];
    const errorLog = makeErrorLog(d.app, toasts);
    const run = () => load(d.app, d.state, { ErrorLog: errorLog }).run();
    assert.equal(await run(), "Calendar sync: nothing synced. Not synced: Studio (its link stopped working on this device)");
    assert.match(map.get(ERROR_LOG), /- Link stopped working · Studio \(on Mac\)\n/);
    assert.match(map.get(ERROR_LOG), /- Link stopped working · Studio \(on iPhone\)\n/, "the phone's line is the phone's");
    assert.equal(toasts.length, 1);
    await run();
    assert.equal(toasts.length, 1, "no second toast");
    assert.equal(load(d.app, d.state).deadLink("cal"), true);
    for (const t of [...map.values(), ...toasts, ...(d.state.notices ?? []), ...d.app.local.values()]) assert.doesNotMatch(String(t), /calendar\.example\.com/);
    d.state.reads.cal = { events: [], failed: [] };
    await run();
    assert.doesNotMatch(map.get(ERROR_LOG), /Studio \(on Mac\)/);
    assert.match(map.get(ERROR_LOG), /Studio \(on iPhone\)/);
    assert.equal(load(d.app, d.state).deadLink("cal"), false);
});

// The real ErrorLog, writing into the test vault, its toasts kept in `toasts`
function makeErrorLog(app, toasts) {
    const context = vm.createContext({
        app, moment, Notice: class { constructor(m) { toasts.push(m); } },
        createFragment: (fn) => { const parts = []; fn({ appendText: (t) => parts.push(t), createEl: (_, o) => { parts.push(o.text); return { addEventListener() {} }; } }); return parts.join(""); },
        plainday: { Settings: { errorLogPath: () => ERROR_LOG } }, console,
    });
    return new (vm.runInContext(classScript("errorLog.js") + "\n;ErrorLog", context))();
}

test("run: a link pasted while a sync works isn't taken for the one that stopped working", async () => {
    const map = vault();
    const d = device(map);
    d.state.reads.cal = { problem: "dead" };
    const s = load(d.app, d.state);
    d.state.duringLoad = () => { s.linkChanged("cal"); };
    await s.run();
    assert.equal(s.deadLink("cal"), false);
    d.state.duringLoad = null;
    await load(d.app, d.state).run();
    assert.equal(load(d.app, d.state).deadLink("cal"), true, "a sync that reads the dead link again says so");
    assert.equal(map.size, 0);
});

test("run: one sync at a time: a second one says so and does nothing", async () => {
    const map = vault();
    const d = device(map);
    d.state.reads.cal = { events: [event()], failed: [] };
    const s = load(d.app, d.state);
    const [a, b] = await Promise.all([s.run(), s.run()]);
    assert.equal(a, "Calendar sync: 1 added");
    assert.equal(b, "A calendar sync is already running");
});

test("run: daily notes named DD-MM-YYYY get the events, and no YYYY-MM-DD notes appear (OBS-124)", async () => {
    const map = vault();
    device(map).state.format = "DD-MM-YYYY";
    await sync(map, [event()]);
    assert.equal(body(map.get(`${DAYS}/16-09-2026.md`)), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    assert.equal(map.has(day("2026-09-16")), false);
    edit(map, `${DAYS}/16-09-2026.md`, (t) => t.replace("\t- 4:30pm", "\t- 4:30pm\n\t- 4:00pm - 4:20pm"));
    await sync(map, [moved()]);
    assert.equal(body(map.get(`${DAYS}/16-09-2026.md`)), text("- [>] [[18-09-2026|9/18]] 4:00pm\tPlanning", "\t- 4:30pm", "\t- 4:00pm - 4:20pm"), "the forward links the day by its name");
    assert.equal(body(map.get(`${DAYS}/18-09-2026.md`)), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
});

test("run: the sync writes no file of its own: only daily notes, and no error log with nothing in it", async () => {
    const map = vault();
    device(map).app.isMobile = false;
    device(map).extra = { ErrorLog: makeErrorLog(device(map).app, []) };
    await sync(map, [event(), moved({ key: "E2", id: "E2" })]);
    assert.deepEqual([...map.keys()].sort(), [day("2026-09-16"), day("2026-09-18")]);
    device(map).state.reads.cal = { problem: "dead" };
    await load(device(map).app, device(map).state, device(map).extra).run();
    assert.ok(map.has(ERROR_LOG), "made when there's something to say");
});

test("run: until the one-time conversion runs, the sync changes nothing and says why", async () => {
    const map = vault();
    const d = device(map);
    d.extra = { TimeReport: { oldMarksLeft: async () => 2 } };
    assert.match(await sync(map, [event()]), /^2 lines in the daily notes still end in a 🗒️ or 🔗 link/);
    assert.equal(map.size, 0);
});

// ------------------------------------------------------------------ randomized

// Events retimed, moved, renamed, freed, deleted and put back over several runs, with ⭕ links, time
// entries and notes added by hand and lines deleted. Every event read has one line, at its day and
// time; a ⭕, an entry or a note stays with its event; and a run with nothing new changes nothing.
test("run: random runs keep one line per event, everything of yours with its event, and settle", async () => {
    for (const start of [1, 7, 42]) {
        let seed = start;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const pick = (a) => a[Math.floor(rnd() * a.length)];
        const DATES = ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
        const TITLES = ["Planning", "Standup", "Lunch"];
        const make = (i) => {
            const date = pick(DATES), h = 8 + Math.floor(rnd() * 4);
            return event({ key: `K${i}`, id: `K${i}`, title: pick(TITLES), date, start: `${date}T${String(h).padStart(2, "0")}:00:00-04:00`, end: `${date}T${String(h + 1).padStart(2, "0")}:00:00-04:00`, availability: rnd() < 0.2 ? "free" : "busy" });
        };
        const change = (e) => {
            const r = rnd();
            if (r < 0.25) { const h = 8 + Math.floor(rnd() * 4); return { ...e, start: `${e.date}T${String(h).padStart(2, "0")}:30:00-04:00`, end: `${e.date}T${String(h + 1).padStart(2, "0")}:30:00-04:00` }; }
            if (r < 0.5) { const d = pick(DATES); return { ...e, date: d, start: d + e.start.slice(10), end: d + e.end.slice(10) }; }
            if (r < 0.6) return { ...e, title: pick(TITLES) };
            if (r < 0.7) return { ...e, availability: e.availability === "free" ? "busy" : "free" };
            return e;
        };
        for (let round = 0; round < 30; round++) {
            const map = vault();
            let evs = Array.from({ length: 6 }, (_, i) => make(i));
            await sync(map, evs);
            const notes = () => [...map].filter(([k]) => k.startsWith(DAYS));
            const lineOf = (key) => { const id = lid(key); for (const [k, v] of notes()) { const ls = v.split("\n"); const i = ls.findIndex((l) => /^- \[[<-]\]/.test(l) && l.endsWith(` ^${id}`)); if (i !== -1) return { k, ls, i }; } return null; };
            // Yours, by event: a ⭕ on its line, or a note under it
            const mine = new Map(), marked = new Set();
            for (const e of evs) {
                const r = rnd(), f = lineOf(e.key);
                if (!f) continue;
                if (r < 0.3) { f.ls[f.i] = f.ls[f.i].replace(/ \^/, ` [[P${e.key}|⭕]] ^`); mine.set(e.key, `[[P${e.key}|⭕]]`); }
                else if (r < 0.5) { f.ls.splice(f.i + 1, 0, `\t- note for ${e.key}`); mine.set(e.key, `\t- note for ${e.key}`); }
                else if (r < 0.6) { f.ls.splice(f.i, cs.blockAt(f.ls, f.i).to - f.i + 1); }
                else if (r < 0.65) { f.ls[f.i] = f.ls[f.i].replace("- [<]", "- [x]"); marked.add(e.key); }
                map.set(f.k, f.ls.join("\n"));
            }
            for (let step = 0; step < 3; step++) {
                evs = evs.map(change);
                await sync(map, evs);
                const all = () => notes().map(([k, v]) => `${k}\n${v}`).join("\n");
                const before = all();
                const where = `seed ${start} round ${round} step ${step}`;
                assert.equal(await sync(map, evs), "Calendar sync: nothing to change", where);
                assert.equal(all(), before, where);
                for (const e of evs) {
                    const id = lid(e.key);
                    // A line marked [x] is yours: left where it is, as it is, and its event alone
                    if (marked.has(e.key)) {
                        assert.equal(notes().flatMap(([, v]) => v.split("\n")).filter((l) => l.startsWith("- [x]") && l.endsWith(` ^${id}`)).length, 1, `${where}: ${e.key} marked`);
                        continue;
                    }
                    const ls = notes().flatMap(([k, v]) => v.split("\n").filter((l) => / \^e-[a-z0-9]{6}$/.test(l) && l.endsWith(` ^${id}`)).map((l) => [k, l]));
                    assert.equal(ls.length, 1, `${where}: ${e.key}`);
                    assert.equal(ls[0][0], day(e.date), `${where}: ${e.key} on its day`);
                    assert.ok(ls[0][1].startsWith(cs.lines(e)[0].replace(/ ℹ️$/, "")), `${where}: ${e.key} written from the event: ${ls[0][1]}`);
                    const kept = mine.get(e.key);
                    if (kept) assert.ok(notes().some(([, v]) => v.includes(kept)), `${where}: ${e.key} keeps ${kept}`);
                }
                for (const [, v] of notes()) for (const l of v.split("\n")) {
                    const m = l.match(/\[\[P(K\d+)\|⭕\]\]/), idm = l.match(/ \^(e-[a-z0-9]{6})$/);
                    if (m && idm) assert.equal(idm[1], lid(m[1]), `${where}: a ⭕ on another event's line: ${l}`);
                }
            }
        }
    }
});
