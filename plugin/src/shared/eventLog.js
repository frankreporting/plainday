import { MarkdownView, moment, normalizePath, Notice, stringifyYaml } from "obsidian";
import { app, plainday } from "../host.js";

export default class EventLog {
    // Event logs, made in code (OBS-122), as the Log template made them before: a log is named with its day, spelled
    // the way the daily notes are named (OBS-300), and its event's title ("2026-09-17 Kestrel standup" in the demo,
    // "17-09-2026 Kestrel standup" where daily notes are named DD-MM-YYYY), filed in the `›logs` folder of the project
    // or area its event line's ⭕ or 🗃️ names (else the Inbox), and its event line in the daily note links it.
    // Plainday writes the properties its code reads, in one write (noteText); then the Log template, when it has
    // anything in it, adds its own.
    // - make(): the one maker, for Add note on an event line, New event log and CalNav (openLog)
    // - finish(): a note an event line's ⋯ links, made blank some other way (a click on the link), FinishLinkedLogs
    // - recordEvent() and eventTimes(): the event line and its times, moved here from the Log template's two
    //   Templater scripts as they were
    // The properties Plainday writes, whose values win over a template's (Settings.WRITES.log warns about a clash)
    static OWN = ["parent", "date", "time", "endTime", "who"];

    constructor() {
        // The logs being made now, by name: a second call for the same log gets the first one's, and FinishLinkedLogs
        // leaves these alone
        this.making = new Map();
    }

    // A log's name for `title` on `date` (YYYY-MM-DD): the day's name, as its daily note is named (OBS-300), a space,
    // and the title cleaned as AddTaskNote cleans a note's name
    nameFor(date, title) {
        return `${plainday.PeriodicNotes.where("day", date).name} ${plainday.AddTaskNote.fileName(title)}`;
    }

    // A log's day and title, read from its name: { date (YYYY-MM-DD), title }, or null when the name doesn't start
    // with a day's name, as the daily notes are named, a space and a title (OBS-300). The day is the part before the
    // first space that reads as one, so a day's name with spaces in it ("17 September 2026") reads too.
    dayOf(name) {
        name = String(name ?? "");
        const read = plainday.PeriodicNotes.reader();
        for (let at = name.indexOf(" "); at > 0; at = name.indexOf(" ", at + 1)) {
            const title = name.slice(at + 1);
            if (!title.trim()) return null;
            const period = read(name.slice(0, at));
            if (period?.unit === "day") return { date: period.date, title };
        }
        return null;
    }

    // Makes the log for `title` on `date` (YYYY-MM-DD) without opening it, or finds the one of that name: resolves to
    // { file, made }, or null when there's no title. `name` is the log's name when an event line already links one by
    // another name, and `time` the start to prefer when several lines have the title. The event line links the log
    // (recordEvent), and the log takes its times from it.
    async make({ date, title, name = null, time = "" }) {
        title = String(title ?? "").trim();
        name ??= this.nameFor(date, title);
        if (!plainday.AddTaskNote.fileName(title) || !name.trim()) {
            new Notice("No title to name the log");
            return null;
        }
        const there = app.metadataCache.getFirstLinkpathDest(name, "");
        if (there) return { file: there, made: false };
        if (!this.making.has(name)) {
            this.making.set(name, this.build({ date, title, name, time }).finally(() => this.making.delete(name)));
        }
        return this.making.get(name);
    }

    // A note an event line's ⋯ links, made blank just now some other way (FinishLinkedLogs): it becomes that log, filled
    // and filed as make() would make it. Returns "finished", or null when no event line links it or it isn't blank.
    async finish(file) {
        const named = file ? this.dayOf(file.basename) : null;
        if (!named || this.making.has(file.basename)) return null;
        const daily = app.vault.getFileByPath(plainday.Schedule.dailyNotePath(moment(named.date, "YYYY-MM-DD", true)));
        if (!daily) return null;
        const { outcome } = this.recordEvent(await this.textOf(daily), { log: file.basename, title: named.title });
        if (outcome !== "present" || (await app.vault.read(file)).trim() !== "") return null;
        // Templater's trigger looks 300 ms after a note appears, and Get Template would give this one the Empty Note
        plainday.PeriodicNotes.hold(file.path);
        const run = this.build({ date: named.date, title: named.title, name: file.basename, into: file });
        this.making.set(file.basename, run.finally(() => this.making.delete(file.basename)));
        return (await run) ? "finished" : null;
    }

