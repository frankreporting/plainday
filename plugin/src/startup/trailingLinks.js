import { editorInfoField, editorLivePreviewField, Keymap, moment } from "obsidian";
import { Decoration, EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { EditorSelection, EditorState, Prec, StateEffect, Transaction } from "@codemirror/state";
import { foldedRanges } from "@codemirror/language";
import { app, plainday } from "../host.js";

export default class TrailingLinks {
    // Startup script (OBS-84): draws the links that end a task or event line small, at the right
    // of the line's last row, the way Things shows a deadline. Display only, except that it keeps a
    // task's ID at the end of its line (below): notes never change otherwise.
    //   - Only Obsidian PM's links move: a 🚩 due date, forward date, ⋯ or ↗ note, ⭕
    //     project or 🗃️ area link at the end of the line, before a task's ID (OBS-181). People, links
    //     in the text and old wrapped event titles stay put.
    //   - On screen: the project or area, drawn as its shortest name (faint, no pill), the note,
    //     the due date (faint, red once it's passed), then the forward date (OBS-185) at the edge after the
    //     due date, faint.
    //   - A task's ID (^ and six letters or digits, ending the line) is hidden until the cursor
    //     reaches the end of the line: a second End shows it. Shown on a line with links, it's drawn
    //     last, after them at the right edge, where the caret then is; ← moves back into the links.
    //   - Typing at the ID's edge never moves it off the end: text typed just after the ID goes in at
    //     the end of the text, ahead of the links (spec default 11). Enter is Obsidian's own, from the
    //     end of the line when the cursor is at the end of the text: End, then Enter, starts a new
    //     task below, and the links and the ID stay on their line (OBS-221).
    //   - Only the text's last word wraps with the links; the other rows keep their full width.
    //   - Live Preview only. While a link shows its brackets, the line reads as its markdown.
    //   - In Live Preview, End and Cmd-→ stop at the end of the text, and a second press goes to the
    //     end of the line, after the note link and the ID (OBS-221). By default they'd stop at the far
    //     right of the row, inside the moved links.
    //   - A click on one of them opens that link. Obsidian finds a clicked link from where the
    //     click lands in the text, which the moved, reordered links throw off.
    // It only draws the lines on screen, and while you type only the edited line and the lines
    // nested under it; a cursor move redraws only the lines it left and reached that have an ID.
    //
    // It needs Obsidian's own CodeMirror, which it imports; the build leaves it out of main.js, as
    // Obsidian gives it to every plugin.
    // Gaps and padding around the links, in px, for a first guess at their width until it's measured
    static PILL_PX = 14;
    static CHAR_PX = 7.5;
    static GAP_PX = 8;
    // The margin before each pill (the CSS's margin-inline-start)
    static PILL_MARGIN_PX = 4;
    // Edits bigger than this many lines redraw every line on screen
    static MAX_PIECEMEAL = 40;
    static REDRAW_MS = 250;

    // The layout is in styles.css, keyed to the classes the extension puts on a line:
    //   .pm-trail-line  the line, with --pm-run-w (the links' width); .pm-trail-folded while it's folded
    //   .pm-trail-glue  the text's last word, which keeps that much room after it
    //   .pm-trail-run   around the links
    //   .pm-trail       around each link, with .pm-trail-due / -forward / -note / -project / -area,
    //                   and .pm-trail-overdue on a due date that's passed; and around a shown task ID,
    //                   with .pm-trail-id
    //   .pm-project-name  a ⭕/🗃️ link's alias, with data-pm-name, drawn as that name

    // A task or event line: a list item with a checkbox
    static TASK_LINE = /^\s*[-*+] \[.\] /;
    // One system link at the end of the text given: [[target|alias]], the alias one of the symbols
    // (DueDate's 🚩 M/D, a line's own note's ⋯, the ↗ to the note Schedule sent it from, a project's ⭕,
    // an area's 🗃️; OBS-208); or Schedule's
    // forward date, a periodic note's line with a date for its label (TaskIds.FORWARD), drawn as that
    // date (one written with a ➡️ before its date too). A phone may add or drop the U+FE0F on an emoji.
    // A date label (group 3) counts only on a link to a periodic note's line, which lastLink checks:
    // read the links with it.
    static LINK = /\[\[([^\]|]+)\|\s*(🚩️?\s*\d{1,2}\/\d{1,2}|➡️?\s*[^\]]+?|⋯|↗️?|⭕️?|🗃️?|(\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4}))\s*\]\]$/u;
    // A link's text when it's a periodic note's line: a name or path, then `#^` and an ID,
    // `2026-09-17#^p7d2qe`; periodicLine reads the name
    static PERIODIC_LINE = /^([^#]+)#\^[A-Za-z0-9-]+$/;
    // A link's kind by its alias's symbol; one with none is a forward date (LINK's last alternative)
    static KINDS = { "🚩": "due", "➡": "forward", "⋯": "note", "↗": "from", "⭕": "project", "🗃": "area" };
    // A task's ID ending its line (OBS-181), with the space before it
    static BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/;
    // An ID of six letters or digits, the shape Obsidian's and the task IDs have, or an event line's
    // (`e-` and six, OBS-275): the one that's hidden and kept at the end of its line, so a typed "^3"
    // stays plain text
    static HIDDEN_ID = /\s\^(?:[A-Za-z0-9]{6}|e-[a-z0-9]{6})\s*$/;

    // ---------------------------------------------------------------- the text rules (no app)

    // Where a line's ID is: { from (the space before it), to }, or null. `strict`: only the ID that's
    // hidden (HIDDEN_ID)
    static blockId(text, { strict = false } = {}) {
        const m = text.match(strict ? TrailingLinks.HIDDEN_ID : TrailingLinks.BLOCK_ID);
        return m ? { from: m.index, to: m.index + m[0].trimEnd().length } : null;
    }

    // Where a task or event line's text ends, ahead of the links and the hidden ID that end it, or null
    // when nothing does. A task with no text yet ends right after its checkbox, where the cursor rests.
    // `read` reads a forward date's name, here and in each rule below that takes it (periodicLine).
    static textEnd(text, read) {
        const head = text.match(TrailingLinks.TASK_LINE);
        if (!head) return null;
        const end = TrailingLinks.trail(text, read)?.textEnd ?? TrailingLinks.blockId(text, { strict: true })?.from;
        return end === undefined ? null : Math.max(end, head[0].length);
    }

    // Where End and Cmd-→ go from `ch` on a line with a textEnd: the end of the text, then, from there or
    // past it, the end of the line. Null on any other line, and on an upper row of one that wraps, which
    // ends at `rowEnd`, ahead of the text's end.
    static endStop(text, ch, rowEnd = text.length, read) {
        const end = TrailingLinks.textEnd(text, read);
        if (end === null || Math.max(ch, rowEnd) < end) return null;
        return ch < end ? end : text.length;
    }

    // The system link that ends `text` (LINK's match), or null. A date label counts only on a link to a
    // periodic note's line (periodicLine). Older iPhones can't run that check in the pattern (a
    // lookbehind, OBS-199), and a pattern can't read a name by the vault's formats (OBS-297), so it's made
    // here. When it fails, no link ends the text: one starting later would need a `|` after this one's,
    // and a date label has none. TimeReport.trailLink is the same.
    static lastLink(text, read) {
        const m = text.match(TrailingLinks.LINK);
        return m && (m[3] === undefined || TrailingLinks.periodicLine(m[1], read)) ? m : null;
    }

    // Whether `target`, a link's text before its `|`, is a periodic note's line: after the last `[[` (the
    // link's own, one inside its text, or one made of the link's second `[` and a `[` after it, as the
    // lookbehind read it, OBS-199), a name or path that reads as a day's, week's, month's or year's note
    // (`read`, PeriodicNotes.reader; Plainday's when it's not given), then `#^` and an ID
    static periodicLine(target, read) {
        const text = `[[${target}`;
        const m = text.slice(text.lastIndexOf("[[") + 2).match(TrailingLinks.PERIODIC_LINE);
        return !!m && !!TrailingLinks.reader(read)(m[1]);
    }

    // `read`, or Plainday's reader of periodic note names (PeriodicNotes.reader). Code that runs without
    // Plainday hands its own in; with neither, it throws rather than read a name wrong.
    static reader(read) {
        if (read) return read;
        const own = plainday?.PeriodicNotes?.reader?.();
        if (!own) throw new Error("TrailingLinks: no reader of periodic note names, and Plainday's isn't loaded");
        return own;
    }

    // The run of system links that ends a task or event line, before a task's ID: { bodyFrom
    // (where the text starts, after the checkbox), textEnd (where it ends, before the space ahead
    // of the run), runFrom, runTo, links: [{ from, to, kind, target, alias }] in line order }. Null
    // when the line doesn't end in one. Trailing spaces and the ID aren't part of the run.
    static trail(text, read) {
        const head = text.match(TrailingLinks.TASK_LINE);
        if (!head) return null;
        const links = [];
        let end = TrailingLinks.blockId(text)?.from ?? text.length;
        end = text.slice(0, end).trimEnd().length;
        for (;;) {
            const m = TrailingLinks.lastLink(text.slice(0, end), read);
            if (!m) break;
            const from = end - m[0].length;
            const kind = TrailingLinks.KINDS[String.fromCodePoint(m[2].codePointAt(0))] ?? "forward";
            links.unshift({ from, to: end, kind, target: m[1].trim(), alias: m[2] });
            end = text.slice(0, from).trimEnd().length;
        }
        if (!links.length) return null;
        return { bodyFrom: head[0].length, textEnd: end, runFrom: links[0].from, runTo: links[links.length - 1].to, links };
    }

    // Where the text's last word starts (a link ending the text is one word), or -1 when there's
    // no text between `bodyFrom` and `end`. That word wraps with the run.
    // Whether a fold starts at `pos`, a line's end: CodeMirror folds a list item from the end of its
    // line, where Obsidian then draws its "…" (OBS-203: the line's class says so, for styles.css, which
    // would otherwise need :has to see the "…"). `folds` is CodeMirror's foldedRanges.
    /** @param {{ between(from: number, to: number, f: (from: number, to: number) => void | false): void }} folds @param {number} pos @returns {boolean} */
    static folded(folds, pos) {
        let found = false;
        folds.between(pos, pos, (from) => {
            if (from !== pos) return;
            found = true;
            return false;
        });
        return found;
    }

    static lastWordStart(text, bodyFrom, end) {
        if (end <= bodyFrom) return -1;
        const before = text.slice(0, end);
        let at = before.search(/\S+$/);
        for (const m of before.matchAll(/\[\[[^\]]*\]\]/g)) {
            if (at > m.index && at < m.index + m[0].length) at = m.index;
        }
        return Math.max(at, bodyFrom);
    }

    // The name a project or area link is shown with: the shortest of the note's name and its
    // aliases, leaving out the ⭕.Area.Project style ones. The name wins a tie.
    static shortestName(basename, aliases) {
        const plain = [].concat(aliases ?? [])
            .filter((a) => a !== null && a !== undefined)
            .map(String)
            .filter((a) => a && !/^(?:⭕|🗃)/u.test(a));
        return plain.reduce((best, a) => (a.length < best.length ? a : best), basename);
    }

    // Whether a due link's target, read as a day's note (`read`, as periodicLine), is before `today`
    // (YYYY-MM-DD). A 🚩 on a link to any other note never is.
    static overdue(target, today, read) {
        const period = TrailingLinks.reader(read)(target);
        return period?.unit === "day" && period.date < today;
    }

    // A line's indent, a tab counting as four spaces (as TimeReport counts it)
    static indent(text) {
        let w = 0;
        for (const ch of text.match(/^\s*/)[0]) w += ch === "\t" ? 4 : 1;
        return w;
    }

    // The last of the `count` lines that's nested under line `n` (n itself when none is)
    static subtreeEnd(lineAt, count, n) {
        const base = TrailingLinks.indent(lineAt(n));
        let last = n;
        for (let i = n + 1; i <= count; i++) {
            const text = lineAt(i);
            if (!text.trim()) continue;
            if (TrailingLinks.indent(text) <= base) break;
            last = i;
        }
        return last;
    }

    // Where an edit on a task line goes instead, so its hidden ID stays at the end of the line (spec
    // default 11), or null to leave the edit as it is. `edit` is the one change on line `text`, in
    // offsets into it: { from, to, insert, cursor (where the edit leaves the cursor, an offset into
    // insert) }. The answer: { changes: [{ from, insert }] in offsets into the line, cursor (an
    // offset from the line's start, after the changes) }.
    //   - Text put in after the ID (typed once End or a click right of the line shows it): what comes
    //     before any break goes in at the end of the line's text, ahead of its links, since text between
    //     them and the ID breaks their run; on a line with no links, just before the ID.
    //   - On a task with no text yet (`- [ ] ^id`, the checkbox's space and the ID's are one), text typed
    //     on either side of that space or after the ID gets a space of its own after the checkbox.
    // Enter, and any other text with a line break put in before the ID, is left as it is: Enter is
    // Obsidian's own (fix round 1). The start the old and new text share is left out (an edit may
    // replace the character before the cursor with itself), and an edit that takes text off is left
    // alone.
    static keepIdAtEnd(text, edit, read) {
        if (!TrailingLinks.TASK_LINE.test(text)) return null;
        const id = TrailingLinks.blockId(text, { strict: true });
        if (!id) return null;
        const old = text.slice(edit.from, edit.to);
        let same = 0;
        while (same < old.length && same < edit.insert.length && old[same] === edit.insert[same]) same++;
        const from = edit.from + same, taken = old.slice(same), insert = edit.insert.slice(same);
        if (/\S/.test(taken)) return null;
        const br = insert.indexOf("\n");
        const before = br < 0 ? insert : insert.slice(0, br), after = br < 0 ? "" : insert.slice(br);
        // Whether `before`, put in at `n`, would follow the checkbox straight away: a task with no text yet
        // shares the checkbox's space with what's after it, so the text gets a space of its own there and
        // the box stays a box
        const boxOnly = (n) => /^\s*[-*+]\s+\[.\]$/.test(text.slice(0, n)) && /^\S/.test(before);
        // Where `before` goes; `after` goes at the end of the line
        let at;
        if (before && !taken && from >= id.to) at = TrailingLinks.trail(text, read)?.textEnd ?? id.from;
        else if (boxOnly(id.from) && !taken && !after && (from === id.from || from === id.from + 1)) at = id.from;
        else return null;
        const pad = boxOnly(at) ? " " : "";
        const cursor = Math.max(0, Math.min(insert.length, edit.cursor - same));
        return {
            changes: [{ from: at, insert: pad + before }, { from: text.length, insert: after }].filter((c) => c.insert),
            cursor: cursor <= before.length ? at + pad.length + cursor : text.length + pad.length + cursor,
        };
    }

    // ---------------------------------------------------------------- the editor extension

    async invoke() {
        // The handles live on window, so a second run undoes the first: one set of listeners, however
        // often it runs
        this.deconstructor();
        const T = TrailingLinks;
        const ws = app.workspace;

        // One registered slot per load of Plainday; a rerun swaps what's in it
        const kept = window.pmTrailingLinks;
        const slot = kept?.slot && ws.editorExtensions?.includes?.(kept.slot) ? kept.slot : null;
        const handles = { slot: slot ?? [], refs: [], widths: new Map(), size: null, timer: null, midnight: null };
        window.pmTrailingLinks = handles;
        if (!slot) plainday.plugin.registerEditorExtension(handles.slot);

        // Redraw every line on screen: a note moved or retagged, or the day changed
        const refresh = StateEffect.define();
        const redrawAll = () => ws.iterateAllLeaves((leaf) => leaf.view?.editor?.cm?.dispatch?.({ effects: refresh.of(null) }));

        const sourceOf = (v) => v.state.field(editorInfoField, false)?.file?.path ?? "";
        const noteFor = (linktext, sourcePath) => app.metadataCache.getFirstLinkpathDest(linktext.split(/[#^]/)[0], sourcePath);
        const nameOf = (file, fallback) => file
            ? T.shortestName(file.basename, app.metadataCache.getFileCache(file)?.frontmatter?.aliases)
            : fallback.split("/").pop();

        // The decorations for the lines in `ranges` (by default, the lines on screen)
        const build = (v, ranges = v.visibleRanges) => {
            const none = { outer: Decoration.none, inner: Decoration.none, unmeasured: false };
            if (!v.state.field(editorLivePreviewField, false)) return none;
            const doc = v.state.doc;
            const sourcePath = sourceOf(v);
            const today = moment().format("YYYY-MM-DD");
            // The names of periodic notes read as the settings are now, once for the lines drawn
            const read = T.reader();
            const folds = foldedRanges(v.state);
            const outer = [], inner = [];
            let unmeasured = false;
            for (const { from, to } of ranges) {
                for (let pos = from; pos <= to;) {
                    const line = doc.lineAt(pos);
                    pos = line.to + 1;
                    // A task's ID (OBS-181) is hidden unless the cursor is at it: a second End shows it. The
                    // cursor at the end of the text (just before the space ahead of the ID) keeps it
                    // hidden, so typing there doesn't show it; one past that space, or at the line's
                    // end, shows it
                    const id = T.TASK_LINE.test(line.text) ? T.blockId(line.text, { strict: true }) : null;
                    let idShown = null;
                    if (id) {
                        const head = v.state.selection.main.head;
                        if (head <= line.from + id.from || head > line.to) inner.push(Decoration.replace({}).range(line.from + id.from, line.from + id.to));
                        else idShown = id;
                    }
                    const t = T.trail(line.text, read);
                    if (!t) continue;
                    // A shown ID (OBS-185) is drawn in the run, last, at the right edge after the links: where
                    // it is in the text, after the room the last word keeps, it lands on top of them
                    const idText = idShown ? line.text.slice(idShown.from + 1, idShown.to) : null;
                    const at = (i) => line.from + i;
                    const shown = t.links.map((l) => {
                        if (l.kind !== "project" && l.kind !== "area") return { l, text: l.alias };
                        return { l, text: nameOf(noteFor(l.target, sourcePath), l.target), name: true };
                    });
                    // What the links show decides their width, so it keys the measured widths
                    const sig = shown.map((s) => `${s.l.kind}:${s.text}`).concat(idText ? [`id:${idText}`] : []).join("\n");
                    if (!handles.widths.has(sig)) unmeasured = true;
                    const guess = shown.reduce((w, s) => w + T.PILL_PX + T.CHAR_PX * s.text.length, 0) + (idText ? T.PILL_PX + T.CHAR_PX * idText.length : 0);
                    const width = Math.ceil((handles.widths.get(sig) ?? guess) + T.GAP_PX);

                    outer.push(Decoration.line({ class: T.folded(folds, line.to) ? "pm-trail-line pm-trail-folded" : "pm-trail-line", attributes: { style: `--pm-run-w: ${width}px` } }).range(line.from));
                    const word = T.lastWordStart(line.text, t.bodyFrom, t.textEnd);
                    if (word >= 0) {
                        // The space before the links too, so a struck-through line has no stray dash
                        outer.push(Decoration.mark({ class: "pm-trail-glue" }).range(at(word), at(t.runFrom)));
                    }
                    // inclusive: it sorts outside a link with the same range (a run of one)
                    outer.push(Decoration.mark({ inclusive: true, class: "pm-trail-run", attributes: { "data-pm-sig": sig } }).range(at(t.runFrom), at(idShown ? idShown.to : t.runTo)));
                    // Measured with the links (it has their .pm-trail), so the last word keeps room for it too
                    if (idShown) outer.push(Decoration.mark({ class: "pm-trail pm-trail-id" }).range(at(idShown.from + 1), at(idShown.to)));
                    for (const s of shown) {
                        const overdue = s.l.kind === "due" && T.overdue(s.l.target, today, read) ? " pm-trail-overdue" : "";
                        outer.push(Decoration.mark({ class: `pm-trail pm-trail-${s.l.kind}${overdue}` }).range(at(s.l.from), at(s.l.to)));
                        if (s.name) {
                            // The alias itself, inside Obsidian's link, drawn as the name: the link still works
                            const raw = line.text.slice(s.l.from, s.l.to);
                            inner.push(Decoration.mark({ class: "pm-project-name", attributes: { "data-pm-name": s.text } })
                                .range(at(s.l.from + raw.lastIndexOf("|") + 1), at(s.l.to - 2)));
                        }
                    }
                }
            }
            return { outer: Decoration.set(outer, true), inner: Decoration.set(inner, true), unmeasured };
        };

        // Measures links it hasn't seen yet (the same links are the same width anywhere), then redraws
        const measure = (v) => v.requestMeasure({
            key: handles,
            read: (rv) => [...rv.contentDOM.querySelectorAll(".pm-trail-run[data-pm-sig]")]
                .filter((run) => !handles.widths.has(run.dataset.pmSig))
                // Not while a link on the line is open: its markdown is wider than the pills
                .filter((run) => !run.closest(".pm-trail-line")?.querySelector(".pm-trail-run :is(.cm-formatting-link, .cm-link-alias-pipe)"))
                .map((run) => {
                    // Only the pills: the space between two links is an element too, and it lays out
                    // at the far left
                    const pills = [...run.children].filter((k) => k.classList.contains("pm-trail"))
                        .map((k) => k.getBoundingClientRect()).filter((r) => r.width > 0);
                    if (!pills.length) return null;
                    const width = Math.max(...pills.map((r) => r.right)) - Math.min(...pills.map((r) => r.left)) + T.PILL_MARGIN_PX;
                    return [run.dataset.pmSig, Math.ceil(width)];
                })
                .filter(Boolean),
            write: (found, wv) => {
                if (!found.length) return;
                for (const [sig, w] of found) handles.widths.set(sig, w);
                window.setTimeout(() => wv.dispatch({ effects: refresh.of(null) }));
            },
        });

        const span = (v) => v.visibleRanges.map((r) => `${v.state.doc.lineAt(r.from).number}-${v.state.doc.lineAt(r.to).number}`).join(",");

        const plugin = ViewPlugin.fromClass(class {
            constructor(v) {
                Object.assign(this, build(v));
                this.span = span(v);
                if (this.unmeasured) measure(v);
            }

            update(u) {
                // CodeMirror calls every edit a viewport change (the positions after it move), so what
                // counts is which lines are on screen
                const now = span(u.view);
                const size = `${u.view.defaultCharacterWidth}/${u.view.defaultLineHeight}`;
                if (size !== handles.size) {
                    handles.widths.clear();
                    handles.size = size;
                }
                // A line folded or unfolded redraws too, for its class (.pm-trail-folded). An edit maps the
                // folds, so they're compared only when nothing was typed: an edit redraws its lines anyway
                const full = now !== this.span || u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))
                    || u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false)
                    || (!u.docChanged && foldedRanges(u.startState) !== foldedRanges(u.state));
                this.span = now;
                if (!full && !u.docChanged) {
                    // The cursor moved: redraw the lines it left and reached, when they have a hidden ID
                    if (!u.selectionSet) return;
                    const touched = this.idLines(u);
                    if (!touched.length) return;
                    this.merge(u, build(u.view, touched), touched);
                } else {
                    const touched = full ? null : this.touched(u);
                    if (!touched) Object.assign(this, build(u.view));
                    else this.merge(u, build(u.view, touched), touched);
                }
                if (this.unmeasured) measure(u.view);
            }

            // Swaps the decorations of the lines in `touched` for `part`, what build drew for them;
            // the rest are mapped through the update's changes
            merge(u, part, touched) {
                const inside = (pos) => touched.some((r) => pos >= r.from && pos <= r.to);
                const add = (set, more) => set.map(u.changes).update({ filter: (from) => !inside(from), add: [...T.ranges(more)], sort: true });
                this.outer = add(this.outer, part.outer);
                this.inner = add(this.inner, part.inner);
                this.unmeasured = part.unmeasured;
            }

            // The lines with a hidden ID (OBS-181) that the cursor left and reached, each once: the ID
            // shows only while the cursor is at it. Only the main cursor counts, as in build.
            idLines(u) {
                const doc = u.state.doc;
                const lines = [u.startState.selection.main.head, u.state.selection.main.head].map((p) => doc.lineAt(Math.min(p, doc.length)));
                // lineAt makes a new Line each call: tell two apart by number, or one line is drawn twice
                return lines
                    .filter((l, i) => T.TASK_LINE.test(l.text) && T.blockId(l.text, { strict: true }) && lines.findIndex((o) => o.number === l.number) === i)
                    .map((l) => ({ from: l.from, to: l.to }));
            }

            // The lines an edit touched, each with the lines nested under it, or null when the edit spans
            // lines or changes an indent: then everything on screen is redrawn
            touched(u) {
                const doc = u.state.doc, old = u.startState.doc, out = [];
                let lines = 0, whole = false;
                u.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
                    const before = old.lineAt(fromA), first = doc.lineAt(fromB);
                    if (before.number !== old.lineAt(toA).number || first.number !== doc.lineAt(toB).number
                        || before.text.match(/^\s*/)[0] !== first.text.match(/^\s*/)[0]) {
                        whole = true;
                        return;
                    }
                    const last = doc.line(T.subtreeEnd((n) => doc.line(n).text, doc.lines, first.number));
                    lines += last.number - first.number + 1;
                    out.push({ from: first.from, to: last.to });
                });
                return whole || lines > T.MAX_PIECEMEAL ? null : out;
            }
        }, { decorations: (p) => p.inner });
        // Outer decorations wrap Obsidian's own link spans, so the links are one element and each link
        // is one inside it; ordinary decorations would be split up by them
        const outer = EditorView.outerDecorations.of((v) => v.plugin(plugin)?.outer ?? Decoration.none);

        // End and Cmd-→: where the default would stop in the moved links (or past the text, on the
        // line's last row), go where endStop says, or straight to the end of the line in Source mode.
        // A hidden ID (OBS-181) counts as a link: the default can stop just before it.
        const toEnd = (extend) => (v) => {
            const { state: s } = v;
            const live = s.field(editorLivePreviewField, false);
            let hit = false;
            const ranges = s.selection.ranges.map((r) => {
                const line = s.doc.lineAt(r.head);
                let head = v.moveToLineBoundary(r, true, true).head;
                const stop = T.endStop(line.text, r.head - line.from, head - line.from);
                if (stop !== null) {
                    hit = true;
                    head = live ? line.from + stop : line.to;
                }
                // Leaning left, as the default does: on a folded line, it would be drawn beside the "…"
                return extend ? EditorSelection.range(r.anchor, head) : EditorSelection.cursor(head, -1);
            });
            if (!hit) return false;
            v.dispatch({ selection: EditorSelection.create(ranges, s.selection.mainIndex), scrollIntoView: true, userEvent: "select" });
            return true;
        };
        // Enter at the end of the text, where End now stops, acts as at the end of the line, so End, then
        // Enter, still leaves the links and the ID on their line. It only moves the cursor, and returns
        // false: the Enter itself stays Obsidian's own.
        const enter = (v) => {
            const { state: s } = v;
            const { ranges, main } = s.selection;
            if (ranges.length > 1 || !main.empty || !s.field(editorLivePreviewField, false)) return false;
            const line = s.doc.lineAt(main.head);
            const textEnd = T.textEnd(line.text);
            if (textEnd === null || main.head !== line.from + textEnd) return false;
            v.dispatch({ selection: { anchor: line.to }, userEvent: "select" });
            return false;
        };
        const keys = Prec.highest(keymap.of([
            { key: "End", run: toEnd(false), shift: toEnd(true) },
            { mac: "Mod-ArrowRight", run: toEnd(false), shift: toEnd(true) },
            { key: "Enter", run: enter },
        ]));

        // A click on a moved link opens that link. Caught on the way down, before CodeMirror and
        // Obsidian, which would pick the link from where the click lands in the text.
        const linkAt = (e, v) => {
            const pill = e.target.closest?.(".pm-trail");
            const lineEl = pill?.closest(".pm-trail-line");
            if (!lineEl || lineEl.querySelector(".pm-trail-run :is(.cm-formatting-link, .cm-link-alias-pipe)")) return null;
            const pos = v.posAtDOM(pill);
            const line = v.state.doc.lineAt(pos);
            return T.trail(line.text)?.links.find((l) => pos >= line.from + l.from && pos < line.from + l.to) ?? null;
        };
        const EVENTS = ["pointerdown", "mousedown", "mouseup", "click", "auxclick"];
        const clicks = ViewPlugin.fromClass(class {
            constructor(v) {
                this.v = v;
                this.handler = (e) => {
                    if (e.button !== 0 && e.button !== 1) return;
                    const link = linkAt(e, v);
                    if (!link) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.type !== "click" && e.type !== "auxclick") return;
                    if (e.type === "auxclick" && e.button !== 1) return;
                    app.workspace.openLinkText(link.target, sourceOf(v), e.button === 1 ? "tab" : Keymap.isModEvent(e));
                };
                for (const type of EVENTS) v.dom.addEventListener(type, this.handler, true);
            }

            destroy() {
                for (const type of EVENTS) this.v.dom.removeEventListener(type, this.handler, true);
            }
        });

        // A task's ID stays at the end of its line (OBS-181, spec default 11): text typed or pasted
        // just after a hidden ID goes where keepIdAtEnd says (ahead of the links). Only input (typing,
        // a paste), with one cursor and one change on one line, so commands, Sync, undo, Enter and the
        // scripts' own writes pass through untouched. With two cursors an edit passes through as it is.
        const keepId = EditorState.transactionFilter.of((tr) => {
            // Composed input (an IME, an accent key) is left alone: moving it would break the composition
            if (!tr.docChanged || !tr.isUserEvent("input") || tr.isUserEvent("input.type.compose")) return tr;
            if (tr.startState.selection.ranges.length !== 1) return tr;
            let one = null, count = 0;
            tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                count++;
                one = { fromA, toA, fromB, inserted };
            });
            if (count !== 1) return tr;
            const line = tr.startState.doc.lineAt(one.fromA);
            if (one.toA > line.to) return tr;
            const moved = T.keepIdAtEnd(line.text, {
                from: one.fromA - line.from,
                to: one.toA - line.from,
                insert: one.inserted.toString(),
                // Where the edit put the cursor, within the inserted text (an auto-paired bracket leaves it inside)
                cursor: tr.newSelection.main.head - one.fromB,
            });
            if (!moved) return tr;
            return {
                changes: moved.changes.map((c) => ({ from: line.from + c.from, insert: c.insert })),
                selection: { anchor: line.from + moved.cursor },
                userEvent: tr.annotation(Transaction.userEvent),
                scrollIntoView: true,
            };
        });

        handles.slot.length = 0;
        handles.slot.push(Prec.highest(plugin), outer, keys, clicks, keepId);
        ws.updateOptions();

        // A note moved, renamed, retagged or given an alias changes a name; a theme or snippet
        // change changes the widths
        const later = () => {
            window.clearTimeout(handles.timer);
            handles.timer = window.setTimeout(redrawAll, T.REDRAW_MS);
        };
        handles.refs.push(
            app.vault.on("rename", later),
            app.vault.on("delete", later),
            app.metadataCache.on("changed", later),
            ws.on("css-change", () => {
                handles.widths.clear();
                later();
            }),
        );
        // A due date turns red at midnight
        const atMidnight = () => {
            const next = moment().add(1, "day").startOf("day").add(1, "second");
            handles.midnight = window.setTimeout(() => {
                redrawAll();
                atMidnight();
            }, next.diff(moment()));
        };
        atMidnight();
    }

    deconstructor() {
        const handles = window.pmTrailingLinks;
        if (!handles) return;
        for (const ref of handles.refs) ref.e.offref(ref);
        handles.refs = [];
        window.clearTimeout(handles.timer);
        window.clearTimeout(handles.midnight);
        // The slot stays registered for the next run to fill
        handles.slot.length = 0;
        app.workspace.updateOptions();
    }

    // A decoration set's ranges, to add to another set
    static *ranges(set) {
        for (const c = set.iter(); c.value; c.next()) yield c.value.range(c.from, c.to);
    }
}
