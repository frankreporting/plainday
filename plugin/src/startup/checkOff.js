import { ButtonComponent, editorInfoField, Modal, moment, Notice } from "obsidian";
import { EditorView } from "@codemirror/view";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { app, plainday } from "../host.js";

/** @import { EventRef, Events, MarkdownView, TAbstractFile, TFile } from "obsidian" */
/** @import { ChangeSet, Extension, StateEffectType, Text } from "@codemirror/state" */
/** @import { TaskLine } from "../shared/taskIds.js" */
/** @import { Destination } from "../commands/schedule.js" */
/** @import { MomentFn } from "../host.js" */
/**
 * A box an edit changed (boxChanges): its line's number after the edit and before it (`was`), from 0,
 * and the line before and after.
 * @typedef {{ line: number, was: number, before: string, after: string }} BoxChange
 *
 * One change in an edit (changesOf): where it starts and ends before the edit, what it puts there, and
 * the lines it touches before (la1 to la2) and after (lb1 to lb2), from 0.
 * @typedef {{ fromA: number, toA: number, insert: string, la1: number, la2: number, lb1: number, lb2: number }} EditChange
 *
 * Changed lines, before and after an edit, from 0 and inclusive (boxChanges):
 * @typedef {{ fromA: number, toA: number, fromB: number, toB: number }} LineRange
 *
 * A change to give CodeMirror, by position before the edit (without):
 * @typedef {{ from: number, to: number, insert: string }} Splice
 *
 * A [>] line held while its question is up (hold): its number and text once the edit is made, and the
 * box the edit was giving it.
 * @typedef {{ line: number, text: string, want: string }} Held
 *
 * A question about a [>] box (ask): the box's note, line and text, the box it was about to become, and
 * whether it was clicked in reading view. A tick in reading view (tickRead) is the same, with the box
 * to write.
 * @typedef {{ file: TFile, line: number, text: string, want?: string, read?: boolean }} Ask
 * @typedef {{ file: TFile, line: number, text: string, want: string }} Tick
 *
 * Reading view's renderer, which Obsidian's types don't describe: the text it last drew a note from,
 * whether a box is its own, and the section a box is in, by its first line.
 * @typedef {{
 *   text?: string,
 *   lastText?: string,
 *   belongsToMe?(el: Element): boolean,
 *   getSectionContainer?(el: Element): { start?: { line: number } } | null | undefined,
 * }} ReadingRenderer
 * @typedef {MarkdownView & { previewMode: MarkdownView["previewMode"] & { renderer?: ReadingRenderer } }} ReadingView
 *
 * The tab whose reading view drew a box (readingView):
 * @typedef {{ view: ReadingView, file: TFile, renderer: ReadingRenderer }} Reading
 *
 * A press on a box in reading view, noted for Task Status's menu (pressed): the note's path, its text
 * when pressed, the window's document, whether a dialog has opened and when it closed, the timer that
 * forgets the press, the watcher of dialogs, and the read of the note's saved text.
 * @typedef {{ path: string, before: string, doc: Document, seen: boolean, closed: number | null, timer: number | null, observer: MutationObserver | null, ready?: Promise<void> }} MenuWatch
 *
 * An event's handle, which keeps the object it was registered on, as Obsidian makes one:
 * @typedef {EventRef & { e: Events }} OwnedRef
 *
 * What a run of the script leaves on window for the next one to undo (invoke): the slot its editor
 * extensions are in, its handles and listeners, the documents it listens on, and a press noted for
 * Task Status's menu.
 * @typedef {{
 *   slot: Extension[], refs: OwnedRef[], docs: Set<Document>, click: ((ev: MouseEvent) => void) | null,
 *   press?: (ev: Event) => void, release?: () => void, events?: [string, (ev: Event) => void][], menu?: MenuWatch | null,
 * }} Handles
 * @typedef {Window & { pmCheckOff?: Handles | null }} HandleWindow
 *
 * What CheckOff keeps between calls, besides its queue of jobs and a press noted for Task Status's
 * menu: the lines asked about or waiting to be, by note and line, and when it last ticked a task's
 * line in reading view, by note and ID.
 * @typedef {CheckOff & { asking?: Set<string>, queued?: Set<string>, ticked?: Map<string, number> }} Kept
 */

export default class CheckOff {
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
    // (OBS-228). Undo and redo are edits like any other, but never held. A mark typed in two edits, through
    // `- []`, has no box to compare for one of them, so it's only an edit. While you type it only checks whether
    // an edit changed a checkbox's mark on the lines it touched.
    //
    // Reading view (OBS-245) writes a click on a box straight to the note's file, out of the editor's sight. So a
    // click on a box there, on a line CheckOff acts on, is stopped before Obsidian sees it, and CheckOff makes the
    // change itself, as the system's own write, then follows it as it follows a tick in the editor; a [>] box asks
    // first. The line is found as Obsidian finds it: its section's first line plus the box's `data-line`. Task
    // Status's menu opened there (a right-click, or a long press) writes through the vault too, so a press on a box
    // there notes the note's text, and the menu's change to it is followed the same way. A box in an embedded note,
    // a hover preview or a canvas card is left to Obsidian (OBS-251).
    //
    // It needs Obsidian's own CodeMirror, which Plainday passes in, as TrailingLinks does.