    // For CalNav's Open Log Note (OBS-73's openLog, moved here from CalNav's script): the log of the event `title` on
    // `date`, at `start` (or all day), opened with the cursor in its body. The event's line is found as CalNav found it
    // (its title as the sync writes it, the same time first); a log it links is opened, or made under the name it
    // links; with no link, a log named for the day and title is opened, or made, and the line is linked. Returns
    // { status: "opened" | "created", name, path, linked, dailyNote } or { error }.
    async openLog({ date, title: rawTitle, start = null, allDay = false } = {}) {
        const sync = plainday.CalendarSync, tasks = plainday.AddTaskNote;
        const day = moment(date, "YYYY-MM-DD", true);
        if (!day.isValid()) return { error: `${date} isn't a date` };
        const title = sync.title({ title: rawTitle });
        const time = allDay ? "" : moment(start).format("h:mma");
        const dailyPath = plainday.Schedule.dailyNotePath(day);
        const daily = app.vault.getFileByPath(dailyPath);
        const hit = daily ? this.eventLineFor(await app.vault.read(daily), title, time, allDay) : null;
        let name = this.nameFor(date, title);
        if (hit?.link) {
            const linkpath = hit.link[1].split("#")[0].trim();
            const file = app.metadataCache.getFirstLinkpathDest(linkpath, dailyPath);
            if (file) return this.opened(file, "opened", { linked: true, dailyNote: true });
            name = linkpath.split("/").pop().replace(/\.md$/, "");
        }
        const existing = app.metadataCache.getFirstLinkpathDest(name, dailyPath);
        if (hit && !hit.link) {
            // The line links the log first, at its end before any ID, as Add note links it, so recording it finds it
            await app.vault.process(daily, (text) => {
                const lines = text.split("\n");
                if (lines[hit.i] !== hit.line) return text;
                lines[hit.i] = tasks.endWith(hit.line, `[[${name}|${tasks.constructor.NOTE_MARK}]]`);
                return lines.join("\n");
            });
        }
        if (existing) return this.opened(existing, "opened", { linked: !!hit, dailyNote: !!daily });
        const made = await this.make({ date, title, name, time });
        if (!made) return { error: `Couldn't make the log ${name}` };
        return this.opened(made.file, made.made ? "created" : "opened", { linked: !!hit, dailyNote: !!daily });
    }

    // The event line CalNav means, in a daily note's text: { i, line, link } (link, the log link ending the line, as a
    // match of CalendarSync.LOG_LINK, or null), or null. Its title as the sync writes it, exactly or but for case, the
    // one at `time` (or all day) first.
    eventLineFor(text, title, time, allDay) {
        const sync = plainday.CalendarSync;
        const LINE = /^(\s*[-*+]\s+\[<\]\s+)(?:\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s+)?(?:(all day|\d{1,2}:\d{2}\s?[ap]m)\t)?(.*)$/i;
        const norm = (t) => String(t ?? "").replace(/\s/g, "").toLowerCase();
        const rows = [];
        text.split("\n").forEach((line, i) => {
            const m = line.match(LINE);
            if (!m) return;
            const { rest, log } = sync.splitTail(m[3], true);
            if (!rest) return;
            const sameTime = allDay ? norm(m[2]) === "allday" || !m[2] : norm(m[2]) === norm(time);
            rows.push({ i, line, shown: sync.display(rest), link: log?.match(sync.constructor.LOG_LINK) ?? null, sameTime });
        });
        const exact = rows.filter((r) => r.shown === title);
        const pool = exact.length ? exact : rows.filter((r) => r.shown.toLowerCase() === title.toLowerCase());
        const hit = pool.find((r) => r.sameTime) ?? pool[0] ?? null;
        return hit && { i: hit.i, line: hit.line, link: hit.link };
    }

    // Opens `file` and puts the cursor at the end of its body, so you can start typing, then says what happened
    async opened(file, status, more = {}) {
        await this.open(file);
        return { status, name: file.basename, path: file.path, ...more };
    }

    async open(file) {
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source" }, eState: { focus: true } });
        const toBody = () => {
            const editor = app.workspace.activeEditor?.editor;
            if (!editor || app.workspace.getActiveFile() !== file) return;
            editor.focus();
            const last = editor.lastLine();
            editor.setCursor(last, editor.getLine(last).length);
        };
        toBody();
        // Obsidian can put the cursor in the title as the note opens
        window.setTimeout(toBody, 300);
    }

