class TaskChange {
    // A project change (rules 8 to 12, OBS-225): the edit you'd make by hand, on every copy a command can
    // find. Every command that changes a line's ⭕ or 🗃️, or moves a note into another project, goes through
    // here, so the one question and the one refusal can't be skipped:
    //   find    what a change covers, from a line or from a note;
    //   weigh   what it would do, read before anything is written;
    //   ask     the one question, when a note leaves a project or counted time moves;
    //   billed  the one refusal: time on a sent or paid invoice leaving the project that billed it;
    //   write   the note first, then each line, read again, so a failure leaves a disagreement the report
    //           lists, and running again finishes.
    // run does all of it. What a line reads is TimeReport.resolve's to say; nothing here works it out again.

    // Until Obsidian has indexed the vault at startup, a task's other lines can't be found
    ready() {
        if (app.metadataCache.initialized !== false) return true;
        new Notice("Obsidian is still indexing the vault; try again in a moment");
        return false;
    }

    // Where a line's note puts it: "periodic", "home" (a project's or area's own note) or "other"
    placeOf(file) {
        if (customJS.TaskIds.kindOf(file) !== "other") return "periodic";
        return customJS.MoveToProject.isFolderNote(file) ? "home" : "other";
    }

    // Whether a change moves `note` when a line's ⋯ links it: a task note, log or plain note in the system.
    // A project or area note moves only by MoveToProject, as its folder (rule 8).
    ours(note) {
        const tasks = customJS.TaskIds;
        // A note in a folder of its own name that the cache doesn't know yet may be a project made a moment ago
        if (!app.metadataCache.getFileCache(note) && note.parent?.name === note.basename) return false;
        return tasks.inSystem(note) && tasks.kindOf(note) === "other" && !customJS.MoveToProject.isFolderNote(note) && !customJS.MoveToProject.billingNote(note);
    }

    // A note's lines as they are now, once per command: { raw, visible, hidden }, `visible` as Obsidian shows
    // them, so a code block or a comment is no line of a task
    async shown(file, memo) {
        if (!memo.has(file.path)) {
            const raw = (await customJS.TaskIds.readNow(file)).split("\n").map((l) => l.replace(/\r$/, ""));
            const { visible, hidden } = customJS.TimeReport.scan(raw);
            memo.set(file.path, { raw, visible, hidden });
        }
        return memo.get(file.path);
    }

    // The notes a line's ⋯ links, or the log its title is wrapped in, in the order they're written
    linked(text, from) {
        const tr = customJS.TimeReport;
        const links = tr.lineLinks(tr.classify(text).body);
        return [...links.notes, ...(links.title ? [links.title] : [])]
            .map((l) => app.metadataCache.getFirstLinkpathDest(l.target, from)).filter(Boolean);
    }

    // The top-level lines in the system whose ⋯ links `note`, or whose title is wrapped in a link to it:
    // [{ file, at }], through its backlinks, and every note the cache may be behind on. With `self`, a line in
    // `note` itself that links it counts too (DueDate's search, OBS-229).
    async linking(note, memo, { self = false } = {}) {
        const tasks = customJS.TaskIds, T = tasks.constructor, tr = customJS.TimeReport, helper = customJS.AddTaskNote;
        const files = new Map(customJS.MoveToProject.linkingNotes(note).map((f) => [f.path, f]));
        for (const f of tasks.nowFiles()) files.set(f.path, f);
        if (self) files.set(note.path, note);
        const out = [];
        for (const file of files.values()) {
            if (tasks.ignored(file) || (file.path === note.path && !self)) continue;
            const { visible, hidden } = await this.shown(file, memo);
            visible.forEach((text, at) => {
                if (hidden[at] || !text.includes("[[") || !(T.CHECKBOX.test(text) || tr.eventKind(text)) || !T.isTop(visible, at)) return;
                if (this.linked(text, file.path).some((n) => helper.isSameNote(n, note))) out.push({ file, at });
            });
        }
        return out;
    }

    // Whether `note` is a parent: a task note or a log in the system, whose subtasks (its follow-ups, for a log)
    // share its project (Brian, 2026-11-02). A plain note, a project's or area's own note and a periodic note
    // aren't. Read from its own text when the cache doesn't know it yet, as for a note made a moment ago.
    async holds(note, memo) {
        if (!this.ours(note)) return false;
        const helper = customJS.AddTaskNote;
        if (helper.isLogsFolderName(note.parent?.name)) return true;
        const cache = app.metadataCache.getFileCache(note);
        const tags = cache ? helper.tagsOf(cache) : TaskChange.frontTags((await this.shown(note, memo)).raw);
        return tags.includes("task") || tags.includes("log");
    }

