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
    // One item of the run of links that ends a line, with the spaces before it: a 🚩, 🗒️ (or 🔗), ⭕ or
    // 🗃️ link, a forward date (or one written with a ➡️), or the ℹ️ or 🆓 mark. The same pattern as
    // AddTaskNote.TRAIL_ITEM; TaskIds' statics must load in an empty vm context, so they can't reach
    // AddTaskNote, and this is a copy that taskIds.test.mjs checks against it.
    static TRAIL_ITEM = /(?<![ ])[ ]*(?:\[\[[^\]|]+\|\s*(?:🚩️?\s*\d{1,2}\/\d{1,2}|➡️?[^\]]*|🗒️?|🔗️?|⭕️?|🗃️?)\s*\]\]|\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]|(?<=\s)(?:ℹ|🆓)️?)$/u;
    // The items a forward date goes before: a line's ⭕, 🗃️ and note links
    static HOME_OR_NOTE = /\|\s*(?:⭕|🗃|🗒|🔗)/u;
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
        for (let m; (m = bare.slice(0, at).match(TaskIds.TRAIL_ITEM));) {
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
    // too, since the task is open elsewhere now (rule 13). { text, changed }. Line endings are kept.
    static setForwardIn(text, id, link, { reopen = false } = {}) {
        let changed = false;
        const all = text.split("\n");
        const lines = all.map((l, i) => {
            const cr = l.endsWith("\r") ? "\r" : "";
            const bare = cr ? l.slice(0, -1) : l;
            // Only a sent line ([>], or [x] or [-] once finished): an open line with the same ID is a copy
            const box = bare.match(TaskIds.CHECKBOX);
            if (!box || !">xX-".includes(box[1]) || TaskIds.idOf(bare)?.toLowerCase() !== id.toLowerCase() || !TaskIds.isTop(all, i)) return l;
            let next = TaskIds.withForward(TaskIds.oldForward(bare)?.line ?? bare, link);
            if (reopen) next = next.replace(/^(\s*[-*+]\s+)\[[xX-]\]/, "$1[>]");
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

    // Notes the system keeps (Config: templates, scripts) never hold a task's lines
    ignored(file) {
        return file.path.startsWith("Config/");
    }

    // Every line in the vault ending in block ID `id`: [{ file, line, task }], line 0-based, task the
    // checkbox's character (undefined for a list item without one, null for a block that isn't a list
    // item). From Obsidian's metadata cache, so no file is read; it finds where a task's lines are, but
    // the cache trails a write by a moment, so decisions read the notes themselves (gather).
    linesOf(id) {
        if (this.index) return this.index.get(id.toLowerCase()) ?? [];
        const out = [];
        for (const file of app.vault.getMarkdownFiles()) {
            if (this.ignored(file)) continue;
            const hit = this.lineIn(file, id);
            if (hit) out.push(hit);
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

    // A note's text as it is now: from its editor when it's open in one (ahead of the saved file and
    // the cache while you type), else as the vault has it
    async readNow(file) {
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file?.path === file.path && v.editor);
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
        // Notes a command wrote a moment ago, which the cache may not have read again yet
        for (const [path, at] of this.recent ?? []) {
            const f = Date.now() - at < TaskIds.RECENT_MS ? app.vault.getFileByPath(path) : null;
            if (f) files.set(path, f);
        }
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
            const f = leaf.view?.file;
            if (f && leaf.view.editor) files.set(f.path, f);
        }
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

    // Every list item with a block ID: Map from the ID, lowercased, to its lines, as linesOf gives them
    allIds() {
        if (this.index) return this.index;
        const out = new Map();
        for (const file of app.vault.getMarkdownFiles()) {
            if (this.ignored(file)) continue;
            for (const li of app.metadataCache.getFileCache(file)?.listItems ?? []) {
                if (!li.id) continue;
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
        for (;;) {
            const id = TaskIds.newId(new Set(), this.random ?? Math.random);
            if (!this.linesOf(id).length) return id;
        }
    }

    // The rule, checked over `notes` ([{ path, kind, text }], kind as kindOf says), with
    //   projectOf(note, i, lines): the project or area line i counts toward, or null;
    //   exempt(note, i): why line i may name another project ("finished", "invoiced"), or null;
    //   resolve(linkpath, fromPath): the path a link points at, or null.
    // Returns [{ rule, id, lines: [{ path, line, text }], detail }], in the spec's order: "project" (two
    // projects), "open" (open twice), "finished" (done while open, or done on two days), "forward" (a
    // source's forward date points where the task isn't), "twice" (an ID twice in a note), "trailing" (text after
    // a task's ID, which Obsidian then doesn't read).
    static check(notes, { projectOf, exempt = () => null, resolve }) {
        const found = [], out = [], twice = [];
        for (const note of notes) {
            const lines = note.text.split("\n");
            const seen = new Map();
            lines.forEach((text, line) => {
                const box = text.match(TaskIds.CHECKBOX);
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
        // Only a task's ID: one a sent line ([>], or one with a forward date) carries. Lines that only share a block ID
        // of your own were never one task.
        const isTask = (hits) => hits.some((h) => h.task === ">" || TaskIds.forwardOf(h.text));
        for (const [id, hits] of byId) {
            if (!isTask(hits)) continue;
            const open = hits.filter(isOpen);
            const finished = hits.filter((h) => h.task === "x" || h.task === "-");
            // Exemptions are only worked out for a task whose lines disagree
            const all = hits.map((h) => ({ h, project: projectOf(h.note, h.line, h.lines) ?? null }));
            const named = new Set(all.map((n) => n.project)).size > 1 ? all.filter((n) => !exempt(n.h.note, n.h.line)) : all;
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
        }
        // Twice in a note counts only for a task's ID
        for (const t of twice) if (isTask(byId.get(t.id))) out.push(t);
        const known = new Set([...byId].filter(([, hits]) => isTask(hits)).map(([id]) => id));
        for (const note of notes) {
            note.text.split("\n").forEach((text, line) => {
                if (!TaskIds.CHECKBOX.test(text) || TaskIds.idOf(text)) return;
                for (const m of text.matchAll(/\s\^([A-Za-z0-9-]+)\s+\S/g)) {
                    if (known.has(m[1].toLowerCase())) out.push({ rule: "trailing", id: m[1].toLowerCase(), lines: [{ path: note.path, line, text: text.trim() }], detail: {} });
                }
            });
        }
        const order = ["project", "open", "finished", "forward", "twice", "trailing"];
        return out.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
    }

    // A line as a check reports it
    static where(h) {
        return { path: h.path, line: h.line, text: h.text };
    }

    // "day", "week", "month" or "year" for a periodic note (Schedule's own test), else "other": a note a
    // task is sent from
    kindOf(file) {
        const schedule = customJS.Schedule;
        return schedule.isDailyNote(file) ? "day" : schedule.periodOf(file) ?? "other";
    }
}