    // The daily note's text: its editor's when it's open in the active pane (Add note just linked the line there),
    // else what's on disk
    async textOf(daily) {
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        return view?.file === daily && view.editor ? view.editor.getValue() : app.vault.cachedRead(daily);
    }

    // The log `name`: where its line says, its line recorded, its properties, then the Log template. `into` is a blank
    // note to fill and file rather than a new one. Resolves to { file, made: true }, or null.
    async build({ date, title, name, time = "", into = null }) {
        const tasks = plainday.AddTaskNote, schedule = plainday.Schedule;
        const day = moment(date, "YYYY-MM-DD", true);
        const dailyPath = day.isValid() ? schedule.dailyNotePath(day) : null;
        let daily = dailyPath ? app.vault.getFileByPath(dailyPath) : null;
        const dailyText = daily ? await this.textOf(daily) : "";

        // Where it goes (OBS-57): the project or area its line's ⭕ or 🗃️ names, finished or not, else the Inbox,
        // where it waits to be filed (OBS-55)
        const line = daily ? this.recordEvent(dailyText, { log: name, title, time }).line : null;
        const home = line ? tasks.lineHomeIn(line, dailyPath) : null;
        const folder = home ? tasks.logsFolderIn(home.parent.path) : tasks.stagingFolder();
        let parent = "";
        if (home) {
            const alias = [].concat(app.metadataCache.getFileCache(home)?.frontmatter?.aliases ?? [])[0] || home.basename;
            parent = `[[${home.basename}|${alias}]]`;
        }
        if (folder && folder !== "/") await tasks.makeFolder(folder);

        // Its line in the daily note, then its times from that line
        let times = null;
        if (!day.isValid()) {
            new Notice(`${date} isn't a date, so this log wasn't recorded in a daily note`);
        } else if (daily && plainday.TimeReport?.oldMarkLines?.([{ text: dailyText }])) {
            // Until the one-time conversion has run, a 🗒️ link isn't read as a log's (OBS-208), so the line that
            // already links this log wouldn't be found, and a second one would be added
            new Notice(`${dailyPath} still has lines ending in a 🗒️ or 🔗 link, so this log wasn't recorded there: run the one-time conversion first (see the manual's Links at the end of a line)`, 0);
        } else {
            try {
                times = await this.recordLine({ daily, dailyPath, name, title, time, home });
            } catch (e) {
                console.error("EventLog: couldn't record the log in its daily note", e);
                new Notice("Couldn't record this log in its daily note — check the console");
            }
        }

        // Its alias: the day as Plainday writes dates, then the log's name without its day
        const own = { alias: `${day.isValid() ? day.format("M/D/YY") : date} ${this.dayOf(name)?.title ?? name}`, parent, date, time: times?.time ?? "", endTime: times?.endTime ?? "", who: "" };
        return this.write({ name, folder, own, into });
    }

    // The log's line: recorded in its daily note (made first when it isn't there) as the Log template recorded it.
    // Resolves to the log's times from the line, or null.
    async recordLine({ daily, dailyPath, name, title, time, home }) {
        const tasks = plainday.AddTaskNote, sync = plainday.CalendarSync;
        const fresh = !daily;
        daily ??= await plainday.Schedule.ensureDailyNote(dailyPath);
        // The line names the project or area the log was filed for, in place of its own ⭕ links, before its ⋯ (a
        // project note that isn't its folder's own note can't hold the log, and the line still names it, as
        // AddProjectLink does). A log left in the Inbox leaves the line's links as they are.
        const homeLink = home ? tasks.homeLink(home, tasks.linktextFor(home, app.vault.getMarkdownFiles().map((f) => f.path))) : null;
        const record = (text) => this.recordEvent(text, { log: name, title, time, home: homeLink }, sync, fresh);
        // A line that's there already, naming the log's project, means nothing to write. Open in the editor (Add note
        // made the log from its line), only the lines that change are written there, so nothing you type is
        // overwritten; otherwise the note is written in one step, and its fold snapshot taken again, as MoveToProject
        // does (RefoldOnOpen would read the changed line as new and fold it)
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        const editor = view?.file === daily ? view.editor : null;
        let text = editor ? editor.getValue() : await app.vault.cachedRead(daily);
        const recorded = record(text).text;
        const [was, now] = [text.split("\n"), recorded.split("\n")];
        if (recorded === text) {
            // Nothing to write
        } else if (editor && was.length === now.length) {
            now.forEach((l, i) => { if (l !== was[i]) editor.replaceRange(l, { line: i, ch: 0 }, { line: i, ch: was[i].length }); });
            text = recorded;
        } else {
            await app.vault.process(daily, (t) => (text = record(t).text));
            try { await plainday.RefoldDailyNotes?.onLeave?.(daily); } catch (e) { console.error("EventLog: couldn't snapshot the folds", e); }
        }
        return this.eventTimes(text, name);
    }

