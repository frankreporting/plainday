// Tests for plugin/src/commands/calendarSync.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm. The pure parts (applyOne, runOps,
// findBlock) are tested on note text; whole runs go through run() against an in-memory vault, with
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
const OLD_EVENTS = "Config/Scripts/Calendar/calendar-events.json";
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
// An event's line ID, as the sync works it out from its key
const lid = (key) => cs.lineId(key);

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

test("🗃️ area link added, then the event's time changes: time updated, 🗃️ kept (OBS-36)", () => {
    const before = note("- [<] 4:00pm\tPlanning [[Household|🗃️]]", "\t- 4:30pm", "- [ ] A task");
    const { text: after, outcome } = run(before, replace(["- [<] 5:00pm\tPlanning", "\t- 5:30pm"]));
    assert.equal(outcome, "replaced");
    assert.equal(after, note("- [<] 5:00pm\tPlanning [[Household|🗃️]]", "\t- 5:30pm", "- [ ] A task"));
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

test("title turned into a log link (before OBS-57), then the time changes: the log stays linked, now at the end; a rename changes only the title", () => {
    const before = note("- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 4:30pm");
    const retimed = run(before, replace(["- [<] 3:00pm\tPlanning", "\t- 3:30pm"]));
    assert.equal(retimed.outcome, "replaced");
    assert.equal(retimed.text, note("- [<] 3:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 3:30pm"));

    const renamed = run(before, replace(["- [<] 4:00pm\tQ3 planning", "\t- 4:30pm"]));
    assert.equal(renamed.text, note("- [<] 4:00pm\tQ3 planning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"));
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
        ["a second note link", ["- [<] 4:00pm\tPlanning [[Agenda|⋯]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"]],
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
    assert.equal(after, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm", "- [ ] A task"));
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

// A vault, this device's state (settings, links, reads) and its cache; `sync(map, events)` runs Sync
// calendars with the Work calendar giving `events`. Lines carry their IDs, which `body` shows as the
// event's key (` ^E1`), so expectations read plainly.
// The device's clock: a real time on the test day, an hour on for each run (a run asks it many times)
let clock = Date.UTC(2026, 8, 15, 13);
const keys = new Set();
const day = (date) => `${DAYS}/${date}.md`;
const named = (t) => t.replace(/ \^([a-z0-9]{6})$/gm, (m, id) => { const k = [...keys].find((key) => lid(key) === id); return k ? ` ^${k}` : m; });
const body = (t) => named(t.split("\n").slice(3).join("\n").replace(/\n+$/, ""));

async function sync(map, events, { device = sync.device, now } = {}) {
    for (const e of events) keys.add(e.key);
    device.state.reads.cal = { events: events.map((e) => ({ calendar: "Work", account: "Work", endsSameDay: true, ...e })), failed: [] };
    const s = load(device.app, device.state);
    const at = now !== undefined ? now : (clock += 60 * 60 * 1000);
    s.now = () => at;
    return s.run();
}
// A vault with one device on it; `twin(map)` is a second device on the same vault, with its own cache
const devices = new WeakMap();
function vault(files = {}) {
    const { app, map } = makeApp(files);
    sync.device = { app, state: newState() };
    sync.app = app;
    devices.set(map, sync.device);
    return map;
}
function twin(map) {
    const { app } = makeApp({});
    // The same notes: the second device's vault reads and writes the first one's map
    for (const k of ["getFileByPath", "create", "read", "cachedRead", "process"]) app.vault[k] = sync.device.app.vault[k];
    app.vault.adapter = sync.device.app.vault.adapter;
    app.metadataCache = sync.device.app.metadataCache;
    app.fileManager = sync.device.app.fileManager;
    return { app, state: newState() };
}
// A note edited by hand, its IDs shown as their events' keys while `fn` edits it, as `body` shows them
const unnamed = (t) => t.replace(/ \^([A-Za-z0-9@.-]+)$/gm, (m, k) => (keys.has(k) ? ` ^${lid(k)}` : m));
const edit = (map, path, fn) => map.set(path, unnamed(fn(named(map.get(path)))));
// A vault's device's cache, and its last run's report, as a list of `- item` lines
const ledger = (map) => (devices.get(map) ?? sync.device).app.loadLocalStorage("plainday-calendar-cache");
const last = (map) => (devices.get(map) ?? sync.device).app.loadLocalStorage("plainday-calendar-last");
const LISTS = ["added", "adopted", "updated", "linked", "restored", "removed", "canceled", "forwarded", "merged", "yours", "held", "skipped"];
const reported = (map) => { const r = last(map); return LISTS.flatMap((k) => r[k].map((i) => `- ${i}\n`)).join(""); };
// The line IDs aside, for checks about the rest of a line
const noIds = (t) => t.replace(/ \^[a-z0-9]{6}$/gm, "");
const plainBody = (t) => noIds(t.split("\n").slice(3).join("\n").replace(/\n+$/, ""));
// Recurring events' projects, in Plainday's settings
const recurring = (map) => (devices.get(map) ?? sync.device).state.calendars.recurring;
const setLinks = (map, title, links) => {
    const device = devices.get(map) ?? sync.device;
    const list = device.state.calendars.recurring.filter((r) => r.title !== title);
    const at = device.state.calendars.recurring.findIndex((r) => r.title === title);
    if (links.length) list.splice(at === -1 ? list.length : at, 0, { title, links });
    device.state.calendars.recurring = list;
};
const section = (map) => `\n${recurring(map).map((r) => `- ${r.title} ${r.links.join(" ")}`).join("\n")}\n`;

test("run: ⭕ and a time entry survive a time change, and nothing is 'yours'", async () => {
    const map = vault();
    await sync(map, [event()]);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));

    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:00pm - 4:30pm: 🆓"));
    await sync(map, [event()]);
    assert.deepEqual(ledger(map).events.E1.projects, ["[[Pinecone Studio|⭕]]"], "the project is remembered");

    const summary = await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]);
    assert.equal(summary, "Calendar sync: 1 updated");
    assert.match(reported(map), /- 2026-09-16 Planning \(time changed; check its time entries\)/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm: 🆓"));
    assert.doesNotMatch(reported(map), /this line is yours/);
    assert.deepEqual(ledger(map).events.E1.lines, ["- [<] 5:00pm\tPlanning", "\t- 5:30pm"]);

    // And a run with nothing new changes nothing
    const again = map.get(day("2026-09-16"));
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: nothing to change");
    assert.equal(map.get(day("2026-09-16")), again);
});

test("run: moved to another day, the ⭕ follows and the time entries stay", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:00pm - 4:30pm"));
    await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [>] [[2026-09-18|9/18]] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:30pm"));
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
    assert.deepEqual(ledger(map).events.E1.projects, ["[[Pinecone Studio|⭕]]"]);
});

test("run: a ⭕ added since the last run moves with the event, and the old line goes", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]"));
    await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.equal(plainBody(map.get(day("2026-09-16"))), "");
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"));
});

test("run: canceled is marked [-] and reported; back in the calendar, it's [<] again and kept current", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 4:30pm", "\t- 4:00pm - 4:30pm"));
    // Gone from one read: nothing yet, since a calendar's copy can lag; still gone a while later: canceled
    assert.equal(await sync(map, []), "Calendar sync: nothing to change");
    assert.equal(await sync(map, []), "Calendar sync: 1 canceled");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [-] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm"));
    assert.deepEqual(last(map).canceled, ["2026-09-16 Planning"]);
    assert.equal(ledger(map).events.E1, undefined);
    assert.equal(await sync(map, []), "Calendar sync: nothing to change");

    // Back with no version to compare: a return once a second read, a while later, still has it
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 restored");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 updated");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning", "\t- 4:00pm - 4:30pm"));
});

test("run: a canceled line you deleted: the event, if it returns, is written afresh", async () => {
    const map = vault();
    await sync(map, [event()]);
    await sync(map, []);
    await sync(map, []);
    edit(map, day("2026-09-16"), () => note());
    await sync(map, [event()]);
    await sync(map, [event()]);
    assert.equal(ledger(map).canceled.E1, undefined);
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 added");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: an event whose ID changes keeps its line (it isn't canceled, or forgotten as deleted)", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\tPlanning [[Pinecone Studio|⭕]]"));
    assert.equal(await sync(map, [event({ key: "E9", id: "E9" })]), "Calendar sync: 1 adopted");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
    assert.deepEqual(Object.keys(ledger(map).events), ["E9"]);
    assert.deepEqual(ledger(map).dismissed, {});
    assert.equal(await sync(map, [event({ key: "E9", id: "E9" })]), "Calendar sync: nothing to change");
});

test("run: a new event doesn't adopt a line another event still has", async () => {
    const map = vault();
    await sync(map, [event()]);
    await sync(map, [event(), event({ key: "E2", id: "E2" })]);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm", "- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.equal(await sync(map, [event(), event({ key: "E2", id: "E2" })]), "Calendar sync: nothing to change");
});

test("run: a vault from before (OBS-275): its lines with no ID are adopted and given IDs, nothing twice; the old record's deleted lines stay deleted", async () => {
    // The Mac's old record keyed events by its own IDs, which no feed has: its deleted line is found in
    // the Mac's last events file, by its day and the line the sync wrote
    const map = vault({
        [OLD_LEDGER]: JSON.stringify({ version: 1, updatedAt: "2026-09-15T08:00:00-04:00", events: { "MAC-1": { ...ENTRY } }, dismissed: { "MAC-2": "2026-09-17" } }),
        [OLD_EVENTS]: JSON.stringify({ events: [{ key: "MAC-2", date: "2026-09-17", title: "Dentist", start: "2026-09-17T08:00:00-04:00", end: "2026-09-17T09:00:00-04:00", allDay: false, endsSameDay: true }] }),
        [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:20pm"),
    });
    const dentist = event({ key: "D1", id: "D1", title: "Dentist", date: "2026-09-17", start: "2026-09-17T08:00:00-04:00", end: "2026-09-17T09:00:00-04:00" });
    assert.equal(await sync(map, [event(), dentist]), "Calendar sync: 1 adopted");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:00pm - 4:20pm"));
    assert.equal(map.get(day("2026-09-17")), undefined, "the line you'd deleted isn't added");
    assert.equal(ledger(map).dismissed.D1, "2026-09-17");
    assert.equal(await sync(map, [event(), dentist]), "Calendar sync: nothing to change");
    assert.ok(map.has(OLD_LEDGER) && map.has(OLD_EVENTS), "the old files are left for you");
});

// ------------------------------------------------------------------ recurring series

const weekly = (date, over = {}) => event({
    key: `S1@${date}`, id: "S1", title: "Weekly sync", date, recurring: true,
    start: `${date}T10:00:00-04:00`, end: `${date}T10:30:00-04:00`, ...over,
});
const SERIES = ["2026-09-16", "2026-09-23", "2026-09-30"];

test("run: a recurring series' ⭕ in Plainday's settings reaches every upcoming line", async () => {
    const map = vault();
    await sync(map, [...SERIES.map((d) => weekly(d)), event()]);
    assert.deepEqual(recurring(map), [], "nothing listed until you give a series a project");

    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    assert.equal(await sync(map, [...SERIES.map((d) => weekly(d)), event()]), "Calendar sync: 3 linked");
    for (const d of SERIES) assert.match(noIds(map.get(day(d))), /- \[<\] 10:00am\tWeekly sync \[\[Pinecone Studio\|⭕\]\]\n\t- 10:30am/);
    assert.doesNotMatch(noIds(map.get(day("2026-09-16"))), /Planning \[\[/);

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
    setLinks(map, "Weekly sync", ["[[Kestrel|⭕]]"]);
    await sync(map, [...more.map((d) => weekly(d)), event()]);
    assert.match(noIds(map.get(day("2026-09-16"))), /Weekly sync \[\[Kestrel\|⭕\]\]\n/);
    assert.doesNotMatch(map.get(day("2026-09-23")), /⭕/);
    assert.match(noIds(map.get(day("2026-09-30"))), /Weekly sync \[\[Budget Book\|⭕\]\]\n/);

    // Taking the mapping away leaves the links alone
    setLinks(map, "Weekly sync", []);
    await sync(map, [...more.map((d) => weekly(d)), event()]);
    assert.match(noIds(map.get(day("2026-09-16"))), /Weekly sync \[\[Kestrel\|⭕\]\]\n/);
});

test("run: series links skip lines with time entries or a log link, and survive a retime once taken off", async () => {
    const map = vault();
    await sync(map, SERIES.map((d) => weekly(d)));
    edit(map, day("2026-09-16"), (t) => t.replace("\t- 10:30am", "\t- 10:00am - 10:40am"));
    edit(map, day("2026-09-23"), (t) => t.replace("\tWeekly sync", "\t[[2026-09-23 Weekly sync|Weekly sync]]"));
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕️]]"]);
    assert.equal(await sync(map, SERIES.map((d) => weekly(d))), "Calendar sync: 1 linked");
    assert.doesNotMatch(noIds(map.get(day("2026-09-16"))), /⭕/, "time already logged keeps its project");
    assert.doesNotMatch(noIds(map.get(day("2026-09-23"))), /⭕/, "a log's project comes from the log");
    assert.match(noIds(map.get(day("2026-09-30"))), /\tWeekly sync \[\[Pinecone Studio\|⭕️\]\]\n/, "the link is written as you typed it");

    // Taken off, then the event is retimed: the ledger still knows, so it isn't put back
    edit(map, day("2026-09-30"), (t) => t.replace(" [[Pinecone Studio|⭕️]]", ""));
    await sync(map, SERIES.map((d) => weekly(d)));
    const later = SERIES.map((d) => weekly(d, d === "2026-09-30" ? { start: `${d}T11:00:00-04:00`, end: `${d}T11:30:00-04:00` } : {}));
    await sync(map, later);
    await sync(map, later);
    assert.match(noIds(map.get(day("2026-09-30"))), /- \[<\] 11:00am\tWeekly sync\n/);

    // Nor after the mapping is taken away while the event changes, and then put back
    setLinks(map, "Weekly sync", []);
    const again = SERIES.map((d) => weekly(d, d === "2026-09-30" ? { title: "Weekly sync", start: `${d}T12:00:00-04:00`, end: `${d}T12:30:00-04:00` } : {}));
    await sync(map, again);
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕️]]"]);
    await sync(map, again);
    assert.match(noIds(map.get(day("2026-09-30"))), /- \[<\] 12:00pm\tWeekly sync\n/);
});

