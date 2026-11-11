class TaskIds {
    // Task identity (OBS-181). Every line of a task carries the same block ID at its end, `^k3x9m2`.
    // Obsidian only needs a block ID to be unique within its note, so one ID on lines in several notes
    // is valid, and [[note#^k3x9m2]] lands on that note's line. This class makes IDs, reads and writes
    // them and the forward date a sent line carries, finds a task's lines through Obsidian's metadata cache
    // without reading files, and checks that a task's lines agree (check). The text rules are static
    // and pure.

    // A block ID ending a line, as Obsidian reads one: a space, then ^ and letters, digits or dashes
    static ID_AT_END = /\s\^([A-Za-z0-9-]+)\s*$/;
    static ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
    static ID_LENGTH = 6;
    // A forward date on its own: [[2026-10-08#^k3x9m2|10/8]], a link to a periodic note (a day, week,
    // month or year, by name or path) and the task's line in it, with a date for its label as Schedule
    // writes one ("10/8", "Wk of 10/4", "Oct. 2026", any locale's short month name as one word, "10月 2026" too, then the year; "2027"). A block
    // link of your own to a day's line, with words for its alias, isn't one: it stays in the text. One
    // written with a ➡️ before its date (before OBS-185's first test round) is read too, the ➡️ left
    // out of its label; a phone may drop the U+FE0F.
    static FORWARD = /^\[\[(?=(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]|[^\]]*\|\s*➡)([^\]|#]+)(?:#\^([A-Za-z0-9-]+))?\|\s*(?:➡️?\s*)?([^\]]*)\]\]$/u;
    // One item of the run of links that ends a line, with the spaces before it: a 🚩, ⋯, ↗, ⭕ or
    // 🗃️ link, a forward date (or one written with a ➡️), or the ℹ️ or 🆓 mark. The same pattern as
    // AddTaskNote.TRAIL_ITEM, read with trailItem as AddTaskNote's is; TaskIds' statics must load in an
    // empty vm context, so they can't reach AddTaskNote, and these are copies that taskIds.test.mjs
    // checks against it.
    static TRAIL_ITEM = /[ ]*(?:\[\[[^\]|]+\|\s*(?:🚩️?\s*\d{1,2}\/\d{1,2}|➡️?[^\]]*|⋯|↗️?|⭕️?|🗃️?)\s*\]\]|\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]|(?:ℹ|🆓)️?)$/u;
    static trailItem(text) {
        const item = text.match(TaskIds.TRAIL_ITEM);
        if (!item) return null;
        const at = item.index + item[0].search(/[^ ]/);
        return text[at] === "[" || /\s/.test(text[at - 1] ?? "") ? item : null;
    }
    // The items a forward date goes before: a line's ⭕, 🗃️ and note links
    static HOME_OR_NOTE = /\|\s*(?:⭕|🗃|⋯|↗)/u;
    static CHECKBOX = /^\s*[-*+]\s+\[(.)\]/;
    // The breadcrumb a line sent from a note had before OBS-181, in front of its text: a link to a
    // day, week, month or year, by name or path. An event the calendar sync forwarded has a time and a
    // tab after its link, and isn't one.
    static OLD_FORWARD = /^(\s*[-*+]\s+\[>\]\s+)\[\[((?:[^\]|]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4}))(?:\|([^\]]*))?\]\] (?!(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t)/iu;

    // The block ID a line ends with, or null
    static idOf(line) {
        return line.match(TaskIds.ID_AT_END)?.[1] ?? null;
    }

    // `line` ending in ` ^id`, unless it ends in an ID already: that one is the task's, so a link made
    // with Copy link to block keeps working
    static withId(line, id) {
        return TaskIds.idOf(line) ? line : `${line.replace(/\s+$/, "")} ^${id}`;
    }

    // `line` without its block ID at the end
    static withoutId(line) {
        return line.replace(TaskIds.ID_AT_END, "");
    }

    // A new ID: ID_LENGTH letters and digits, none of `taken` (IDs in use, lowercased)
    static newId(taken, random = Math.random) {
        for (;;) {
            let id = "";
            for (let i = 0; i < TaskIds.ID_LENGTH; i++) id += TaskIds.ID_CHARS[Math.floor(random() * TaskIds.ID_CHARS.length)];
            if (!taken.has(id)) return id;
        }
    }

    // [[2026-10-08#^k3x9m2|10/8]]: `linktext` is the periodic note's name, or its path when another
    // note shares the name; `label` is "10/8", "Wk of 10/4", "Oct. 2026" or "2027". Just the date: the
    // [>] box already says it's where the task went, and a link to a line can't be taken for a 🚩.
    static forwardLink(linktext, label, id) {
        return `[[${linktext}#^${id}|${label}]]`;
    }

    // The run of links that ends a line, its ID set aside: { text, items }, the text before the run
    // with no trailing spaces, and the run's links and marks in line order
    static splitRun(line) {
        const bare = TaskIds.withoutId(line).replace(/\s+$/, "");
        const items = [];
        let at = bare.length;
        for (let m; (m = TaskIds.trailItem(bare.slice(0, at)));) {
            items.unshift(m[0].trim());
            at = m.index;
        }
        return { text: bare.slice(0, at).replace(/\s+$/, ""), items };
    }

    // The forward date in the run that ends a line: { raw, linkpath, id, label }, or null
    static forwardOf(line) {
        for (const raw of TaskIds.splitRun(line).items) {
            const m = raw.match(TaskIds.FORWARD);
            if (m) return { raw, linkpath: m[1].trim(), id: m[2] ?? null, label: m[3].trim() };
        }
        return null;
    }

    // `line` with `link` as its forward date (null: none), in the spec's order: in place of one it has, after
    // any 🚩, before the ⭕, 🗃️ and note link that end the line, the ID last
    static withForward(line, link) {
        const id = TaskIds.idOf(line);
        const { text, items } = TaskIds.splitRun(line);
        const kept = items.filter((i) => !TaskIds.FORWARD.test(i));
        if (link) {
            const at = kept.findIndex((i) => TaskIds.HOME_OR_NOTE.test(i));
            kept.splice(at === -1 ? kept.length : at, 0, link);
        }
        return [text, ...kept].join(" ") + (id ? ` ^${id}` : "");
    }

    // A line sent before OBS-181, its date in front: { linkpath, label, line } (the line without the
    // breadcrumb), or null
    static oldForward(line) {
        // A line with a forward date is in the new shape already: a date at its start is its title's
        if (TaskIds.forwardOf(line)) return null;
        const m = line.match(TaskIds.OLD_FORWARD);
        if (!m) return null;
        return { linkpath: m[2], label: m[3] ?? m[2].split("/").pop(), line: m[1] + line.slice(m[0].length) };
    }

    // Whether the run that ends a line has a ⋯, wherever it links
    static hasOwnNote(line) {
        return TaskIds.splitRun(line).items.some((i) => /\|\s*⋯\s*\]\]$/u.test(i));
    }

    // A task's title, for matching lines written before IDs: its text before the links that end it, any
    // link in it read as its alias (or name), without the checkbox, a breadcrumb, the ID, case or extra
    // spaces
    static title(line) {
        const body = (TaskIds.oldForward(line)?.line ?? line).replace(TaskIds.CHECKBOX, "");
        return TaskIds.splitRun(body).text
            .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1")
            .replace(/\s+/g, " ").trim().toLowerCase();
    }

    // Whether line `i` of `lines` is at the top of its nest (rule 5): a line nested under a checklist line
    // is a sub-task, and nothing on it counts, its ID included. TimeReport.nestTop decides, plain bullets
    // skipped; loaded alone (the statics in tests), a line with no indent.
    static isTop(lines, i) {
        const tr = globalThis.customJS?.TimeReport;
        return tr ? tr.nestTop((n) => lines[n], i) === i : !/^\s/.test(lines[i]);
    }

    // `text` (a note) with the forward date on each top-level checklist line ending in `id` set to `link`,
    // and an older breadcrumb in front of it taken off; with `reopen`, a done or canceled one becomes [>]
    // too, since the task is open elsewhere now (rule 13); with `mark` ("x" or "-"), each one is finished
    // instead, since the task was (CheckOff, OBS-232). { text, changed }. Line endings are kept.
    static setForwardIn(text, id, link, { reopen = false, mark = null } = {}) {
        let changed = false;
        const all = text.split("\n");
        const lines = all.map((l, i) => {
            const cr = l.endsWith("\r") ? "\r" : "";
            const bare = cr ? l.slice(0, -1) : l;
            // Only a sent line ([>], or [x] or [-] once finished): an open line with the same ID is a copy
            const box = bare.match(TaskIds.CHECKBOX);
            if (!box || !">xX-".includes(box[1]) || TaskIds.idOf(bare)?.toLowerCase() !== id.toLowerCase() || !TaskIds.isTop(all, i)) return l;
            let next = TaskIds.withForward(TaskIds.oldForward(bare)?.line ?? bare, link);
            if (mark) next = next.replace(/^(\s*[-*+]\s+)\[.\]/, `$1[${mark}]`);
            else if (reopen) next = next.replace(/^(\s*[-*+]\s+)\[[xX-]\]/, "$1[>]");
            if (next === bare) return l;
            changed = true;
            return next + cr;
        });
        return { text: lines.join("\n"), changed };
    }

    // `text` with each top-level done or canceled checklist line ending in `id` set to [>], nothing else on
    // it touched: the task is open elsewhere now (rule 13). { text, changed }
    static reopenIn(text, id) {
        let changed = false;
        const all = text.split("\n");
        const lines = all.map((l, i) => {
            const box = l.match(TaskIds.CHECKBOX);
            if (!box || !"xX-".includes(box[1]) || TaskIds.idOf(l.replace(/\r$/, ""))?.toLowerCase() !== id.toLowerCase() || !TaskIds.isTop(all, i)) return l;
            changed = true;
            return l.replace(/^(\s*[-*+]\s+)\[[xX-]\]/, "$1[>]");
        });
        return { text: lines.join("\n"), changed };
    }

    // How long a note a command just wrote is read by gather whatever the cache says (Obsidian parses a note
    // written through its editor again only once the editor saves, about two seconds later)
    static RECENT_MS = 10000;

    // Marks `file` as just written by a command (Schedule calls it for every note it writes)
    touched(file) {
        const now = Date.now();
        (this.recent ??= new Map()).set(file.path, now);
        for (const [path, at] of this.recent) if (now - at > TaskIds.RECENT_MS) this.recent.delete(path);
    }

    // The folders the system works in besides the Planner's periodic notes (rule 12, OBS-208): named
    // once here, a setting later. AddTaskNote's staging folder is the Inbox.
    static INBOX = "Inbox";
    static FOLDERS = ["Projects", TaskIds.INBOX];
    static ARCHIVE = "Archive/";

    // Whether a note is in the system: a daily, weekly, monthly or yearly note, or a note in one of
    // FOLDERS (rule 12). A line anywhere else is a plain checklist line: no command works on it.
    inSystem(file) {
        return !!file && (TaskIds.FOLDERS.some((f) => file.path.startsWith(`${f}/`)) || this.kindOf(file) !== "other");
    }

    // What a command that works on a line says when its note is outside the system, and does nothing (rule 12)
    outside(file) {
        return `${file.basename} isn't in the Planner, Projects or the Inbox, where the system works, so nothing changed`;
    }

    // Whether a command may work on a line of `file`; when not, it says so (rule 12, OBS-208)
    works(file) {
        if (this.inSystem(file)) return true;
        new Notice(this.outside(file));
        return false;
    }

    // A note no command finds a task's lines in: one outside the system (OBS-208)
    ignored(file) {
        return !this.inSystem(file);
    }

    // Every line in the vault ending in block ID `id`: [{ file, line, task }], line 0-based, task the
    // checkbox's character (undefined for a list item without one, null for a block that isn't a list
    // item). From Obsidian's metadata cache, so no file is read; it finds where a task's lines are, but
    // the cache trails a write by a moment, so decisions read the notes themselves (gather).
    linesOf(id) {
        const out = [];
        // A note's place is asked only of a note holding the ID, so a vault of many notes costs no more
        for (const file of app.vault.getMarkdownFiles()) {
            const hit = this.lineIn(file, id);
            if (hit && !this.ignored(file)) out.push(hit);
        }
        return out;
    }

    // The line of `file` ending in `id`, as linesOf gives it, or null. Obsidian keys `blocks` by the ID,
    // lowercased (Task 1 recorded which); both are tried.
    lineIn(file, id) {
        const cache = app.metadataCache.getFileCache(file);
        const block = cache?.blocks?.[id.toLowerCase()] ?? cache?.blocks?.[id];
        if (!block) return null;
        const line = block.position.start.line;
        const item = cache.listItems?.find((li) => li.position.start.line === line);
        return { file, line, task: item ? item.task : null };
    }

    // Every task ID's lines in the notes in the system, in one pass over Obsidian's cache: Map from the ID,
    // lowercased, to its lines, as linesOf gives them. A command builds it once and looks every ID up there
    // (rule 19). A note's place is asked only of a note holding an ID, so a vault of many notes costs no more.
    map() {
        const out = new Map();
        for (const file of app.vault.getMarkdownFiles()) {
            const items = (app.metadataCache.getFileCache(file)?.listItems ?? []).filter((li) => li.id);
            if (!items.length || this.ignored(file)) continue;
            for (const li of items) {
                const key = li.id.toLowerCase();
                if (!out.has(key)) out.set(key, []);
                out.get(key).push({ file, line: li.position.start.line, task: li.task });
            }
        }
        return out;
    }

    // The notes the cache can't be trusted about: every note open in an editor, and those a command wrote a
    // moment ago, which it may not have read again yet
    nowFiles() {
        const files = new Map();
        for (const [path, at] of this.recent ?? []) {
            const f = Date.now() - at < TaskIds.RECENT_MS ? app.vault.getFileByPath(path) : null;
            if (f) files.set(path, f);
        }
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
            const f = leaf.view?.file;
            if (f && leaf.view.editor) files.set(f.path, f);
        }
        return [...files.values()];
    }

    // Several tasks' checklist lines as they are now, top-level lines only: Map from each of `ids` that is a
    // task's (isTask) to its lines, as gather gives them. `map` is the command's (map()). A block ID of your
    // own on lines that were never sent joins nothing.
    async gatherMany(ids, map = this.map()) {
        const want = new Set(ids.map((id) => id.toLowerCase()));
        const files = new Map();
        for (const id of want) for (const l of map.get(id) ?? []) files.set(l.file.path, l.file);
        for (const f of this.nowFiles()) files.set(f.path, f);
        const out = new Map();
        for (const file of files.values()) {
            if (this.ignored(file) || !app.vault.getFileByPath(file.path)) continue;
            const ls = (await this.readNow(file)).split("\n");
            ls.forEach((raw, line) => {
                const text = raw.replace(/\r$/, "");
                const box = text.match(TaskIds.CHECKBOX);
                const id = box ? TaskIds.idOf(text)?.toLowerCase() : null;
                if (!id || !want.has(id) || !TaskIds.isTop(ls, line)) return;
                if (!out.has(id)) out.set(id, []);
                out.get(id).push({ file, line, task: box[1], text });
            });
        }
        for (const [id, lines] of out) if (!TaskIds.isTask(lines)) out.delete(id);
        return out;
    }

    // Whether lines sharing a block ID are a task's: one of them is sent, a [>] line or one with a forward
    // date. Lines that only share a block ID of your own were never one task (rule 2).
    static isTask(lines) {
        return lines.some((l) => l.task === ">" || TaskIds.forwardOf(l.text));
    }

    // A note's text as it is now: from its editor when it's open in one in editing view (ahead of the saved
    // file and the cache while you type), else as the vault has it. Reading view writes the file itself and its
    // editor catches up only later (Schedule.rewrite writes the same way).
    async readNow(file) {
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file?.path === file.path && v.editor && (v.getMode?.() ?? "source") === "source");
        return view ? view.editor.getValue() : app.vault.cachedRead(file);
    }

    // A task's checklist lines as they are now, top-level lines only (rule 5): [{ file, line, task, text }].
    // The notes the cache names for `id`, every note open in an editor, and `also` (files a caller knows of,
    // such as the note a forward date points at), each read through readNow, so a line written a moment
    // ago isn't missed.
    async gather(id, also = []) {
        const want = id.toLowerCase();
        const files = new Map();
        for (const l of this.linesOf(id)) files.set(l.file.path, l.file);
        for (const f of also) if (f) files.set(f.path, f);
        for (const f of this.nowFiles()) files.set(f.path, f);
        const out = [];
        for (const file of files.values()) {
            if (this.ignored(file) || !app.vault.getFileByPath(file.path)) continue;
            const ls = (await this.readNow(file)).split("\n");
            ls.forEach((raw, line) => {
                const text = raw.replace(/\r$/, "");
                const box = text.match(TaskIds.CHECKBOX);
                if (box && TaskIds.idOf(text)?.toLowerCase() === want && TaskIds.isTop(ls, line)) out.push({ file, line, task: box[1], text });
            });
        }
        return out;
    }

    // Every list item with a block ID: Map from the ID, lowercased, to its lines, as linesOf gives them.
    // For the task checks, which also read `Archive`, as before OBS-208, since an archived project's
    // Problems are listed (Brian, 2026-10-28); no command searches there.
    allIds() {
        const out = new Map();
        for (const file of app.vault.getMarkdownFiles()) {
            const items = (app.metadataCache.getFileCache(file)?.listItems ?? []).filter((li) => li.id);
            if (!items.length || (this.ignored(file) && !file.path.startsWith(TaskIds.ARCHIVE))) continue;
            for (const li of items) {
                const key = li.id.toLowerCase();
                if (!out.has(key)) out.set(key, []);
                out.get(key).push({ file, line: li.position.start.line, task: li.task });
            }
        }
        return out;
    }

    // A new ID that no block in the vault has: one lookup per draw, and the first draw almost always
    // does
    freshId() {
        // Taken anywhere in the vault but Config, in the system or not, so a note moved in later can't
        // bring a second task with the same ID (OBS-208)
        const taken = (id) => app.vault.getMarkdownFiles().some((f) => !f.path.startsWith("Config/") && this.lineIn(f, id));
        for (;;) {
            const id = TaskIds.newId(new Set(), this.random ?? Math.random);
            if (!taken(id)) return id;
        }
    }

    // The rule, checked over `notes` ([{ path, kind, text }], kind as kindOf says), with
    //   projectOf(note, i, lines): the project or area line i counts toward, or null;
    //   compared(note): whether its lines are compared at all: a line in a task note, log or plain note
    //     isn't (Brian, 2026-10-25), so a subtask's day line can go its own way;
    //   resolve(linkpath, fromPath): the path a link points at, or null;
    //   ownNote(text, path): the notes a line's ⋯ links, in the system (a ↗ is read by nobody).
    // Only top-level lines are a task's: at the left edge, since a line nested under a checklist line is
    // a sub-task (rule 5) and one under nothing but plain bullets isn't defined in the system.
    // Returns [{ rule, id, lines: [{ path, line, text }], detail }], in the spec's order: "project" (two
    // projects), "open" (open twice), "finished" (done while open, or done on two days), "forward" (a
    // source's forward date points where the task isn't), "notes" (lines in two notes outside the periodic
    // notes), "ownNotes" (two different ⋯ notes), "twice" (an ID twice in a note), "trailing" (text after
    // a task's ID, which Obsidian then doesn't read).
    static check(notes, { projectOf, compared = () => true, resolve, ownNote = () => [] }) {
        const found = [], out = [], twice = [];
        const topLevel = (text) => TaskIds.CHECKBOX.test(text) && !/^\s/.test(text);
        for (const note of notes) {
            const lines = note.text.split("\n");
            const seen = new Map();
            lines.forEach((text, line) => {
                const box = topLevel(text) ? text.match(TaskIds.CHECKBOX) : null;
                const raw = box ? TaskIds.idOf(text) : null;
                if (!raw) return;
                const hit = { id: raw.toLowerCase(), path: note.path, kind: note.kind, line, task: box[1], text: text.trim(), note, lines };
                found.push(hit);
                if (seen.has(hit.id)) twice.push({ rule: "twice", id: hit.id, lines: [seen.get(hit.id), hit].map(TaskIds.where), detail: {} });
                else seen.set(hit.id, hit);
            });
        }
        const byId = new Map();
        for (const h of found) {
            if (!byId.has(h.id)) byId.set(h.id, []);
            byId.get(h.id).push(h);
        }
        const isOpen = (h) => h.task === " " || h.task === "/";
        // Only a task's ID: one a sent line carries (isTask)
        const isTask = TaskIds.isTask;
        for (const [id, hits] of byId) {
            if (!isTask(hits)) continue;
            const open = hits.filter(isOpen);
            const finished = hits.filter((h) => h.task === "x" || h.task === "-");
            // No line is let off (OBS-233): a project change writes every line of the task and refuses to move
            // billed time, so two projects are always something to fix. A line with a ⋯ and no project is
            // Unassigned and isn't listed (rule 4)
            const named = hits.filter((h) => compared(h.note)).map((h) => ({ h, project: projectOf(h.note, h.line, h.lines) ?? null })).filter((n) => n.project !== null || !TaskIds.hasOwnNote(n.h.text));
            if (new Set(named.map((n) => n.project)).size > 1) out.push({ rule: "project", id, lines: named.map((n) => TaskIds.where(n.h)), detail: { projects: named.map((n) => n.project) } });
            // `clicked`: which of them, if any, is a sent line a click turned from [>] into [ ] (a line outside
            // the periodic notes with a forward date), so the Problem can say to set it back rather than take off its ID
            if (open.length > 1) out.push({ rule: "open", id, lines: open.map(TaskIds.where), detail: { clicked: open.findIndex((h) => h.kind === "other" && TaskIds.forwardOf(h.text)) } });
            const doneDays = finished.filter((h) => h.task === "x" && h.kind === "day");
            if (finished.length && open.length) out.push({ rule: "finished", id, lines: [...finished, ...open].map(TaskIds.where), detail: { open: true } });
            else if (doneDays.length > 1) out.push({ rule: "finished", id, lines: doneDays.map(TaskIds.where), detail: { open: false } });
            // Where the task is: its open line in a periodic note, or once it's finished, its done line. A
            // line copied by hand makes it open on several (rule 2 says so): a forward date naming any of them is right.
            const at = open.filter((h) => h.kind !== "other");
            if (!at.length && !open.length) at.push(...finished.filter((h) => h.kind !== "other").slice(0, 1));
            const current = at[0] ?? null;
            for (const s of hits.filter((h) => h.kind === "other" && !isOpen(h))) {
                const fwd = TaskIds.forwardOf(s.text);
                // A [>] line with its date in front is in the old shape: the backfill gives it its forward date
                if (!fwd && (s.task !== ">" || TaskIds.oldForward(s.text))) continue;
                const to = fwd ? resolve(fwd.linkpath, s.path) : null;
                if (fwd && at.some((h) => h.path === to) && (fwd.id ?? "").toLowerCase() === id) continue;
                out.push({ rule: "forward", id, lines: [s, ...(current ? [current] : [])].map(TaskIds.where), detail: { to, missing: !fwd } });
            }
            const others = hits.filter((h) => h.kind === "other");
            if (new Set(others.map((h) => h.path)).size > 1) out.push({ rule: "notes", id, lines: others.map(TaskIds.where), detail: {} });
            const owned = hits.map((h) => ({ h, notes: ownNote(h.text, h.path) })).filter((o) => o.notes.length);
            if (new Set(owned.flatMap((o) => o.notes)).size > 1) out.push({ rule: "ownNotes", id, lines: owned.map((o) => TaskIds.where(o.h)), detail: {} });
        }
        // Twice in a note counts only for a task's ID
        for (const t of twice) if (isTask(byId.get(t.id))) out.push(t);
        const known = new Set([...byId].filter(([, hits]) => isTask(hits)).map(([id]) => id));
        for (const note of notes) {
            note.text.split("\n").forEach((text, line) => {
                if (!topLevel(text) || TaskIds.idOf(text)) return;
                for (const m of text.matchAll(/\s\^([A-Za-z0-9-]+)\s+\S/g)) {
                    if (known.has(m[1].toLowerCase())) out.push({ rule: "trailing", id: m[1].toLowerCase(), lines: [{ path: note.path, line, text: text.trim() }], detail: {} });
                }
            });
        }
        const order = ["project", "open", "finished", "forward", "notes", "ownNotes", "twice", "trailing"];
        return out.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
    }

    // A line as a check reports it
    static where(h) {
        return { path: h.path, line: h.line, text: h.text };
    }

    // ---------------------------------------------------------------- the one-time conversion (OBS-208)

    // A link in the old marks, which mean nothing since OBS-208: 🗒️, a line's note or Schedule's link
    // back to the note it was sent from, and 🔗 before OBS-87. A phone may add or drop the U+FE0F.
    static OLD_ITEM = /[ ]*\[\[([^\]|]+)\|\s*(?:🗒|🔗)️?\s*\]\]$/u;

    // The old-mark links in the run that ends `line`: [{ from, to, target }] in line order, `target`
    // the link's text before its `|`
    static oldMarks(line) {
        const bare = TaskIds.withoutId(line).replace(/\s+$/, "");
        const out = [];
        let at = bare.length;
        for (;;) {
            const head = bare.slice(0, at);
            const old = head.match(TaskIds.OLD_ITEM);
            const item = old ?? TaskIds.trailItem(head);
            if (!item) break;
            if (old) out.unshift({ from: item.index + item[0].indexOf("[["), to: at, target: old[1].trim() });
            at = item.index;
        }
        return out;
    }

    // Replaces every 🗒️ and 🔗 at the end of a line with ⋯ or ↗, once (Brian, 2026-10-26), in every
    // note the system reads: the system's and Archive's, whose lines the task checks read. A link back
    // to the note the line was sent from becomes ↗: one whose note holds a line with the line's task ID,
    // or, from before IDs, a checklist line with its title (`byText`); one found by ID links that line,
    // `[[Note#^id|↗]]`, as Schedule writes it (Brian, 2026-10-28). Every other one becomes ⋯. A
    // checklist line at the left edge of a periodic note whose only project link was that link back
    // gets the linked note's project as its ⭕, finished or archived or not, so its time keeps counting
    // there; time counts only under such a line (Brian, 2026-10-28), so no other line needs one.
    // Returns { changes: [{ path, line (1-based), before, after, mark, note, byText, review, home,
    // moves }] }, the ones to check first first (`review`): text matches, links back by an ID on a line
    // that was never sent, and lines whose time the report would count differently afterwards (`moves`:
    // [{ minutes, from, to }], a project path or null for none, as main read the line and as it will).
    // With `write`, it writes them (each note through its editor when open) and runs again, which must
    // find nothing, and counts any line still ending in 🗒️ or 🔗, as the time report's guard does:
    // { changes, left, old }.
    async linkBackPass({ write = false } = {}) {
        const helper = customJS.AddTaskNote;
        const tr = customJS.TimeReport;
        const index = tr.appIndex();
        const paths = app.vault.getMarkdownFiles().map((f) => f.path);
        const texts = new Map();
        const textOf = async (file) => {
            if (!texts.has(file.path)) texts.set(file.path, (await this.readNow(file)).split("\n").map((l) => l.replace(/\r$/, "")));
            return texts.get(file.path);
        };
        const reads = (file) => this.inSystem(file) || file.path.startsWith(TaskIds.ARCHIVE);
        // A line a sent task left behind: [>], or a forward date of either form
        const sent = (l) => /^\s*[-*+] \[>\]/.test(l) || !!TaskIds.forwardOf(l) || !!TaskIds.oldForward(l);
        // How the report reads a daily note's entries: entry → its project, or null when disputed
        const readingOf = (file, lines) => {
            const date = window.moment(file.basename, customJS.Schedule.dailyOpts().format, true).format("YYYY-MM-DD");
            const model = tr.build([{ date, path: file.path, text: lines.join("\n") }], index, {});
            const out = new Map();
            for (const e of model.entries) out.set(`${e.line}|${e.start}|${e.end}`, { e, project: e.project ?? null });
            for (const e of model.disputed ?? []) out.set(`${e.line}|${e.start}|${e.end}`, { e, project: null });
            return out;
        };
        const changes = [];
        for (const file of app.vault.getMarkdownFiles()) {
            if (!reads(file)) continue;
            const lines = await textOf(file);
            const periodic = this.kindOf(file) !== "other";
            const found = [];
            for (let i = 0; i < lines.length; i++) {
                const before = lines[i];
                if (!tr.convertible(before)) continue;
                const marks = TaskIds.oldMarks(before);
                if (!marks.length) continue;
                const id = TaskIds.idOf(before);
                // Its title without the old marks, which no longer read as part of the run that ends it
                const title = TaskIds.title([...marks].reverse().reduce((t, m) => t.slice(0, m.from) + t.slice(m.to), before));
                let after = before, dots = before, back = null, byText = false, review = false;
                // Right to left, so the spans before stay where they are
                for (const m of [...marks].reverse()) {
                    const dest = app.metadataCache.getFirstLinkpathDest(m.target.split("#")[0].trim(), file.path);
                    const there = dest ? await textOf(dest) : [];
                    const byId = !!id && there.find((l) => TaskIds.idOf(l)?.toLowerCase() === id.toLowerCase());
                    const byTitle = !byId && !!title && there.some((l) => TaskIds.CHECKBOX.test(l) && TaskIds.title(l) === title);
                    const mark = byId || byTitle ? "↗" : "⋯";
                    if (mark === "↗") { back = dest; byText = byTitle; review = byTitle || !sent(byId || ""); }
                    // A link back by ID links the task's line there, as Schedule writes it now
                    const target = byId && !m.target.includes("#") ? `${m.target}#^${TaskIds.idOf(byId)}` : m.target;
                    after = after.slice(0, m.from) + `[[${target}|${mark}]]` + after.slice(m.to);
                    // As the report reads the line with every old mark a ⋯: which gives it no project
                    dots = dots.slice(0, m.from) + `[[${m.target}|⋯]]` + dots.slice(m.to);
                }
                // The ⭕ a link back gave it, on a checklist line at the left edge of a periodic note
                // with no project link of its own and no ⋯ note in a project
                let home = null;
                const run = TaskIds.splitRun(after).items;
                const own = run.filter((x) => /\|\s*⋯\s*\]\]$/u.test(x)).map((x) => x.match(/^\[\[([^\]|#]+)/)?.[1].trim());
                // As the report reads a note's project: its folder
                const ownHome = own.some((t) => { const n = t && app.metadataCache.getFirstLinkpathDest(t, file.path); return n && tr.projectOfNote(n.path, index); });
                if (back && periodic && /^[-*+] \[.\]/.test(before) && !run.some((x) => /\|\s*(?:⭕|🗃)/u.test(x)) && !ownHome) {
                    home = helper.filedIn(back);
                    if (home) after = helper.withHome(after, helper.homeLink(home, helper.linktextFor(home, paths)));
                }
                found.push({ path: file.path, line: i + 1, before, after, dots, mark: back ? "↗" : "⋯", note: back?.path ?? null, byText, review, home: home?.path ?? null, moves: [] });
            }
            if (!found.length) continue;
            // Where the report counts this day's time before and after, so a line whose time would count
            // differently is listed with it
            if (customJS.Schedule.isDailyNote(file)) {
                const was = lines.slice(), now = lines.slice();
                for (const c of found) { was[c.line - 1] = c.dots; now[c.line - 1] = c.after; }
                const a = readingOf(file, was), b = readingOf(file, now);
                for (const [key, x] of new Map([...b, ...a])) {
                    const from = a.get(key)?.project ?? null, to = b.get(key)?.project ?? null;
                    if (from === to) continue;
                    const at = new Set(x.e.context.map((c) => c.line));
                    const c = found.find((f) => at.has(f.line));
                    if (c) { c.moves.push({ minutes: x.e.minutes, from, to }); c.review = true; }
                }
            }
            for (const c of found) {
                delete c.dots;
                if (c.after !== c.before) changes.push(c);
            }
        }
        // To check first: time that would count differently, text matches, and links back by an ID on a
        // line that was never sent
        changes.sort((a, b) => (b.review - a.review) || ((b.moves.length > 0) - (a.moves.length > 0)) || (b.byText - a.byText) || a.path.localeCompare(b.path) || a.line - b.line);
        if (!write) return { changes };
        const byFile = new Map();
        for (const c of changes) {
            if (!byFile.has(c.path)) byFile.set(c.path, []);
            byFile.get(c.path).push(c);
        }
        for (const [path, list] of byFile) {
            const file = app.vault.getFileByPath(path);
            if (!file) continue;
            await customJS.Schedule.rewrite(file, (text) => {
                const ls = text.split("\n");
                for (const c of list) {
                    const cr = ls[c.line - 1]?.endsWith("\r") ? "\r" : "";
                    // Only a line still as it was read: one changed since is left for the next run
                    if (ls[c.line - 1]?.replace(/\r$/, "") === c.before) ls[c.line - 1] = c.after + cr;
                }
                return ls.join("\n");
            });
        }
        const again = await this.linkBackPass();
        // And a plain count, as the time report's guard counts: a line still ending in a 🗒️ or 🔗 link
        let old = 0;
        for (const file of app.vault.getMarkdownFiles()) {
            if (!reads(file)) continue;
            for (const l of (await this.readNow(file)).split("\n")) if (tr.convertible(l) && TaskIds.oldMarks(l).length) old++;
        }
        return { changes, left: again.changes, old };
    }

    // "day", "week", "month" or "year" for a periodic note (Schedule's own test), else "other": a note a
    // task is sent from
    kindOf(file) {
        const schedule = customJS.Schedule;
        return schedule.isDailyNote(file) ? "day" : schedule.periodOf(file) ?? "other";
    }
}