    // Schedule.ORIGIN, the system's tag; a copy, since the class must load on its own (CI's check)
    static ORIGIN = "obsidian-pm";
    // An edit that changes more lines than this at once (a paste, a big undo) isn't read for ticks
    static MAX_LINES = 200;
    // A job that hasn't settled after this long no longer holds up the ones after it
    static JOB_MS = 300000;
    // Task Status's menu in reading view: its write is taken as the menu's until this long after the menu closes,
    // and a press on a box that opened no dialog in PRESS_MS is forgotten
    static MENU_MS = 2000;
    static PRESS_MS = 6000;
    // A click on a line CheckOff ticked this recently finds it changed by that tick, not by someone else
    static TICKED_MS = 2000;
    // A checklist line's mark, and the block ID ending a line (TaskIds.ID_AT_END, copied for the same reason)
    static BOX = /^\s*[-*+]\s+\[(.)\]/;
    static ID_AT_END = /\s\^([A-Za-z0-9-]+)\s*$/;

    // Whether an edit tagged `userEvent` is your own: not one from outside the editor ("set") or the system's own
    /** @param {string | undefined} userEvent @returns {boolean} */
    static yours(userEvent) {
        if (!userEvent) return true;
        const is = (/** @type {string} */ tag) => userEvent === tag || userEvent.startsWith(`${tag}.`);
        return !is("set") && !is(CheckOff.ORIGIN);
    }

    // A checklist line's mark, or null
    /** @param {string | null | undefined} text @returns {string | null} */
    static markOf(text) {
        return text?.match(CheckOff.BOX)?.[1] ?? null;
    }

    /** @param {string | null | undefined} mark @returns {boolean} */
    static isOpen(mark) { return mark === " " || mark === "/"; }
    /** @param {string | null | undefined} mark @returns {boolean} */
    static isDone(mark) { return mark === "x" || mark === "X" || mark === "-"; }