test("run: no series links in a held run, or for a calendar you've switched off", async () => {
    const map = vault();
    const others = Array.from({ length: 11 }, (_, i) => event({ key: `X${i}`, id: `X${i}`, title: `One-off ${i}` }));
    await sync(map, [...SERIES.map((d) => weekly(d)), ...others]);
    await sync(map, SERIES.map((d) => weekly(d)));
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    assert.match(await sync(map, SERIES.map((d) => weekly(d))), /held back/);
    for (const d of SERIES) assert.doesNotMatch(noIds(map.get(day(d))), /⭕/);

    const unticked = vault();
    await sync(unticked, SERIES.map((d) => weekly(d)));
    setLinks(unticked, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    devices.get(unticked).state.calendars.list[0].on = false;
    await sync(unticked, SERIES.map((d) => weekly(d)));
    for (const d of SERIES) assert.doesNotMatch(noIds(unticked.get(day(d))), /⭕/);
});

test("run: moved onto a day that already has a line for it, the old line is forwarded, links and all", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\t[[2026-09-16 Planning|Planning]]"));
    map.set(day("2026-09-18"), note("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    const summary = await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.match(summary, /1 adopted/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [>] [[2026-09-18|9/18]] 4:00pm\t[[2026-09-16 Planning|Planning]]", "\t- 4:30pm"));
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: a line that's yours is forwarded when its event moves, and its ⭕ still goes along", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm\n\t- bring the draft"));
    await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.match(noIds(map.get(day("2026-09-16"))), /- \[>\] \[\[2026-09-18\|9\/18\]\] 4:00pm\tPlanning \[\[Pinecone Studio\|⭕\]\]\n\t- 4:30pm\n\t- bring the draft/);
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
});

test("notes under a time entry: deeper by tabs or spaces; a note beside it is yours", () => {
    const synced = ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"];
    assert.ok(cs.annotations(["- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm", "\t    - with spaces", "\t\t\t- deeper"], synced));
    assert.equal(cs.annotations(["- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm", "    - same depth in spaces"], synced), null);
    assert.equal(cs.annotations(["- [<] 4:00pm\tPlanning", "\t- 4:30pm", "\t\t- under the end time"], synced), null);
});