    // Whether `note` is a task note: tagged #task, and not a log (tagged #log, or in a `›logs` folder); read from
    // its own text when the cache doesn't know it yet. Wherever it is: the caller asks whether it's in the system.
    async isTaskNote(note, memo = new Map()) {
        const helper = customJS.AddTaskNote;
        if (note?.extension !== "md" || helper.isLogsFolderName(note.parent?.name)) return false;
        const cache = app.metadataCache.getFileCache(note);
        const tags = cache ? helper.tagsOf(cache) : TaskChange.frontTags((await this.shown(note, memo)).raw);
        return tags.includes("task") && !tags.includes("log");
    }

    // The tags a note's frontmatter gives, lowercased and without #: `tags:` (or `tag:`) as a list, inline
    // or one item a line, or as words
    static frontTags(raw) {
        if (raw[0]?.trim() !== "---") return [];
        const end = raw.findIndex((l, i) => i > 0 && l.trim() === "---");
        const fm = raw.slice(1, end === -1 ? 0 : end);
        const at = fm.findIndex((l) => /^tags?:/i.test(l));
        if (at === -1) return [];
        const value = fm[at].replace(/^tags?:/i, "").trim();
        const items = value ? value.replace(/^\[|\]$/g, "").split(/[,\s]+/)
            : fm.slice(at + 1).filter((l, i, all) => all.slice(0, i + 1).every((x) => /^\s*-\s/.test(x))).map((l) => l.replace(/^\s*-\s*/, ""));
        return items.map((t) => t.trim().replace(/^["']|["']$/g, "").replace(/^#/, "").toLowerCase()).filter(Boolean);
    }

    // A note's subtasks: its top-level checklist lines, as shown
    subtasks(visible, hidden) {
        const T = customJS.TaskIds.constructor;
        return visible.map((text, at) => at).filter((at) => !hidden[at] && T.CHECKBOX.test(visible[at]) && T.isTop(visible, at));
    }

    // What a change covers: a task and everything under it share one project (Brian, 2026-11-02, replacing
    // rule 9's "nothing further moves"). { notes: the notes that move with it, stays: own notes it doesn't move,
    // said so, lines: [{ file, at, raw, seen, task }], own: the notes the start's task's lines link, null from a
    // note }. `task`: the line is one of the start's task's, the lines AddTaskNote and DueDate write. A note that
    // moves and isn't the start's own is a parent it sits under, which the question names as one.
    //   The start's task: from a line ({ file, at }), its lines by ID and by ⋯, with every line that links the
    //   same note (`note` too, AddTaskNote's for a line with no ⋯ yet), until nothing new turns up. From a note
    //   ({ note }), the note.
    //   Then everything tied to it, until nothing new turns up: the note a line's ⋯ (or wrapped title) links,
    //   in the system, with every line that links it; the task note or log a line sits in, its parent, with
    //   every line that links it; and each task in a note that moves, with its lines by ID.
    //   Nothing else ties: a ↗ alone, a link in a line's text, a nested line, or a plain, project or periodic
    //   note as a parent. A note in Archive or outside the system, or an invoice or timesheet, never moves.
    //   With `family: false`, it stops at the start's task: its lines, `own` and `stays` are all DueDate reads,
    //   since a deadline is the task's alone and a subtask keeps its own (OBS-229). Its lines then include
    //   those whose ⋯ links a task note no change moves (in Archive or outside the system), which share that
    //   deadline though they can't share a project, and they don't depend on which line it starts from.
    async find(start, { note = null, family = true } = {}) {
        const tasks = customJS.TaskIds, T = tasks.constructor, mover = customJS.MoveToProject;
        // Every task ID's lines, one pass over the cache, made the first time a line has an ID: a line with none
        // (a task of its own) costs nothing here
        let ids = null;
        const memo = new Map();
        const found = { notes: [], stays: [], lines: [], own: start.note ? null : [] };
        const held = new Set(), idsDone = new Set(), queued = new Set(), queue = [];
        // Without the family, the notes whose linking lines were walked: `queued` also holds the notes a line sits in
        const walked = new Set();
        const addNote = (n) => {
            if (!found.notes.includes(n)) found.notes.push(n);
            if (!queued.has(n)) { queued.add(n); queue.push(n); }
        };
        const walk = async (seeds, task) => {
            const todo = [...seeds];
            while (todo.length) {
                const { file, at } = todo.pop();
                if (held.has(`${file.path}:${at}`)) continue;
                held.add(`${file.path}:${at}`);
                const { raw, visible, hidden } = await this.shown(file, memo);
                if (hidden[at] || visible[at] === undefined) continue;
                found.lines.push({ file, at, raw: raw[at], seen: visible[at], task, targets: this.targetsOf(raw[at], file.path) });
                const id = T.idOf(visible[at])?.toLowerCase();
                if (id && !idsDone.has(id)) {
                    idsDone.add(id);
                    for (const l of (await tasks.gatherMany([id], ids ??= tasks.map())).get(id) ?? []) todo.push({ file: l.file, at: l.line });
                }
                for (const own of this.linked(visible[at], file.path)) {
                    if (!this.ours(own)) {
                        if ((!tasks.inSystem(own) || mover.billingNote(own)) && !found.stays.includes(own)) found.stays.push(own);
                        if (!family && task && !tasks.inSystem(own) && !walked.has(own) && await this.isTaskNote(own, memo)) {
                            walked.add(own);
                            todo.push(...await this.linking(own, memo, { self: true }));
                        }
                        continue;
                    }
                    // The start's own note: the lines that link it are the start's task's lines
                    if (task && !family && !walked.has(own)) {
                        walked.add(own);
                        todo.push(...await this.linking(own, memo, { self: true }));
                    } else if (task && family && !queued.has(own)) todo.push(...await this.linking(own, memo));
                    if (task && !found.own.includes(own)) found.own.push(own);
                    addNote(own);
                }
                if (await this.holds(file, memo)) addNote(file);
            }
        };
        if (start.note) addNote(start.note);
        else {
            await walk([{ file: start.file, at: start.at }], true);
            if (note && this.ours(note) && !queued.has(note)) {
                await walk(await this.linking(note, memo), true);
                addNote(note);
            }
            if (note && !found.own.includes(note)) found.own.push(note);
        }
        if (!family) return found;
        while (queue.length) {
            const n = queue.shift();
            // A note that moves takes its tasks along, a plain note's too; only a task note or log is a parent
            const seeds = await this.linking(n, memo);
            const { visible, hidden } = await this.shown(n, memo);
            for (const at of this.subtasks(visible, hidden)) seeds.push({ file: n, at });
            await walk(seeds, false);
        }
        return found;
    }

    // The lines of `lines` a change would leave disagreeing with themselves (rule 4): a line in a periodic note
    // whose ⭕ (`home`'s, once written, or else its own) names another project than one of its own notes is
    // filed in, a note that isn't among `moving` (which go to `home`). `adds`: the note AddTaskNote links on the
    // task's lines. The change still happens: the question says their time stops counting, and a notice says
    // so afterwards (Brian, 2026-11-02: warn after, never block). [{ l, note, filed }], and with `inbox` and
    // `project`, a line that names a project while its own note waits in the Inbox: its time still counts,
    // and the report lists it until the note is filed (rule 15).
    breaking(lines, { home = null, moving = [], adds = null } = {}) {
        const tr = customJS.TimeReport, T = customJS.TaskIds.constructor, index = tr.appIndex();
        const movingPaths = new Set(moving.map((n) => n.path));
        const out = [];
        for (const l of lines) {
            if (this.placeOf(l.file) !== "periodic") continue;
            const project = home ? home.path : tr.resolve((n) => (n === l.at ? l.seen : ""), l.at, l.file.path, index, l.at).project;
            if (!project) continue;
            // Its own notes as the report reads them, and the one AddTaskNote adds to a line with none
            const own = tr.ownNote(tr.lineLinks(tr.classify(l.seen).body), l.file.path, index);
            if (adds && l.task && !T.hasOwnNote(l.seen) && (index.inSystem(adds.path) || tr.isArchived(adds.path))) own.push(adds.path);
            const staying = own.filter((path) => !movingPaths.has(path));
            const note = (path) => app.vault.getFileByPath(path) ?? { path, basename: tr.basename(path) };
            const against = staying.map((path) => ({ path, filed: tr.projectOfNote(path, index) })).find(({ filed }) => filed && filed !== project);
            const waiting = against ? null : staying.find((path) => !tr.projectOfNote(path, index) && index.inInbox(path));
            if (against) out.push({ l, note: note(against.path), filed: against.filed });
            else if (waiting) out.push({ l, note: note(waiting), filed: null, inbox: true, project });
        }
        return out;
    }

    // The notices for `breaking`'s lines, none when there are none
    warned(breaks) {
        const out = [], name = (path) => customJS.TimeReport.basename(path);
        const days = (list) => [...new Set([...list].sort((a, b) => a.l.file.basename.localeCompare(b.l.file.basename)).map((b) => this.dayName(b.l.file)))].join(", ");
        const against = breaks.filter((b) => !b.inbox), waiting = breaks.filter((b) => b.inbox);
        if (against.length === 1) {
            const [{ l, note, filed }] = against;
            out.push(`${this.dayName(l.file)}'s line now disagrees with its note ${note.basename}, which is filed in ${name(filed)}, so its time counts nowhere until you fix it. The report lists it under Problems`);
        } else if (against.length) out.push(`${against.length} lines (${days(against)}) now disagree with their notes, so their time counts nowhere until you fix them. The report lists them under Problems`);
        if (waiting.length === 1) {
            const [{ l, note, project }] = waiting;
            out.push(`${this.dayName(l.file)}'s line links ${customJS.AddTaskNote.markOf(app.vault.getFileByPath(project))}, but its note ${note.basename} waits in the Inbox. The report lists it under Problems until you run AddProjectLink on the line or MoveToProject on the note`);
        } else if (waiting.length) out.push(`${waiting.length} lines (${days(waiting)}) link a project, but their notes wait in the Inbox. The report lists them under Problems until you run AddProjectLink on the lines or MoveToProject on the notes`);
        return out;
    }

    // The one project the start's task's lines name, when they agree and one names any, an archived one aside;
    // else null. For AddTaskNote on a line that names none. A line in a project's own note names that project,
    // and one in a task note, log or other note names the project the note is filed in: a task and everything
    // under it share one project (Brian, 2026-11-02).
    agreedHome(found) {
        const tr = customJS.TimeReport, index = tr.appIndex();
        const named = new Set();
        for (const l of found.lines) {
            if (!l.task) continue;
            if (this.placeOf(l.file) === "home") {
                named.add(l.file.path);
                continue;
            }
            if (this.placeOf(l.file) === "other") {
                const filed = tr.projectOfNote(l.file.path, index);
                if (filed && !tr.isArchived(filed)) named.add(filed);
                continue;
            }
            if (this.placeOf(l.file) !== "periodic") continue;
            const where = tr.resolve((n) => (n === l.at ? l.seen : ""), l.at, l.file.path, index, l.at);
            if (where.conflict) return null;
            if (where.project && !where.archived) named.add(where.project);
        }
        return named.size === 1 ? app.vault.getFileByPath([...named][0]) : null;
    }

    // The entries under each line of `days` ([{ file, at }] in daily notes): Map from `${path}:${at}` to the
    // entries the report reads there, an ended event's span included, each `disputed` when its line's time
    // counts nowhere. Time under a nested task is no line's.
    async entries(days, index) {
        const tr = customJS.TimeReport, out = new Map();
        if (!days.length) return out;
        const clock = window.moment();
        const notes = await Promise.all([...new Map(days.map((l) => [l.file.path, l.file])).values()]
            .map(async (f) => ({ path: f.path, date: tr.dailyDate(f.path), text: await customJS.TaskIds.readNow(f) })));
        const model = tr.build(notes, index, { now: { date: clock.format("YYYY-MM-DD"), minutes: clock.hours() * 60 + clock.minutes() } });
        for (const e of [...model.entries, ...model.disputed]) {
            if (e.subTask) continue;
            const key = `${e.path}:${e.top ?? e.context[0].line - 1}`;
            if (!out.has(key)) out.set(key, []);
            out.get(key).push(e);
        }
        return out;
    }

    // What `found` would do with `home` as its project, read before anything is written: { moves: steps
    // (MoveToProject.plan's) for the notes that move, leaving: those that leave a project, clash: a note of
    // that name at the destination, or null, lines: the lines in a periodic note whose ⭕ changes, days: the
    // daily notes' lines whose counted time would count elsewhere, stops: those whose counted time would
    // stop counting (breaking's), checked and stopped: the entries the billed-time check reads for each,
    // toDo: the lines in a project note that go to `home`'s To Do }. With no `home`, nothing changes project:
    // only AddTaskNote's ⋯ is written.
    async weigh(found, home, { adds = null } = {}) {
        const tr = customJS.TimeReport, helper = customJS.AddTaskNote, mover = customJS.MoveToProject, schedule = customJS.Schedule;
        const index = tr.appIndex();
        const link = home ? helper.homeLink(home, helper.linktextFor(home, app.vault.getMarkdownFiles().map((f) => f.path))) : null;
        const weighed = { link, moves: [], leaving: [], clash: null, lines: [], days: [], stops: [], checked: [], stopped: [], toDo: [], breaks: [] };
        for (const step of home ? mover.plan(found.notes.map((n) => mover.itemFor(n)), home.parent.path, (p) => mover.exists(p), helper.logsFolder(home)) : []) {
            if (step.skip === "clash") weighed.clash ??= step;
            else if (!step.skip) {
                weighed.moves.push(step);
                if (step.from && step.from !== home) weighed.leaving.push(step);
            }
        }
        weighed.breaks = this.breaking(found.lines, { home, moving: home ? found.notes : [], adds });
        // A line whose note waits in the Inbox still counts: only one that disagrees stops
        const breaking = new Set(weighed.breaks.filter((b) => !b.inbox).map((b) => b.l));
        const memo = new Map();
        const places = found.lines.map((l) => ({ l, place: this.placeOf(l.file) }));
        const onDays = places.filter(({ l, place }) => place === "periodic" && schedule.isDailyNote(l.file)).map(({ l }) => l);
        const timed = await this.entries(onDays, index);
        for (const { l, place } of places) {
            if (home && place === "home" && l.file !== home) weighed.toDo.push(l);
            if (place !== "periodic") continue;
            const rehomed = home && this.withProject(l.raw, link) !== l.raw;
            if (rehomed) weighed.lines.push(l);
            const { visible } = await this.shown(l.file, memo);
            const where = tr.resolve((n) => visible[n], l.at, l.file.path, index);
            const list = timed.get(`${l.file.path}:${l.at}`) ?? [];
            const counted = !where.conflict && where.project && list.some((e) => !e.disputed);
            // Time that stops counting leaves the project that billed it as surely as time that moves
            if (counted && breaking.has(l)) {
                weighed.stops.push({ l, from: where.project });
                weighed.stopped.push(...list);
            } else if (home && counted && where.project !== home.path) weighed.days.push({ l, from: where.project });
            if (home && !breaking.has(l) && (where.conflict || where.project !== home.path)) weighed.checked.push(...list);
        }
        return weighed;
    }

    // `raw`, a line in a periodic note, with `link` as its one ⭕ or 🗃️. A comment with nothing shown after it
    // stays last, as it was; one before the links, or a %% in the text, is just part of the line.
    withProject(raw, link) {
        const tr = customJS.TimeReport, linker = customJS.AddProjectLink;
        const shown = (text) => tr.scan([text]).visible[0].trimEnd();
        const comment = raw.match(/\s*(?:%%[^%]*%%|<!--.*?-->)\s*$/)?.[0] ?? "";
        const head = raw.slice(0, raw.length - comment.length);
        return comment && shown(head) === shown(raw) ? linker.placed(head, link) + comment : linker.placed(raw, link);
    }

    // A day as the notices name it: "9/11", or a week's, month's or year's own name
    dayName(file) {
        const schedule = customJS.Schedule;
        return schedule.isDailyNote(file) ? window.moment(file.basename, schedule.dailyOpts().format, true).format("M/D") : schedule.labelOf(file);
    }

    // The one question (rule 10): at most one per change, before anything is written. It asks when a note
    // filed in a project would leave it, or counted time would count toward another project, and always when
    // `leave` offers keeping the note where it is. It says the one thing to decide, highlighted, and what follows
    // from it, and lists no days or lines: the system takes care of those (Brian, 2026-11-03). `parent`: the note
    // that moves is the task note or log the start sits under; `matched`: AddTaskNote linked a note of the task's
    // name, filed in that project. Resolves to "move", "leave" or null (Cancel).
    async ask(weighed, home, { leave = null, name = null, matched = null, parent = false } = {}) {
        if (!weighed.leaving.length && !weighed.days.length && !leave) return "move";
        const helper = customJS.AddTaskNote;
        const steps = weighed.moves, step = steps[0] ?? null;
        const mark = (f) => helper.markOf(f), to = mark(home);
        const asking = (title, label, shown, words, cancel = "Cancel") =>
            helper.confirmMove(step?.note ?? null, step?.from ?? null, home, { title, label, name: shown, words, cancel });
        // A note tagged #project that isn't its folder's own is a plain note (rule 3)
        const kindOf = (note) => (["Project", "Area"].includes(helper.kindOf(note)) ? "Note" : helper.kindOf(note));
        // AddTaskNote found a note of the task's name in another project: why it asks, and what each answer does
        const named = matched && (steps.find((s) => s.from === matched)?.note ?? step?.note);
        if (named) {
            const what = { Task: "Task note", Log: "Log" }[kindOf(named)] ?? "Note";
            const words = leave
                ? [`This task will link to that note. Move the note to ${to} with this task, or leave it where it is and give this task ${mark(leave)}?`, "For a separate note, press Esc and give this task a different name."]
                : [`This task will link to that note, and the note moves to ${to} with it.`, "For a separate note, press Cancel and give this task a different name."];
            return asking("A note with this name already exists", what, `${named.basename}, in ${mark(matched)}`, words, leave ? "Leave it" : "Cancel");
        }
        const kind = !step ? "Task" : steps.length > 1 ? "Notes" : kindOf(step.note);
        const names = steps.length ? steps.map((s) => s.note.basename).join(", ") : name ?? "";
        const timed = weighed.days.length > 0;
        // A line left disagreeing with its own note counts nowhere: its time stops counting, it doesn't move
        const stops = weighed.stops.length ? ["Some of its time will stop counting, because its lines disagree with the task note."] : [];
        if (!step) return asking("Change project?", "Task", names, [timed ? `Its time entries will now count toward ${to}.` : `It will now link ${to}.`, ...stops]);
        const up = parent && ["Task", "Log"].includes(kind);
        const subject = {
            Task: up ? "Any other subtasks and task notes" : "Any subtasks and task notes",
            Log: up ? "Its other follow-up tasks, along with any task notes," : "Its follow-up tasks, along with any task notes,",
            Note: "Its tasks, along with any task notes,",
            Notes: "Their subtasks and task notes",
        }[kind];
        const whose = { Log: "its ", Note: "their " }[kind] ?? "";
        const follows = timed ? `${subject} will also move, and ${whose}time entries will now count toward ${to}.` : `${subject} will also move to ${to}.`;
        if (up) return asking("Moving a subtask requires moving its parent", "Parent", names, [`Move this ${kind.toLowerCase()}? ${follows}`, ...stops]);
        return asking(steps.length > 1 ? `Move ${steps.length} notes?` : `Move ${kind.toLowerCase()}?`, kind, names, [follows, ...stops]);
    }

    // The one refusal (rule 11): the first of the entries `weighed` checks that a sent or paid invoice billed
    // to a project other than `home`, as Billing matches them: { entry, invoice }, or null. A row with no
    // project reads as its invoice's; with neither, it refuses nothing. "Sent or paid" is any invoice that
    // isn't a draft or canceled, a status of your own included.
    async billed(weighed, home) {
        if (!weighed.checked.length && !weighed.stopped.length) return null;
        const tr = customJS.TimeReport, billing = customJS.Billing;
        // Without the drafts, which refuse nothing and would otherwise hide a sent invoice's row for the same
        // entry. An invoice that can't be read isn't one: its rows are still checked.
        const ledger = billing.ledger(tr.readBilled(await tr.readInvoices(billing), tr.appIndex(), billing).filter((i) => i.status !== "draft" || i.unread));
        for (const entry of weighed.checked) {
            const { invoice, row } = billing.standing(entry, ledger);
            if (!invoice) continue;
            const bills = row.projectPath ?? invoice.project;
            if (bills && bills !== home.path) return { entry, invoice };
        }
        // Time that would stop counting, once billed, leaves its invoice's project whichever it is
        for (const entry of weighed.stopped) {
            const { invoice, row } = billing.standing(entry, ledger);
            if (invoice && (row.projectPath ?? invoice.project)) return { entry, invoice };
        }
        return null;
    }

    // "Nothing changed: this task's time on 9/11 is on 1001-KES (paid 9/15)."
    refused({ entry, invoice }) {
        const short = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
        if (invoice.unread) return `Nothing changed: this task's time on ${short(entry.date)} is on ${invoice.number}, whose status can't be read.`;
        const on = invoice.status === "paid" ? invoice.paid : invoice.status === "sent" ? invoice.invoiceDate : null;
        return `Nothing changed: this task's time on ${short(entry.date)} is on ${invoice.number} (${invoice.status}${on ? ` ${short(on)}` : ""}).`;
    }

    // The lines that go in a project's `## To Do`, at its end (rule 9). The section is made just above
    // `## Time Report`, or at the end of a note with none, when the note has none; the same lines already
    // there aren't added again, so a second run finishes a first that stopped between its two writes.
    static placeInToDo(text, block) {
        const cr = text.includes("\r\n") ? "\r" : "";
        const lines = text.split("\n");
        const bare = lines.map((l) => l.replace(/\r$/, ""));
        const there = bare.indexOf(block[0]);
        if (there !== -1 && block.every((l, i) => bare[there + i] === l)) return text;
        const add = block.map((l) => l + cr);
        const fmEnd = bare[0]?.trim() === "---" ? bare.findIndex((l, i) => i > 0 && l.trim() === "---") : -1;
        const blank = (i) => !bare[i].trim();
        const heading = bare.findIndex((l, i) => i > fmEnd && /^##\s+to do\s*$/i.test(l));
        if (heading !== -1) {
            let end = bare.findIndex((l, i) => i > heading && (/^#{1,2}\s/.test(l) || l.trim() === "%% time:start %%"));
            if (end === -1) end = bare.length;
            while (end > heading + 1 && blank(end - 1)) end--;
            // The first line under the heading follows a blank line, as every heading does
            if (end === heading + 1) {
                const follows = end < bare.length && !blank(end);
                lines.splice(end, end < bare.length && blank(end) ? 1 : 0, cr, ...add, ...(follows || end < bare.length ? [cr] : []));
                return lines.join("\n");
            }
            lines.splice(end, 0, ...add);
            return lines.join("\n");
        }
        const report = bare.findIndex((l, i) => i > fmEnd && (/^##\s+time\s+(?:report|tracking)$/i.test(l.trim()) || l.trim() === "%% time:start %%"));
        let at = report === -1 ? bare.length : report;
        while (at > fmEnd + 1 && blank(at - 1)) at--;
        const above = at > fmEnd + 1 ? [cr] : [];
        const section = [...above, `## To Do${cr}`, cr, ...add];
        if (report !== -1) section.push(cr);
        else if (at === bare.length) section.push("");
        lines.splice(at, report === -1 ? bare.length - at : report - at, ...section, ...(report === -1 ? [""] : []));
        return lines.join("\n").replace(/\n\n$/, "\n");
    }

    // Where the line `l` holds is among `lines`, as they are now: its index, or -1. A note's move can have
    // rewritten any link's text, as its path, so failing the line as it was read, a line whose link texts alone
    // differ is taken when its links still lead to the notes they did when it was read (`l.targets`, find's),
    // and only one line does; a look-alike of another task's is never taken, and -1 says to run it again.
    locate(lines, l) {
        const bare = (s) => s.replace(/\r$/, "");
        const masked = (s) => bare(s).replace(/\[\[[^\]|#]*/g, "[[");
        if (lines[l.at] !== undefined && bare(lines[l.at]) === l.raw) return l.at;
        const exact = lines.findIndex((s) => bare(s) === l.raw);
        if (exact !== -1) return exact;
        const want = masked(l.raw), same = (a, b) => a.length === b.length && a.every((f, i) => f === b[i]);
        const hits = [];
        lines.forEach((s, i) => {
            if (masked(s) === want && (!l.targets || same(this.targetsOf(bare(s), l.file.path), l.targets))) hits.push(i);
        });
        if (hits.includes(l.at)) return l.at;
        return hits.length === 1 ? hits[0] : -1;
    }

    // Where each link in `text` leads, in order: its note, or null
    targetsOf(text, from) {
        return [...text.matchAll(/\[\[([^\]|#]*)/g)].map((m) => app.metadataCache.getFirstLinkpathDest(m[1], from) ?? null);
    }

    // Writes `list`, lines of `file`, each read again and passed through `next(text, l)`, through its editor
    // when it's open, and takes a daily note's fold snapshot again. Each line it wrote holds what it now says,
    // for whatever writes it next; resolves to { missed: the lines it couldn't find, changed: those whose text
    // it changed }.
    async rewrite(file, list, next) {
        let wrote = [];
        await customJS.Schedule.rewrite(file, (text) => {
            const ls = text.split("\n");
            wrote = [];
            for (const l of list) {
                const at = this.locate(ls, l);
                if (at === -1) continue;
                const before = ls[at].replace(/\r$/, ""), now = next(before, l);
                ls[at] = now + (ls[at].endsWith("\r") ? "\r" : "");
                wrote.push({ l, at, now, changed: now !== before });
            }
            return ls.join("\n");
        });
        for (const { l, at, now } of wrote) Object.assign(l, { at, raw: now, targets: this.targetsOf(now, l.file.path) });
        if (customJS.Schedule.isDailyNote(file)) await customJS.RefoldDailyNotes?.onLeave?.(file);
        return { missed: list.filter((l) => !wrote.some((w) => w.l === l)), changed: wrote.filter((w) => w.changed).map((w) => w.l) };
    }

    // The change, in rule 19's order: the note first, waiting for SyncArea; then each line, read again; a
    // line in a project note goes into the new To Do before it's taken out of the old note, so a failed write
    // can't lose it. `each(text, l)`, when given, changes a line further, such as AddTaskNote's ⋯. With no
    // `home`, only `each` is written. Resolves to { moved: notes, wrote: lines in periodic notes, toDo: lines
    // moved, failed: notes not written, written: the lines whose text it changed, rehomed: the lines in periodic
    // notes it gave `home`'s ⭕ }.
    async write(found, weighed, home, { each = null } = {}) {
        const helper = customJS.AddTaskNote;
        const moved = [], failed = [];
        for (const step of weighed.moves) {
            try {
                await helper.makeFolder(step.to.slice(0, step.to.lastIndexOf("/")));
                await app.fileManager.renameFile(step.note, step.to);
            } catch (e) {
                // The note goes first, so nothing has moved away from it yet
                console.error(`TaskChange: couldn't move ${step.path}`, e);
                failed.push(step.note);
                return { moved, wrote: 0, toDo: [], failed, written: new Set(), rehomed: [] };
            }
            moved.push(step);
            try {
                await customJS.SyncArea?.sync?.(step.note, false);
            } catch (e) {
                console.error(`TaskChange: couldn't set the parent of ${step.note.path}`, e);
            }
        }
        const byFile = new Map(), written = new Set();
        for (const l of found.lines) {
            if ((!home || this.placeOf(l.file) !== "periodic") && !(each && l.task)) continue;
            if (!byFile.has(l.file.path)) byFile.set(l.file.path, []);
            byFile.get(l.file.path).push(l);
        }
        const changing = new Set(weighed.lines), rehomed = [];
        let wrote = 0;
        for (const list of byFile.values()) {
            const { file } = list[0];
            const periodic = this.placeOf(file) === "periodic";
            try {
                const { missed, changed } = await this.rewrite(file, list, (text, l) => {
                    const homed = periodic && home ? this.withProject(text, weighed.link) : text;
                    return each && l.task ? each(homed, l) : homed;
                });
                if (missed.length) failed.push(file);
                const homed = list.filter((l) => changing.has(l) && !missed.includes(l));
                wrote += homed.length;
                rehomed.push(...homed);
                for (const l of changed) written.add(l);
            } catch (e) {
                console.error(`TaskChange: couldn't write ${file.path}`, e);
                failed.push(file);
            }
        }
        const toDo = [];
        for (const l of weighed.toDo) {
            try {
                if (await this.intoToDo(l, home)) { toDo.push(l); l.gone = true; }
                else if (!failed.includes(l.file)) failed.push(l.file);
            } catch (e) {
                console.error(`TaskChange: couldn't move a line out of ${l.file.path}`, e);
                if (!failed.includes(l.file)) failed.push(l.file);
            }
        }
        return { moved, wrote, toDo, failed, written, rehomed };
    }

    // Moves a task's line in a project note, with everything nested under it, to the end of `home`'s To Do.
    // True once it's out of the old note.
    async intoToDo(l, home) {
        const tasks = customJS.TaskIds, tr = customJS.TimeReport;
        const lines = (await tasks.readNow(l.file)).split("\n").map((t) => t.replace(/\r$/, ""));
        const at = this.locate(lines, l);
        if (at === -1) return false;
        const block = lines.slice(at, tr.subtreeEnd(lines, at) + 1);
        await customJS.Schedule.rewrite(home, (t) => TaskChange.placeInToDo(t, block));
        await customJS.Schedule.rewrite(l.file, (t) => {
            const ls = t.split("\n");
            const from = this.locate(ls, l);
            if (from === -1) return t;
            // What's under it, as it is now
            ls.splice(from, tr.subtreeEnd(ls.map((x) => x.replace(/\r$/, "")), from) - from + 1);
            return ls.join("\n");
        });
        return true;
    }

    // What a change says when it's done. The lines it gave the project are named when there's more than the one
    // you ran it on, or, from AddTaskNote (`start`, its line), when one of them is another
    said(result, home, { here = null, start = null } = {}) {
        const mover = customJS.MoveToProject;
        const { moved, wrote, toDo, failed } = result;
        const parts = moved.map((s) => `Moved ${s.label} to ${s.to.slice(0, s.to.lastIndexOf("/"))}`);
        if (here && home) parts.push(`${here} ${wrote || toDo.length ? "was" : "is"} already in ${home.basename}`);
        const another = start && (result.rehomed ?? []).some((l) => l !== start);
        if (home && (moved.length || here || wrote > 1 || another) && wrote) parts.push(mover.linesNow(wrote, home));
        if (toDo.length) parts.push(`Its line in ${toDo[0].file.basename} went to ${home.basename}'s To Do`);
        if (failed.length) parts.push(`couldn't write ${failed.length === 1 ? "1 note" : `${failed.length} notes`}; run it again to finish`);
        return parts.join(". ");
    }

    // One change to `home`, or with no `home`, AddTaskNote's ⋯ alone. Every write a command makes comes through
    // here, so the question, the refusal and the warning can't be skipped: find's `found`, weighed, asked,
    // checked and written. Options: `leave`, the project
    // the note stays in on *Leave it* (AddTaskNote); `stale()`, whether the line changed meanwhile; `ready()`,
    // run once nothing can stop the change, for a note that isn't made until then, false to stop; `each`, for
    // write; `here`, the note's name when MoveToProject runs on a note already there; `name`, the task's, for
    // the question when no note moves; `adds`, the note `each` links on the task's lines; `start`, AddTaskNote's
    // line, for what `said` names. Resolves to
    // { cancelled }, { refused }, or { done, ... } (write's).
    async run(found, home, { leave = null, stale = null, ready = null, each = null, here = null, name = null, adds = null, start = null } = {}) {
        const weighed = await this.weigh(found, home, { adds });
        if (weighed.clash) {
            const { to, label } = weighed.clash;
            new Notice(`${to.slice(0, to.lastIndexOf("/"))} already has a note named ${label}, so nothing changed`);
            return { refused: true };
        }
        const alt = leave ? await this.weigh(found, leave, { adds }) : null;
        // The note that moves isn't one the start's lines link: it's the parent the start sits under
        const parent = !!found.own && weighed.moves.length === 1 && !found.own.includes(weighed.moves[0].note);
        // Leave it isn't offered when it couldn't be done: a note of that name where it would go
        const answer = await this.ask(weighed, home, { leave: alt?.clash ? null : leave, name, matched: leave, parent });
        if (!answer) {
            new Notice("Nothing changed");
            return { cancelled: true };
        }
        if (stale?.()) {
            new Notice("The line changed while you were asked, so nothing changed");
            return { refused: true };
        }
        const [target, plan] = answer === "leave" ? [leave, alt] : [home, weighed];
        if (plan.clash) {
            const { to, label } = plan.clash;
            new Notice(`${to.slice(0, to.lastIndexOf("/"))} already has a note named ${label}, so nothing changed`);
            return { refused: true };
        }
        const hit = await this.billed(plan, target);
        if (hit) {
            new Notice(this.refused(hit));
            return { refused: true };
        }
        if (ready && !(await ready())) return { refused: true };
        // Moving a note waits for Obsidian's cache, up to a couple of seconds: say it's working meanwhile
        const busy = plan.moves.length ? new Notice(`Moving ${plan.moves.length === 1 ? plan.moves[0].note.basename : `${plan.moves.length} notes`} to ${target.basename}…`, 0) : null;
        let result;
        try {
            result = await this.write(found, plan, target, { each });
        } finally {
            busy?.hide?.();
        }
        const text = this.said(result, target, { here, start });
        if (text) new Notice(text);
        // Only a line the change wrote: one that disagreed already, left as it was, the report has listed
        for (const warning of this.warned(plan.breaks.filter((b) => result.written.has(b.l)))) new Notice(warning);
        for (const note of target ? found.stays : []) {
            if (!plan.breaks.some((b) => b.note.path === note.path)) new Notice(`${note.basename} stays where it is, since nothing there is moved; the line links ${target.basename}`);
        }
        return { done: true, target, ...result };
    }
}
