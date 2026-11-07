class DueDate {
    // Note links end a line (⋯ task note or log, ↗ the note it was sent from, ⭕ project, 🗃️ area), so End reaches the note; the
    // due date goes in front of them (OBS-36), and in front of a sent line's forward date (OBS-107): a
    // link to a periodic note's line with a date for its label, `[[2026-10-08#^k3x9m2|10/8]]`, or one
    // written with a ➡️ before its date. A task's ID stays last (OBS-181). A phone may add or drop the U+FE0F on an emoji.
    static NOTE_LINK = /\[\[[^\]]*\|\s*(?:⋯|↗|⭕|🗃|➡)\uFE0F?[^\]]*\]\]|\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]/gu;
    static BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/;
    // A due date, with any whitespace before it: a link to a day's note with a 🚩 for its label. A link
    // to a day with no 🚩 isn't one, and neither is a 🚩 on a link to any other note.
    static DUE_LINK = /(\s*)\[\[(?:[^\]|#]*\/)?\d{4}-\d{2}-\d{2}\|\s*🚩\uFE0F?[^\]]*\]\]/gu;

    // Where the due link goes on `lineText`, and the text to insert there: over the 🚩 the line has, the
    // first one if there are more, which go (OBS-65); else right before the line's trailing note links
    // and forward date (with one space either side), else at the end, ahead of an ID
    placement(lineText, dueLink) {
        const flags = [...lineText.matchAll(DueDate.DUE_LINK)];
        if (flags.length) {
            const [first, last] = [flags[0], flags[flags.length - 1]];
            const from = first.index + first[1].length, to = last.index + last[0].length;
            return { from, to, text: dueLink + lineText.slice(from, to).replace(DueDate.DUE_LINK, "") };
        }
        const id = lineText.match(DueDate.BLOCK_ID);
        const trimmed = lineText.slice(0, id ? id.index : lineText.length).trimEnd();
        let at = trimmed.length;
        for (;;) {
            const head = trimmed.slice(0, at).trimEnd();
            const last = [...head.matchAll(DueDate.NOTE_LINK)].pop();
            if (!last || last.index + last[0].length !== head.length) break;
            at = last.index;
        }
        if (at === trimmed.length) {
            if (id) return { from: trimmed.length, to: id.index, text: ` ${dueLink}` };
            return { from: lineText.length, to: lineText.length, text: `${lineText.endsWith(" ") || !lineText.length ? "" : " "}${dueLink} ` };
        }
        const before = trimmed.slice(0, at).trimEnd();
        return { from: before.length, to: at, text: ` ${dueLink} ` };
    }

    // Where a cursor at `ch` ends up after that change: on the same words, ahead of a 🚩 added right
    // where it is. One inside a replaced 🚩 goes to the start of the new one.
    cursorAfter(ch, { from, to, text }) {
        return ch <= from ? ch : ch < to ? from : ch + text.length - (to - from);
    }

    // The due link for a date (a moment): [[2026-09-25|🚩 9/25]]
    static link(m) {
        return `[[${m.format("YYYY-MM-DD")}|🚩 ${m.format("M/D")}]]`;
    }

    // `lineText` with the due link placed on it (placement)
    placed(lineText, dueLink) {
        const { from, to, text } = this.placement(lineText, dueLink);
        return lineText.slice(0, from) + text + lineText.slice(to);
    }

    async invoke() {
        const { MarkdownView } = customJS.obsidian;
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) { new Notice("Need an active editor"); return; }
        if (view.file && customJS.TaskIds && !customJS.TaskIds.works(view.file)) return;

        const editor = view.editor;
        // On a sub-task, or any line under a task, the deadline is the task's: the line at the top of the nest
        // (rule 5, OBS-193). An event has none (rule 14), whatever its form.
        const cursor = editor.getCursor();
        const top = customJS.TimeReport.topOf((n) => editor.getLine(n), cursor.line);
        if (top.event) {
            new Notice("An event has no deadline, so none was set");
            return;
        }
        const lineNum = top.at;

        // Bail unless the line starts with a checklist box: "- [ ]", "- [x]", "- [>]", etc.
        if (top.box === null) {
            new Notice("Not on a checklist item");
            return;
        }
        // Until Obsidian has indexed the vault at startup, the task's other lines can't be found (rule 12)
        if (customJS.TaskChange && !customJS.TaskChange.ready()) return;

        const foldBefore = view.currentMode.getFoldInfo?.();

        const read = top.line, file = view.file;
        customJS.DatePrompt.open("Due date", async ({ m }, modal) => {
            const lineText = editor.getLine(lineNum);
            // The date box waited on you: don't write into a line that changed meanwhile (rule 12)
            if (lineText !== read) {
                modal.close();
                new Notice("The line changed while the date box was open, so no deadline was set");
                return;
            }
            const change = this.placement(lineText, DueDate.link(m));

            // Insert while the modal is still open — same order NLD uses
            editor.replaceRange(change.text, { line: lineNum, ch: change.from }, { line: lineNum, ch: change.to });
            // The cursor stays where it was, on the line or under it
            editor.setCursor(lineNum !== cursor.line ? cursor : { line: lineNum, ch: this.cursorAfter(cursor.ch, change) });
            modal.close();

            // Safety net: if the fold got dropped anyway, restore the pre-edit fold map
            setTimeout(() => {
                const wasFolded = foldBefore?.folds?.some(f => f.from === lineNum);
                const after = view.currentMode.getFoldInfo?.();
                const stillFolded = after?.folds?.some(f => f.from === lineNum);
                if (wasFolded && !stillFolded && view.currentMode.applyFoldInfo) {
                    view.currentMode.applyFoldInfo(foldBefore);
                }
            }, 50);

            // The rest of the task follows, searched only now, so the date box never waits on it (OBS-229)
            if (file && customJS.TaskChange) await this.spread({ file, at: lineNum }, m);
        });
    }

    // Every other line of the task on line `start` ({ file, at }, the one just written) gets the same 🚩, and
    // its task note gets the date as its `due` (rule 16: a command writes every copy it finds). A task's lines
    // are TaskChange.find's, from the top of the nest, with `family: false`: by ID and by ⋯, never a subtask's,
    // which keeps its own deadline. An event line among them gets none. Says nothing when it all went through, only
    // what it couldn't write or left alone (Brian, 2026-11-07: no notice for what you'd expect); never throws into
    // the date box.
    async spread(start, m) {
        const change = customJS.TaskChange, tr = customJS.TimeReport;
        const dueLink = DueDate.link(m), date = m.format("YYYY-MM-DD");
        let found;
        try {
            found = await change.find(start, { family: false });
        } catch (e) {
            console.error("DueDate: couldn't find the task's other lines", e);
            new Notice("Only this line got the deadline: the task's other lines couldn't be found. Run DueDate again");
            return;
        }
        const byFile = new Map();
        for (const l of found.lines) {
            if (!l.task || tr.eventKind(l.seen) || (l.file.path === start.file.path && l.at === start.at)) continue;
            if (!byFile.has(l.file.path)) byFile.set(l.file.path, []);
            byFile.get(l.file.path).push(l);
        }
        const missed = [], failed = [];
        for (const list of byFile.values()) {
            const { file } = list[0];
            try {
                const done = await change.rewrite(file, list, (text) => this.placed(text, dueLink));
                missed.push(...done.missed);
            } catch (e) {
                console.error(`DueDate: couldn't write ${file.path}`, e);
                failed.push(file);
            }
        }
        // The task notes its lines link with ⋯; a log, a plain note, and a project's or area's own note have no `due`
        const kept = [], unread = [], odd = [];
        for (const note of found.own) {
            try {
                if (!(await change.isTaskNote(note))) continue;
                const done = await this.setDue(note, date);
                if (done === "unread") unread.push(note);
                else if (done === "odd") odd.push(note);
            } catch (e) {
                console.error(`DueDate: couldn't set the due of ${note.path}`, e);
                if (!failed.includes(note)) failed.push(note);
            }
        }
        // A task note no command works in keeps its `due`, said so (rule 3: warn after, never block)
        for (const note of found.stays) {
            try {
                if (await change.isTaskNote(note)) kept.push(note);
            } catch (e) {
                console.error(`DueDate: couldn't read ${note.path}`, e);
            }
        }
        for (const text of this.said({ missed, failed, kept, unread, odd })) new Notice(text);
    }

    // Sets `note`'s `due` to `date` ("YYYY-MM-DD"), as the Task template writes it: `due: 2026-09-25`. Resolves to
    // "set"; "same", due that day already; "odd", a shape the one-line edit leaves alone (withDue), set by hand;
    // or "unread", properties Obsidian can't read. Only the one line changes, through the editor when the note
    // is open (Schedule.rewrite), so the other properties stay exactly as they are and an edit not yet saved isn't
    // lost; and only when Obsidian reads the result as the same properties with the new `due` (Brian, 2026-11-06:
    // no processFrontMatter, which lays the block out again and works from the saved file).
    async setDue(note, date) {
        const ob = customJS.obsidian;
        const props = (text) => {
            try {
                const info = ob.getFrontMatterInfo(text);
                return info.exists ? ob.parseYaml(info.frontmatter) ?? {} : {};
            } catch (e) {
                return undefined;
            }
        };
        const others = (fm) => { const rest = { ...fm }; delete rest.due; return JSON.stringify(rest); };
        // What the edit makes of `text`, and the result to report
        let result = "odd";
        const edit = (text) => {
            const before = props(text);
            if (before === undefined) { result = "unread"; return text; }
            const now = DueDate.withDue(text, date);
            if (now?.same) { result = "same"; return text; }
            const after = now?.text ? props(now.text) : undefined;
            if (!after || DueDate.dayOf(after.due) !== date || others(before) !== others(after)) { result = "odd"; return text; }
            result = "set";
            return now.text;
        };
        edit(await customJS.TaskIds.readNow(note));
        if (result !== "set") return result;
        await customJS.Schedule.rewrite(note, edit);
        return result;
    }

    // `text` (a note) with its `due` set to `date`: { text }, or { same: true } when it's due that day already, or
    // null to leave it alone. Only the plain shapes the Task template and Obsidian write are done here: the
    // properties between two `---` at the left edge, and either one `due:` line at the left edge whose value is
    // plain (empty, or a date, quoted or not) followed by another key or the end, which is replaced, or no `due`
    // at all, which is added last. Anything else (a quoted key, a comment, a value over several lines, no
    // properties block) is null, so it can never write YAML that Obsidian can't read: that `due` is set by hand.
    static withDue(text, date) {
        const lines = text.split("\n");
        const bare = (l) => l.replace(/\r$/, "");
        const fence = (l) => /^---[ \t]*$/.test(bare(l));
        if (!fence((lines[0] ?? "").replace(/^﻿/, ""))) return null;
        const end = lines.findIndex((l, i) => i > 0 && fence(l));
        if (end === -1) return null;
        const props = lines.slice(1, end).map(bare);
        // Any mention of a due key the plain shape doesn't cover: quoted, indented, or more than one
        if (props.filter((l) => /^\s*["']?due["']?\s*:/.test(l)).length !== props.filter((l) => /^due:/.test(l)).length) return null;
        const at = props.map((l, i) => i).filter((i) => /^due:/.test(props[i]));
        if (at.length > 1) return null;
        const cr = lines[0].endsWith("\r") ? "\r" : "";
        if (!at.length) {
            lines.splice(end, 0, `due: ${date}${cr}`);
            return { text: lines.join("\n") };
        }
        const i = at[0], value = props[i].slice("due:".length).trim();
        if (!/^(?:|\d{4}-\d{2}-\d{2}|"\d{4}-\d{2}-\d{2}"|'\d{4}-\d{2}-\d{2}')$/.test(value)) return null;
        // What follows must be another key at the left edge, or the end: nothing carried over from this one
        const next = props.slice(i + 1).find((l) => l.trim());
        if (next !== undefined && !/^[A-Za-z_][\w-]*\s*:/.test(next)) return null;
        if (DueDate.dayOf(value) === date) return { same: true };
        lines[i + 1] = `due: ${date}${lines[i + 1].endsWith("\r") ? "\r" : ""}`;
        return { text: lines.join("\n") };
    }

    // A `due` as "YYYY-MM-DD", whether YAML read it as text or as a date; else null
    static dayOf(value) {
        if (typeof value?.toISOString === "function") return value.toISOString().slice(0, 10);
        return typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "") || null : null;
    }

    // What spread says, a notice each, only about what didn't go as you'd expect: the notes it couldn't write, the
    // lines that changed meanwhile, then each task note it left alone. Nothing when it all went through. `missed`:
    // the other lines not found as they were; `failed`: notes it couldn't write; `unread`: task notes whose
    // properties Obsidian can't read, so running again wouldn't help; `odd`: task notes whose `due` is written in
    // a way DueDate doesn't change; `kept`: task notes outside where the commands work.
    said({ missed = [], failed = [], kept = [], unread = [], odd = [] }) {
        const out = [];
        const list = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
        const where = (file) => customJS.TaskChange.dayName(file);
        if (failed.length) out.push(`Couldn't write to ${list(failed.map(where))}; run DueDate again to finish`);
        if (missed.length === 1) out.push(`${where(missed[0].file)}'s line changed meanwhile, so it kept its old deadline. Run DueDate again to finish`);
        else if (missed.length) out.push(`${missed.length} lines (${list([...new Set(missed.map((l) => where(l.file)))])}) changed meanwhile, so they kept their old deadline. Run DueDate again to finish`);
        for (const note of unread) out.push(`${note.basename}'s properties can't be read, so its due wasn't changed. Fix them, then run DueDate again`);
        for (const note of odd) out.push(`${note.basename}'s due is written in a way DueDate doesn't change, so it wasn't changed. Set it by hand`);
        for (const note of kept) {
            const place = note.path.startsWith(customJS.TaskIds.constructor.ARCHIVE) ? "is in Archive" : "isn't in Projects or the Inbox";
            out.push(`${note.basename} ${place}, so its due wasn't changed`);
        }
        return out;
    }
}