    // The checkbox marks an edit changed on lines that end in the same block ID before and after: [{ line, was,
    // before, after }], `line` the line's number after the edit and `was` before it, 0-based, one per line.
    // `lineA(n)` and `lineB(n)` give line n before and after; `ranges` are the changed line ranges, [{ fromA, toA,
    // fromB, toB }], 0-based and inclusive. A change whose line count differs before and after (lines added or
    // taken out) has no line to compare with, and is passed over, as is one bigger than MAX_LINES. A box in a
    // callout (`> - [ ]`) isn't a checklist line here.
    /**
     * @param {(n: number) => string | undefined} lineA
     * @param {(n: number) => string | undefined} lineB
     * @param {LineRange[]} ranges
     * @returns {BoxChange[]}
     */
    static boxChanges(lineA, lineB, ranges) {
        const /** @type {BoxChange[]} */ out = [], /** @type {Set<number>} */ seen = new Set();
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
    /** @param {ChangeSet} changes @param {Text} docA @param {Text} docB @returns {EditChange[]} */
    static changesOf(changes, docA, docB) {
        /** @type {EditChange[]} */
        const out = [];
        changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            out.push({ fromA, toA, insert: inserted.toString(), la1: docA.lineAt(fromA).number - 1, la2: docA.lineAt(toA).number - 1, lb1: docB.lineAt(fromB).number - 1, lb2: docB.lineAt(toB).number - 1 });
        });
        return out;
    }

    // The changed line ranges boxChanges reads, from changesOf
    /** @param {EditChange[]} list @returns {LineRange[]} */
    static rangesOf(list) {
        return list.map((c) => ({ fromA: c.la1, toA: c.la2, fromB: c.lb1, toB: c.lb2 }));
    }

    // An edit (changesOf's list) with the boxes of the lines `held` (their numbers before the edit) kept as [>]:
    // the changes to give CodeMirror instead, as { from, to, insert } before the edit. Changes on other lines stay
    // as they were; changes that touch a held line are written again one line at a time, each line as the edit
    // left it and a held line with its box back to [>] (heldText), so no change spans a held line. Null when a
    // change touching a held line adds or takes out lines, or moves lines within it, so it can't be split.
    /**
     * @param {EditChange[]} list
     * @param {Set<number>} held
     * @param {Text} docA
     * @param {Text} docB
     * @returns {Splice[] | null}
     */
    static without(list, held, docA, docB) {
        /** @type {{ la1: number, la2: number, lb1: number, lb2: number, items: EditChange[] }[]} */
        const groups = [];
        for (const c of list) {
            const g = groups.at(-1);
            if (g && c.la1 <= g.la2) { g.items.push(c); g.la2 = Math.max(g.la2, c.la2); g.lb2 = Math.max(g.lb2, c.lb2); }
            else groups.push({ la1: c.la1, la2: c.la2, lb1: c.lb1, lb2: c.lb2, items: [c] });
        }
        /** @type {Splice[]} */
        const out = [];
        for (const g of groups) {
            const hit = [...held].some((n) => n >= g.la1 && n <= g.la2);
            if (!hit) { for (const c of g.items) out.push({ from: c.fromA, to: c.toA, insert: c.insert }); continue; }
            if (g.la2 - g.la1 !== g.lb2 - g.lb1) return null;
            // Line k before is line k after only while each held line's task is still in its place
            const idOf = (/** @type {string} */ t) => t.match(CheckOff.ID_AT_END)?.[1]?.toLowerCase() ?? null;
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
    /** @param {string} text @returns {string} */
    static heldText(text) {
        return text.replace(/\[(.)\]/, "[>]");
    }

    // Line `was` (its number before the edit) once the changes `rest` (from without, none spanning it) are made:
    // each change wholly above it moves it by the lines it adds or takes out
    /** @param {Splice[]} rest @param {Text} docA @param {number} was @returns {number} */
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
    /**
     * @param {EditChange[]} list
     * @param {BoxChange[]} hits
     * @param {Text} docA
     * @param {Text} docB
     * @returns {{ changes: Splice[], asks: Held[] } | null}
     */
    static hold(list, hits, docA, docB) {
        const C = CheckOff;
        const changes = C.without(list, new Set(hits.map((c) => c.was)), docA, docB);
        if (!changes) return null;
        return { changes, asks: hits.map((c) => ({ line: C.lineAfter(changes, docA, c.was), text: C.heldText(c.after), want: C.markOf(c.after) })) };
    }

    // A CodeMirror doc's line n (0-based), or undefined past its ends
    /** @param {Text} doc @returns {(n: number) => string | undefined} */
    static lineFn(doc) {
        return (n) => (n >= 0 && n < doc.lines ? doc.line(n + 1).text : undefined);
    }

    // The line a box in reading view stands for, as Obsidian's own click finds it: `start`, the first line of the
    // box's section (reading view draws a note in sections, and only those near the screen are on the page), plus
    // the box's `data-line`, which counts from there. `text` is the whole note as reading view drew it, and `mark`
    // the box's mark as drawn (its list item's `data-task`, which is empty for `[ ]`). { line, text, lineAt }, line
    // 0-based and `lineAt(n)` any line of the note; null when the line isn't a checklist line with that mark, so an
    // Obsidian that draws boxes some other way leaves the click to Obsidian.
    /**
     * @param {string | null | undefined} text
     * @param {number | null | undefined} start
     * @param {string | null | undefined} dataLine
     * @param {string | null | undefined} mark
     * @returns {{ line: number, text: string, lineAt: (i: number) => string | undefined } | null}
     */
    static readingLine(text, start, dataLine, mark) {
        const n = /^\d+$/.test(dataLine ?? "") ? Number(dataLine) : NaN;
        if (typeof text !== "string" || !Number.isInteger(start) || start < 0 || !Number.isInteger(n) || typeof mark !== "string") return null;
        const ls = text.split("\n");
        const line = start + n, at = ls[line]?.replace(/\r$/, "");
        if (at === undefined || CheckOff.markOf(at) !== (mark === "" ? " " : mark)) return null;
        return { line, text: at, lineAt: (i) => ls[i]?.replace(/\r$/, "") };
    }

    // The lines that differ between `a` and `b` (two versions of a note's lines), as boxChanges reads them:
    // { fromA, toA, fromB, toB }, 0-based and inclusive, past the lines both start and end with; null when equal
    /** @param {string[]} a @param {string[]} b @returns {LineRange | null} */
    static lineRange(a, b) {
        let s = 0;
        while (s < a.length && s < b.length && a[s] === b[s]) s++;
        if (s === a.length && s === b.length) return null;
        let e = 0;
        while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
        return { fromA: s, toA: a.length - 1 - e, fromB: s, toB: b.length - 1 - e };
    }

    // The boxes a write changed and nothing else on their lines, between two versions of a note's text: boxChanges'
    // entries. Task Status's menu writes just that, one line's mark; typing, a save from another pane or a
    // calendar sync change more, and are no menu's.
    /** @param {string} before @param {string} after @returns {BoxChange[]} */
    static menuChanges(before, after) {
        const strip = (/** @type {string} */ t) => t.split("\n").map((l) => l.replace(/\r$/, ""));
        const a = strip(before), b = strip(after);
        // With as many lines as before, line by line, however far apart the changes; otherwise lines came or went,
        // which the menu never does
        /** @type {LineRange[]} */
        const ranges = [];
        if (a.length === b.length) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) ranges.push({ fromA: i, toA: i, fromB: i, toB: i }); }
        else { const range = CheckOff.lineRange(a, b); if (range) ranges.push(range); }
        const bare = (/** @type {string} */ t) => t.replace(/\[(.)\]/, "[ ]");
        return CheckOff.boxChanges((n) => a[n], (n) => b[n], ranges).filter((c) => bare(c.before) === bare(c.after));
    }

    // Whether a change to note `path` at time `now` is Task Status's menu's, for the press `w` noted (pressed):
    // a dialog opened after the press, and it's still up or closed no more than MENU_MS ago
    /** @param {MenuWatch | null | undefined} w @param {string} path @param {number} now @returns {boolean} */
    static menuTakes(w, path, now) {
        return !!w && w.path === path && w.seen && (w.closed === null || now - w.closed <= CheckOff.MENU_MS);
    }

    // Whether line `i` (lineAt(i)) of `file` is a line CheckOff acts on: a checklist line at the top of its nest
    // (rule 5), or a day's [>] line (OBS-254), that ends in a block ID, in a note in the system (rule 12), and not
    // an event (rule 1)
    /**
     * @param {TFile | null | undefined} file
     * @param {(n: number) => string | undefined} lineAt
     * @param {number} i
     * @returns {boolean}
     */
    actsOn(file, lineAt, i) {
        const tasks = plainday.TaskIds, tr = plainday.TimeReport;
        const text = lineAt(i);
        if (!file || !text || !tasks.inSystem(file) || !CheckOff.BOX.test(text) || !CheckOff.ID_AT_END.test(text)) return false;
        if (tr.eventKind(text)) return false;
        if (tr.nestTop(lineAt, i) === i) return true;
        // A day's [>] line (OBS-254) is one of its subtask's lines: a click on its box asks, as on a task's
        const T = tasks.constructor;
        return /^\s*[-*+]\s+\[>\]/.test(text) && !!T.forwardOf(text) && tasks.kindOf(file) === "day";
    }

    // Where `text` is among `ls` (a note's lines): at `line` still, or found by its ID when lines above it came or
    // went; -1 once it's changed
    /** @param {string[]} ls @param {number} line @param {string} text @returns {number} */
    static lineIn(ls, line, text) {
        const same = (/** @type {number} */ i) => ls[i]?.replace(/\r$/, "") === text;
        if (same(line)) return line;
        const id = plainday.TaskIds.constructor.idOf(text);
        const at = id ? plainday.Schedule.constructor.taskLine(ls, id) : -1;
        return at !== -1 && same(at) ? at : -1;
    }

    // Today's date, YYYY-MM-DD
    /** @returns {string} */
    today() {
        return /** @type {MomentFn} */ (moment)().format("YYYY-MM-DD");
    }

    // Where Reopen today puts a task: today's daily note (Schedule.destination)
    /** @returns {Destination} */
    todayDest() {
        return plainday.Schedule.destination(plainday.DatePrompt.result(this.today(), "day"), plainday.DatePrompt.weekRules());
    }

    // A task's lines as they are now: the notes `text` (one of its lines) links, among them where a forward
    // date points, are read whatever the cache says
    /** @param {string} id @param {string} text @param {TFile} file @returns {Promise<TaskLine[]>} */
    async linesOf(id, text, file) {
        return plainday.TaskIds.gather(id, plainday.Schedule.linkedNotes(text, file.path));
    }

    // Where a task is, for a question about one of its [>] boxes: { kind, line }. Its open line on a periodic
    // note, else its done or canceled one there (Schedule.whereIs). Kind null when it has neither.
    /** @param {TaskLine[]} lines @returns {{ kind: "open" | "done" | null, line: TaskLine | null }} */
    where(lines) {
        const { open, done } = plainday.Schedule.whereIs(lines);
        if (open) return { kind: "open", line: open };
        if (done) return { kind: "done", line: done };
        return { kind: null, line: null };
    }

    // Once every editor showing `file` shows the same text: an edit made in one pane reaches the note's other panes
    // a moment later (as "set"), and until then a read could see the note as it was (TaskIds.readNow reads the
    // first). Gives up after a third of a second.
    /** @param {TFile} file @returns {Promise<void>} */
    async settled(file) {
        const views = () => app.workspace.getLeavesOfType("markdown").map((l) => /** @type {MarkdownView} */ (l.view)).filter((v) => v?.file?.path === file.path && v.editor && (v.getMode?.() ?? "source") === "source");
        for (let k = 0; k < 10; k++) {
            const vs = views();
            if (vs.length < 2 || vs.every((v) => v.editor.getValue() === vs[0].editor.getValue())) return;
            await new Promise((ok) => window.setTimeout(ok, 35));
        }
    }

    // Runs `job` after the jobs before it, one at a time, never inside an edit
    /** @this {Kept} @param {() => Promise<unknown>} job @returns {Promise<unknown>} */
    enqueue(job) {
        const run = () => new Promise((ok) => window.setTimeout(ok, 0)).then(() => Promise.race([job(), new Promise((ok) => window.setTimeout(ok, CheckOff.JOB_MS))]));
        /** @type {Promise<unknown>} */
        this.queue = (this.queue ?? Promise.resolve()).then(run).catch((e) => console.error("CheckOff:", e));
        return this.queue;
    }

    // ---------------------------------------------------------------- a box you changed

    // A box you changed (`before` to `after`) on line `line` of `file`: the task's other lines follow. A line that
    // moved since (an earlier change in the same edit) is found by its ID; one that changed again is left alone,
    // and so is a line whose task was never sent (a block ID of your own).
    /**
     * @param {TFile} file
     * @param {{ line: number, before: string, after: string }} change
     * @returns {Promise<boolean | void>}
     */
    async follow(file, { line, before, after }) {
        const tasks = plainday.TaskIds, T = tasks.constructor, S = plainday.Schedule;
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
    /**
     * @param {TFile} file
     * @param {string} id
     * @param {TaskLine[]} lines
     * @param {string} mark
     * @returns {Promise<void>}
     */
    async followSources(file, id, lines, mark) {
        const tasks = plainday.TaskIds, S = plainday.Schedule, C = CheckOff;
        const sources = lines.filter((l) => tasks.kindOf(l.file) === "other" && ">xX-".includes(l.task));
        if (!sources.length) return;
        await S.followForward(id, S.destinationOf(file), sources, C.isOpen(mark) ? { reopen: true } : { mark });
    }

    // A source line (line `line` of `file`, now `after`) unticked, or changed between done and canceled: the
    // task's done line on a periodic note (the one its forward date names, when it's done on two) follows where it
    // is, open again as Schedule reopens a task ([/] when the task has time logged, else [ ]), or finished the
    // same way; an unticked source goes back to [>], its forward date pointing at that line.
    /**
     * @param {TFile} file
     * @param {number} line
     * @param {string} after
     * @param {string} id
     * @param {TaskLine[]} lines
     * @param {string} mark
     * @returns {Promise<void>}
     */
    async followDone(file, line, after, id, lines, mark) {
        const tasks = plainday.TaskIds, T = tasks.constructor, S = plainday.Schedule, C = CheckOff;
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
    /** @param {string} id @param {TaskLine[]} lines @param {string} [mark] @returns {Promise<boolean>} */
    async complete(id, lines, mark = "x") {
        const S = plainday.Schedule;
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
    /** @this {Kept} @param {Ask} args @returns {Promise<boolean | void>} */
    async ask({ file, line, text, want = " ", read = false }) {
        const key = `${file.path}\n${line}`;
        if ((this.asking ??= new Set()).has(key)) return;
        this.asking.add(key);
        try {
            return await this.question({ file, line, text, want, read });
        } finally {
            this.asking.delete(key);
        }
    }

    // ask, after the jobs before it. A question already waiting or up for the same line isn't queued again, so a
    // double click or a repeated ⌘⏎ asks once.
    /** @this {Kept} @param {Ask} args */
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

    // `read`: clicked in reading view, where the page can be behind the note: a line that changed since it was
    // drawn says so, as tickRead does, rather than asking nothing
    /** @param {Ask} args @returns {Promise<boolean | void>} */
    async question({ file, line, text, want, read = false }) {
        const tasks = plainday.TaskIds, T = tasks.constructor, S = plainday.Schedule;
        await this.settled(file);
        // The line, found again by its ID when something above it moved it (a question before this one)
        const lineNow = async () => {
            const ls = (await tasks.readNow(file)).split("\n").map((l) => l.replace(/\r$/, ""));
            if (ls[line] === text) return text;
            const at = S.constructor.taskLine(ls, T.idOf(text));
            if (at !== -1 && ls[at] === text) { line = at; return text; }
            return ls[line];
        };
        if (await lineNow() !== text) {
            if (read) new Notice("This line changed just before the click, so nothing was written");
            return;
        }
        const id = T.idOf(text);
        const lines = await this.linesOf(id, text, file);
        const at = this.where(lines);
        const name = S.nameOf(text);
        const finished = (/** @type {TaskLine} */ l) => (l.task === "-" ? "canceled" : "completed");
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
    /** @param {TFile} file @param {number} line @param {string} text @param {string} mark @returns {Promise<void>} */
    async setBox(file, line, text, mark) {
        await plainday.Schedule.rewrite(file, (t) => {
            const ls = t.split("\n");
            const at = CheckOff.lineIn(ls, line, text);
            if (at !== -1) ls[at] = ls[at].replace(/\[(.)\]/, `[${mark}]`);
            return ls.join("\n");
        });
        plainday.TaskIds.touched(file);
    }

    // The question: `title`, the task's name highlighted, `words` under it when there are any, and `buttons`
    // left to right, `cta` highlighted and focused. Enter takes the focused button (the highlighted one unless you tabbed away).
    // Resolves to the button's text, or null for Esc.
    /**
     * @param {{ title: string, name: string, words?: string | null, buttons: string[], cta: string }} spec
     * @returns {Promise<string | null>}
     */
    choose({ title, name, words = null, buttons, cta }) {
        return new Promise((resolve) => {
            let /** @type {string | null} */ choice = null, /** @type {ButtonComponent | null} */ focus = null, typed = false;
            /** @type {{ button: ButtonComponent, label: string }[]} */
            const made = [];
            // Obsidian focuses a modal's first button; the highlighted one takes it, unless a key was pressed first
            const focusIt = () => { if (!typed) focus?.buttonEl.focus(); };
            const modal = new (class extends Modal {
                onClose() { window.setTimeout(() => resolve(choice), 0); }
                // Focused once the modal is open, not straight after open() (OBS-50); the timer for a window that
                // draws no frames
                onOpen() {
                    this.containerEl.addEventListener("keydown", () => { typed = true; }, true);
                    window.requestAnimationFrame(focusIt);
                    window.setTimeout(focusIt, 50);
                }
            })(app);
            const pick = (/** @type {string} */ c) => { choice = c; modal.close(); };
            modal.titleEl.setText(title);
            const mark = modal.contentEl.createEl("p").createEl("mark", { cls: "plainday-task-name" });
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

    // ---------------------------------------------------------------- reading view (OBS-245)

    // The tab whose reading view drew `box`: { view, file, renderer }, or null. Not a box in the editor, in a
    // callout, in a note embedded in the one you're reading (its own renderer draws it, and its lines count
    // within the embed), or one a plugin draws in a code block (a query's results); nor one in a hover preview or
    // a canvas card, which are in no tab (OBS-251).
    /** @param {Element | null | undefined} box @returns {Reading | null} */
    readingView(box) {
        if (!box?.closest || box.closest('.cm-editor, .callout, .markdown-embed, .internal-embed, [class*="block-language-"]')) return null;
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
            const view = /** @type {ReadingView} */ (leaf.view), renderer = view?.previewMode?.renderer;
            if (!renderer || view.getMode?.() !== "preview" || !view.previewMode.containerEl?.contains(box)) continue;
            return renderer.belongsToMe?.(box) ? { view, file: view.file, renderer } : null;
        }
        return null;
    }

    // What a click on `box` in a tab's reading view does instead of Obsidian's own toggle: { ask } for a [>] box
    // (the question, as for a click in the editor), { tick } for any other ({ file, line, text, want }, `want`
    // the box Obsidian would have written: [ ] becomes [x], any other mark [ ]), or null to leave the click to
    // Obsidian. Only a line CheckOff acts on, found where Obsidian would have changed it, and never while a dialog
    // is up (Task Status's menu after a long press, say). The line is read from the text the boxes on the page
    // were drawn from (the renderer's `lastText`): a change takes a frame or more to be drawn, and until then
    // `text` is ahead of the page, its lines possibly moved. tickRead finds the line again in the note as it is.
    /** @param {Element | null | undefined} box @returns {{ ask?: Ask, tick?: Tick } | null} */
    readingClick(box) {
        const C = CheckOff;
        if (!box || box.ownerDocument?.querySelector(".modal-container")) return null;
        const hit = this.readingView(box);
        if (!hit?.file || !plainday.TaskIds.inSystem(hit.file)) return null;
        const section = hit.renderer.getSectionContainer?.(box);
        const drawn = typeof hit.renderer.lastText === "string" ? hit.renderer.lastText : hit.renderer.text;
        const li = box.closest("li");
        const found = C.readingLine(drawn, section?.start?.line, box.getAttribute("data-line"), li?.getAttribute("data-task"));
        if (!found || !this.actsOn(hit.file, found.lineAt, found.line)) return null;
        const mark = C.markOf(found.text), args = { file: hit.file, line: found.line, text: found.text };
        return mark === ">" ? { ask: { ...args, want: " ", read: true } } : { tick: { ...args, want: mark === " " ? "x" : " " } };
    }

    // A click in reading view on a box other than [>] (readingClick's tick): the box set to `want` as the system's
    // own write, then followed as a tick in the editor is. A line already as the click would make it (a second
    // click before the first was drawn) is left as it is. A line that changed otherwise since reading view drew it
    // (a change that reached the note just before the click) gets nothing written.
    /** @this {Kept} @param {Tick} tick @returns {Promise<boolean | void>} */
    async tickRead({ file, line, text, want }) {
        const C = CheckOff;
        await this.settled(file);
        const ls = (await plainday.TaskIds.readNow(file)).split("\n").map((l) => l.replace(/\r$/, ""));
        const after = text.replace(/\[(.)\]/, `[${want}]`);
        const at = C.lineIn(ls, line, text);
        // A second click on a line this one's tick, or its follow, has just changed (a double click) does nothing
        const key = `${file.path}\n${plainday.TaskIds.constructor.idOf(text)?.toLowerCase()}`;
        this.ticked ??= new Map();
        if (at === -1) {
            const recent = Date.now() - (this.ticked.get(key) ?? -Infinity) < C.TICKED_MS;
            if (!recent && C.lineIn(ls, line, after) === -1) new Notice("This line changed just before the click, so nothing was written");
            return;
        }
        await this.setBox(file, at, text, want);
        const now = Date.now();
        this.ticked.set(key, now);
        for (const [k, t] of this.ticked) if (now - t > C.TICKED_MS) this.ticked.delete(k);
        return this.follow(file, { line: at, before: text, after });
    }

    // A click on `box` outside the editor (the click listener's part for reading view): stopped before Obsidian
    // sees it when readingClick has a job for it, which then runs. True when it was stopped.
    /** @this {Kept} @param {Event} ev @param {Element} box @returns {boolean} */
    readingClicked(ev, box) {
        /** @type {{ ask?: Ask, tick?: Tick } | null} */
        let job = null;
        // If reading view ever changes so this fails, the click is Obsidian's, as before OBS-245
        try { job = this.readingClick(box); } catch (e) { console.error("CheckOff:", e); }
        if (!job) return false;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        // As Obsidian's own click there does, on a phone that can
        try { navigator.vibrate?.(100); } catch { /* none on this device: nothing to do */ }
        if (job.ask) this.askLater(job.ask);
        else this.enqueue(() => this.tickRead(job.tick));
        return true;
    }

    // Task Status's menu, opened from a box in reading view, writes the note through the vault, where the editor
    // never sees it. A press on a box there (a right-click, or the start of a long press) notes the note and its
    // text; once a dialog has opened, the first change to that note that only sets boxes (menuChanges, while
    // menuTakes) is the menu's, and is followed (followMenu). A press that ends with no dialog up, such as a click,
    // is forgotten, and so is the menu MENU_MS after it closes.
    /** @this {Kept} @param {Element | null | undefined} box */
    pressed(box) {
        const doc = box?.ownerDocument;
        if (!doc?.body || doc.querySelector(".modal-container")) return;
        const hit = this.readingView(box);
        if (!hit?.file || !plainday.TaskIds.inSystem(hit.file) || typeof hit.renderer.text !== "string") return;
        this.unwatch();
        // `before` is the note as the vault has it, which the menu changes and `modified` reads: a pane in Live
        // Preview can show the reading pane edits it hasn't saved yet
        /** @type {MenuWatch} */
        const w = { path: hit.file.path, before: hit.renderer.text, doc, seen: false, closed: null, timer: null, observer: null };
        w.ready = app.vault.cachedRead(hit.file).then((t) => { if (typeof t === "string") w.before = t; }).catch(() => {});
        // Task Status's menu is a picker (a SuggestModal, drawn as a prompt), not one of the system's questions
        const up = () => !!doc.querySelector(".modal-container .prompt");
        w.observer = new MutationObserver(() => {
            if (up()) { w.seen = true; return; }
            if (!w.seen || w.closed !== null) return;
            w.closed = Date.now();
            window.clearTimeout(w.timer);
            w.timer = window.setTimeout(() => this.unwatch(w), CheckOff.MENU_MS);
        });
        w.observer.observe(doc.body, { childList: true });
        w.timer = window.setTimeout(() => { if (!w.seen) this.unwatch(w); }, CheckOff.PRESS_MS);
        this.menu = w;
        // Kept where the next run of the script finds it, to end it
        if (/** @type {HandleWindow} */ (window).pmCheckOff) /** @type {HandleWindow} */ (window).pmCheckOff.menu = w;
    }

    // The press ended (pointerup): forgotten unless the menu opened
    /** @this {Kept} */
    released() {
        const w = this.menu;
        if (w && !w.seen && !w.doc.querySelector(".modal-container .prompt")) this.unwatch(w);
    }

    /** @this {Kept} @param {MenuWatch | null} [w] */
    unwatch(w = this.menu) {
        if (!w || this.menu !== w) return;
        w.observer?.disconnect();
        window.clearTimeout(w.timer);
        this.menu = null;
        if (/** @type {HandleWindow} */ (window).pmCheckOff?.menu === w) /** @type {HandleWindow} */ (window).pmCheckOff.menu = null;
    }

    // A change to a note while the press on one of its boxes in reading view was noted: the menu's when, while
    // menuTakes holds, it only sets boxes (menuChanges) on lines CheckOff acts on; any other change, such as a save
    // from another pane or the calendar sync setting an event's box, becomes the text the menu's is compared with.
    // Cheap otherwise: it runs on every change to any note. (A change of boxes alone that reaches that note while
    // the menu is up, from Sync, a save from another pane or CheckOff's own write, would be taken for it.)
    /** @this {Kept} @param {TFile} file @returns {Promise<void> | undefined} */
    modified(file) {
        const w = this.menu;
        if (!w || file?.path !== w.path) return;
        const takes = CheckOff.menuTakes(w, file.path, Date.now());
        return w.ready.then(() => {
            const before = w.before;
            return app.vault.cachedRead(file).then((now) => {
                if (this.menu !== w) return;
                const ls = now.split("\n").map((l) => l.replace(/\r$/, ""));
                const changes = takes ? CheckOff.menuChanges(before, now).filter((c) => this.actsOn(file, (n) => ls[n], c.line)) : [];
                if (!changes.length) { w.before = now; return; }
                this.unwatch(w);
                this.enqueue(() => this.followMenu(file, changes));
            });
        }).catch((e) => console.error("CheckOff:", e));
    }

    // Task Status's menu changed `file`'s boxes (`changes`, menuChanges' entries): each is followed, as a click in
    // reading view is. A [>] box it opened goes back to [>] and asks the question, since its write can't be stopped
    // beforehand; one it set done or canceled is Mark done, or a cancel, at once.
    /** @this {Kept} @param {TFile} file @param {BoxChange[]} changes @returns {Promise<void>} */
    async followMenu(file, changes) {
        const C = CheckOff;
        const b = (await this.caughtUp(file)).split("\n").map((l) => l.replace(/\r$/, ""));
        const lineB = (/** @type {number} */ n) => b[n];
        for (const change of changes) {
            // The line where it is now: a job before this one may have moved it
            const at = C.lineIn(b, change.line, change.after);
            if (at === -1) continue;
            const c = { ...change, line: at };
            if (C.markOf(c.before) === ">" && C.isOpen(C.markOf(c.after))) {
                if (!this.actsOn(file, lineB, c.line)) continue;
                await this.setBox(file, c.line, c.after, ">");
                this.askLater({ file, line: c.line, text: C.heldText(c.after), want: C.markOf(c.after) });
            } else await this.follow(file, c);
        }
    }

    // `file`'s text once an editor showing it in editing view has the vault's: a write through the vault reaches
    // the editor a moment later (as "set"). Gives up after a third of a second, as settled does.
    /** @param {TFile} file @returns {Promise<string>} */
    async caughtUp(file) {
        const tasks = plainday.TaskIds;
        let now = await tasks.readNow(file);
        for (let k = 0; k < 10 && now !== (await app.vault.cachedRead(file)); k++) {
            await new Promise((ok) => window.setTimeout(ok, 35));
            now = await tasks.readNow(file);
        }
        return now;
    }

    // ---------------------------------------------------------------- the editor extension

    /** @this {Kept} @returns {Promise<void>} */
    async invoke() {
        // The handles live on window, so a second run undoes the first: one set of listeners, however
        // often it runs
        this.deconstructor();
        const C = CheckOff;
        const ws = app.workspace;

        // One registered slot per load of Plainday; a rerun swaps what's in it
        const kept = /** @type {HandleWindow} */ (window).pmCheckOff;
        const slot = kept?.slot && ws.editorExtensions?.includes?.(kept.slot) ? kept.slot : null;
        /** @type {Handles} */
        const handles = { slot: slot ?? [], refs: [], docs: new Set(), click: null };
        /** @type {HandleWindow} */ (window).pmCheckOff = handles;
        if (!slot) plainday.plugin.registerEditorExtension(handles.slot);

        // A [>] line an edit was about to open, held, to ask about once the edit is dispatched
        const asked = /** @type {StateEffectType<Ask>} */ (StateEffect.define());
        const undoing = (/** @type {string | undefined} */ ev) => !!ev && /^(undo|redo)($|\.)/.test(ev);

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
                if (!file || !plainday.TaskIds.inSystem(file)) continue;
                for (const c of found) this.enqueue(() => this.follow(file, c));
            }
        });

        // A click on a [>] box in the editor is stopped before Obsidian sees it, so the box stays [>], and asked
        // about. A callout or an embed drawn inside the editor is left alone (an editor inside an embed, a hover
        // preview's or a canvas card's, isn't). While a modal is up, such as Task Status's menu after a long press,
        // the click is left to it. In a tab's reading view, a click on any box of a line CheckOff acts on is
        // stopped, and CheckOff makes the change itself (readingClick).
        const boxOf = (/** @type {Event} */ ev) => /** @type {Element | null} */ (ev.target)?.closest?.("input.task-list-item-checkbox") ?? null;
        handles.click = (ev) => {
            const box = boxOf(ev);
            if (!box) return;
            const root = box.closest(".cm-editor");
            if (!root) return void this.readingClicked(ev, box);
            const drawn = box.closest(".markdown-rendered, .markdown-preview-view, .cm-callout, .markdown-embed");
            if (drawn && root.contains(drawn)) return;
            if (box.ownerDocument.querySelector(".modal-container")) return;
            const cm = EditorView.findFromDOM(root);
            if (!cm) return;
            const info = cm.state.field(editorInfoField, false);
            const file = info?.file;
            let at;
            try { at = cm.state.doc.lineAt(cm.posAtDOM(box)).number - 1; } catch { return; }
            const lineAt = C.lineFn(cm.state.doc);
            const text = lineAt(at);
            if (C.markOf(text) !== ">" || !this.actsOn(file, lineAt, at)) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            this.askLater({ file, line: at, text, want: " " });
        };
        // A press on a box in reading view, for Task Status's menu there (pressed); its end, which forgets a press
        // that opened no dialog
        handles.press = (ev) => {
            const box = boxOf(ev);
            if (!box || box.closest(".cm-editor")) return;
            try { this.pressed(box); } catch (e) { console.error("CheckOff:", e); }
        };
        handles.release = () => this.released();
        /** @type {[string, (ev: Event) => void][]} */
        const events = [["click", handles.click], ["pointerdown", handles.press], ["contextmenu", handles.press], ["pointerup", handles.release], ["pointercancel", handles.release]];
        handles.events = events;
        const listen = (/** @type {Document | null | undefined} */ doc) => {
            if (!doc || handles.docs.has(doc)) return;
            for (const [name, fn] of events) doc.addEventListener(name, fn, true);
            handles.docs.add(doc);
        };
        const unlisten = (/** @type {Document | null | undefined} */ doc) => {
            if (!doc || !handles.docs.has(doc)) return;
            for (const [name, fn] of events) doc.removeEventListener(name, fn, true);
            handles.docs.delete(doc);
        };
        listen(document);
        // A note popped out into its own window
        handles.refs.push(/** @type {OwnedRef} */ (ws.on("window-open", (w, win) => listen(win?.document))), /** @type {OwnedRef} */ (ws.on("window-close", (w, win) => unlisten(win?.document))));
        ws.iterateAllLeaves?.((leaf) => listen(leaf.view?.containerEl?.ownerDocument));
        // Task Status's write after a press in reading view
        handles.refs.push(/** @type {OwnedRef} */ (app.vault.on("modify", (file) => this.modified(/** @type {TFile} */ (file)))));

        handles.slot.length = 0;
        handles.slot.push(hold, follow);
        ws.updateOptions();
    }

    /** @this {Kept} */
    deconstructor() {
        const handles = /** @type {HandleWindow} */ (window).pmCheckOff;
        if (!handles) return;
        for (const ref of handles.refs) ref.e.offref(ref);
        handles.refs = [];
        const events = handles.events ?? [["click", handles.click]];
        for (const doc of handles.docs) for (const [name, fn] of events) doc.removeEventListener(name, fn, true);
        handles.docs.clear();
        // A press the last run noted for Task Status's menu
        if (handles.menu) { handles.menu.observer?.disconnect(); window.clearTimeout(handles.menu.timer); handles.menu = null; }
        this.unwatch();
        // The slot stays registered for the next run to fill
        handles.slot.length = 0;
        app.workspace.updateOptions();
    }
}
