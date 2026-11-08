class CheckOff {
    // Startup script (OBS-232): a task sent out of a note has two lines, the source line left as [>] in the note
    // it was sent from and its open line on a day (or a week, month or year). A tick on either line checks off
    // both, where they are, and a click on a [>] box asks what you meant, since a click alone would leave the task
    // open twice. Nothing moves: marking a task done says nothing about when it was done (Brian, 11/8).
    //   - Ticking the open line: the source line is finished too. An earlier day's [>] line stays [>], so only
    //     one day shows the task done. Unticking puts the source back to [>]. Canceling ([-]) works the same way.
    //   - Ticking the source line, or setting a day's [>] line done: the open line is finished where it is.
    //     Unticking the source puts it back to [>] and opens the done line again where it is.
    //   - A [>] box about to become [ ] or [/] (a click, ⌘⏎, Task Status's picker, typing over the mark) asks
    //     first, with the box held at [>]: Do nothing, Cancel it or Mark done. On a [>] line of a task that's
    //     finished, Do nothing or Reopen today. Scheduling stays Schedule's (OBS-249). The rest of the same edit
    //     (other lines ⌘⏎ or the picker changed) goes ahead, and each [>] line held is asked about in turn.
    //   - A [>] box becoming [x] or [-] is Mark done (or a cancel) at once.
    // Changing the other line says nothing: only a move (Reopen today) or a write it couldn't make has a notice.
    // Only your own edits in the editor count: a change from outside it (Sync, a script writing through the
    // vault, a change on disk, the same note in a second pane) reaches the editor tagged "set", and the system's
    // own writes through an editor carry ORIGIN (Schedule.ORIGIN), so neither is acted on and nothing loops
    // (OBS-228). Undo and redo are edits like any other, but never held. Reading view writes a note's file
    // directly, so a tick there changes only its line (OBS-245). A mark typed in two edits, through `- []`, has
    // no box to compare for one of them, so it's only an edit. While you type it only checks whether an edit
    // changed a checkbox's mark on the lines it touched.
    //
    // It needs Obsidian's own CodeMirror, as TrailingLinks does. If that ever fails, a tick changes only its line.

    // Schedule.ORIGIN, the system's tag; a copy, since the class must load on its own (CI's check)
    static ORIGIN = "obsidian-pm";
    // An edit that changes more lines than this at once (a paste, a big undo) isn't read for ticks
    static MAX_LINES = 200;
    // A job that hasn't settled after this long no longer holds up the ones after it
    static JOB_MS = 300000;
    // A checklist line's mark, and the block ID ending a line (TaskIds.ID_AT_END, copied for the same reason)
    static BOX = /^\s*[-*+]\s+\[(.)\]/;
    static ID_AT_END = /\s\^([A-Za-z0-9-]+)\s*$/;

    // Whether an edit tagged `userEvent` is your own: not one from outside the editor ("set") or the system's own
    static yours(userEvent) {
        if (!userEvent) return true;
        const is = (tag) => userEvent === tag || userEvent.startsWith(`${tag}.`);
        return !is("set") && !is(CheckOff.ORIGIN);
    }

    // A checklist line's mark, or null
    static markOf(text) {
        return text?.match(CheckOff.BOX)?.[1] ?? null;
    }

    static isOpen(mark) { return mark === " " || mark === "/"; }
    static isDone(mark) { return mark === "x" || mark === "X" || mark === "-"; }

    // The checkbox marks an edit changed on lines that end in the same block ID before and after: [{ line, was,
    // before, after }], `line` the line's number after the edit and `was` before it, 0-based, one per line.
    // `lineA(n)` and `lineB(n)` give line n before and after; `ranges` are the changed line ranges, [{ fromA, toA,
    // fromB, toB }], 0-based and inclusive. A change whose line count differs before and after (lines added or
    // taken out) has no line to compare with, and is passed over, as is one bigger than MAX_LINES. A box in a
    // callout (`> - [ ]`) isn't a checklist line here.
    static boxChanges(lineA, lineB, ranges) {
        const out = [], seen = new Set();
        for (const r of ranges) {
            const n = r.toA - r.fromA;
            if (n !== r.toB - r.fromB || n > CheckOff.MAX_LINES) continue;
            for (let k = 0; k <= n; k++) {
                if (seen.has(r.fromB + k)) continue;
                const a = lineA(r.fromA + k), b = lineB(r.fromB + k);
                const was = CheckOff.markOf(a), now = CheckOff.markOf(b);
                if (was === null || now === null || was === now) continue;
                const ida = a.match(CheckOff.ID_AT_END)?.[1], idb = b.match(CheckOff.ID_AT_END)?.[1];
                if (!ida || !idb || ida.toLowerCase() !== idb.toLowerCase()) continue;
                seen.add(r.fromB + k);
                out.push({ line: r.fromB + k, was: r.fromA + k, before: a.replace(/\r$/, ""), after: b.replace(/\r$/, "") });
            }
        }
        return out;
    }

    // An edit's changes, each with the line ranges it touches: [{ fromA, toA, insert, la1, la2, lb1, lb2 }],
    // positions before the edit and line numbers 0-based, from CodeMirror's ChangeSet and the two docs
    static changesOf(changes, docA, docB) {
        const out = [];
        changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            out.push({ fromA, toA, insert: inserted.toString(), la1: docA.lineAt(fromA).number - 1, la2: docA.lineAt(toA).number - 1, lb1: docB.lineAt(fromB).number - 1, lb2: docB.lineAt(toB).number - 1 });
        });
        return out;
    }

    // The changed line ranges boxChanges reads, from changesOf
    static rangesOf(list) {
        return list.map((c) => ({ fromA: c.la1, toA: c.la2, fromB: c.lb1, toB: c.lb2 }));
    }

    // An edit (changesOf's list) with the boxes of the lines `held` (their numbers before the edit) kept as [>]:
    // the changes to give CodeMirror instead, as { from, to, insert } before the edit. Changes on other lines stay
    // as they were; changes that touch a held line are written again one line at a time, each line as the edit
    // left it and a held line with its box back to [>] (heldText), so no change spans a held line. Null when a
    // change touching a held line adds or takes out lines, or moves lines within it, so it can't be split.
    static without(list, held, docA, docB) {
        const groups = [];
        for (const c of list) {
            const g = groups.at(-1);
            if (g && c.la1 <= g.la2) { g.items.push(c); g.la2 = Math.max(g.la2, c.la2); g.lb2 = Math.max(g.lb2, c.lb2); }
            else groups.push({ la1: c.la1, la2: c.la2, lb1: c.lb1, lb2: c.lb2, items: [c] });
        }
        const out = [];
        for (const g of groups) {
            const hit = [...held].some((n) => n >= g.la1 && n <= g.la2);
            if (!hit) { for (const c of g.items) out.push({ from: c.fromA, to: c.toA, insert: c.insert }); continue; }
            if (g.la2 - g.la1 !== g.lb2 - g.lb1) return null;
            // Line k before is line k after only while each held line's task is still in its place
            const idOf = (t) => t.match(CheckOff.ID_AT_END)?.[1]?.toLowerCase() ?? null;
            for (const n of held) if (n >= g.la1 && n <= g.la2 && idOf(docB.line(g.lb1 + n - g.la1 + 1).text) !== idOf(docA.line(n + 1).text)) return null;
            for (let k = 0; k <= g.la2 - g.la1; k++) {
                const a = docA.line(g.la1 + k + 1), b = docB.line(g.lb1 + k + 1).text;
                const want = held.has(g.la1 + k) ? CheckOff.heldText(b) : b;
                if (want !== a.text) out.push({ from: a.from, to: a.to, insert: want });
            }
        }
        return out;
    }

    // A held line: the line as the edit left it, its box back to [>]
    static heldText(text) {
        return text.replace(/\[(.)\]/, "[>]");
    }

    // Line `was` (its number before the edit) once the changes `rest` (from without, none spanning it) are made:
    // each change wholly above it moves it by the lines it adds or takes out
    static lineAfter(rest, docA, was) {
        const start = docA.line(was + 1).from;
        let n = was;
        for (const c of rest) if (c.to < start) n += c.insert.split("\n").length - 1 - (docA.lineAt(c.to).number - docA.lineAt(c.from).number);
        return n;
    }

    // What the editor does with an edit (changesOf's list) that would open the [>] boxes `hits` (boxChanges'
    // entries, numbered before the edit): { changes, asks }, the edit with those boxes kept at [>] (without), and
    // for each held line { line, text, want }: its number and text once that's done, and the box the edit was
    // giving it. Null when the edit can't be split, so it goes ahead unasked, as Obsidian would make it.
    static hold(list, hits, docA, docB) {
        const C = CheckOff;
        const changes = C.without(list, new Set(hits.map((c) => c.was)), docA, docB);
        if (!changes) return null;
        return { changes, asks: hits.map((c) => ({ line: C.lineAfter(changes, docA, c.was), text: C.heldText(c.after), want: C.markOf(c.after) })) };
    }

    // A CodeMirror doc's line n (0-based), or undefined past its ends
    static lineFn(doc) {
        return (n) => (n >= 0 && n < doc.lines ? doc.line(n + 1).text : undefined);
    }

    // Whether line `i` (lineAt(i)) of `file` is a line CheckOff acts on: a checklist line at the top of its nest
    // (rule 5) that ends in a block ID, in a note in the system (rule 12), and not an event (rule 1)
    actsOn(file, lineAt, i) {
        const tasks = customJS.TaskIds, tr = customJS.TimeReport;
        const text = lineAt(i);
        if (!file || !text || !tasks.inSystem(file) || !CheckOff.BOX.test(text) || !CheckOff.ID_AT_END.test(text)) return false;
        return !tr.eventKind(text) && tr.nestTop(lineAt, i) === i;
    }

    // Where `text` is among `ls` (a note's lines): at `line` still, or found by its ID when lines above it came or
    // went; -1 once it's changed
    static lineIn(ls, line, text) {
        const same = (i) => ls[i]?.replace(/\r$/, "") === text;
        if (same(line)) return line;
        const id = customJS.TaskIds.constructor.idOf(text);
        const at = id ? customJS.Schedule.constructor.taskLine(ls, id) : -1;
        return at !== -1 && same(at) ? at : -1;
    }

    // Today's date, YYYY-MM-DD
    today() {
        return window.moment().format("YYYY-MM-DD");
    }

    // Where Reopen today puts a task: today's daily note (Schedule.destination)
    todayDest() {
        return customJS.Schedule.destination(customJS.DatePrompt.result(this.today(), "day"), customJS.DatePrompt.weekRules());
    }

    // A task's lines as they are now: the notes `text` (one of its lines) links, among them where a forward
    // date points, are read whatever the cache says
    async linesOf(id, text, file) {
        return customJS.TaskIds.gather(id, customJS.Schedule.linkedNotes(text, file.path));
    }

    // Where a task is, for a question about one of its [>] boxes: { kind, line }. Its open line on a periodic
    // note, else its done or canceled one there (Schedule.whereIs). Kind null when it has neither.
    where(lines) {
        const { open, done } = customJS.Schedule.whereIs(lines);
        if (open) return { kind: "open", line: open };
        if (done) return { kind: "done", line: done };
        return { kind: null, line: null };
    }

    // Once every editor showing `file` shows the same text: an edit made in one pane reaches the note's other panes
    // a moment later (as "set"), and until then a read could see the note as it was (TaskIds.readNow reads the
    // first). Gives up after a third of a second.
    async settled(file) {
        const views = () => app.workspace.getLeavesOfType("markdown").map((l) => l.view).filter((v) => v?.file?.path === file.path && v.editor && (v.getMode?.() ?? "source") === "source");
        for (let k = 0; k < 10; k++) {
            const vs = views();
            if (vs.length < 2 || vs.every((v) => v.editor.getValue() === vs[0].editor.getValue())) return;
            await new Promise((ok) => setTimeout(ok, 35));
        }
    }

    // Runs `job` after the jobs before it, one at a time, never inside an edit
    enqueue(job) {
        const run = () => new Promise((ok) => setTimeout(ok, 0)).then(() => Promise.race([job(), new Promise((ok) => setTimeout(ok, CheckOff.JOB_MS))]));
        this.queue = (this.queue ?? Promise.resolve()).then(run).catch((e) => console.error("CheckOff:", e));
        return this.queue;
    }

    // ---------------------------------------------------------------- a box you changed

    // A box you changed (`before` to `after`) on line `line` of `file`: the task's other lines follow. A line that
    // moved since (an earlier change in the same edit) is found by its ID; one that changed again is left alone,
    // and so is a line whose task was never sent (a block ID of your own).
    async follow(file, { line, before, after }) {
        const tasks = customJS.TaskIds, T = tasks.constructor, S = customJS.Schedule;
        const C = CheckOff;
        const was = C.markOf(before), now = C.markOf(after), id = T.idOf(after);
        if (!id || was === now) return;
        await this.settled(file);
        const text = (await tasks.readNow(file)).split("\n").map((l) => l.replace(/\r$/, ""));
        if (text[line] !== after) {
            const at = S.constructor.taskLine(text, id);
            if (at === -1 || text[at] !== after) return;
            line = at;
        }
        if (!this.actsOn(file, (n) => text[n], line)) return;
        const lines = await this.linesOf(id, after, file);
        if (!T.isTask(lines)) return;
        const { open } = S.whereIs(lines);
        if (tasks.kindOf(file) !== "other") {
            // A [>] line on a day set to done or canceled (Task Status's picker, typing): Mark done, or a cancel,
            // at once, while the task is open on another line. The line goes back to [>] first, as a click leaves
            // it, with its time, and the open line is finished where it is.
            if (was === ">") {
                if (!C.isDone(now) || !open) return;
                await this.setBox(file, line, after, ">");
                return this.complete(id, await this.linesOf(id, after, file), now);
            }
            // The open line ticked, canceled or unticked: its source lines follow
            if (C.isOpen(was) && C.isDone(now)) return this.followSources(file, id, lines, now);
            if (C.isDone(was) && (C.isOpen(now) || C.isDone(now))) return this.followSources(file, id, lines, now);
            return;
        }
        // The source line ticked or canceled: the open line is finished where it is
        if (C.isDone(now) && !C.isDone(was)) {
            if (open) return this.complete(id, lines, now);
            return;
        }
        // The source line unticked, or done changed to canceled: the done line follows, where it is
        if (C.isDone(was) && (C.isOpen(now) || C.isDone(now))) return this.followDone(file, line, after, id, lines, now);
    }

    // The source lines of a task whose line on a periodic note (`file`) became `mark`: finished, or back to [>]
    // when it opened again, their forward date pointing at `file`
    async followSources(file, id, lines, mark) {
        const tasks = customJS.TaskIds, S = customJS.Schedule, C = CheckOff;
        const sources = lines.filter((l) => tasks.kindOf(l.file) === "other" && ">xX-".includes(l.task));
        if (!sources.length) return;
        await S.followForward(id, S.destinationOf(file), sources, C.isOpen(mark) ? { reopen: true } : { mark });
    }

    // A source line (line `line` of `file`, now `after`) unticked, or changed between done and canceled: the
    // task's done line on a periodic note (the one its forward date names, when it's done on two) follows where it
    // is, open again as Schedule reopens a task ([/] when the task has time logged, else [ ]), or finished the
    // same way; an unticked source goes back to [>], its forward date pointing at that line.
    async followDone(file, line, after, id, lines, mark) {
        const tasks = customJS.TaskIds, T = tasks.constructor, S = customJS.Schedule, C = CheckOff;
        const periodic = lines.filter((l) => tasks.kindOf(l.file) !== "other");
        const fwd = T.forwardOf(after);
        const named = fwd ? app.metadataCache.getFirstLinkpathDest(fwd.linkpath, file.path)?.path : null;
        const done = periodic.find((l) => C.isDone(l.task) && l.file.path === named) ?? periodic.find((l) => C.isDone(l.task));
        const open = periodic.find((l) => C.isOpen(l.task));
        const target = C.isOpen(mark) ? (done ?? open) : done;
        if (!target) return;
        const box = C.isOpen(mark) ? ((await S.started(lines)) ? "/" : " ") : mark;
        if (target.task !== box && !(C.isOpen(mark) && C.isOpen(target.task))) {
            await S.rewrite(target.file, (t) => {
                const ls = t.split("\n"), at = S.constructor.taskLine(ls, id, target.task);
                if (at !== -1) ls[at] = ls[at].replace(/\[(.)\]/, `[${box}]`);
                return ls.join("\n");
            });
            tasks.touched(target.file);
        }
        if (C.isOpen(mark)) {
            const link = S.forwardTo(target.file, id);
            await S.rewrite(file, (t) => {
                const ls = t.split("\n");
                const at = C.lineIn(ls, line, after);
                if (at === -1) return t;
                const cr = ls[at].endsWith("\r") ? "\r" : "";
                ls[at] = T.withForward(after.replace(/\[(.)\]/, "[>]"), link) + cr;
                return ls.join("\n");
            });
            tasks.touched(file);
        }
    }

    // Mark done (`mark` "x"), or a cancel ("-"): the task's open line is finished where it is, and its source
    // lines with it, their forward date naming that line's day. Nothing moves: to finish it on another day,
    // Schedule it there first (Brian, 11/8). True when it was open.
    async complete(id, lines, mark = "x") {
        const S = customJS.Schedule;
        const { open, sources } = S.whereIs(lines);
        if (!open) { new Notice("This task is already finished, so nothing changed"); return false; }
        await this.setBox(open.file, open.line, open.text, mark);
        if (sources.length) await S.followForward(id, S.destinationOf(open.file), sources, { mark });
        return true;
    }

    // ---------------------------------------------------------------- a click on a [>] box

    // A [>] box on line `line` of `file` (its text `text`) about to become `want` (" " for a click, or "/"),
    // stopped before it changed: asks what you meant, and does it. One question per line at a time, and none once
    // the line isn't what was clicked.
    async ask({ file, line, text, want = " " }) {
        const key = `${file.path}\n${line}`;
        if ((this.asking ??= new Set()).has(key)) return;
        this.asking.add(key);
        try {
            return await this.question({ file, line, text, want });
        } finally {
            this.asking.delete(key);
        }
    }

    // ask, after the jobs before it. A question already waiting or up for the same line isn't queued again, so a
    // double click or a repeated ⌘⏎ asks once.
    askLater(args) {
        const key = `${args.file.path}\n${args.line}`;
        if ((this.queued ??= new Set()).has(key)) return;
        this.queued.add(key);
        this.enqueue(async () => {
            try {
                await this.ask(args);
            } finally {
                this.queued.delete(key);
            }
        });
    }

    async question({ file, line, text, want }) {
        const tasks = customJS.TaskIds, T = tasks.constructor, S = customJS.Schedule;
        await this.settled(file);
        // The line, found again by its ID when something above it moved it (a question before this one)
        const lineNow = async () => {
            const ls = (await tasks.readNow(file)).split("\n").map((l) => l.replace(/\r$/, ""));
            if (ls[line] === text) return text;
            const at = S.constructor.taskLine(ls, T.idOf(text));
            if (at !== -1 && ls[at] === text) { line = at; return text; }
            return ls[line];
        };
        if (await lineNow() !== text) return;
        const id = T.idOf(text);
        const lines = await this.linesOf(id, text, file);
        const at = this.where(lines);
        const name = S.nameOf(text);
        const finished = (l) => (l.task === "-" ? "canceled" : "completed");
        // Only whether you meant done or canceled: moving a task is Schedule's (Brian, 11/8). A finished task
        // reopens on today, never on a past day that later days have moved on from.
        let spec;
        if (at.kind === "open") {
            spec = { title: `This task is scheduled for ${S.labelOf(at.line.file)}. What would you like to do?`, buttons: ["Do nothing", "Cancel it", "Mark done"], cta: "Mark done" };
        } else if (at.kind === "done") {
            spec = { title: `This task was ${finished(at.line)} on ${S.labelOf(at.line.file)}. What would you like to do?`, buttons: ["Do nothing", "Reopen today"], cta: "Do nothing" };
        } else {
            // Nothing to ask about: what Obsidian would have done
            await this.setBox(file, line, text, want);
            return;
        }
        const choice = await this.choose({ ...spec, name });
        if (!choice || choice === "Do nothing") return;
        // A line that changed while the question was up, or a task that moved or was finished meanwhile, gets
        // nothing written
        if (await lineNow() !== text) { new Notice("The line changed while the question was open, so nothing was written"); return; }
        const fresh = await this.linesOf(id, text, file);
        const now = this.where(fresh);
        if (now.kind !== at.kind || now.line.file.path !== at.line.file.path) { new Notice("The task changed while the question was open, so nothing was written"); return; }
        if (choice === "Mark done") return this.complete(id, fresh, "x");
        if (choice === "Cancel it") return this.complete(id, fresh, "-");
        if (choice === "Reopen today") {
            // As Schedule moves a finished task to today: its line there opens, and the day it was done keeps a
            // [>] line with any time logged under it
            const moved = await S.moveTask({ id, lines: fresh, dest: this.todayDest() });
            new Notice(moved.notice);
        }
    }

    // Line `line` of `file`, while it's still `text`, with its box set to `mark`, as the system's own write
    async setBox(file, line, text, mark) {
        await customJS.Schedule.rewrite(file, (t) => {
            const ls = t.split("\n");
            const at = CheckOff.lineIn(ls, line, text);
            if (at !== -1) ls[at] = ls[at].replace(/\[(.)\]/, `[${mark}]`);
            return ls.join("\n");
        });
        customJS.TaskIds.touched(file);
    }

    // The question: `title`, the task's name highlighted, `words` under it when there are any, and `buttons`
    // left to right, `cta` highlighted and focused. Enter takes the focused button (the highlighted one unless you tabbed away).
    // Resolves to the button's text, or null for Esc.
    choose({ title, name, words = null, buttons, cta }) {
        const { Modal, ButtonComponent } = customJS.obsidian;
        return new Promise((resolve) => {
            let choice = null, focus = null, typed = false;
            const made = [];
            // Obsidian focuses a modal's first button; the highlighted one takes it, unless a key was pressed first
            const focusIt = () => { if (!typed) focus?.buttonEl.focus(); };
            const modal = new (class extends Modal {
                onClose() { setTimeout(() => resolve(choice), 0); }
                // Focused once the modal is open, not straight after open() (OBS-50); the timer for a window that
                // draws no frames
                onOpen() {
                    this.containerEl.addEventListener("keydown", () => { typed = true; }, true);
                    requestAnimationFrame(focusIt);
                    setTimeout(focusIt, 50);
                }
            })(app);
            const pick = (c) => { choice = c; modal.close(); };
            modal.titleEl.setText(title);
            const mark = modal.contentEl.createEl("p").createEl("mark", { attr: { style: "background-color: var(--text-highlight-bg); color: var(--text-normal); padding: 0.1em 0.3em; border-radius: var(--radius-s);" } });
            mark.createEl("strong", { text: "Task:" });
            mark.appendText(` ${name}`);
            if (words) modal.contentEl.createEl("p", { text: words });
            const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
            for (const b of buttons) {
                const button = new ButtonComponent(row).setButtonText(b).onClick(() => pick(b));
                made.push({ button, label: b });
                if (b === cta) { button.setCta(); focus = button; }
            }
            modal.scope.register([], "Enter", () => {
                const focused = made.find((m) => m.button.buttonEl === modal.containerEl.ownerDocument.activeElement);
                pick(focused ? focused.label : cta);
                return false;
            });
            modal.open();
        });
    }

    // ---------------------------------------------------------------- the editor extension

    async invoke() {
        // CustomJS doesn't run deconstructors when the plugin itself reloads, so the handles live on window, to
        // guarantee one set of listeners
        this.deconstructor();
        let view, state;
        try {
            view = require("@codemirror/view");
            state = require("@codemirror/state");
        } catch (e) {
            console.warn("CheckOff: CodeMirror isn't available, so a tick changes only its own line", e);
            return;
        }
        const C = CheckOff;
        const { EditorView } = view;
        const { EditorState, Transaction, StateEffect } = state;
        const { editorInfoField } = customJS.obsidian;
        const ws = app.workspace;

        // One registered slot per CustomJS lifetime; a rerun swaps what's in it
        const kept = window.pmCheckOff;
        const slot = kept?.slot && ws.editorExtensions?.includes?.(kept.slot) ? kept.slot : null;
        const handles = { slot: slot ?? [], refs: [], docs: new Set(), click: null };
        window.pmCheckOff = handles;
        if (!slot) app.plugins.plugins.customjs.registerEditorExtension(handles.slot);

        // A [>] line an edit was about to open, held, to ask about once the edit is dispatched
        const asked = StateEffect.define();
        const undoing = (ev) => !!ev && /^(undo|redo)($|\.)/.test(ev);

        // ⌘⏎, Task Status's picker or typing taking a [>] box to [ ] or [/]: that line's box is held at [>] while
        // the question is up (OBS-228), and the rest of the edit goes ahead, that line's other changes included.
        // Undo and redo pass, so the history never sticks there; so does an edit that can't be split.
        const hold = EditorState.transactionFilter.of((tr) => {
            if (!tr.docChanged) return tr;
            const ev = tr.annotation(Transaction.userEvent);
            if (!C.yours(ev) || undoing(ev)) return tr;
            const info = tr.startState.field(editorInfoField, false);
            const file = info?.file;
            if (!file) return tr;
            const docA = tr.startState.doc, docB = tr.newDoc;
            const list = C.changesOf(tr.changes, docA, docB);
            const lineA = C.lineFn(docA);
            const hits = C.boxChanges(lineA, C.lineFn(docB), C.rangesOf(list))
                .filter((c) => C.markOf(c.before) === ">" && C.isOpen(C.markOf(c.after)) && this.actsOn(file, lineA, c.was));
            if (!hits.length) return tr;
            const held = C.hold(list, hits, docA, docB);
            if (!held) return tr;
            const effects = held.asks.map((a) => asked.of({ file, ...a }));
            return { changes: held.changes, effects, userEvent: ev };
        });

        // A box you changed: acted on after the edit, never inside it; and a held [>] line asked about
        const follow = EditorView.updateListener.of((u) => {
            for (const tr of u.transactions) {
                for (const e of tr.effects) if (e.is(asked)) this.askLater(e.value);
                if (!tr.docChanged || !C.yours(tr.annotation(Transaction.userEvent))) continue;
                const found = C.boxChanges(C.lineFn(tr.startState.doc), C.lineFn(tr.newDoc), C.rangesOf(C.changesOf(tr.changes, tr.startState.doc, tr.newDoc)));
                if (!found.length) continue;
                const file = u.state.field(editorInfoField, false)?.file;
                if (!file || !customJS.TaskIds.inSystem(file)) continue;
                for (const c of found) this.enqueue(() => this.follow(file, c));
            }
        });

        // A click on a [>] box in the editor is stopped before Obsidian sees it, so the box stays [>], and asked
        // about. Reading view, and a callout or an embed drawn inside the editor, are left alone (an editor inside
        // an embed, a hover preview's or a canvas card's, isn't). While a modal is up, such as Task Status's menu
        // after a long press, the click is left to it.
        const boxOf = (ev) => ev.target?.closest?.("input.task-list-item-checkbox") ?? null;
        handles.click = (ev) => {
            const box = boxOf(ev);
            const root = box?.closest(".cm-editor");
            if (!root) return;
            const drawn = box.closest(".markdown-rendered, .markdown-preview-view, .cm-callout, .markdown-embed");
            if (drawn && root.contains(drawn)) return;
            if (box.ownerDocument.querySelector(".modal-container")) return;
            const cm = EditorView.findFromDOM(root);
            if (!cm) return;
            const info = cm.state.field(editorInfoField, false);
            const file = info?.file;
            let at;
            try { at = cm.state.doc.lineAt(cm.posAtDOM(box)).number - 1; } catch (e) { return; }
            const lineAt = C.lineFn(cm.state.doc);
            const text = lineAt(at);
            if (C.markOf(text) !== ">" || !this.actsOn(file, lineAt, at)) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            this.askLater({ file, line: at, text, want: " " });
        };
        const listen = (doc) => {
            if (!doc || handles.docs.has(doc)) return;
            doc.addEventListener("click", handles.click, true);
            handles.docs.add(doc);
        };
        const unlisten = (doc) => {
            if (!doc || !handles.docs.has(doc)) return;
            doc.removeEventListener("click", handles.click, true);
            handles.docs.delete(doc);
        };
        listen(document);
        // A note popped out into its own window
        handles.refs.push(ws.on("window-open", (w, win) => listen(win?.document)), ws.on("window-close", (w, win) => unlisten(win?.document)));
        ws.iterateAllLeaves?.((leaf) => listen(leaf.view?.containerEl?.ownerDocument));

        handles.slot.length = 0;
        handles.slot.push(hold, follow);
        ws.updateOptions();
    }

    deconstructor() {
        const handles = window.pmCheckOff;
        if (!handles) return;
        for (const ref of handles.refs) ref.e.offref(ref);
        handles.refs = [];
        for (const doc of handles.docs) doc.removeEventListener("click", handles.click, true);
        handles.docs.clear();
        // The slot stays registered for the next run to fill
        handles.slot.length = 0;
        app.workspace.updateOptions();
    }
}