    // The log's note: made at `folder/name` with Plainday's properties and the Log template's text in one write, or
    // `into` filled and moved there; then the Log template through Templater, when it's on. Templater's trigger is
    // kept off it from before it's there, so Get Template never runs on it.
    async write({ name, folder, own, into }) {
        const notes = plainday.PeriodicNotes, tasks = plainday.AddTaskNote;
        const path = normalizePath(folder && folder !== "/" ? `${folder}/${name}.md` : `${name}.md`);
        const tpl = app.vault.getFileByPath(tasks.templatePath("log"));
        const tplText = tpl ? await app.vault.read(tpl) : "";
        const templater = tplText.trim() ? notes.templater() : null;
        let text = this.noteText(own), unused = false;
        if (tplText.trim() && !templater) {
            if (tplText.includes("<%")) unused = true;
            else text = this.withTemplate(text, notes.fill(tplText, { name, start: own.date }), own);
        }
        let file = into, top = null;
        if (into) {
            // Written on disk, not through its editor: the move below sets SyncArea going, which writes the note's
            // `parent` on disk, and an editor's unsaved text would then be lost. It's blank, so nothing typed is.
            notes.hold(into.path);
            top = notes.cursorAtTopOf(into);
            await app.vault.process(into, (now) => text + now.replace(/^\s+/, ""));
        } else {
            notes.hold(path);
            try {
                file = await app.vault.create(path, text);
            } catch (e) {
                const other = app.metadataCache.getFirstLinkpathDest(name, "");
                if (other) return { file: other, made: false };
                console.error("EventLog: couldn't make the log", e);
                new Notice(`Couldn't make the log "${name}"`);
                return null;
            }
        }
        if (templater) await this.withTemplater(templater, tpl, file, own);
        if (unused) new Notice(`${tpl.basename} holds Templater code and Templater is off, so the new log was made without it.`);
        // A note made elsewhere goes where the log belongs, unless a note is there already
        if (into && file.path !== path && !app.vault.getFileByPath(path)) {
            notes.hold(path);
            await app.fileManager.renameFile(file, path);
        }
        // The editor shows what's on disk a moment later; a cursor still at its top goes below the properties
        if (top) window.setTimeout(() => notes.cursorBelowProperties(top), 100);
        return { file, made: true };
    }

    // The Log template run on the log through Templater, which adds the template's properties to Plainday's and its
    // text after them; then Plainday's values again where the template set its own, its alias first and `log` among
    // the tags; then the template's `id` first
    async withTemplater(templater, tpl, file, own) {
        const notes = plainday.PeriodicNotes;
        await templater.write_template_to_file(tpl, file);
        // Templater lets go of the note when it's done; the trigger mustn't take it then
        notes.hold(file.path);
        const front = notes.parts(await app.vault.read(file)).props ?? {};
        const same = (key) => String(front[key] ?? "") === own[key];
        const aliases = [].concat(front.aliases ?? []), tags = [].concat(front.tags ?? []);
        const tagged = tags.some((t) => String(t).toLowerCase() === "log");
        if (!EventLog.OWN.every(same) || aliases[0] !== own.alias || !tagged) {
            await app.fileManager.processFrontMatter(file, (f) => {
                for (const key of EventLog.OWN) if (String(f[key] ?? "") !== own[key]) f[key] = own[key] || null;
                const others = [].concat(f.aliases ?? []).filter((a) => a !== null && a !== "" && a !== own.alias);
                f.aliases = [own.alias, ...others];
                const more = [].concat(f.tags ?? []).filter((t) => t !== null && t !== "");
                if (!more.some((t) => String(t).toLowerCase() === "log")) f.tags = ["log", ...more];
            });
        }
        // Templater adds a template's new properties last; its `id` goes first, as in every note (OBS-317)
        await plainday.ProjectNotes.idFirst(file);
    }

