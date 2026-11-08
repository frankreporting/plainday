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
        hours: () => 23, minutes: () => 59,
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
// status, parent), list items with their checkbox and block ID, every block ID (on a list item or any
// other line) by its lowercased ID, and its links, whose displayText is a link's alias, or else its text
export const parseCache = (text) => {
    // Windows line ends read as Obsidian reads them
    const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
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
                // A quoted value as YAML reads it, a # inside included and a comment after it left out; an unquoted
                // one without a comment after it
                else {
                    const quoted = v.match(/^(["'])(.*?)\1\s*(?:#.*)?$/);
                    frontmatter[key] = quoted ? quoted[2] : v.replace(/(^|\s+)#.*$/, "").trim();
                }
            // A YAML list item, indented or not, as the demo's notes write `tags:` then `- project`
            } else if (key === "tags" && /^\s*-\s+/.test(l)) frontmatter.tags.push(l.replace(/^\s*-\s+/, "").trim());
        }
        start = end + 1;
    }
    const listItems = [], blocks = {}, links = [];
    lines.forEach((l, i) => {
        if (i < start) return;
        for (const m of l.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) links.push({ link: m[1], displayText: m[2] ?? m[1], position: { start: { line: i } } });
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
    return { frontmatter, listItems, blocks, links };
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
export function standIn({ notes = {}, open = null, at = 0, today = "2026-09-16", nn = NN, lag = false, plant = null }) {
    const vault = new Map(Object.entries(notes));
    const folders = new Map();
    const root = { path: "/", name: "", children: [], isRoot: () => true, parent: null };
    const folder = (p) => {
        if (!p) return root;
        if (!folders.has(p)) folders.set(p, { path: p, name: p.split("/").pop(), children: [], isRoot: () => false, parent: folder(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") });
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
    const notices = [], left = [], asked = [], menus = [], questions = [], origins = [];
    // What a question covers, which it doesn't list (Brian, 2026-11-03): the days whose lines change, whose time
    // moves and whose time stops counting, as the tests check them. Set while TaskChange.ask runs.
    let covers = null;
    let editing = open, cursor = at, cursorCh = null, placed = null, selected = null, lines = (vault.get(open) ?? "").split("\n");
    const save = () => { if (editing) { vault.set(editing, lines.join("\n")); if (!lag) disk.set(editing, vault.get(editing)); } };
    const offset = (p) => lines.slice(0, p.line).reduce((s, l) => s + l.length + 1, 0) + p.ch;
    const editor = {
        getCursor: (which) => ({ line: cursor, ch: which === "to" && selected ? selected.to : selected ? selected.from : cursorCh ?? lines[cursor]?.length ?? 0 }), setCursor(c) { placed = { line: c.line, ch: c.ch }; }, getSelection: () => (selected ? lines[cursor].slice(selected.from, selected.to) : ""),
        getLine: (n) => lines[n], lineCount: () => lines.length, getValue: () => lines.join("\n"),
        offsetToPos(o) { let line = 0; while (line < lines.length - 1 && o > lines[line].length) { o -= lines[line].length + 1; line++; } return { line, ch: o }; },
        // `origin`, the edit's tag (CodeMirror's userEvent), recorded: the system's writes carry Schedule.ORIGIN
        replaceRange(text, from, to = from, origin = undefined) {
            origins.push(origin ?? null);
            const all = lines.join("\n");
            lines = (all.slice(0, offset(from)) + text + all.slice(offset(to))).split("\n");
            save();
        },
    };
    const view = { editor, file: fileOf(open), currentMode: { getFoldInfo: () => null } };
    const byName = (name) => [...vault.keys()].map(fileOf).find((f) => f.path.replace(/\.md$/, "").toLowerCase() === name.toLowerCase() || f.basename.toLowerCase() === name.toLowerCase()) ?? null;
    const listeners = new Set();
    const changed = (file) => { for (const l of [...listeners]) if (l.name === "changed") l.fn(file); };
    const put = (p, text) => { vault.set(p, text); disk.set(p, text); if (p === editing) lines = text.split("\n"); };
    // Obsidian's move: a note's links are written again when its name stops being unique, or they named its path
    const moveNote = (from, to) => {
        if (vault.has(to)) throw new Error("Destination file already exists!");
        const file = fileOf(from), old = from.replace(/\.md$/, "").toLowerCase(), name = file.basename.toLowerCase();
        const clash = [...vault.keys()].some((k) => k !== from && k.split("/").pop().replace(/\.md$/, "").toLowerCase() === name);
        const linktext = clash ? to.replace(/\.md$/, "") : file.basename;
        const points = (t) => { const x = t.trim().toLowerCase(); return x === old || (x === name && byName(x) === file); };
        for (const [p, text] of [...vault]) {
            const next = text.replace(/\[\[([^\]|#]+)([^\]]*)\]\]/g, (m, t, rest) => (points(t) ? `[[${linktext}${rest}]]` : m));
            if (next !== text) put(p, next);
        }
        for (const map of [vault, disk]) { map.set(to, map.get(from)); map.delete(from); }
        for (const map of [seen, started]) if (map?.has(from)) { map.set(to, map.get(from)); map.delete(from); }
        files.delete(from);
        Object.assign(file, { path: to, name: to.split("/").pop(), basename: to.split("/").pop().replace(/\.md$/, ""), parent: folder(to.slice(0, to.lastIndexOf("/"))) });
        files.set(to, file);
        if (editing === from) editing = to;
    };
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
            on: (name, fn) => { const ref = { name, fn }; listeners.add(ref); return ref; },
            offref: (ref) => listeners.delete(ref),
            // Which notes link which, from what the cache has read
            get resolvedLinks() {
                const out = {};
                for (const p of vault.keys()) {
                    const links = {};
                    for (const l of parseCache(cacheText(p) ?? "").links) {
                        const f = byName(l.link.split("#")[0].trim());
                        if (f) links[f.path] = (links[f.path] ?? 0) + 1;
                    }
                    out[p] = links;
                }
                return out;
            },
        },
        fileManager: {
            renameFile: async (file, to) => {
                if (file.children) {
                    const from = file.path;
                    for (const k of [...vault.keys()].filter((p) => p.startsWith(`${from}/`))) moveNote(k, to + k.slice(from.length));
                } else moveNote(file.path, to);
            },
            processFrontMatter: async (file, fn) => {
                const text = disk.get(file.path);
                const before = parseCache(text).frontmatter ?? { tags: [] };
                const after = { ...before };
                fn(after);
                const ls = text.split("\n");
                if (ls[0] !== "---") ls.unshift("---", "---");
                const end = ls.indexOf("---", 1);
                for (const key of Object.keys(after)) {
                    if (key === "tags" || after[key] === before[key]) continue;
                    const at = ls.findIndex((l, i) => i < end && l.startsWith(`${key}:`));
                    // A date as Obsidian writes it, bare (OBS-229); anything else quoted, as a link must be
                    const line = /^\d{4}-\d{2}-\d{2}$/.test(after[key]) ? `${key}: ${after[key]}` : `${key}: "${after[key]}"`;
                    if (at === -1) ls.splice(ls.indexOf("---", 1), 0, line); else ls[at] = line;
                }
                put(file.path, ls.join("\n"));
                changed(file);
            },
        },
        vault: {
            getMarkdownFiles: () => [...vault.keys()].map(fileOf),
            getFileByPath: fileOf, getAbstractFileByPath: (p) => fileOf(p) ?? app.vault.getFolderByPath(p),
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
    // `plugins` as the scripts ask it; Templater stands in below, where the notes it makes are made
    const frontMatter = (text) => { const m = text.match(/^---\r?\n([\s\S]*?)\r?\n?---/); return m ? { exists: true, frontmatter: `${m[1]}\n` } : { exists: false, frontmatter: "" }; };
    const customJS = { obsidian: { MarkdownView: class {}, getAllTags: (cache) => (cache?.frontmatter?.tags ?? []).map((t) => `#${t}`), getLanguage: () => "en", Platform: { isDesktop: true }, getFrontMatterInfo: frontMatter, parseYaml: (y) => parseCache(`---\n${y.replace(/\r/g, "")}---\n`).frontmatter } };
    const context = vm.createContext({ app, customJS, window: { moment: momentOn(today) }, Notice: class { constructor(m) { notices.push(m); } }, setTimeout: () => 0, clearTimeout: () => {}, console: { ...console, error: () => {}, info: () => {} } });
    // `plant(name, text)` changes a script's text, to show a test catches a bug
    const make = (name, cls) => new (vm.runInContext(`${plant ? plant(name, src(name)) : src(name)}\n;${cls}`, context))();
    Object.assign(customJS, {
        DatePrompt: make("datePrompt", "DatePrompt"), JumpToDate: make("jumpToDate", "JumpToDate"), TimeReport: make("timeReport", "TimeReport"),
        AddTaskNote: make("addTaskNote", "AddTaskNote"), Schedule: make("schedule", "Schedule"), TaskIds: make("taskIds", "TaskIds"), DueDate: make("setDueDate", "DueDate"),
        AddProjectLink: make("addProjectLink", "AddProjectLink"), MoveToProject: make("moveToProject", "MoveToProject"),
        TaskChange: make("taskChange", "TaskChange"), Billing: make("billing", "Billing"), SyncArea: make("syncArea", "SyncArea"),
        CheckOff: make("checkOff", "CheckOff"),
        RefoldDailyNotes: { onLeave: async (f) => { left.push(f.path); } },
    });
    const ask = customJS.TaskChange.ask.bind(customJS.TaskChange);
    customJS.TaskChange.ask = async (weighed, ...rest) => {
        const days = (list) => [...new Set([...list].sort((a, b) => a.file.basename.localeCompare(b.file.basename)).map((l) => customJS.TaskChange.dayName(l.file)))].join(", ");
        covers = { lines: days(weighed.lines), time: days(weighed.days.map((d) => d.l)), stops: days(weighed.stops.map((d) => d.l)) };
        try { return await ask(weighed, ...rest); } finally { covers = null; }
    };
    // Templater's part: a task note or log made where the Task and Log templates would put it
    const made2 = (path, text) => { put(path, text); return fileOf(path); };
    customJS.AddTaskNote.createTaskNote = async (name, parent = null) => {
        // As the Task template names it: its dates and "!task" taken off and the ends trimmed, spaces left as they are
        const title = name.replaceAll(/[0-9]{4}-[0-9]{2}-[0-9]{2}/g, "").replace("!task", "").trim() || name;
        return made2(`${parent ? parent.parent.path : "Inbox"}/${title}.md`, `---\ntags: [task]\n${parent ? `parent: "[[${parent.basename}]]"\n` : ""}---\n`);
    };
    customJS.AddTaskNote.makeLog = async (name) => {
        if (app.metadataCache.getFirstLinkpathDest(name)) return;
        made2(`Inbox/${name}.md`, "---\ntags: [log]\n---\n");
    };
    let n = 0;
    customJS.TaskIds.random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    return {
        app, customJS, notices, left, tick,
        // Where a command last put the cursor (setCursor), or null
        placed: () => placed,
        notes: () => Object.fromEntries(vault),
        open(p, line, ch = null) { flush(); editing = p; cursor = line; cursorCh = ch; lines = (vault.get(p) ?? "").split("\n"); view.file = fileOf(p); },
        // Text selected on the cursor's line, as columns
        select(from, to) { selected = { from, to }; },
        lineOf: (p, text) => (vault.get(p) ?? "").split("\n").findIndex((l) => l.includes(text)),
        async schedule(date, unit = "day") {
            tick();
            let prompt = null;
            customJS.DatePrompt.open = (title, onPick, opts) => { prompt = { title, onPick, opts }; return {}; };
            await customJS.Schedule.invoke();
            if (prompt) await prompt.onPick(customJS.DatePrompt.result(date, unit), { close() {} });
            return prompt?.title ?? null;
        },
        // DueDate, the date box handing on `date` ("YYYY-MM-DD") and the whole pick awaited, the search after it
        // included. The date box's title, or null when it didn't open.
        async dueDate(date) {
            tick();
            let prompt = null;
            customJS.DatePrompt.open = (title, onPick) => { prompt = { title, onPick }; return {}; };
            await customJS.DueDate.invoke();
            if (prompt) await prompt.onPick(customJS.DatePrompt.result(date, "day"), { close() {} });
            return prompt?.title ?? null;
        },
        check: () => JSON.parse(JSON.stringify(checkAll())),
        // What the checks say, every line that disagrees with its own note, and the report's own checks (parents),
        // as the report lists them
        problems: () => JSON.parse(JSON.stringify([...checkAll().map((x) => x.rule), ...ownNotes(), ...parents()])),
        // What the question asked, as confirmMove was called, and what each menu was given
        asked, menus,
        // A command, answering its menu with `pick` (a path, or null for Esc) and its question with `answer`
        answering,
        async addProjectLink(pick, answer = "move") { tick(); answering(pick, answer); await customJS.AddProjectLink.invoke(); },
        // With no cursor placed (open's `ch`), it's in the task's text, as you'd run the command
        async addTaskNote(answer = "move", pick = null) { tick(); answering(pick, answer); cursorCh ??= customJS.AddTaskNote.afterCheckbox(lines[cursor]); await customJS.AddTaskNote.invoke(); },
        async moveToProject(pick, answer = "move", files = null) { tick(); answering(pick, answer); await customJS.MoveToProject.move(files ? files.map(fileOf) : [view.file]); },
        // CheckOff (OBS-232): the box on the cursor's line set to `mark` by your own edit (a click, ⌘⏎, Task
        // Status's picker, typing), then what CheckOff does. A [>] box about to become [ ] or [/] is held and
        // asked about, as CheckOff's click listener and edit filter do: the question answered with `answer`
        // (a button's text, or null for Esc) and Schedule's date prompt, if it opens, with `date`. `before(spec)`
        // runs while the question is up. Returns the question's spec, or null when none was asked.
        async box(mark, { answer = null, date = null, before = null } = {}) {
            tick();
            const C = customJS.CheckOff, text = lines[cursor], file = view.file;
            const at = text.match(/^\s*[-*+]\s+\[/)[0].length;
            const write = () => editor.replaceRange(mark, { line: cursor, ch: at }, { line: cursor, ch: at + 1 });
            if (C.constructor.markOf(text) === ">" && " /".includes(mark) && C.actsOn(file, (n) => lines[n], cursor)) {
                let spec = null, prompt = null;
                C.choose = async (s) => { spec = s; questions.push(s); await before?.(s); return answer; };
                customJS.DatePrompt.open = (title, onPick) => { prompt = { title, onPick }; return {}; };
                await C.ask({ file, line: cursor, text, editor, want: mark });
                if (prompt) { spec = { ...spec, dated: prompt.title }; if (date) await prompt.onPick(customJS.DatePrompt.result(date, "day"), { close() {} }); }
                return spec;
            }
            const line = cursor;
            write();
            await C.follow(file, { line, before: text, after: lines[line] });
            return null;
        },
        // A click on the cursor's line's box, as Obsidian toggles it: [ ] becomes [x], anything else [ ]
        async click(options = {}) { return this.box(customJS.CheckOff.constructor.markOf(lines[cursor]) === " " ? "x" : " ", options); },
        questions, origins,
        file: fileOf,
    };
    function ownNotes() {
        const tr = customJS.TimeReport, index = tr.appIndex();
        const notes = [...vault.keys()].filter((p) => customJS.TaskIds.inSystem(fileOf(p))).map((p) => ({ path: p, text: vault.get(p) }));
        return [...new Set(tr.ownNoteProblems(notes, index).map((p) => `${p.conflict.path}:${p.conflict.line}`))].map((at) => `own note ${at}`);
    }
    // The report's own checks (OBS-233) over the notes checkAll reads: every subtask's day line that names
    // another project than the task note or log it's a subtask of, which the commands keep together (Brian,
    // 2026-11-02); every task whose deadlines differ, which DueDate keeps the same; and every ⭕ at the end of
    // a task line outside the periodic notes, which no command writes since OBS-225
    function parents() {
        const tr = customJS.TimeReport, T = customJS.TaskIds.constructor, index = tr.appIndex();
        const notes = checked();
        return [
            ...tr.subtaskProjectProblems(notes, index, T).map((l) => `parent ${l.path}:${l.line + 1}`),
            ...tr.deadlineProblems(notes, index, T).map((t) => `deadline ${t.at[0].path}:${t.at[0].line + 1}`),
            ...tr.strayMarkProblems(notes, index).map((l) => `stray ${l.path}:${l.line + 1}`),
        ];
    }
    function answering(pick, answer) {
        const answers = [].concat(answer);
        customJS.AddTaskNote.pickHome = async (name, options = {}) => { menus.push({ name, options }); return pick ? fileOf(pick) : null; };
        customJS.AddTaskNote.confirmMove = async (note, from, to, words = {}) => {
            asked.push({ note: note?.basename ?? null, from: from?.basename ?? null, to: to?.basename ?? null, ...words, ...covers });
            return answers.length > 1 ? answers.shift() : answers[0];
        };
    }
    // Every task's lines over the notes the report's checks read (the system and Archive, OBS-208), as
    // the live text says (`vault`, not `disk`: the notes as you'd see them open, which is what must agree;
    // disk lags by design), projects read as the time report reads them
    function checked() {
        const T = customJS.TaskIds.constructor;
        const read = (p) => !p.startsWith("Config/") && (customJS.TaskIds.inSystem(fileOf(p)) || p.startsWith(T.ARCHIVE));
        return [...vault.keys()].filter(read).map((p) => ({ path: p, kind: customJS.TaskIds.kindOf(fileOf(p)), text: vault.get(p) }));
    }
    function checkAll() {
        const tr = customJS.TimeReport, T = customJS.TaskIds.constructor;
        const index = tr.appIndex();
        const notes = checked();
        return T.check(notes, {
            projectOf: (note, i, lines) => tr.lineProject(note, i, lines, index, false),
            compared: (note) => tr.comparedNote(note, index),
            resolve: (linkpath, from) => app.metadataCache.getFirstLinkpathDest(linkpath, from)?.path ?? null,
            ownNote: (text, from) => tr.ownNote(tr.lineLinks(tr.classify(text).body), from, index),
        });
    }
}
