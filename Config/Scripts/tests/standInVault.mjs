// A stand-in vault for tests: the real CustomJS scripts on a fake app whose metadata cache is parsed
// from note text. Also the moment stand-in and periodic-note settings the Schedule tests share.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

export const src = (name) => fs.readFileSync(new URL(`../CustomJS/${name}.js`, import.meta.url), "utf8");

export const PLANNER = "Reference/Planner";
export const NN = {
    vaultProfiles: [{ periodicNotesFolder: PLANNER }],
    calendarCustomWeekPattern: "[weeks]/gggg[w]ww",
    calendarCustomMonthPattern: "[months]/YYYY-MM",
    calendarCustomYearPattern: "[years]/YYYY",
};
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const weekKey = (date) => new (vm.runInContext(src("timeReport") + "\n;TimeReport", vm.createContext({})))().weekKey(date);

// Dates as "YYYY-MM-DD", moved by days, and their weekday (0 is Sunday)
export const utc = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const plus = (date, n) => new Date(utc(date).getTime() + n * 864e5).toISOString().slice(0, 10);
export const dow = (date) => utc(date).getUTCDay();
// ISO weeks, as moment's GGGG-[W]WW names them: a date's week, and the Monday a name stands for
export const isoName = (date) => {
    const thursday = plus(date, 3 - ((dow(date) + 6) % 7));
    const week = Math.floor((utc(thursday) - utc(`${thursday.slice(0, 4)}-01-01`)) / 864e5 / 7) + 1;
    return `${thursday.slice(0, 4)}-W${String(week).padStart(2, "0")}`;
};
export const isoMonday = (name) => { const jan4 = `${name.slice(0, 4)}-01-04`; return plus(jan4, -((dow(jan4) + 6) % 7) + (Number(name.slice(6)) - 1) * 7); };
// English weeks, as gggg[w]ww names them: the Sunday a name stands for
export const enSunday = (name) => { const jan1 = `${name.slice(0, 4)}-01-01`; return plus(jan1, -dow(jan1) + (Number(name.slice(5)) - 1) * 7); };

// Enough of moment for these scripts, on `today`, in English (weeks start on Sunday), checked against
// Obsidian's own: a note's name parses strictly to its period's first day (an ISO week's Monday), a
// date formats as any of the names, and startOf("week") goes back to Sunday, as it does in English
export const NAMES = { "YYYY-MM-DD": /^\d{4}-\d{2}-\d{2}$/, "gggg[w]ww": /^\d{4}w\d{2}$/, "GGGG-[W]WW": /^\d{4}-W\d{2}$/, "YYYY-MM": /^\d{4}-(?:0[1-9]|1[0-2])$/, YYYY: /^\d{4}$/ };
export const momentOn = (today) => {
    const make = (date, valid = true) => ({
        isValid: () => valid,
        locale: () => make(date, valid),
        clone: () => make(date, valid),
        startOf: (unit) => make({ week: plus(date, -dow(date)), isoWeek: plus(date, -((dow(date) + 6) % 7)), month: `${date.slice(0, 7)}-01`, year: `${date.slice(0, 4)}-01-01` }[unit] ?? date, valid),
        year: () => Number(date.slice(0, 4)),
        format: (f) => ({ "YYYY-MM-DD": date, "gggg[w]ww": weekKey(date), "GGGG-[W]WW": isoName(date), "YYYY-MM": date.slice(0, 7), YYYY: date.slice(0, 4), "M/D": `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`, "ddd M/D": `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow(date)]} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}` })[f] ?? assert.fail(`format ${f}`),
    });
    const moment = (text, format) => {
        if (text === undefined) return make(today);
        if (!NAMES[format]?.test(text)) return make(null, false);
        return make({ "gggg[w]ww": () => enSunday(text), "GGGG-[W]WW": () => isoMonday(text), "YYYY-MM": () => `${text}-01`, YYYY: () => `${text}-01-01` }[format]?.() ?? text);
    };
    moment.locale = () => "en";
    moment.locales = () => ["en"];
    moment.localeData = () => ({ firstDayOfWeek: () => 0, months: () => MONTHS, monthsShort: () => SHORT });
    return moment;
};
// The metadata cache Obsidian keeps for a note, as far as the scripts read it: frontmatter (tags,
// status, parent), list items with their checkbox and block ID, and every block ID (on a list item
// or any other line) by its lowercased ID
export const parseCache = (text) => {
    const lines = text.split("\n");
    let frontmatter = null, start = 0;
    if (lines[0] === "---") {
        const end = lines.indexOf("---", 1);
        frontmatter = { tags: [] };
        let key = null;
        for (const l of lines.slice(1, end)) {
            const kv = l.match(/^([A-Za-z_]+):\s*(.*)$/);
            if (kv) {
                key = kv[1];
                const v = kv[2].trim();
                if (key === "tags") frontmatter.tags = v.startsWith("[") ? v.slice(1, -1).split(",").map((t) => t.trim()).filter(Boolean) : v ? [v] : [];
                else frontmatter[key] = v.replace(/^"|"$/g, "");
            // A YAML list item, indented or not, as the demo's notes write `tags:` then `- project`
            } else if (key === "tags" && /^\s*-\s+/.test(l)) frontmatter.tags.push(l.replace(/^\s*-\s+/, "").trim());
        }
        start = end + 1;
    }
    const listItems = [], blocks = {};
    lines.forEach((l, i) => {
        if (i < start) return;
        const id = l.match(/\s\^([A-Za-z0-9-]+)\s*$/)?.[1];
        const position = { start: { line: i } };
        if (id) blocks[id.toLowerCase()] = { id, position };
        const m = l.match(/^\s*[-*+]\s+(?:\[(.)\])?/);
        if (!m) return;
        const item = { position, parent: -1 };
        if (m[1] !== undefined) item.task = m[1];
        if (id) item.id = id;
        listItems.push(item);
    });
    return { frontmatter, listItems, blocks };
};