    // A new log's text, `own` its alias, `parent` (a link, or ""), `date`, `time`, `endTime` and `who`: a template's
    // `id` first, as in every note (OBS-317), then Plainday's properties in the order the Log template wrote them,
    // then `extra` (a template's other properties), then `body`
    noteText(own, { aliases = [own.alias], tags = ["log"], extra = {}, body = "" } = {}) {
        const scalar = (v) => plainday.PeriodicNotes.scalar(String(v));
        // A time as the Log template and the calendar sync write it, bare: `9:00am` reads back as that text
        const bare = (key) => (own[key] ? `${key}: ${/^\d{1,2}:\d{2}[ap]m$/i.test(own[key]) ? own[key] : scalar(own[key])}` : `${key}:`);
        const { id, ...others } = extra;
        const lines = [
            "aliases:", ...aliases.map((a) => `  - ${scalar(a)}`), "tags:", ...tags.map((t) => `  - ${scalar(t)}`),
            own.parent ? `parent: ${JSON.stringify(own.parent)}` : "parent:", bare("date"), bare("time"), bare("endTime"), bare("who"),
        ];
        const first = "id" in extra ? stringifyYaml({ id }) : "";
        const more = Object.keys(others).length ? stringifyYaml(others) : "";
        return `---\n${first}${lines.join("\n")}\n${more}---\n${body}`;
    }

    // `text` with a template's text, `filled`, added, without Templater: the properties combined as
    // PeriodicNotes.merge combines them, Plainday's own kept, its alias first and `log` among the tags
    withTemplate(text, filled, own) {
        const notes = plainday.PeriodicNotes;
        const { props, body } = notes.parts(notes.merge(text, filled));
        const extra = { ...props };
        const list = (key, first) => [...new Set([first, ...[].concat(extra[key] ?? []).filter((v) => v !== null && v !== "").map(String)])];
        const aliases = list("aliases", own.alias), tags = list("tags", "log");
        for (const key of ["aliases", "tags", ...EventLog.OWN]) delete extra[key];
        return this.noteText(own, { aliases, tags, extra, body });
    }

    // ---------------------------------------------------------------- the event line (the Log template's recordEvent)