const moved = (over = {}) => event({ date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00", ...over });

test("run: moved and renamed to a title with a | in it: the log link goes along at the end, and the old line goes", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\t[[2026-09-16 Planning|Planning]]"));
    assert.equal(await sync(map, [moved({ title: "Planning | Q3" })]), "Calendar sync: 1 added, 1 removed");
    assert.equal(plainBody(map.get(day("2026-09-16"))), "");
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning | Q3 [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"));
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
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    await sync(map, [weekly("2026-09-16")]);
    setLinks(map, "Weekly sync", ["[[Kestrel|⭕]]"]);
    await sync(map, [weekly("2026-09-16")]);
    assert.match(noIds(map.get(day("2026-09-16"))), /Weekly sync \[\[Pinecone Studio\|⭕\]\]\n/);
});

test("run: time entries past a blank line under an event aren't left behind under another one", async () => {
    const review = event({ key: "E2", id: "E2", title: "Review", start: "2026-09-16T15:00:00-04:00", end: "2026-09-16T15:30:00-04:00" });
    const map = vault();
    await sync(map, [review, event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm\n\n\t- 4:00pm - 4:45pm: billed"));
    const later = event({ start: "2026-09-16T14:00:00-04:00", end: "2026-09-16T14:30:00-04:00" });
    assert.equal(await sync(map, [review, later]), "Calendar sync: 1 left for you");
    assert.match(noIds(map.get(day("2026-09-16"))), /- \[<\] 3:00pm\tReview\n\t- 3:30pm\n- \[<\] 4:00pm\tPlanning \[\[Pinecone Studio\|⭕\]\]\n\t- 4:30pm\n\n\t- 4:00pm - 4:45pm: billed/);
});

test("run: a series follows its ID: renamed in the calendar, its line in the note is renamed and keeps the project", async () => {
    const map = vault();
    await sync(map, SERIES.map((d) => weekly(d)));
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    await sync(map, SERIES.map((d) => weekly(d)));
    assert.equal(ledger(map).seriesTitles.S1, "Weekly sync");

    const renamed = [...SERIES, "2026-10-07"].map((d) => weekly(d, { title: "Weekly sync (studio)" }));
    await sync(map, renamed);
    assert.match(section(map), /\n- Weekly sync \(studio\) \[\[Pinecone Studio\|⭕\]\]\n/);
    assert.doesNotMatch(section(map), /- Weekly sync\n|- Weekly sync \[/);
    for (const d of SERIES) assert.match(noIds(map.get(day(d))), /\tWeekly sync \(studio\) \[\[Pinecone Studio\|⭕\]\]\n/);
    assert.match(noIds(map.get(day("2026-10-07"))), /\tWeekly sync \(studio\) \[\[Pinecone Studio\|⭕\]\]\n/, "a new occurrence gets it too");
    assert.equal(ledger(map).seriesTitles.S1, "Weekly sync (studio)");
});

test("run: occurrences of one series with different titles share its project", async () => {
    const map = vault();
    const anniversary = (date, age) => weekly(date, { key: `B1@${date}`, id: "B1", title: `${age}th Anniversary`, allDay: true });
    await sync(map, [anniversary("2026-09-16", 12), anniversary("2026-10-16", 13)]);
    assert.equal(ledger(map).seriesTitles.B1, "12th Anniversary", "known by the next occurrence's title");
    setLinks(map, "12th Anniversary", ["[[Budget Book|⭕]]"]);
    await sync(map, [anniversary("2026-09-16", 12), anniversary("2026-10-16", 13)]);
    assert.match(noIds(map.get(day("2026-10-16"))), /- \[<\] All day\t13th Anniversary \[\[Budget Book\|⭕\]\]/);
});

test("run: when a renamed series' old title still belongs to another series, the line is copied, not moved", async () => {
    const map = vault();
    const standup = (id, title) => weekly("2026-09-16", { key: `${id}@2026-09-16`, id, title });
    await sync(map, [standup("S1", "Standup"), standup("S2", "Standup")]);
    setLinks(map, "Standup", ["[[Kestrel|⭕]]"]);
    await sync(map, [standup("S1", "Standup"), standup("S2", "Standup")]);
    await sync(map, [standup("S1", "Standup"), standup("S2", "Standup B")]);
    assert.match(section(map), /\n- Standup \[\[Kestrel\|⭕\]\]\n- Standup B \[\[Kestrel\|⭕\]\]\n/);
});

test("run: an event deleted and then made again (a new ID) takes back the line marked canceled", async () => {
    const map = vault();
    await sync(map, [event()]);
    await sync(map, []);
    assert.equal(await sync(map, [event({ key: "E9", id: "E9" })]), "Calendar sync: 1 adopted");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.deepEqual(ledger(map).canceled, {});
    assert.equal(await sync(map, [event({ key: "E9", id: "E9", start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 updated");

    // A [-] you set yourself is yours: a matching new event is adopted but the mark stays
    const own = vault({ [day("2026-09-16")]: note("- [-] 4:00pm\tPlanning", "\t- 4:30pm") });
    await sync(own, [event()]);
    assert.equal(plainBody(own.get(day("2026-09-16"))), text("- [-] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: a calendar removed and added again (a new calendar ID, the same events) finds its lines by their IDs", async () => {
    const map = vault();
    await sync(map, [event()]);
    const device = devices.get(map);
    device.state.calendars.list = [{ id: "cal2", name: "Work", account: "Work again", address: "", on: true }];
    device.state.links = { cal2: "https://calendar.example.com/work.ics" };
    device.state.reads.cal2 = { events: [{ ...event(), calendarId: "cal2", calendar: "Work", account: "Work again", endsSameDay: true }], failed: [] };
    assert.equal(await load(device.app, device.state).run(), "Calendar sync: nothing to change");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    assert.equal(ledger(map).events.E1.calendarId, "cal2");
});

test("run: new events still go in time order past a line marked canceled", async () => {
    const map = vault();
    const at = (id, h) => event({ key: id, id, title: id, start: `2026-09-16T${h}:00:00-04:00`, end: `2026-09-16T${h}:30:00-04:00` });
    await sync(map, [at("A", "09"), at("B", "10"), at("C", "11")]);
    await sync(map, [at("A", "09"), at("C", "11")]);
    await sync(map, [at("A", "09"), at("C", "11"), at("D", "12"), at("Z", "10")]);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text(
        "- [<] 9:00am\tA", "\t- 9:30am", "- [-] 10:00am\tB", "\t- 10:30am", "- [<] 10:00am\tZ", "\t- 10:30am",
        "- [<] 11:00am\tC", "\t- 11:30am", "- [<] 12:00pm\tD", "\t- 12:30pm",
    ));
});

test("run: a canceled line whose [-] you changed isn't reported restored, and a lost cache write doesn't strand a [-]", async () => {
    const map = vault();
    await sync(map, [event()]);
    await sync(map, []);
    await sync(map, []);
    edit(map, day("2026-09-16"), (t) => t.replace("[-]", "[x]"));
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.match(map.get(day("2026-09-16")), /- \[x\] 4:00pm\tPlanning/);

    const lost = vault();
    await sync(lost, [event()]);
    await sync(lost, []);
    const saved = devices.get(lost).app.local.get("plainday-calendar-cache");
    await sync(lost, []);
    devices.get(lost).app.local.set("plainday-calendar-cache", saved);
    assert.equal(await sync(lost, []), "Calendar sync: 1 canceled");
    await sync(lost, [event()]);
    assert.equal(await sync(lost, [event()]), "Calendar sync: 1 restored");
    assert.match(lost.get(day("2026-09-16")), /- \[<\] 4:00pm\tPlanning/);
});

test("run: a held run doesn't restore canceled lines", async () => {
    const map = vault();
    const others = Array.from({ length: 11 }, (_, i) => event({ key: `X${i}`, id: `X${i}`, title: `One-off ${i}` }));
    await sync(map, [event(), ...others]);
    await sync(map, others);
    await sync(map, others);
    // The others gone once; then back comes Planning, in a run that would cancel all eleven
    await sync(map, []);
    assert.match(await sync(map, [event()]), /held back/);
    assert.match(noIds(map.get(day("2026-09-16"))), /- \[-\] 4:00pm\tPlanning\n/);
});

test("run: a line you delete counts as deleted once a second run, a while later, still finds it gone; an identical line of another event is left", async () => {
    const map = vault();
    const e2 = event({ key: "E2", id: "E2" });
    await sync(map, [event(), e2]);
    edit(map, day("2026-09-16"), (t) => t.replace("- [<] 4:00pm\tPlanning ^E1\n\t- 4:30pm\n", ""));
    // Gone for a moment (it could be on its way through Sync): nothing put back, nothing decided
    assert.equal(await sync(map, [event(), e2], { now: 1000 }), "Calendar sync: nothing to change");
    assert.deepEqual(ledger(map).dismissed, {});
    assert.equal(await sync(map, [event(), e2], { now: 1000 + 5 * 60 * 1000 }), "Calendar sync: nothing to change", "five minutes isn't long enough");
    assert.equal(await sync(map, [event(), e2], { now: 1000 + 11 * 60 * 1000 }), "Calendar sync: 1 left for you");
    assert.match(reported(map), /2026-09-16 Planning — you deleted this one/);
    assert.deepEqual(Object.keys(ledger(map).dismissed), ["E1"]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ^E2", "\t- 4:30pm"));
    assert.equal(await sync(map, [event(), e2]), "Calendar sync: nothing to change");

    // A line back before the second run is the sync's again
    const back = vault();
    await sync(back, [event()]);
    const was = back.get(day("2026-09-16"));
    back.set(day("2026-09-16"), note());
    await sync(back, [event()], { now: 1000 });
    back.set(day("2026-09-16"), was);
    await sync(back, [event()], { now: 1000 + 20 * 60 * 1000 });
    assert.equal(ledger(back).events.E1.missingSince, undefined);
    assert.deepEqual(ledger(back).dismissed, {});
});

test("run: series renamed in one run: chains, swaps and a shared line each keep the right project", async () => {
    const occ = (id, title) => weekly("2026-09-16", { key: `${id}@2026-09-16`, id, title });
    const setUp = async (events, links) => {
        const map = vault();
        await sync(map, events);
        for (const [title, link] of Object.entries(links)) setLinks(map, title, [link]);
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
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 9:00am\tDaily", "\t- 9:30am"));
    assert.equal(plainBody(map.get(day("2026-09-17"))), text("- [<] 9:00am\tDaily [[Pinecone Studio|⭕]]", "\t- 9:30am"));
    assert.match(reported(map), /- 2026-09-16 Daily \(end time updated\)/);
    assert.equal(await sync(map, series), "Calendar sync: nothing to change");

    // A line with a note of yours is taken over as it is
    const noted = vault({ [day("2026-09-16")]: note("- [<] 9:00am\tDaily", "\t- 9:15am", "\t- bring slides") });
    await sync(noted, [series[0]]);
    assert.equal(plainBody(noted.get(day("2026-09-16"))), text("- [<] 9:00am\tDaily", "\t- 9:15am", "\t- bring slides"));
});

test("run: a series split with \"this and future events\" (a new series ID) renames its lines instead of canceling them", async () => {
    const map = vault();
    const occ = (id, title, d, h = "10") => weekly(d, { key: `${id}@${d}`, id, title, start: `${d}T${h}:00:00-04:00`, end: `${d}T${h}:30:00-04:00` });
    const before = SERIES.map((d) => occ("S1", "Weekly sync", d));
    await sync(map, before);
    setLinks(map, "Weekly sync", ["[[Pinecone Studio|⭕]]"]);
    await sync(map, before);
    edit(map, day("2026-09-30"), (t) => t.replace("\t- 10:30am", "\t- 10:30am\n\t- 10:00am - 10:20am"));

    const after = [occ("S1", "Weekly sync", "2026-09-16"), occ("S2", "Studio sync", "2026-09-23"), occ("S2", "Studio sync", "2026-09-30")];
    assert.equal(await sync(map, after), "Calendar sync: 2 updated");
    assert.match(noIds(map.get(day("2026-09-16"))), /- \[<\] 10:00am\tWeekly sync \[\[Pinecone Studio\|⭕\]\]\n/);
    assert.equal(plainBody(map.get(day("2026-09-23"))), text("- [<] 10:00am\tStudio sync [[Pinecone Studio|⭕]]", "\t- 10:30am"));
    assert.equal(plainBody(map.get(day("2026-09-30"))), text("- [<] 10:00am\tStudio sync [[Pinecone Studio|⭕]]", "\t- 10:30am", "\t- 10:00am - 10:20am"));
    assert.match(section(map), /\n- Weekly sync \[\[Pinecone Studio\|⭕\]\]\n- Studio sync \[\[Pinecone Studio\|⭕\]\]\n/);
    assert.deepEqual(Object.keys(ledger(map).events).sort(), ["S1@2026-09-16", "S2@2026-09-23", "S2@2026-09-30"]);
    assert.deepEqual(ledger(map).canceled, {});
    assert.equal(await sync(map, after), "Calendar sync: nothing to change");

    // The whole rest of the series split off (no old occurrences left): the line moves over, not copied
    const whole = vault();
    const two = ["2026-09-23", "2026-09-30"];
    await sync(whole, two.map((d) => occ("S1", "Weekly sync", d)));
    setLinks(whole, "Weekly sync", ["[[Kestrel|⭕]]"]);
    await sync(whole, two.map((d) => occ("S1", "Weekly sync", d)));
    await sync(whole, two.map((d) => occ("S2", "Studio sync", d)));
    assert.match(section(whole), /\n- Studio sync \[\[Kestrel\|⭕\]\]\n/);
    assert.doesNotMatch(section(whole), /Weekly sync/);

    // At a different time it's a different event: canceled, and the new one added
    const moved = vault();
    await sync(moved, before);
    const later = [occ("S1", "Weekly sync", "2026-09-16"), occ("S2", "Studio sync", "2026-09-23", "11"), occ("S2", "Studio sync", "2026-09-30", "11")];
    assert.equal(await sync(moved, later), "Calendar sync: 2 added");
    assert.equal(await sync(moved, later), "Calendar sync: 2 canceled");
});

// ------------------------------------------------------------------ free events (OBS-47)

test("lines: a timed free event gets ℹ️ after its title; all-day, busy, tentative, unknown and an old events file don't", () => {
    assert.deepEqual(plain(cs.lines(event({ availability: "free" }))), ["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"]);
    assert.deepEqual(plain(cs.lines(event({ availability: "free", allDay: true }))), ["- [<] All day\tPlanning"]);
    for (const availability of ["busy", "tentative", "unavailable", "unknown", undefined]) {
        assert.deepEqual(plain(cs.lines(event({ availability }))), ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], String(availability));
    }
});

// ------------------------------------------------------------------ 🆓 on the line, a note on the end line (OBS-24)

test("splitTail: a 🆓 you put on the line comes off the end with the mark and the ⭕ links, in any order", () => {
    const P = "[[Pinecone Studio|⭕]]";
    assert.deepEqual(plain(cs.splitTail("Planning 🆓")), { rest: "Planning", projects: [], free: false, nonbillable: true, log: null });
    assert.deepEqual(plain(cs.splitTail("Planning ℹ️ 🆓")), { rest: "Planning", projects: [], free: true, nonbillable: true, log: null });
    assert.deepEqual(plain(cs.splitTail("Planning 🆓 ℹ️")), { rest: "Planning", projects: [], free: true, nonbillable: true, log: null });
    assert.deepEqual(plain(cs.splitTail(`Planning ${P} 🆓`)), { rest: "Planning", projects: [P], free: false, nonbillable: true, log: null });
    assert.deepEqual(plain(cs.splitTail(`Planning 🆓 ${P}`)), { rest: "Planning", projects: [P], free: false, nonbillable: true, log: null });
    assert.deepEqual(plain(cs.splitTail("Planning 🆓\uFE0F")), { rest: "Planning", projects: [], free: false, nonbillable: true, log: null });
    assert.deepEqual(plain(cs.splitTail("🆓")), { rest: "🆓", projects: [], free: false, nonbillable: false, log: null }, "a title that is only the mark keeps it");
    assert.deepEqual(plain(cs.splitTail("Planning🆓")), { rest: "Planning🆓", projects: [], free: false, nonbillable: false, log: null }, "no whitespace before it: part of the title");
    assert.equal(cs.isFree("- [<] 4:00pm\tPlanning ℹ️ 🆓"), true);
    assert.equal(cs.eventHead("- [<] 4:00pm\tPlanning ℹ️ 🆓 [[Pinecone Studio|⭕]]").nonbillable, true);
    assert.equal(cs.head("- [<] 4:00pm\tPlanning 🆓").title, "Planning");
});

test("a 🆓 on the line survives a time change and a free flip, written after the mark and before the ⭕ links", () => {
    const before = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] 🆓", "\t- 4:30pm");
    const { text: after, outcome } = run(before, replace(["- [<] 5:00pm\tPlanning", "\t- 5:30pm"]));
    assert.equal(outcome, "replaced");
    assert.equal(after, note("- [<] 5:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]]", "\t- 5:30pm"));
    const flipped = run(before, replace(["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"]));
    assert.equal(flipped.text, note("- [<] 4:00pm\tPlanning ℹ️ 🆓 [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
});

test("a note on the end line is kept when the end time changes, and a run with nothing new writes nothing", () => {
    const before = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm: 🆓 not billing this", "\t\t- a note under it");
    assert.equal(cs.annotations(before.split("\n").slice(3, 6), ENTRY.lines), null, "a line under the end line is still yours");
    const simple = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm: 🆓 not billing this");
    const { text: after, outcome } = run(simple, replace(["- [<] 4:00pm\tPlanning", "\t- 5:00pm"]));
    assert.equal(outcome, "replaced");
    assert.equal(after, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 5:00pm: 🆓 not billing this"));
    // A space before the colon is the same note
    assert.equal(run(note("- [<] 4:00pm\tPlanning", "\t- 4:30pm : left early"), replace(["- [<] 4:00pm\tPlanning", "\t- 5:00pm"])).text,
        note("- [<] 4:00pm\tPlanning", "\t- 5:00pm : left early"));
    // An entry that starts at the end time isn't the end line
    assert.equal(run(note("- [<] 4:00pm\tPlanning", "\t- 4:30pm - 5:00pm"), replace(["- [<] 4:00pm\tPlanning", "\t- 5:00pm"])).text,
        note("- [<] 4:00pm\tPlanning", "\t- 4:30pm - 5:00pm"));
});

test("adopting a line with a noted end line: the end time is updated once, the note kept, the free mark follows", () => {
    const insert = (lines) => ({ kind: "insert", key: "E1", event: event(), lines });
    const noted = note("- [<] 4:00pm\tPlanning", "\t- 4:30pm: 🆓 not billing this");
    const same = run(noted, insert(["- [<] 4:00pm\tPlanning", "\t- 4:30pm"]));
    assert.equal(same.outcome, "adopted");
    assert.deepEqual(plain(same.result.changed), []);
    assert.equal(same.text, noted);
    const later = run(noted, insert(["- [<] 4:00pm\tPlanning", "\t- 5:00pm"]));
    assert.deepEqual(plain(later.result.changed), ["end time updated"]);
    assert.equal(later.text, note("- [<] 4:00pm\tPlanning", "\t- 5:00pm: 🆓 not billing this"));
    const free = run(noted, insert(["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"]));
    assert.deepEqual(plain(free.result.changed), ["now free"]);
    assert.equal(free.text, note("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm: 🆓 not billing this"));
});

test("timed → all day with a noted end line: the line is left alone as yours", () => {
    const before = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm: 🆓 skipped it");
    const { text: after, outcome } = run(before, replace(["- [<] All day\tPlanning"]));
    assert.equal(outcome, "yours");
    assert.equal(after, before);
});

test("moved: a noted end line is forwarded with the old line, and a 🆓 travels like a ⭕", () => {
    const noted = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm: 🆓 skipped it", "- [ ] A task");
    const carry = { projects: ["[[Pinecone Studio|⭕]]"], log: null, nonbillable: false };
    const forwarded = run(noted, { ...moveOut, carry, landed: { asIntended: true } });
    assert.equal(forwarded.outcome, "forwarded");
    assert.equal(forwarded.text, note("- [>] [[2026-09-18|9/18]] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm: 🆓 skipped it", "- [ ] A task"));

    const marked = note("- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]]", "\t- 4:30pm", "- [ ] A task");
    const gone = run(marked, { ...moveOut, carry: { ...carry, nonbillable: true }, landed: { asIntended: true } });
    assert.equal(gone.outcome, "removed");
    assert.equal(gone.text, note("- [ ] A task"));
    // The 🆓 didn't make it across (or was added since): forward instead
    assert.equal(run(marked, { ...moveOut, carry, landed: { asIntended: true } }).outcome, "forwarded");

    const op = { kind: "insert", key: "E1", event: event({ date: "2026-09-18" }), move: true, lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], carry: { ...carry, nonbillable: true } };
    const { text: after, result } = run(note("- [ ] A task"), op);
    assert.equal(after, note("- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]]", "\t- 4:30pm", "- [ ] A task"));
    assert.deepEqual(plain(result.lines), ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], "the ledger keeps the sync's own lines");
});

test("a calendar title ending in 🆓 or ℹ️ loses it, so the line can be found again; a timed event ending on another day gets no end line", () => {
    assert.deepEqual(plain(cs.lines(event({ title: "Gym 🆓" }))), ["- [<] 4:00pm\tGym", "\t- 4:30pm"]);
    assert.deepEqual(plain(cs.lines(event({ title: "Gym ℹ️ 🆓" }))), ["- [<] 4:00pm\tGym", "\t- 4:30pm"]);
    assert.deepEqual(plain(cs.lines(event({ title: "Camping", end: "2026-09-18T11:00:00-04:00", endsSameDay: false }))), ["- [<] 4:00pm\tCamping"]);
    assert.deepEqual(plain(cs.lines(event({ title: "Planning", endsSameDay: true }))), ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"]);
    // Past midnight (pm to am, under a day) still gets its end line: the report reads that as one span
    assert.deepEqual(plain(cs.lines(event({ title: "Late show", start: "2026-09-16T22:30:00-04:00", end: "2026-09-17T01:00:00-04:00", endsSameDay: false }))), ["- [<] 10:30pm\tLate show", "\t- 1:00am"]);
    assert.deepEqual(plain(cs.lines(event({ title: "Party", start: "2026-09-16T20:00:00-04:00", end: "2026-09-17T00:00:00-04:00", endsSameDay: false }))), ["- [<] 8:00pm\tParty", "\t- 12:00am"]);
    assert.deepEqual(plain(cs.lines(event({ title: "Two nights", start: "2026-09-16T22:30:00-04:00", end: "2026-09-18T01:00:00-04:00", endsSameDay: false }))), ["- [<] 10:30pm\tTwo nights"]);
    assert.deepEqual(plain(cs.lines(event({ title: "Overnight from the morning", start: "2026-09-16T09:00:00-04:00", end: "2026-09-17T02:00:00-04:00", endsSameDay: false }))), ["- [<] 9:00am\tOvernight from the morning"]);
});

test("adopting a line: a time-looking note nested deeper isn't the end line; an event that lost its end line loses the stale one", () => {
    const insert = (lines) => ({ kind: "insert", key: "E1", event: event(), lines });
    const nested = note("- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:20pm", "\t\t- 4:30pm");
    const same = run(nested, insert(["- [<] 4:00pm\tPlanning", "\t- 4:30pm"]));
    assert.equal(same.outcome, "adopted");
    assert.deepEqual(plain(same.result.changed), []);
    const oneLine = run(note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm", "- [ ] A task"), insert(["- [<] 4:00pm\tPlanning"]));
    assert.deepEqual(plain(oneLine.result.changed), ["end time removed"]);
    assert.equal(oneLine.text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "- [ ] A task"));
    // With a note on it, the end line is yours to remove
    const noted = note("- [<] 4:00pm\tPlanning", "\t- 4:30pm: 🆓 skipped");
    const kept = run(noted, insert(["- [<] 4:00pm\tPlanning"]));
    assert.deepEqual(plain(kept.result.changed), []);
    assert.equal(kept.text, noted);
});

test("run: a 🆓 on the line is remembered, survives a time change, and follows the event to another day", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ^E1\n\t- 4:30pm", "\tPlanning 🆓 [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm: not my meeting"));
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.equal(ledger(map).events.E1.nonbillable, true);
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 updated");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]]", "\t- 5:30pm: not my meeting"));
    // Moved: the note on the end line keeps the old line (forwarded); the 🆓 and the ⭕ go with the event
    await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T17:00:00-04:00", end: "2026-09-18T17:30:00-04:00" })]);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [>] [[2026-09-18|9/18]] 5:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]]", "\t- 5:30pm: not my meeting"));
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 5:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]]", "\t- 5:30pm"));
    assert.equal(ledger(map).events.E1.nonbillable, true);
    // Take the 🆓 off, and it stays off through the next change
    edit(map, day("2026-09-18"), (t) => t.replace(" 🆓", ""));
    await sync(map, [event({ date: "2026-09-18", start: "2026-09-18T17:00:00-04:00", end: "2026-09-18T18:00:00-04:00" })]);
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 5:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 6:00pm"));
    assert.equal(ledger(map).events.E1.nonbillable, undefined);
});

test("splitTail and head: the mark and ⭕ links come off the end in either order, and don't change which line is meant", () => {
    assert.deepEqual(plain(cs.splitTail("Planning ℹ️ [[Pinecone Studio|⭕]]")), { rest: "Planning", projects: ["[[Pinecone Studio|⭕]]"], free: true, nonbillable: false, log: null });
    assert.deepEqual(plain(cs.splitTail("Planning [[Pinecone Studio|⭕]] ℹ")), { rest: "Planning", projects: ["[[Pinecone Studio|⭕]]"], free: true, nonbillable: false, log: null });
    assert.deepEqual(plain(cs.splitTail("ℹ️")), { rest: "ℹ️", projects: [], free: false, nonbillable: false, log: null });
    assert.deepEqual(plain(cs.splitTail("Planningℹ️")), { rest: "Planningℹ️", projects: [], free: false, nonbillable: false, log: null }, "no whitespace before it: part of the title");
    assert.deepEqual(plain(cs.head("- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]]")), { start: "4:00pm", title: "Planning" });
    const lines = note("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm").split("\n");
    assert.deepEqual(plain(cs.findBlock(lines, { lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"] })), { from: 3, to: 4 });
});

test("run: busy → free → busy on an untouched line: the mark comes and goes, the report says so, the ledger carries it", async () => {
    const map = vault();
    await sync(map, [event()]);
    assert.equal(await sync(map, [event({ availability: "free" })]), "Calendar sync: 1 updated");
    assert.match(reported(map), /- 2026-09-16 Planning \(now free\)/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"));
    assert.deepEqual(ledger(map).events.E1.lines, ["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"]);
    assert.equal(await sync(map, [event({ availability: "free" })]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [event({ availability: "busy" })]), "Calendar sync: 1 updated");
    assert.match(reported(map), /- 2026-09-16 Planning \(now busy\)/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: free → busy keeps the log link, the ⭕ and the time entry; the mark sits between the title and the links", async () => {
    const map = vault();
    await sync(map, [event({ availability: "free" })]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ℹ️ ^E1\n\t- 4:30pm", "\t[[2026-09-16 Planning|Planning]] ℹ️ [[Pinecone Studio|⭕]] ^E1\n\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [event({ availability: "free", title: "Planning call" })]), "Calendar sync: 1 updated");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning call ℹ️ [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [event({ title: "Planning call" })]), "Calendar sync: 1 updated");
    assert.match(reported(map), /Planning call \(now busy\)/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning call [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:00pm - 4:30pm"));
});

test("run: the mark is the sync's: taken off or added by hand, the line is yours, and it's still found", async () => {
    const map = vault();
    await sync(map, [event({ availability: "free" })]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ℹ️", "\tPlanning"));
    assert.equal(await sync(map, [event({ availability: "free", start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 left for you");
    assert.match(reported(map), /this line is yours/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));

    const map2 = vault();
    await sync(map2, [event()]);
    edit(map2, day("2026-09-16"), (t) => t.replace("\tPlanning", "\tPlanning ℹ️"));
    assert.equal(await sync(map2, [event({ title: "Planning call" })]), "Calendar sync: 1 left for you");
    assert.doesNotMatch(reported(map2), /you deleted/);
});

test("run: a free event that moves takes its mark along", async () => {
    const map = vault();
    await sync(map, [event({ availability: "free" })]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning ℹ️", "\tPlanning ℹ️ [[Pinecone Studio|⭕]]"));
    await sync(map, [event({ availability: "free", date: "2026-09-18", start: "2026-09-18T16:00:00-04:00", end: "2026-09-18T16:30:00-04:00" })]);
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
});

test("run: a first run adopts a hand-written or older line and gives a free event its mark", async () => {
    const map = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm") });
    assert.equal(await sync(map, [event({ availability: "free" })]), "Calendar sync: 1 adopted");
    assert.match(reported(map), /Planning \(now free\)/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]]", "\t- 4:30pm"));
    // And a busy one adopting a line that has the mark by hand: the mark comes off
    const map2 = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm") });
    assert.equal(await sync(map2, [event()]), "Calendar sync: 1 adopted");
    assert.match(reported(map2), /Planning \(now busy\)/);
    assert.equal(plainBody(map2.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: adopting a line whose end line a time entry replaced changes only the mark, and writes no end line back", async () => {
    // A first run (no ledger): the line is in the sync's shape but for the entry in place of the end
    const map = vault({ [day("2026-09-16")]: note("- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm") });
    assert.equal(await sync(map, [event({ availability: "free" })]), "Calendar sync: 1 adopted");
    assert.match(reported(map), /Planning \(now free\)/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ℹ️", "\t- 4:00pm - 4:30pm"));
    // Deleted, then made again with a new ID as busy: the [-] line is revived and the mark comes off
    await sync(map, []);
    await sync(map, []);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [-] 4:00pm\tPlanning ℹ️", "\t- 4:00pm - 4:30pm"));
    assert.equal(await sync(map, [event({ key: "E2", id: "E2" })]), "Calendar sync: 1 adopted");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:00pm - 4:30pm"));
});

// ------------------------------------------------------------------ a log's line with no time (OBS-10)

test("insert adopts a log's timeless line from before OBS-57: the sync's shape with the log link at the end, ⭕ and what's under it kept", () => {
    const before = note("- [<] 9:00am\tStandup", "\t- 9:15am", "- [<] [[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:20pm", "- [ ] A task");
    const insert = (lines) => ({ kind: "insert", key: "E1", event: event(), lines });
    const { text: after, outcome, result } = run(before, insert(["- [<] 4:00pm\tPlanning", "\t- 4:30pm"]));
    assert.equal(outcome, "adopted");
    assert.deepEqual(plain(result.changed), ["time added"]);
    assert.equal(after, note("- [<] 9:00am\tStandup", "\t- 9:15am", "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm", "\t- 4:00pm - 4:20pm", "- [ ] A task"));
    // A free event brings its mark, before the ⭕
    const free = run(before, insert(["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"])).text;
    assert.equal(free.split("\n")[5], "- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]");
    // Another title isn't it: the timed line goes above the timeless one, which stays
    const other = run(before, insert(["- [<] 4:00pm\tRetro", "\t- 4:30pm"]));
    assert.equal(other.outcome, "inserted");
    assert.equal(other.text, note("- [<] 9:00am\tStandup", "\t- 9:15am", "- [<] 4:00pm\tRetro", "\t- 4:30pm", "- [<] [[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:20pm", "- [ ] A task"));
});

test("only an insert adopts a timeless line: a cancel or a check for a line that's gone leaves it alone", () => {
    const before = note("- [<] [[2026-09-16 Planning|Planning]]");
    const cancel = run(before, { kind: "cancel", key: "E1", entry: ENTRY });
    assert.equal(cancel.outcome, "missing");
    assert.equal(cancel.text, before);
    const verify = run(before, { kind: "verify", key: "E1", entry: ENTRY, event: event(), lines: ENTRY.lines });
    assert.equal(verify.outcome, "missing");
    assert.equal(verify.text, before);
});

test("run: a log's timeless line is adopted when its event arrives, remembered, and kept current after", async () => {
    const map = vault({ [day("2026-09-16")]: note("- [<] [[2026-09-16 Planning|Planning]]", "- [ ] A task") });
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 adopted");
    assert.match(reported(map), /Planning \(time added\)/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]]", "\t- 4:30pm", "- [ ] A task"));
    assert.equal(ledger(map).events.E1.log, "[[2026-09-16 Planning|⋯]]");
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 updated");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning [[2026-09-16 Planning|⋯]]", "\t- 5:30pm", "- [ ] A task"));
});

test("adopting a timeless line for a moved event: its ⭕ comes along, the old day's log link can't, so the old line stays", () => {
    const before = note("- [<] [[2026-09-17 Planning|Planning]]", "- [ ] A task");
    const carry = { projects: ["[[Pinecone Studio|⭕]]"], log: "[[2026-09-16 Planning|Planning]]", series: undefined };
    const { text: after, outcome, result } = run(before, { kind: "insert", key: "E1", event: event({ date: "2026-09-17" }), lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], move: true, carry });
    assert.equal(outcome, "adopted");
    assert.equal(result.droppedLog, true);
    assert.equal(after, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-17 Planning|⋯]]", "\t- 4:30pm", "- [ ] A task"));
    // A series mapping's ⭕ too, and the mapping is remembered
    const series = run(before, { kind: "insert", key: "E1", event: event({ recurring: true }), lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"], series: { links: ["[[Studio|⭕]]"], key: "[[Studio|⭕]]" } });
    assert.equal(series.text.split("\n")[3], "- [<] 4:00pm\tPlanning [[Studio|⭕]] [[2026-09-17 Planning|⋯]]");
    assert.equal(series.result.series, "[[Studio|⭕]]");
});

test("a timeless line nested under a task belongs to the task: not adopted; hand-typed [<] lines still sort below timed events", () => {
    const nested = note("- [ ] Big task", "\t- [<] [[2026-09-16 Planning|Planning]]", "\t\t- 4:00pm - 4:20pm");
    const { text: after, outcome } = run(nested, { kind: "insert", key: "E1", event: event(), lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"] });
    assert.equal(outcome, "inserted");
    assert.equal(after, note("- [<] 4:00pm\tPlanning", "\t- 4:30pm", "- [ ] Big task", "\t- [<] [[2026-09-16 Planning|Planning]]", "\t\t- 4:00pm - 4:20pm"));
    const typed = note("- [<] 4:00pm Dentist", "- [<] Lunch", "- [ ] A task").split("\n");
    assert.equal(cs.insert(typed, ["- [<] 5:00pm\tDrinks", "\t- 6:00pm"]), note("- [<] 5:00pm\tDrinks", "\t- 6:00pm", "- [<] 4:00pm Dentist", "- [<] Lunch", "- [ ] A task"));
});

test("run: a log a line links takes the line's times: on adoption, on a retime, and not when nothing changed", async () => {
    const LOG = "Projects/Studio/logs/2026-09-16 Planning.md";
    const map = vault({
        [day("2026-09-16")]: note("- [<] [[2026-09-16 Planning|Planning]]", "- [ ] A task"),
        [LOG]: "---\ntags: log\ndate: 2026-09-16\ntime: \nendTime: \n---\n## Notes\n",
    });
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 adopted");
    assert.match(reported(map), /Planning \(time added; log times updated\)/);
    assert.equal(map.get(LOG), "---\ntags: log\ndate: 2026-09-16\ntime: 4:00pm\nendTime: 4:30pm\n---\n## Notes\n");
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" })]), "Calendar sync: 1 updated");
    assert.match(reported(map), /Planning \(log times updated\)/);
    assert.equal(map.get(LOG), "---\ntags: log\ndate: 2026-09-16\ntime: 5:00pm\nendTime: 5:30pm\n---\n## Notes\n");
    // Moved to another day: the new line carries the link, and the log's times follow
    assert.equal(await sync(map, [event({ date: "2026-09-17", start: "2026-09-17T09:00:00-04:00", end: "2026-09-17T09:45:00-04:00" })]), "Calendar sync: 1 added, 1 removed");
    assert.equal(map.get(LOG), "---\ntags: log\ndate: 2026-09-16\ntime: 9:00am\nendTime: 9:45am\n---\n## Notes\n");
    // An all-day event adopts a timeless line too, and says nothing about time; a log that isn't there is no error
    const map2 = vault({ [day("2026-09-16")]: note("- [<] [[2026-09-16 Offsite|Offsite]]") });
    assert.equal(await sync(map2, [event({ key: "E2", id: "E2", title: "Offsite", allDay: true })]), "Calendar sync: 1 adopted");
    assert.equal(plainBody(map2.get(day("2026-09-16"))), "- [<] All day\tOffsite [[2026-09-16 Offsite|⋯]]");
    assert.match(reported(map2), /Offsite \(time added\)/);
});

// ------------------------------------------------------------------ the event's note link at the end (OBS-57, OBS-87)

test("splitTail: without the flag a trailing note link stays in the title (CalNav reads it that way); with it, it comes off in any order", () => {
    assert.deepEqual(plain(cs.splitTail("Planning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]")),
        { rest: "Planning [[2026-09-16 Planning|⋯]]", projects: ["[[Pinecone Studio|⭕]]"], free: false, nonbillable: false, log: null });
    // In the order written since OBS-90 the note link ends the line, so without the flag nothing comes off
    assert.deepEqual(plain(cs.splitTail("Planning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]")),
        { rest: "Planning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", projects: [], free: false, nonbillable: false, log: null });
    for (const tail of [
        "Planning ℹ️ 🆓 [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]",
        "Planning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]] 🆓 ℹ️",
        "Planning ℹ️ [[2026-09-16 Planning|⋯]] 🆓 [[Pinecone Studio|⭕]]",
        "Planning ℹ️ 🆓 [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]",
        "Planning ℹ️ 🆓 [[2026-09-16 Planning| ⋯ ]] [[Pinecone Studio|⭕]]",
    ]) {
        assert.deepEqual(plain(cs.splitTail(tail, true)),
            { rest: "Planning", projects: ["[[Pinecone Studio|⭕]]"], free: true, nonbillable: true, log: tail.match(/\[\[2026[^\]]*\]\]/)[0] }, tail);
    }
    assert.equal(cs.splitTail("[[2026-09-16 Planning|⋯]]", true).rest, "[[2026-09-16 Planning|⋯]]", "a line that's only a link keeps it as its title");
});

test("head, eventHead and logLine read the note link and the old wrapped title alike, and hold the log as [[target|⋯]]", () => {
    for (const line of ["- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]", "- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] [[Pinecone Studio|⭕]]"]) {
        assert.deepEqual(plain(cs.head(line)), { start: "4:00pm", title: "Planning" }, line);
        const head = cs.eventHead(line);
        assert.equal(head.shown, "Planning", line);
        assert.equal(head.log, "[[2026-09-16 Planning|⋯]]", line);
        assert.deepEqual(plain(head.projects), ["[[Pinecone Studio|⭕]]"], line);
    }
    for (const line of ["- [<] Printer call [[2026-09-18 Printer call|⋯]]", "- [<] [[2026-09-18 Printer call|Printer call]]", "- [<] Printer call [[2026-09-18 Printer call|⋯]]"]) {
        assert.deepEqual(plain(cs.logLine(line)), { log: "[[2026-09-18 Printer call|⋯]]", shown: "Printer call", projects: [], free: false, nonbillable: false }, line);
    }
    assert.equal(cs.logLine("- [<] Printer call"), null, "a timeless line with no log isn't a log's line");
});

test("a line with its log at the end: a retime keeps it, a rename changes only the plain title", () => {
    const before = note("- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]", "\t- 4:30pm");
    const retimed = run(before, replace(["- [<] 3:00pm\tPlanning", "\t- 3:30pm"]));
    assert.equal(retimed.outcome, "replaced");
    assert.equal(retimed.text, note("- [<] 3:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 3:30pm"));
    const renamed = run(before, replace(["- [<] 4:00pm\tPlanning | Q3", "\t- 4:30pm"]));
    assert.equal(renamed.outcome, "replaced", "a title with a | no longer has to fit inside a link");
    assert.equal(renamed.text, note("- [<] 4:00pm\tPlanning | Q3 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"));
});

test("an old wrapped line is written in the new form when the sync rewrites it, and left alone when it doesn't", () => {
    const before = note("- [<] 4:00pm\t[[2026-09-16 Planning|Planning]] ℹ️ [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:20pm");
    const entry = { ...ENTRY, lines: ["- [<] 4:00pm\tPlanning ℹ️", "\t- 4:30pm"] };
    const retimed = run(before, replace(["- [<] 5:00pm\tPlanning ℹ️", "\t- 5:30pm"], entry));
    assert.equal(retimed.outcome, "replaced");
    assert.equal(retimed.text, note("- [<] 5:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:00pm - 4:20pm"));
    const checked = run(before, { kind: "verify", key: "E1", entry, event: event(), lines: entry.lines });
    assert.equal(checked.outcome, "present");
    assert.equal(checked.text, before);
});

test("a phone's spelling or the older order of the links (⋯ before ⭕): still the sync's line, written back in the usual order", () => {
    for (const line of [
        "- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]",
        "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]",
        "- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]",
        "- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]",
    ]) {
        const { text: after, outcome } = run(note(line, "\t- 4:30pm"), replace(["- [<] 3:00pm\tPlanning", "\t- 3:30pm"]));
        assert.equal(outcome, "replaced", line);
        assert.equal(after, note("- [<] 3:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 3:30pm"), line);
    }
});

test("an insert carrying a log link, in either form, writes it at the end, after the ⭕ (OBS-90)", () => {
    for (const log of ["[[2026-09-16 Planning|Planning]]", "[[2026-09-16 Planning|⋯]]"]) {
        const op = {
            kind: "insert", key: "E1", event: event({ date: "2026-09-18" }), move: true,
            lines: ["- [<] 4:00pm\tPlanning | Q3", "\t- 4:30pm"],
            carry: { projects: ["[[Pinecone Studio|⭕]]"], log, nonbillable: true },
        };
        const { text: after, outcome, result } = run(note("- [ ] A task"), op);
        assert.equal(outcome, "inserted", log);
        assert.equal(after, note("- [<] 4:00pm\tPlanning | Q3 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm", "- [ ] A task"), log);
        assert.ok(!result.droppedLog, log);
    }
});

test("a moved line whose log link is in the old form still goes once the new line has it", () => {
    const before = note("- [<] 4:00pm\t[[2026-09-16 Planning|Planning]]", "\t- 4:30pm", "- [ ] A task");
    const moveOut = { kind: "moveOut", key: "E1", entry: ENTRY, event: event({ date: "2026-09-18" }), lines: ENTRY.lines };
    const carry = { projects: [], log: "[[2026-09-16 Planning|⋯]]" };
    assert.equal(run(before, { ...moveOut, carry, landed: { asIntended: true } }).outcome, "removed");
    const oldCarry = { projects: [], log: "[[2026-09-16 Planning|Planning]]" };
    assert.equal(run(note("- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"), { ...moveOut, carry: oldCarry, landed: { asIntended: true } }).outcome, "removed");
});

test("insert adopts a log's timeless line written with the note link at the end, in either order", () => {
    for (const line of ["- [<] Planning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "- [<] Planning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]"]) {
        const { text: after, outcome } = run(note(line, "\t- 4:00pm - 4:20pm", "- [ ] A task"), { kind: "insert", key: "E1", event: event(), lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"] });
        assert.equal(outcome, "adopted", line);
        assert.equal(after, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm", "\t- 4:00pm - 4:20pm", "- [ ] A task"), line);
    }
});

test("insert adopts a log's timeless line written with the note link at the end", () => {
    const before = note("- [<] Planning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]", "\t- 4:00pm - 4:20pm", "- [ ] A task");
    const { text: after, outcome } = run(before, { kind: "insert", key: "E1", event: event(), lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"] });
    assert.equal(outcome, "adopted");
    assert.equal(after, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm", "\t- 4:00pm - 4:20pm", "- [ ] A task"));
});

test("run: only a log takes the line's times: a ⋯ pointing at a task note leaves that note alone", async () => {
    const TASK = "Projects/Studio/Prep the deck.md";
    const LOG = "Projects/Studio/Notes/2026-09-16 Retro.md";
    const map = vault({
        [TASK]: "---\ntags: task\n---\n",
        [LOG]: "---\ntags: log\n---\n",
        [day("2026-09-16")]: note("- [<] Planning [[Prep the deck|⋯]]", "- [<] Retro [[2026-09-16 Retro|⋯]]"),
    });
    assert.equal(await sync(map, [event(), event({ key: "E2", id: "E2", title: "Retro" })]), "Calendar sync: 2 adopted");
    assert.equal(map.get(TASK), "---\ntags: task\n---\n", "a task note gets no times");
    assert.match(map.get(LOG), /time: 4:00pm/, "a log tagged log gets them, wherever it's filed");
});

test("only a title wrapped in a link to a dated log is the event's log: any other wrapped title is a hand edit, and nothing is re-labelled", () => {
    for (const title of ["[[Rafe Oakes|Planning]]", "[[Planning]]", "[[People/Planning|Planning]]"]) {
        const line = `- [<] 4:00pm\t${title}`;
        assert.equal(cs.eventHead(line).log, null, title);
        const before = note(line, "\t- 4:30pm");
        const { text: after, outcome } = run(before, replace(["- [<] 5:00pm\tPlanning", "\t- 5:30pm"]));
        assert.equal(outcome, "yours", title);
        assert.equal(after, before, title);
    }
    assert.equal(cs.logLine("- [<] [[Rafe Oakes|Planning]]"), null);
    assert.equal(cs.eventHead("- [<] 4:00pm\t[[Projects/Studio/logs/2026-09-16 Planning|Planning]]").log, "[[Projects/Studio/logs/2026-09-16 Planning|⋯]]", "a log's path still counts");
});

test("adopting a log's timeless line keeps its 🆓, in either form", () => {
    for (const line of ["- [<] Planning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "- [<] Planning 🆓 [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]", "- [<] [[2026-09-16 Planning|Planning]] 🆓 [[Pinecone Studio|⭕]]"]) {
        const { text: after, outcome } = run(note(line), { kind: "insert", key: "E1", event: event(), lines: ["- [<] 4:00pm\tPlanning", "\t- 4:30pm"] });
        assert.equal(outcome, "adopted", line);
        assert.equal(after, note("- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"), line);
    }
});

test("isLog: a note in a ›logs folder (AddTaskNote's name, any case) or tagged #log; without AddTaskNote only the tag counts (OBS-164)", () => {
    const helper = new (vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({})))();
    const context = vm.createContext({ app: {}, moment, plainday: { Schedule: { dailyOpts: () => ({ folder: DAYS }) }, AddTaskNote: helper }, console });
    const sync = new (vm.runInContext(code + "\n;CalendarSync", context))();
    const isLog = (path, tags = []) => sync.isLog({ path }, { frontmatter: { tags } });
    assert.deepEqual(["Projects/Studio/›logs/2026-09-16 Planning.md", "Projects/Studio/›Logs/2026-09-16 Planning.md", "Projects/Studio/logs/2026-09-16 Planning.md",
        "Projects/Studio/2026-09-16 Planning.md", "Projects/Studio/›logs/2025/2025-03-02 Kickoff.md", "›logs/x.md"].map((p) => isLog(p)),
    [true, true, false, false, false, true]);
    assert.ok(isLog("Inbox/2026-09-18 Printer call.md", ["log"]), "tagged, wherever it waits");
    assert.ok(!cs.isLog({ path: "Projects/Studio/›logs/2026-09-16 Planning.md" }, {}), "no AddTaskNote: the folder doesn't decide");
});

// ------------------------------------------------------------------ the range (OBS-282)

test("run: only calendars that are on and have a link on this device are read; with none, nothing goes over the network", async () => {
    const map = vault();
    const device = devices.get(map);
    device.state.calendars.list.push({ id: "off", name: "Off", account: "", address: "", on: false }, { id: "nolink", name: "Elsewhere", account: "", address: "", on: true });
    device.state.links.off = "https://calendar.example.com/off.ics";
    const feed = stand(device.state).CalendarFeed;
    device.state.reads.cal = { events: [event()], failed: [] };
    assert.equal(await load(device.app, device.state, { CalendarFeed: feed }).run(), "Calendar sync: 1 added");
    assert.deepEqual(feed.loads, ["cal"]);

    const none = vault();
    devices.get(none).state.calendars.list = [];
    const quiet = stand(devices.get(none).state).CalendarFeed;
    assert.equal(await load(devices.get(none).app, devices.get(none).state, { CalendarFeed: quiet }).run(), "No calendars to sync yet: add one in Settings → Plainday → Calendars");
    assert.deepEqual(quiet.loads, []);
    devices.get(none).state.calendars.list = [{ id: "x", name: "X", account: "", address: "", on: true }];
    assert.equal(await load(devices.get(none).app, devices.get(none).state, { CalendarFeed: quiet }).run(), "No calendar is switched on with a link on this device: see Settings → Plainday → Calendars");
    assert.deepEqual(quiet.loads, []);
    assert.equal(none.size, 0, "no note written");
});

// ------------------------------------------------------------------ IDs on event lines (OBS-275)

test("lineId: six letters and digits from the event's key, the same every time; steps are other IDs", () => {
    const a = cs.lineId("E1"), b = load().lineId("E1");
    assert.match(a, /^[a-z0-9]{6}$/);
    assert.equal(a, b, "every device works out the same one");
    assert.notEqual(cs.lineId("E1", 1), a);
    assert.notEqual(cs.lineId("S1@2026-09-16"), cs.lineId("S1@2026-09-23"), "each occurrence its own");
    assert.deepEqual(plain(cs.lineIds("E1")), [a, cs.lineId("E1", 1), cs.lineId("E1", 2)]);
});

test("the ID is read at the end of a line or ahead of links typed after it, and written last", () => {
    const id = lid("E1");
    assert.equal(cs.lidOf(`- [<] 9:30am\tReview ^${id}`), id);
    assert.equal(cs.lidOf(`- [<] 9:30am\tReview ^${id} [[Acme|⭕]] [[2026-09-16 Review|⋯]]`), id);
    assert.equal(cs.lidOf(`- [<] 9:30am\tReview ^${id} and more words`), null, "text after it: not an ID");
    assert.equal(cs.bare(`- [<] 9:30am\tReview ^${id} [[Acme|⭕]]`), "- [<] 9:30am\tReview [[Acme|⭕]]");
    assert.equal(cs.withLid("- [<] 9:30am\tReview [[Acme|⭕]] ^old", id), `- [<] 9:30am\tReview [[Acme|⭕]] ^${id}`);
    assert.deepEqual(plain(cs.head(`- [<] 9:30am\tReview [[Acme|⭕]] ^${id}`)), { start: "9:30am", title: "Review" });
    assert.equal(cs.eventHead(`- [<] 9:30am\tReview 🆓 [[Acme|⭕]] ^${id}`).shown, "Review");
});

test("run: each event line ends in its event's ID; a moved line keeps it, a forwarded one gives it up", async () => {
    const map = vault();
    await sync(map, [event(), weekly("2026-09-16")]);
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 10:00am\tWeekly sync ^S1@2026-09-16", "\t- 10:30am", "- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    await sync(map, [moved(), weekly("2026-09-16")]);
    assert.equal(body(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
    edit(map, day("2026-09-18"), (t) => t.replace("\t- 4:30pm", "\t- 4:00pm - 4:20pm"));
    await sync(map, [event({ date: "2026-09-19", start: "2026-09-19T16:00:00-04:00", end: "2026-09-19T16:30:00-04:00" }), weekly("2026-09-16")]);
    assert.equal(body(map.get(day("2026-09-18"))), text("- [>] [[2026-09-19|9/19]] 4:00pm\tPlanning", "\t- 4:00pm - 4:20pm"), "no ID: the event's line is on the 19th");
    assert.equal(body(map.get(day("2026-09-19"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
});

test("run: a line with links typed after its ID is still the event's: found, and its ID put back at the end", async () => {
    const map = vault();
    await sync(map, [event()]);
    map.set(day("2026-09-16"), map.get(day("2026-09-16")).replace(/(\^[a-z0-9]{6})/, "$1 [[Pinecone Studio|⭕]]"));
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 4:30pm"));
    assert.deepEqual(ledger(map).dismissed, {});
});

test("run: a second vault, or a device with no cache, finds the same lines by the same IDs and changes nothing", async () => {
    const map = vault();
    await sync(map, [event(), weekly("2026-09-16")]);
    const before = map.get(day("2026-09-16"));
    const phone = twin(map);
    assert.equal(await sync(map, [event(), weekly("2026-09-16")], { device: phone }), "Calendar sync: nothing to change");
    assert.equal(map.get(day("2026-09-16")), before);
    assert.equal(phone.app.loadLocalStorage("plainday-calendar-cache").events.E1.lid, lid("E1"));

    // A vault of its own, from the same calendars: the same lines, the same IDs
    const other = vault();
    await sync(other, [event(), weekly("2026-09-16")]);
    assert.equal(other.get(day("2026-09-16")), before);
});

test("run: two devices: a change one applied is current for the other, which doesn't call the line yours", async () => {
    const map = vault();
    const mac = sync.device;
    await sync(map, [event()]);
    const phone = twin(map);
    await sync(map, [event()], { device: phone });
    const later = event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" });
    assert.equal(await sync(map, [later], { device: mac }), "Calendar sync: 1 updated");
    assert.equal(await sync(map, [later], { device: phone }), "Calendar sync: nothing to change");
    assert.deepEqual(phone.app.loadLocalStorage("plainday-calendar-cache").events.E1.lines, ["- [<] 5:00pm\tPlanning", "\t- 5:30pm"]);
    // And it keeps the line current from then on
    const again = event({ start: "2026-09-16T18:00:00-04:00", end: "2026-09-16T18:30:00-04:00" });
    assert.equal(await sync(map, [again], { device: phone }), "Calendar sync: 1 updated");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 6:00pm\tPlanning ^E1", "\t- 6:30pm"));
});

test("run: two devices: one reading an older copy of the calendar never moves a line back", async () => {
    const map = vault();
    const mac = sync.device;
    await sync(map, [event({ modified: 1 })]);
    const phone = twin(map);
    await sync(map, [event({ modified: 1 })], { device: phone });
    // The Mac reads the move; the phone's copy of the calendar still has the event where it was
    await sync(map, [moved({ modified: 2 })], { device: mac });
    assert.equal(await sync(map, [event({ modified: 1 })], { device: phone }), "Calendar sync: nothing to change");
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.equal(phone.app.loadLocalStorage("plainday-calendar-cache").events.E1.date, "2026-09-18", "it follows the line");
    // Its copy catches up: still nothing to do
    assert.equal(await sync(map, [moved({ modified: 2 })], { device: phone }), "Calendar sync: nothing to change");
    // A copy older than one it has seen changes nothing either
    assert.equal(await sync(map, [event({ modified: 1 })], { device: mac }), "Calendar sync: nothing to change");
    assert.equal(plainBody(map.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: a device in another time zone doesn't rewrite a line whose event hasn't changed (Brian, 11/18)", async () => {
    const map = vault();
    await sync(map, [event()]);
    // The same instants, as a device an ocean away writes them
    const away = event({ start: "2026-09-16T21:00:00+01:00", end: "2026-09-16T21:30:00+01:00" });
    assert.equal(await sync(map, [away]), "Calendar sync: nothing to change");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    // The event changes: written as this device writes it
    assert.equal(await sync(map, [event({ start: "2026-09-16T22:00:00+01:00", end: "2026-09-16T22:30:00+01:00" })]), "Calendar sync: 1 updated");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 10:00pm\tPlanning", "\t- 10:30pm"));
});

test("run: a device with no cache leaves a line that differs from what it would write, and forwards a moved line rather than removing it", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\tPlanning (our side)"));
    const phone = twin(map);
    assert.equal(await sync(map, [event()], { device: phone }), "Calendar sync: 1 left for you");
    assert.match(phone.app.loadLocalStorage("plainday-calendar-last").yours[0], /this device didn't write it/);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning (our side)", "\t- 4:30pm"));

    const moving = vault();
    await sync(moving, [event()]);
    const fresh = twin(moving);
    assert.equal(await sync(moving, [moved()], { device: fresh }), "Calendar sync: 1 added, 1 forwarded");
    assert.equal(body(moving.get(day("2026-09-16"))), text("- [>] [[2026-09-18|9/18]] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.equal(body(moving.get(day("2026-09-18"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:30pm"));
});

test("run: a device with no cache cancels nothing: it can't tell which calendar a line is from", async () => {
    const map = vault();
    await sync(map, [event()]);
    const phone = twin(map);
    assert.equal(await sync(map, [], { device: phone }), "Calendar sync: nothing to change");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: two lines with one ID in a note are merged, keeping yours, brought up to the event's time", async () => {
    const map = vault();
    await sync(map, [event()]);
    // Two devices wrote the event before Sync met; one copy has your time entry
    edit(map, day("2026-09-16"), (t) => t.replace("- [<] 4:00pm\tPlanning ^E1\n\t- 4:30pm", "- [<] 4:00pm\tPlanning ^E1\n\t- 4:00pm - 4:20pm\n- [<] 4:00pm\tPlanning ^E1\n\t- 4:30pm"));
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 doubled line merged");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 4:00pm - 4:20pm"));
    assert.deepEqual(last(map).merged, ["2026-09-16 Planning"]);

    // One device retimed it while you added a ⭕ to the old line on another: yours, at the new time
    const retimed = vault();
    await sync(retimed, [event()]);
    edit(retimed, day("2026-09-16"), (t) => t.replace("- [<] 4:00pm\tPlanning ^E1\n\t- 4:30pm", "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm\n- [<] 5:00pm\tPlanning ^E1\n\t- 5:30pm"));
    const later = event({ start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" });
    await sync(retimed, [later]);
    assert.equal(body(retimed.get(day("2026-09-16"))), text("- [<] 5:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1", "\t- 5:30pm"));

    // Two copies each with something of yours: both stay, and the report says so
    const both = vault();
    await sync(both, [event()]);
    edit(both, day("2026-09-16"), (t) => t.replace("- [<] 4:00pm\tPlanning ^E1\n\t- 4:30pm", "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm\n- [<] 4:00pm\tPlanning ^E1\n\t- 4:00pm - 4:20pm"));
    assert.equal(await sync(both, [event()]), "Calendar sync: 1 left for you");
    assert.match(reported(both), /two lines for this event/);
    assert.equal((both.get(day("2026-09-16")).match(/\^/g) ?? []).length, 2);
});

test("run: a calendar that couldn't be read, or an event the reader skipped, keeps its lines; the summary names them", async () => {
    const map = vault();
    const device = sync.device;
    device.state.calendars.list.push({ id: "home", name: "Home", account: "iCloud", address: "", on: true });
    device.state.links.home = "https://calendar.example.com/home.ics";
    device.state.reads.home = { events: [event({ key: "H1", id: "H1", title: "Dentist", calendarId: "home", start: "2026-09-16T08:00:00-04:00", end: "2026-09-16T09:00:00-04:00" })], failed: [] };
    await sync(map, [event()]);
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 8:00am\tDentist", "\t- 9:00am", "- [<] 4:00pm\tPlanning", "\t- 4:30pm"));

    device.state.reads.home = { problem: "unreachable" };
    await sync(map, []);
    const said = await sync(map, []);
    // Work read fine and Planning is gone from it: canceled; Home couldn't be reached: Dentist stays
    assert.equal(said, "Calendar sync: 1 canceled. Not synced: Home (couldn't be reached)");
    assert.match(map.get(day("2026-09-16")), /- \[<\] 8:00am\tDentist/);

    // The reader skipped an event: its line stays as it is, never canceled
    device.state.reads.home = { events: [], failed: [{ uid: "H1", title: "Dentist" }] };
    assert.equal(await sync(map, []), "Calendar sync: nothing to change. 1 event skipped, which the calendar sync can't read: see the error log");
    assert.match(map.get(day("2026-09-16")), /- \[<\] 8:00am\tDentist/);
});

test("run: a link that stopped working: the error log names the calendar and this device, a toast once, and never the link", async () => {
    const map = vault({ [ERROR_LOG]: "---\nid: 1\ntags:\n---\n\n## Calendar sync\n\nUpdated 9/14 8:00am · 1 open\n\n- Link stopped working · Studio (on iPhone)\n" });
    const device = sync.device;
    device.state.calendars.list[0].name = "Studio";
    device.state.reads.cal = { problem: "dead" };
    const toasts = [];
    const errorLog = makeErrorLog(device.app, toasts);
    const run = () => load(device.app, device.state, { ErrorLog: errorLog }).run();
    assert.equal(await run(), "Calendar sync: nothing synced. Not synced: Studio (its link stopped working on this device)");
    assert.match(map.get(ERROR_LOG), /- Link stopped working · Studio \(on Mac\)\n/);
    assert.match(map.get(ERROR_LOG), /- Link stopped working · Studio \(on iPhone\)\n/, "the phone's line is the phone's");
    assert.equal(toasts.length, 1);
    await run();
    assert.equal(toasts.length, 1, "no second toast");
    assert.equal(load(device.app, device.state).deadLink("cal"), true);
    for (const t of [...map.values(), ...toasts, ...(device.state.notices ?? []), ...device.app.local.values()]) assert.doesNotMatch(String(t), /calendar\.example\.com/);
    // It works again: the Mac's line goes, the phone's stays until the phone's next run
    device.state.reads.cal = { events: [], failed: [] };
    await run();
    assert.doesNotMatch(map.get(ERROR_LOG), /Studio \(on Mac\)/);
    assert.match(map.get(ERROR_LOG), /Studio \(on iPhone\)/);
    assert.equal(load(device.app, device.state).deadLink("cal"), false);
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

test("run: one sync at a time: a second one says so and does nothing", async () => {
    const map = vault();
    const device = sync.device;
    device.state.reads.cal = { events: [event()], failed: [] };
    const s = load(device.app, device.state);
    const [a, b] = await Promise.all([s.run(), s.run()]);
    assert.equal(a, "Calendar sync: 1 added");
    assert.equal(b, "A calendar sync is already running");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: daily notes named DD-MM-YYYY get the events, and no YYYY-MM-DD notes appear (OBS-124)", async () => {
    const map = vault();
    sync.device.state.format = "DD-MM-YYYY";
    await sync(map, [event()]);
    assert.equal(plainBody(map.get(`${DAYS}/16-09-2026.md`)), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
    assert.equal(map.has(day("2026-09-16")), false);
    edit(map, `${DAYS}/16-09-2026.md`, (t) => t.replace("\t- 4:30pm", "\t- 4:00pm - 4:20pm"));
    await sync(map, [moved()]);
    assert.equal(plainBody(map.get(`${DAYS}/16-09-2026.md`)), text("- [>] [[18-09-2026|9/18]] 4:00pm\tPlanning", "\t- 4:00pm - 4:20pm"), "the forward links the day by its name");
    assert.equal(plainBody(map.get(`${DAYS}/18-09-2026.md`)), text("- [<] 4:00pm\tPlanning", "\t- 4:30pm"));
});

test("run: recurring events' projects are read from the old Calendar Sync note once, into the settings", async () => {
    const map = vault({ [NOTE]: text("---", "id: 1", "---", "", "## Calendars", "### Work", "- [x] Work", "", "## Recurring events", "", "Put a project link after a series.", "", "- Weekly sync [[Pinecone Studio|⭕]]", "- Board call", "", "## Last run", "") });
    const device = sync.device;
    device.state.calendars.recurring = null;
    const before = map.get(NOTE);
    assert.equal(await sync(map, SERIES.map((d) => weekly(d))), "Calendar sync: 3 added");
    assert.deepEqual(plain(device.state.calendars.recurring), [{ title: "Weekly sync", links: ["[[Pinecone Studio|⭕]]"] }]);
    for (const d of SERIES) assert.match(noIds(map.get(day(d))), /Weekly sync \[\[Pinecone Studio\|⭕\]\]/);
    assert.equal(map.get(NOTE), before, "the note isn't changed");
    // Read once: a link added to the note now isn't taken
    edit(map, NOTE, (t) => t.replace("- Board call", "- Board call [[Kestrel|⭕]]"));
    const saves = device.state.saves;
    await sync(map, SERIES.map((d) => weekly(d)));
    assert.equal(device.state.saves, saves);
    assert.deepEqual(plain(device.state.calendars.recurring), [{ title: "Weekly sync", links: ["[[Pinecone Studio|⭕]]"] }]);
});

test("run: the sync writes no file of its own: only daily notes", async () => {
    const map = vault();
    await sync(map, [event(), moved({ key: "E2", id: "E2" })]);
    assert.deepEqual([...map.keys()].sort(), [day("2026-09-16"), day("2026-09-18")]);
});

// ------------------------------------------------------------------ from the code review (OBS-275)

const at = (h, over = {}) => event({ start: `2026-09-16T${h}:00:00-04:00`, end: `2026-09-16T${h}:30:00-04:00`, ...over });

test("run: a line you changed by hand is yours, said once, not on every run", async () => {
    const map = vault();
    await sync(map, [at(16)]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tPlanning", "\tPlanning with Quincy"));
    assert.equal(await sync(map, [at(17)]), "Calendar sync: 1 left for you");
    assert.equal(await sync(map, [at(17)]), "Calendar sync: nothing to change");
    assert.equal(plainBody(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning with Quincy", "\t- 4:30pm"));
});

test("run: words typed after a line's ID: still the event's line, now yours, never taken for deleted", async () => {
    for (const typed of [" - room 4", " #important", " ✅ 2026-09-16"]) {
        const map = vault();
        await sync(map, [event()]);
        map.set(day("2026-09-16"), map.get(day("2026-09-16")).replace(`^${lid("E1")}`, `^${lid("E1")}${typed}`));
        await sync(map, [event()], { now: 1000 });
        assert.equal(await sync(map, [event()], { now: 1000 + 20 * 60 * 1000 }), "Calendar sync: nothing to change", typed);
        assert.deepEqual(ledger(map).dismissed, {}, typed);
        // Canceled in the calendar: marked, as any line of its is
        await sync(map, [], { now: 1000 + 40 * 60 * 1000 });
        assert.equal(await sync(map, [], { now: 1000 + 60 * 60 * 1000 }), "Calendar sync: 1 canceled", typed);
        assert.match(map.get(day("2026-09-16")), new RegExp(`- \\[-\\] 4:00pm\\tPlanning \\^${lid("E1")}`), typed);
    }
});

test("run: a line you deleted doesn't come back when its event changes after the sync first found it gone", async () => {
    const map = vault();
    await sync(map, [at(16)]);
    edit(map, day("2026-09-16"), () => note());
    assert.equal(await sync(map, [at(16)], { now: 1000 }), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [at(17)], { now: 1000 + 20 * 60 * 1000 }), "Calendar sync: 1 left for you");
    assert.equal(await sync(map, [at(17)], { now: 1000 + 40 * 60 * 1000 }), "Calendar sync: nothing to change");
    assert.equal(plainBody(map.get(day("2026-09-16"))), "");
});

test("run: copies of the calendar that alternate with and without an event don't flip its line between canceled and back", async () => {
    const map = vault();
    await sync(map, [event({ modified: 5 })]);
    // A copy without it, then one with it: nothing, either way
    assert.equal(await sync(map, []), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [event({ modified: 5 })]), "Calendar sync: nothing to change");
    assert.equal(await sync(map, []), "Calendar sync: nothing to change");
    assert.equal(await sync(map, []), "Calendar sync: 1 canceled");
    for (let i = 0; i < 3; i++) {
        assert.equal(await sync(map, [event({ modified: 5 })]), "Calendar sync: nothing to change");
        assert.equal(await sync(map, []), "Calendar sync: nothing to change");
        assert.equal(await sync(map, []), "Calendar sync: nothing to change");
    }
    assert.match(map.get(day("2026-09-16")), /- \[-\] 4:00pm\tPlanning/);
    // Really back: a newer copy of the event
    assert.equal(await sync(map, [event({ modified: 9 })]), "Calendar sync: 1 restored");
});

test("run: a LAST-MODIFIED far ahead of now (a wrong clock) doesn't stop later changes", async () => {
    const map = vault();
    await sync(map, [event({ modified: 10 * 365 * 24 * 3600 * 1000 })], { now: 1000 });
    assert.equal(await sync(map, [at(17, { modified: 5 })], { now: 2000 }), "Calendar sync: 1 updated");
});

test("run: a daily note that's gone (renamed folder, not synced yet) takes none of its lines for deleted", async () => {
    const map = vault();
    await sync(map, [event(), moved({ key: "E2", id: "E2" })]);
    map.delete(day("2026-09-16"));
    await sync(map, [event(), moved({ key: "E2", id: "E2" })], { now: 1000 });
    await sync(map, [event(), moved({ key: "E2", id: "E2" })], { now: 1000 + 30 * 60 * 1000 });
    assert.deepEqual(ledger(map).dismissed, {});
    assert.equal(map.has(day("2026-09-16")), false, "not made again either");

    // More lines gone at once than a run may remove: none is taken for deleted
    const many = vault();
    const lots = Array.from({ length: 12 }, (_, i) => event({ key: `M${i}`, id: `M${i}`, title: `Meeting ${i}` }));
    await sync(many, lots);
    many.set(day("2026-09-16"), note());
    await sync(many, lots, { now: 1000 });
    assert.match(await sync(many, lots, { now: 1000 + 30 * 60 * 1000 }), /12 held back/);
    assert.deepEqual(ledger(many).dismissed, {});
});


// ------------------------------------------------------------------ one device syncs (OBS-275, Brian 11/18)

test("run: on a device that isn't the one that syncs, Sync calendars says so, writes nothing and downloads nothing", async () => {
    const map = vault();
    const device = sync.device;
    device.state.syncHere = false;
    const feed = stand(device.state).CalendarFeed;
    device.state.reads.cal = { events: [event()], failed: [] };
    assert.equal(await load(device.app, device.state, { CalendarFeed: feed }).run(), "This device doesn't sync calendars. To sync them here, turn on Settings → Plainday → Calendars → Sync calendars on this device, and keep it off on your other devices.");
    assert.deepEqual(feed.loads, []);
    assert.equal(map.size, 0);
});

// ------------------------------------------------------------------ from the third review (OBS-275)

test("run: a daily note the sync makes (its name changed) takes none of that day's remembered lines for deleted", async () => {
    const map = vault();
    const alpha = event({ key: "A1", id: "A1", title: "Alpha" }), beta = event({ key: "B1", id: "B1", title: "Beta", start: "2026-09-16T17:00:00-04:00", end: "2026-09-16T17:30:00-04:00" });
    await sync(map, [alpha, beta]);
    sync.device.state.format = "DD-MM-YYYY";
    const gamma = event({ key: "C1", id: "C1", title: "Gamma", start: "2026-09-16T18:00:00-04:00", end: "2026-09-16T18:30:00-04:00" });
    await sync(map, [alpha, beta, gamma], { now: 1000 });
    await sync(map, [alpha, beta, gamma], { now: 1000 + 30 * 60 * 1000 });
    assert.deepEqual(ledger(map).dismissed, {});
    assert.doesNotMatch(reported(map), /you deleted/);
});

test("run: a log keeps its times when the line that links it is left as it is", async () => {
    const map = vault({
        [day("2026-09-16")]: note(`- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] ^${lid("E1")}`, "\t- 4:30pm"),
        "Logs/2026-09-16 Planning.md": "---\ntags: log\ntime: 4:00pm\nendTime: 4:30pm\n---\n",
    });
    keys.add("E1");
    // A device with nothing remembered reads another time: the line is left, and so is the log
    assert.equal(await sync(map, [at(21)]), "Calendar sync: 1 left for you");
    assert.match(map.get("Logs/2026-09-16 Planning.md"), /time: 4:00pm/);
});

test("run: a forwarded line gives up its ID even with words after it; a line with words after its ID isn't taken by another event", async () => {
    const map = vault();
    await sync(map, [event()]);
    map.set(day("2026-09-16"), map.get(day("2026-09-16")).replace(`^${lid("E1")}`, `^${lid("E1")} - room 4`));
    await sync(map, [moved()]);
    assert.doesNotMatch(map.get(day("2026-09-16")), /\^[a-z0-9]{6}/, "the forwarded line has no ID");

    const other = vault();
    await sync(other, [event()]);
    other.set(day("2026-09-16"), other.get(day("2026-09-16")).replace(`^${lid("E1")}`, `^${lid("E1")} - room 4`));
    await sync(other, [event(), event({ key: "E2", id: "E2" })]);
    assert.equal((other.get(day("2026-09-16")).match(new RegExp(`\\^${lid("E1")}`, "g")) ?? []).length, 1);
    assert.match(other.get(day("2026-09-16")), new RegExp(`\\^${lid("E2")}$`, "m"), "E2 gets a line of its own");
});

test("run: a deleted event that moves to a later day stays deleted until that day", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), () => note());
    await sync(map, [event()], { now: 1000 });
    await sync(map, [event()], { now: 1000 + 20 * 60 * 1000 });
    assert.equal(ledger(map).dismissed.E1, "2026-09-16");
    await sync(map, [moved()], { now: 1000 + 40 * 60 * 1000 });
    assert.equal(ledger(map).dismissed.E1, "2026-09-18");
    assert.equal(map.get(day("2026-09-18")), undefined);
});

test("run: a device with nothing remembered finds a line whose ID stepped past a task's", async () => {
    const id = lid("E1");
    const map = vault({ [day("2026-09-16")]: note(`- [ ] A task that happens to end in it ^${id}`) });
    await sync(map, [event()]);
    const stepped = cs.lineId("E1", 1);
    assert.match(map.get(day("2026-09-16")), new RegExp(`\\tPlanning \\^${stepped}$`, "m"));
    sync.device.app.saveLocalStorage("plainday-calendar-cache", null);
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.equal((map.get(day("2026-09-16")).match(/\tPlanning/g) ?? []).length, 1);
});

test("run: a line found by its ID, with nothing remembered, keeps its end time and mark", async () => {
    const map = vault({ [day("2026-09-16")]: note(`- [<] 4:00pm\tPlanning ^${lid("E1")}`, "\t- 5:00pm") });
    keys.add("E1");
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
    assert.equal(body(map.get(day("2026-09-16"))), text("- [<] 4:00pm\tPlanning ^E1", "\t- 5:00pm"));
});

test("run: two copies each with something of yours are reported once, not on every run", async () => {
    const map = vault();
    await sync(map, [event()]);
    edit(map, day("2026-09-16"), (t) => t.replace("- [<] 4:00pm\tPlanning ^E1\n\t- 4:30pm", "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] ^E1\n\t- 4:30pm\n- [<] 4:00pm\tPlanning ^E1\n\t- 4:00pm - 4:20pm"));
    assert.equal(await sync(map, [event()]), "Calendar sync: 1 left for you");
    assert.equal(await sync(map, [event()]), "Calendar sync: nothing to change");
});

// ------------------------------------------------------------------ from the fourth review (OBS-275)

test("run: a restored event isn't canceled again by one read without it, and copies that alternate don't flip it", async () => {
    const map = vault();
    await sync(map, [event({ modified: 1 })]);
    await sync(map, []);
    assert.equal(await sync(map, []), "Calendar sync: 1 canceled");
    assert.equal(await sync(map, [event({ modified: 9 })]), "Calendar sync: 1 restored");
    for (let i = 0; i < 3; i++) {
        assert.equal(await sync(map, []), "Calendar sync: nothing to change");
        assert.equal(await sync(map, [event({ modified: 9 })]), "Calendar sync: nothing to change");
    }
    assert.match(map.get(day("2026-09-16")), /- \[<\] 4:00pm\tPlanning/);
});

test("run: an event back at the same version is restored once a second read, 10 minutes on, still has it", async () => {
    const map = vault();
    const M = Date.UTC(2026, 8, 1);
    await sync(map, [event({ modified: M })]);
    await sync(map, []);
    assert.equal(await sync(map, []), "Calendar sync: 1 canceled");
    assert.equal(await sync(map, [event({ modified: M })], { now: Date.UTC(2026, 8, 15, 20) }), "Calendar sync: nothing to change");
    assert.equal(await sync(map, [event({ modified: M })], { now: Date.UTC(2026, 8, 15, 20, 11) }), "Calendar sync: 1 restored");
});

test("run: a known event that moves takes no other event's canceled or just-missing line", async () => {
    const focus = (key, date) => event({ key, id: key, title: "Focus time", date, start: `${date}T14:00:00-04:00`, end: `${date}T15:00:00-04:00` });
    const map = vault();
    await sync(map, [focus("F1", "2026-09-16"), focus("F2", "2026-09-17")]);
    edit(map, day("2026-09-16"), (t) => t.replace("\tFocus time ^F1\n\t- 3:00pm", "\tFocus time [[Kestrel|⭕]] ^F1\n\t- 2:00pm - 2:40pm"));
    await sync(map, [focus("F2", "2026-09-17")]);
    await sync(map, [focus("F2", "2026-09-17")]);
    assert.match(map.get(day("2026-09-16")), /- \[-\] 2:00pm\tFocus time \[\[Kestrel\|⭕\]\]/);
    await sync(map, [focus("F2", "2026-09-16")]);
    const lines = body(map.get(day("2026-09-16")));
    assert.match(lines, /- \[-\] 2:00pm\tFocus time \[\[Kestrel\|⭕\]\] \^F1\n\t- 2:00pm - 2:40pm/, "F1's canceled line, ⭕ and time entry stay F1's");
    assert.match(lines, /- \[<\] 2:00pm\tFocus time \^F2\n\t- 3:00pm/, "F2 gets a line of its own");
});

test("run: an event-shaped line nested under a task is the task's subtask, never an event's line", async () => {
    const nested = note("- [ ] Prepare launch", `\t- [<] 4:00pm\tPlanning ^${lid("E1")}`, "\t- [ ] Write the brief", "\t- [ ] Email Ana");
    const map = vault({ [day("2026-09-16")]: nested });
    keys.add("E1");
    await sync(map, [event()]);
    await sync(map, [moved()]);
    assert.match(map.get(day("2026-09-16")), /- \[ \] Prepare launch\n\t- \[<\] 4:00pm\tPlanning \^[a-z0-9]{6}\n\t- \[ \] Write the brief\n\t- \[ \] Email Ana/);
});

test("run: a line you put back after the sync took it for deleted is kept current again", async () => {
    const map = vault();
    await sync(map, [event()]);
    const was = map.get(day("2026-09-16"));
    map.set(day("2026-09-16"), note());
    await sync(map, [event()], { now: Date.UTC(2026, 8, 15, 20) });
    await sync(map, [event()], { now: Date.UTC(2026, 8, 15, 20, 20) });
    assert.ok(ledger(map).dismissed.E1);
    map.set(day("2026-09-16"), was);
    await sync(map, [event()], { now: Date.UTC(2026, 8, 15, 21) });
    assert.equal(ledger(map).dismissed.E1, undefined);
    assert.equal(await sync(map, [at(17)], { now: Date.UTC(2026, 8, 15, 22) }), "Calendar sync: 1 updated");
});

test("run: an event moved further ahead than the range isn't taken for canceled", async () => {
    const map = vault();
    await sync(map, [event()]);
    for (const t of [Date.UTC(2026, 8, 15, 20), Date.UTC(2026, 8, 15, 21)]) {
        sync.device.state.reads.cal = { events: [], failed: [], outside: ["E1"] };
        const s = load(sync.device.app, sync.device.state);
        s.now = () => t;
        assert.equal(await s.run(), "Calendar sync: nothing to change");
    }
    assert.match(map.get(day("2026-09-16")), /- \[<\] 4:00pm\tPlanning/);
});

test("run: a link pasted while a sync works isn't taken for the one that stopped working", async () => {
    const map = vault();
    const device = sync.device;
    device.state.reads.cal = { problem: "dead" };
    const s = load(device.app, device.state);
    device.state.duringLoad = () => { s.linkChanged("cal"); };
    await s.run();
    assert.equal(s.deadLink("cal"), false);
    device.state.duringLoad = null;
    await load(device.app, device.state).run();
    assert.equal(load(device.app, device.state).deadLink("cal"), true, "a sync that reads the dead link again says so");
    assert.equal(map.size, 0);
});

// The fourth review's randomized check: events retimed, moved, renamed, freed, deleted and put back over
// several runs, with ⭕ links added by hand. Every event keeps one line, a ⭕ stays with its event, and a
// third run with nothing new changes nothing.
test("run: random runs keep one line per event, each ⭕ with its event, and settle", async () => {
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
            if (r < 0.8) return null;
            return e;
        };
        for (let round = 0; round < 40; round++) {
            const map = vault();
            let evs = Array.from({ length: 6 }, (_, i) => make(i));
            await sync(map, evs);
            const notes = () => [...map].filter(([k]) => k.startsWith(DAYS));
            const tagged = new Set();
            for (const e of evs) if (rnd() < 0.5) {
                const id = lid(e.key);
                for (const [k, v] of notes()) if (v.includes(` ^${id}`)) { map.set(k, v.split("\n").map((l) => (l.endsWith(` ^${id}`) ? l.replace(` ^${id}`, ` [[P${e.key}|⭕]] ^${id}`) : l)).join("\n")); tagged.add(e.key); }
            }
            for (let step = 0; step < 4; step++) {
                evs = evs.map(change).filter(Boolean);
                await sync(map, evs);
                await sync(map, evs);
                const all = () => notes().map(([k, v]) => `${k}\n${v}`).join("\n");
                const before = all();
                const third = await sync(map, evs);
                const where = `seed ${start} round ${round} step ${step}`;
                assert.equal(third, "Calendar sync: nothing to change", where);
                assert.equal(all(), before, where);
                for (const e of evs) {
                    const id = lid(e.key);
                    const ls = notes().flatMap(([, v]) => v.split("\n").filter((l) => l.endsWith(` ^${id}`)));
                    assert.equal(ls.length, 1, `${where}: ${e.key}`);
                }
                for (const [, v] of notes()) for (const l of v.split("\n")) {
                    const m = l.match(/\[\[P(K\d+)\|⭕\]\]/), idm = l.match(/ \^([a-z0-9]{6})$/);
                    if (m && idm) assert.equal(idm[1], lid(m[1]), `${where}: a ⭕ on another event's line: ${l}`);
                }
            }
        }
    }
});