// The real scripts on a stand-in vault and editor. `notes` maps paths to text; `open` is the note in
// the editor, cursor on line `at`. `notes()` is the live text (the open note's is its editor's).
// Without `lag`, every write lands everywhere at once. With `lag`, the worst Obsidian does: editor
// edits change only the live text and reach disk (what read and cachedRead return) when the editor
// saves, at the next tick() (a command's start, standing in for the ~2 s autosave) or when open()
// switches notes; the metadata cache parses disk as the previous tick() left it, so it doesn't see
// the previous command's writes. create and process write disk and live text together; process
// replaces the open note's editor text, so unsaved editor edits are lost as in a real conflict.
// create throws on an existing path; a folder exists once a note lives under it or it was created.
export function standIn({ notes = {}, open = null, at = 0, today = "2026-09-16", nn = NN, lag = false }) {
    const vault = new Map(Object.entries(notes));
    const folders = new Map();
    const folder = (p) => {
        if (!p) return { path: "/", name: "", parent: null };
        if (!folders.has(p)) folders.set(p, { path: p, name: p.split("/").pop(), parent: folder(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") });
        return folders.get(p);
    };
    const disk = new Map(vault);
    const made = new Set();
    const files = new Map();
    const fileOf = (p) => {
        if (!vault.has(p)) return null;
        if (!files.has(p)) files.set(p, { path: p, name: p.split("/").pop(), basename: p.split("/").pop().replace(/\.md$/, ""), extension: "md", parent: folder(p.slice(0, p.lastIndexOf("/"))) });
        return files.get(p);
    };
    let seen = null, started = null;
    const cacheText = (p) => (lag && seen ? seen.get(p) : vault.get(p));
    const flush = () => { if (editing && vault.has(editing)) disk.set(editing, vault.get(editing)); };
    const tick = () => { flush(); seen = started; started = new Map(disk); };
    const notices = [], left = [];
    let editing = open, cursor = at, cursorCh = null, placed = null, lines = (vault.get(open) ?? "").split("\n");
    const save = () => { if (editing) { vault.set(editing, lines.join("\n")); if (!lag) disk.set(editing, vault.get(editing)); } };
    const offset = (p) => lines.slice(0, p.line).reduce((s, l) => s + l.length + 1, 0) + p.ch;
    const editor = {
        getCursor: () => ({ line: cursor, ch: cursorCh ?? lines[cursor]?.length ?? 0 }), setCursor(c) { placed = { line: c.line, ch: c.ch }; }, getSelection: () => "",
        getLine: (n) => lines[n], lineCount: () => lines.length, getValue: () => lines.join("\n"),
        offsetToPos(o) { let line = 0; while (line < lines.length - 1 && o > lines[line].length) { o -= lines[line].length + 1; line++; } return { line, ch: o }; },
        replaceRange(text, from, to = from) {
            const all = lines.join("\n");
            lines = (all.slice(0, offset(from)) + text + all.slice(offset(to))).split("\n");
            save();
        },
    };
    const view = { editor, file: fileOf(open), currentMode: { getFoldInfo: () => null } };
    const byName = (name) => [...vault.keys()].map(fileOf).find((f) => f.path.replace(/\.md$/, "").toLowerCase() === name.toLowerCase() || f.basename.toLowerCase() === name.toLowerCase()) ?? null;
    const app = {
        internalPlugins: { plugins: { "daily-notes": { instance: { options: { folder: `${PLANNER}/days`, format: "YYYY-MM-DD" } } } } },
        plugins: { plugins: nn ? { "notebook-navigator": { settings: nn } } : {}, getPlugin: () => null },
        workspace: { getActiveViewOfType: () => view, getActiveFile: () => view.file, getLeavesOfType: (t) => (t === "markdown" && view.file ? [{ view }] : []), activeLeaf: { view } },
        foldManager: { load: () => null, save: async () => {} },
        metadataCache: {
            initialized: true, inProgressTaskCount: 0,
            getFileCache: (f) => { const t = cacheText(f.path); return t === undefined ? null : parseCache(t); },
            getFirstLinkpathDest: (linkpath) => byName(linkpath.split("#")[0].trim()),
            fileToLinktext: (f) => f.basename,
        },
        vault: {
            getMarkdownFiles: () => [...vault.keys()].map(fileOf),
            getFileByPath: fileOf, getAbstractFileByPath: fileOf,
            getFolderByPath: (p) => (!p || p === "/" || made.has(p) || [...vault.keys()].some((k) => k.startsWith(`${p}/`)) ? folder(p) : null),
            createFolder: async (p) => {
                if (made.has(p) || [...vault.keys()].some((k) => k.startsWith(`${p}/`))) throw new Error("Folder already exists.");
                made.add(p);
                return folder(p);
            },
            create: async (p, text) => {
                if (vault.has(p)) throw new Error("File already exists.");
                vault.set(p, text); disk.set(p, text);
                return fileOf(p);
            },
            read: async (f) => disk.get(f.path), cachedRead: async (f) => disk.get(f.path),
            process: async (f, fn) => {
                const text = fn(disk.get(f.path));
                vault.set(f.path, text); disk.set(f.path, text);
                if (f.path === editing) lines = text.split("\n");
                return text;
            },
        },
    };
    const customJS = { obsidian: { MarkdownView: class {}, getAllTags: (cache) => (cache?.frontmatter?.tags ?? []).map((t) => `#${t}`), getLanguage: () => "en", Platform: { isDesktop: true } } };
    const context = vm.createContext({ app, customJS, window: { moment: momentOn(today) }, Notice: class { constructor(m) { notices.push(m); } }, setTimeout: () => 0, console: { ...console, error: () => {}, info: () => {} } });
    const make = (name, cls) => new (vm.runInContext(`${src(name)}\n;${cls}`, context))();
    Object.assign(customJS, {
        DatePrompt: make("datePrompt", "DatePrompt"), JumpToDate: make("jumpToDate", "JumpToDate"), TimeReport: make("timeReport", "TimeReport"),
        AddTaskNote: make("addTaskNote", "AddTaskNote"), Schedule: make("schedule", "Schedule"), TaskIds: make("taskIds", "TaskIds"), DueDate: make("setDueDate", "DueDate"),
        AddProjectLink: make("addProjectLink", "AddProjectLink"),
        RefoldDailyNotes: { onLeave: async (f) => { left.push(f.path); } },
    });
    let n = 0;
    customJS.TaskIds.random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    return {
        app, customJS, notices, left, tick,
        // Where a command last put the cursor (setCursor), or null
        placed: () => placed,
        notes: () => Object.fromEntries(vault),
        open(p, line) { flush(); editing = p; cursor = line; lines = (vault.get(p) ?? "").split("\n"); view.file = fileOf(p); },
        lineOf: (p, text) => (vault.get(p) ?? "").split("\n").findIndex((l) => l.includes(text)),
        async schedule(date, unit = "day") {
            tick();
            let prompt = null;
            customJS.DatePrompt.open = (title, onPick, opts) => { prompt = { title, onPick, opts }; return {}; };
            await customJS.Schedule.invoke();
            if (prompt) await prompt.onPick(customJS.DatePrompt.result(date, unit), { close() {} });
            return prompt?.title ?? null;
        },
        check: () => JSON.parse(JSON.stringify(checkAll())),
    };
    // Every task's lines over the notes the report's checks read (the system and Archive, OBS-208), as
    // the live text says (`vault`, not `disk`: the notes as you'd see them open, which is what must agree;
    // disk lags by design), projects read as the time report reads them
    function checkAll() {
        const tr = customJS.TimeReport, T = customJS.TaskIds.constructor;
        const index = tr.appIndex();
        const read = (p) => !p.startsWith("Config/") && (customJS.TaskIds.inSystem(fileOf(p)) || p.startsWith(T.ARCHIVE));
        const notes = [...vault.keys()].filter(read).map((p) => ({ path: p, kind: customJS.TaskIds.kindOf(fileOf(p)), text: vault.get(p) }));
        return T.check(notes, {
            projectOf: (note, i, lines) => tr.lineProject(note, i, lines, index, false),
            resolve: (linkpath, from) => app.metadataCache.getFirstLinkpathDest(linkpath, from)?.path ?? null,
        });
    }
}