    // Records a new log in its daily note's text (OBS-10): `log` is the note's name ("2026-09-16 Planning"), `title` the
    // title without the date, and `time` (optional) the start to prefer when several lines share the title. `sync` is
    // the calendar sync, whose line shape, matching and sort order this borrows rather than copies. `home` (optional)
    // is the ⭕ or 🗃️ link for the project or area the log is filed in: the event line's own ⭕ and 🗃️ links give way
    // to it, so the line and its log agree on where the event's time counts (OBS-90). Every note link ends its line,
    // so the log's goes after the line's ⭕.
    // Returns { text, outcome, line }, where `line` is the event line as it was before this call (the one found present
    // or linked, so the caller can read its ⭕ links), or null, and the outcome is one of:
    // - "present":  an event line already links the log (the log was made from it), so nothing changes but its ⭕: with
    //               its note link at the end, `Title [[log|⋯]]` (or ↗, OBS-208), or with its title wrapped in the link,
    //               the way lines were written before OBS-57 (any checklist line whose whole title is the link). A link
    //               to the log elsewhere (a task's ⋯, a mention in prose you clicked to make the note) isn't its line.
    // - "linked":   the [<] event line whose title is the log's title, timed or not, gets ` [[log|⋯]]` at the end, after
    //               the title, its marks and any ⭕, keeping the lines under it. Exact title first, then exact but for
    //               case, else the one line the title is a prefix of, as the sync's own adoption goes. A line that
    //               already links a log, or has a link in its title, is never taken.
    // - "inserted": no such line, so `- [<] title [[home|⭕]] [[log|⋯]]` is added (without the ⭕ when there's no
    //               `home`). A log with no time can't sort among the timed events, so it goes after them, above the
    //               tasks. In a note just created (`fresh`, or text that still opens with a template's `<%`), it goes
    //               at the end.
    // - "skipped":  no title to record
    // The sync adopts an inserted line when the event reaches the calendar, and gives it its time.
    // A checklist line: its lead, marker, the date link a forwarded event carries, its start (all day or a time, before
    // the sync's tab or, on a line typed by hand, a space) and the rest
    static LINE = /^(\s*[-*+]\s+\[(.)\]\s+)(?:\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s+)?(?:(all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+)?(.*)$/i;
    // An event line in the form used before August 2025: no bullet, its time first (OBS-193), and the rest
    static OLD_LINE = /^(?:all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+(.*)$/i;
    // A ⭕ project or 🗃️ area link, as the sync reads them (a phone may add or drop the U+FE0F)
    static HOME_LINK = /\[\[[^[\]|]+\|\s*(?:⭕|🗃)️?\s*\]\]/gu;
    // A note link
    static NOTE_LINK = /\[\[[^[\]|]+\|\s*(?:⋯|↗️?)\s*\]\]/u;
    // One item of the run that ends a line: a ⋯ or ↗, 🚩, ⭕ or 🗃️ link, or the ℹ️ or 🆓 mark (AddTaskNote.TRAIL_ITEM)
    static TRAIL_ITEM = /(?:\[\[[^\]|]+\|\s*(?:🚩️?\s*\d{1,2}\/\d{1,2}|⋯|↗️?|⭕️?|🗃️?)\s*\]\]|(?:ℹ|🆓)️?)$/u;
    // A block ID ending a line, which stays last
    static BLOCK_ID = /\s+\^[A-Za-z0-9-]+$/;

    // The item of the run that ends `text`, with the spaces before it, or null: an ℹ️ or 🆓 only after a space or a
    // tab, found here since older iPhones can't run a lookbehind (AddTaskNote.trailItem)
    static trailItem(text) {
        const item = text.match(EventLog.TRAIL_ITEM);
        if (!item || (text[item.index] !== "[" && !/\s/.test(text[item.index - 1] ?? ""))) return null;
        while (text[item.index - 1] === " ") item.index--;
        item[0] = text.slice(item.index);
        return item;
    }

    recordEvent(text, { log, title, time = "", home = null }, sync = plainday.CalendarSync, fresh = false) {
        text = String(text ?? "");
        if (!title) return { text, outcome: "skipped", line: null };
        const lines = text.split("\n");
        const { LOG_LINK, NOTE_MARK } = sync.constructor;
        const logOf = (link) => link.match(/^\[\[([^[\]|]+)/)?.[1].split("#")[0].trim().split("/").pop().replace(/\.md$/, "");
        const normal = (t) => String(t ?? "").replace(/\s/g, "").toLowerCase();

        const wanted = normal(time);
        const candidates = [];
        for (const [i, line] of lines.entries()) {
            const match = line.match(EventLog.LINE);
            // An event line in the old form is only ever the log's when it links it, as Add note links one
            const old = match ? null : line.match(EventLog.OLD_LINE);
            if (!match && !old) continue;
            // A block ID at the end (` ^mtg1`) isn't part of the title or the links before it
            const { rest, log: linked } = sync.splitTail((match ? match[4] : old[1]).replace(EventLog.BLOCK_ID, ""), true);
            const event = !match || match[2] === "<" || !!match[3];
            if ((rest.match(LOG_LINK) && logOf(rest) === log) || (linked && event && logOf(linked) === log)) {
                const homed = this.homeIn(line, home);
                if (homed === line) return { text, outcome: "present", line };
                lines[i] = homed;
                return { text: lines.join("\n"), outcome: "present", line };
            }
            if (!match || match[2] !== "<" || !rest || rest.includes("[[") || linked) continue;
            if (wanted && (!match[3] || normal(match[3]) !== wanted)) continue;
            candidates.push({ i, rest, at: line.length - match[4].length + match[4].indexOf(rest) });
        }
        const lower = title.toLowerCase();
        let found = candidates.find((c) => c.rest === title) ?? candidates.find((c) => c.rest.toLowerCase() === lower);
        if (!found) {
            // A prefix match only when one line could possibly be meant, as the sync adopts
            const near = candidates.filter((c) => c.rest.startsWith(title));
            if (new Set(near.map((c) => lines[c.i])).size === 1) found = near[0];
        }
        const link = `[[${log}|${NOTE_MARK}]]`;
        if (found) {
            // At the end: after the title, its ℹ️ or 🆓, and any ⭕
            const line = lines[found.i];
            const bare = line.replace(/\s+$/, "");
            const block = bare.match(EventLog.BLOCK_ID)?.[0] ?? "";
            lines[found.i] = this.homeIn(`${bare.slice(0, bare.length - block.length)} ${link}${block}`, home);
            return { text: lines.join("\n"), outcome: "linked", line };
        }

        const block = [`- [<] ${title}${home ? ` ${home}` : ""} ${link}`];
        if (fresh || /^\s*<%/.test(text)) {
            const body = text.replace(/\s+$/, "");
            return { text: `${body ? body + "\n" : ""}${block[0]}\n`, outcome: "inserted", line: null };
        }
        return { text: sync.insert(lines, block), outcome: "inserted", line: null };
    }

    // `line` with `home` as its one ⭕ or 🗃️, before the first note link in the run that ends it (as AddTaskNote.withHome
    // puts it); unchanged with no `home`, or when it already reads that way
    homeIn(line, home) {
        if (!home) return line;
        let bare = line.replace(/\s+$/, "");
        const block = bare.match(EventLog.BLOCK_ID)?.[0] ?? "";
        bare = bare.slice(0, bare.length - block.length);
        // Taken off with one space beside each, keeping a space where two words would touch (as
        // AddTaskNote.withoutLinks does), so `Review [[Old|⭕]]🆓` doesn't become `Review🆓`
        for (const l of [...bare.matchAll(EventLog.HOME_LINK)].map((m) => m[0])) {
            const at = bare.lastIndexOf(l);
            let from = at, to = at + l.length;
            if (bare[from - 1] === " ") from--;
            else if (bare[to] === " ") to++;
            const gap = from > 0 && to < bare.length && !/[\s([{]/.test(bare[from - 1]) && !/[\s,.;:!?)\]}]/.test(bare[to]) ? " " : "";
            bare = bare.slice(0, from) + gap + bare.slice(to);
        }
        bare = bare.replace(/\s+$/, "");
        let at = bare.length, before = null;
        for (let item; (item = EventLog.trailItem(bare.slice(0, at)));) {
            at = item.index;
            if (EventLog.NOTE_LINK.test(item[0])) before = at;
        }
        const out = before === null ? `${bare} ${home}` : `${bare.slice(0, before).replace(/ +$/, "")} ${home} ${bare.slice(before).trim()}`;
        return out + block === line.replace(/\s+$/, "") ? line : out + block;
    }

    // ---------------------------------------------------------------- its times (the Log template's eventTimes)

    // Start and end time of the event a log was made from: the daily note line with a time that links to the log, e.g.
    //     - [<] 1:30pm⇥Intro call with Imogen Fenwick [[2026-09-09 Intro call with Imogen Fenwick|⋯]]
    //     ⇥- 1:40pm
    // (or, from before OBS-57, `1:30pm⇥[[2026-09-09 Intro call with Imogen Fenwick|…]]`) gives
    // { time: "1:30pm", endTime: "1:40pm" }. The line under it is the calendar sync's end time, or a time entry
    // ("1:30pm - 2:15pm") once you've edited it, whose last time is the end. The start is followed by the sync's tab, or
    // by spaces on a line typed by hand, as Add note reads it. Older daily notes have no end line, so endTime can be "".
    // Null when no line with a time links to the log: all-day events have no time, so they don't count.
    eventTimes(text, logName) {
        const TIME = /\d{1,2}:\d{2}\s?[ap]m/i;
        const normal = (t) => t.replace(/\s/g, "").toLowerCase();
        const lines = String(text ?? "").split("\n");
        const escaped = logName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const link = new RegExp(`\\[\\[${escaped}(?:\\.md)?(?:[|#\\]])`);
        for (let i = 0; i < lines.length; i++) {
            if (!link.test(lines[i])) continue;
            const start = lines[i].match(new RegExp(`^\\s*(?:[-*+]\\s+(?:\\[.\\]\\s+)?)?(${TIME.source})[\\t ]+`, "i"));
            if (!start) continue;
            const end = (lines[i + 1] ?? "").match(new RegExp(`^\\s+[-*+]\\s+(${TIME.source})(?:\\s*[-–—]\\s*(${TIME.source}))?`, "i"));
            return { time: normal(start[1]), endTime: end ? normal(end[2] ?? end[1]) : "" };
        }
        return null;
    }
}
