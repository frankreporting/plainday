class Schedule {
    async invoke() {
        const { Modal, TextComponent, MarkdownView } = customJS.obsidian;
        const nld = app.plugins.getPlugin("nldates-obsidian");
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        const srcFile = app.workspace.getActiveFile();
        if (!nld || !view || !srcFile) { new Notice("Need NLD + an active editor"); return; }
        const editor = view.editor;
        const lineNum = editor.getCursor().line;
        const lineText = editor.getLine(lineNum);

        const box = lineText.match(/^(\s*)([-*+]\s+)\[(.)\]\s*(.*)$/);
        if (!box) { new Notice("Not on a checklist item"); return; }
        const [, indent, bullet, status, body] = box;
        const statusCh = indent.length + bullet.length + 1;
        const bodyCh = lineText.length - body.length;
        // Events belong to the calendar; moving one here would put the note out of sync with it
        if (status === "<") { new Notice("Events must be moved in your calendar app"); return; }
        // So is an event the calendar sync forwarded after you'd made notes on it
        if (status === ">" && /^\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s+(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t/i.test(body)) {
            new Notice("Events must be moved in your calendar app");
            return;
        }
        // And one it marked canceled: it stays as a record of that day
        if (status === "-" && /^(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t/i.test(body)) {
            new Notice("This event was canceled in your calendar");
            return;
        }
        const sourceIsDaily = this.isDailyNote(srcFile);
        const sourceIsMonthly = this.isMonthlyNote(srcFile);

        const children = [];
        for (let i = lineNum + 1; i < editor.lineCount(); i++) {
            const t = editor.getLine(i);
            if (t.trim() === "" || t.match(/^\s*/)[0].length <= indent.length) break;
            children.push(t);
        }
        const wasWorkedOn = children.some(t => /\b\d{1,2}:\d{2}\s?[ap]m\b/i.test(t));
        const destStatus = status === "/" ? "/" : " ";

        const hasLink = /\[\[[^\]]*\|🔗\]\]/.test(body);
        const taskName = body.split("[[")[0].trim();
        const taskLink = `[[${taskName}|🔗]]`;

        const foldBefore = view.currentMode.getFoldInfo?.();

        const modal = new Modal(app);
        modal.titleEl.setText("Schedule for");
        const input = new TextComponent(modal.contentEl);
        input.inputEl.style.width = "100%";
        input.inputEl.addEventListener("keydown", async (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const parsed = nld.parseDate(input.getValue());
            if (!parsed?.moment?.isValid()) { new Notice("Couldn't parse that date"); return; }
            const m = parsed.moment;

            // Forwarding a worked-on task links it to its task note on both lines. The time already
            // logged only counts toward a project once that note exists, so find or create it first
            // (through AddTaskNote, which asks where a new one goes). No project picked: nothing moves.
            let link = taskLink, name = taskName, projectLinks = [];
            if (sourceIsDaily && wasWorkedOn && !hasLink && taskName) {
                modal.close();
                const found = await customJS.AddTaskNote.noteFor(taskName, srcFile.path, lineText);
                if (!found) return;
                if (editor.getLine(lineNum) !== lineText) {
                    new Notice("The line changed while picking a project, so it wasn't scheduled");
                    return;
                }
                link = `[[${found.linktext}|🔗]]`;
                name = found.name;   // a date in the name went to the note's due date
                projectLinks = found.projectLinks;   // the note now ties the task to its project
            }

            const dailyPath = this.dailyNotePath(m);
            const dailyName = dailyPath.split("/").pop().replace(/\.md$/, "");
            let outgoing;
            let lineSurvives = true;

            if (!sourceIsDaily && !sourceIsMonthly) {
                // Task/project/other note: forward with a link to the daily note, and link back from there
                editor.replaceRange(">", { line: lineNum, ch: statusCh }, { line: lineNum, ch: statusCh + 1 });
                editor.replaceRange(`[[${dailyName}|${m.format("M/D")}]] `, { line: lineNum, ch: bodyCh });
                const alias = this.isProjectNote(srcFile) ? "⭕" : this.isAreaNote(srcFile) ? "🗃️" : "🔗";
                outgoing = [`${bullet}[${destStatus}] ${body.trimEnd()} [[${srcFile.basename}|${alias}]] `];
            } else if (wasWorkedOn && !sourceIsMonthly) {
                // Daily note, already worked on: forward in place, fresh copy goes forward
                editor.replaceRange(">", { line: lineNum, ch: statusCh }, { line: lineNum, ch: statusCh + 1 });
                if (!hasLink) {
                    if (name !== taskName) editor.replaceRange(name, { line: lineNum, ch: bodyCh }, { line: lineNum, ch: bodyCh + taskName.length });
                    const current = editor.getLine(lineNum);
                    editor.setCursor({ line: lineNum, ch: current.length });
                    editor.replaceSelection((current.endsWith(" ") ? "" : " ") + link);
                    if (projectLinks.length) {
                        const linked = editor.getLine(lineNum);
                        editor.replaceRange(customJS.AddTaskNote.withoutLinks(linked, projectLinks), { line: lineNum, ch: 0 }, { line: lineNum, ch: linked.length });
                    }
                }
                const destBody = hasLink ? body : `${(name + body.slice(taskName.length)).trimEnd()} ${link}`;
                outgoing = [`${bullet}[${destStatus}] ${destBody}`];
                if (projectLinks.length) outgoing = [customJS.AddTaskNote.withoutLinks(outgoing[0], projectLinks)];
            } else {
                // Daily note untouched, or any monthly note: move the line and its sub-bullets
                lineSurvives = false;
                outgoing = [lineText, ...children].map(l => l.slice(indent.length));
                const lastLine = lineNum + children.length;
                if (lastLine + 1 < editor.lineCount()) {
                    editor.replaceRange("", { line: lineNum, ch: 0 }, { line: lastLine + 1, ch: 0 });
                } else if (lineNum > 0) {
                    const prev = lineNum - 1;
                    editor.replaceRange("", { line: prev, ch: editor.getLine(prev).length },
                                            { line: lastLine, ch: editor.getLine(lastLine).length });
                } else {
                    editor.replaceRange("", { line: 0, ch: 0 }, { line: lastLine, ch: editor.getLine(lastLine).length });
                }
                // Park the cursor after the checkbox (or bullet) of whatever line is now here
                const landing = Math.min(lineNum, editor.lineCount() - 1);
                const after = editor.getLine(landing).match(/^\s*[-*+]\s+(\[.\]\s?)?/)?.[0].length ?? 0;
                editor.setCursor({ line: landing, ch: after });
            }

            modal.close();

            if (lineSurvives) setTimeout(() => {
                const wasFolded = foldBefore?.folds?.some(f => f.from === lineNum);
                const stillFolded = view.currentMode.getFoldInfo?.()?.folds?.some(f => f.from === lineNum);
                if (wasFolded && !stillFolded && view.currentMode.applyFoldInfo) {
                    view.currentMode.applyFoldInfo(foldBefore);
                }
            }, 50);

            try {
                const file = await this.ensureDailyNote(dailyPath);
                const before = await app.vault.cachedRead(file);
                const prevFolds = this.captureFolds(file, before.split("\n").length);
                const { content, at, count } = await this.appendToTopChecklist(file, outgoing);
                await this.semiFold(file, content, prevFolds, at, count);
                new Notice(`${lineSurvives ? "Forwarded" : "Moved"} to ${m.format("M/D")}`);
            } catch (err) {
                console.error(err);
                new Notice("Couldn't write to the daily note — check console");
            }
        });
        // Focus once the modal is open and the hotkey's keydown is over; focusing straight after
        // open() fights the editor for focus, and the first key typed can land in the note (OBS-50)
        modal.onOpen = () => requestAnimationFrame(() => input.inputEl.focus());
        modal.open();
    }

    dailyOpts() {
        const opts = app.internalPlugins?.plugins?.["daily-notes"]?.instance?.options ?? {};
        return {
            folder: (opts.folder ?? "").replace(/\/$/, ""),
            format: opts.format || "YYYY-MM-DD",
            template: opts.template ?? ""
        };
    }

    dailyNotePath(m) {
        const { folder, format } = this.dailyOpts();
        return `${folder ? folder + "/" : ""}${m.format(format)}.md`;
    }

    isDailyNote(file) {
        const { folder, format } = this.dailyOpts();
        const inFolder = (file.parent?.path ?? "/") === (folder || "/");
        return inFolder && window.moment(file.basename, format, true).isValid();
    }

    // Monthly notes are named strictly YYYY-MM ("2026-09", not "2026-09-07") and live in the months
    // folder, so notes elsewhere with that name, like the old ones in 37 Journal, aren't monthly notes
    isMonthlyNote(file) {
        return /^\d{4}-\d{2}$/.test(file.basename) && (file.parent?.path ?? "") === this.monthsFolder();
    }

    // Notebook Navigator's periodic notes folder plus the folder part of its month pattern
    // ("[months]/YYYY-MM" → "30 Reference/36 Planner/months"); without that, "months" beside the
    // daily notes folder
    monthsFolder() {
        const nn = app.plugins?.plugins?.["notebook-navigator"]?.settings;
        const base = String(nn?.vaultProfiles?.[0]?.periodicNotesFolder ?? "").replace(/\/$/, "");
        const pattern = String(nn?.calendarCustomMonthPattern ?? "");
        const dir = pattern.includes("/") ? pattern.slice(0, pattern.lastIndexOf("/")) : null;
        // Only a folder made entirely of [literal] parts is a fixed folder
        if (base && dir && dir.replace(/\[[^\]]*\]/g, "").replace(/\//g, "") === "") {
            return `${base}/${dir.replace(/\[([^\]]*)\]/g, "$1")}`;
        }
        const { folder } = this.dailyOpts();
        const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
        return `${parent ? parent + "/" : ""}months`;
    }

    isProjectNote(file) {
        const cache = app.metadataCache.getFileCache(file);
        const tags = cache ? (customJS.obsidian.getAllTags(cache) ?? []) : [];
        return tags.some(t => t === "#project" || t.startsWith("#project/"));
    }

    // A line forwarded out of an area note links the area with its own suffix, 🗃️ (OBS-36)
    isAreaNote(file) {
        const cache = app.metadataCache.getFileCache(file);
        const tags = cache ? (customJS.obsidian.getAllTags(cache) ?? []) : [];
        return tags.some(t => t === "#area" || t.startsWith("#area/"));
    }

    async ensureDailyNote(path) {
        let file = app.vault.getFileByPath(path);
        if (file) return file;
        const { folder, template } = this.dailyOpts();
        if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
        let content = "";
        if (template) {
            const tpl = app.vault.getFileByPath(template.endsWith(".md") ? template : `${template}.md`);
            if (tpl) content = await app.vault.read(tpl);
        }
        return app.vault.create(path, content);
    }

    // Insert after the last item of the first checklist.
    // Returns the new content plus where the block landed, so the fold pass can find it.
    async appendToTopChecklist(file, newLines) {
        let out;
        await app.vault.process(file, (content) => {
            const lines = content.split("\n");
            const first = lines.findIndex(l => /^\s*[-*+]\s+\[.\]/.test(l));
            if (first === -1) {
                const head = content.replace(/\s+$/, "").split("\n");
                out = { content: [...head, ...newLines].join("\n") + "\n", at: head.length, count: newLines.length };
                return out.content;
            }
            const destIndent = lines[first].match(/^\s*/)[0];
            let end = first;
            while (end + 1 < lines.length) {
                const next = lines[end + 1];
                if (next.trim() === "" || !(/^\s*[-*+]\s/.test(next) || /^\s/.test(next))) break;
                end++;
            }
            const at = end + 1;
            lines.splice(at, 0, ...newLines.map(l => destIndent + l));
            out = { content: lines.join("\n"), at, count: newLines.length };
            return out.content;
        });
        return out;
    }

    // Every list item that has children is foldable; headings never get an entry
    foldableRanges(content) {
        const lines = content.split("\n");
        const ranges = [];
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^(\s*)(?:[-*+]|\d+[.)])\s+/);
            if (!m) continue;
            const indent = m[1].length;
            let last = i;
            for (let j = i + 1; j < lines.length; j++) {
                const t = lines[j];
                if (t.trim() === "" || t.match(/^\s*/)[0].length <= indent) break;
                last = j;
            }
            if (last > i) ranges.push({ from: i, to: last });
        }
        return ranges;
    }

    // Capture BEFORE the write. Live editor if the note is open, else the saved record —
    // and only trust its line numbers if the saved line count still matches the file.
    captureFolds(file, lineCount) {
        const view = app.workspace.getLeavesOfType("markdown").map(l => l.view).find(v => v?.file === file);
        const info = view ? view.currentMode.getFoldInfo?.() : app.foldManager.load(file);
        const all = info?.folds ?? [];
        const isProps = f => f.from === 0 && f.to === 0;   // collapsed frontmatter marker
        return {
            props: all.some(isProps),
            folds: info && info.lines === lineCount ? all.filter(f => !isProps(f)) : null
        };
    }

    // Mixed fold state in the destination: keep it, and fold just the item we pasted.
    // Otherwise (all folded, none folded, or no trustworthy record) fold every list item.
    // applyFoldInfo silently no-ops unless `lines` matches the document.
    async semiFold(file, content, prev, at, count) {
        const foldable = this.foldableRanges(content);
        const byLine = new Map(foldable.map(r => [r.from, r]));

        const kept = (prev.folds ?? [])
            .map(f => ({ from: f.from >= at ? f.from + count : f.from }))
            .filter(f => byLine.has(f.from))
            .map(f => byLine.get(f.from));

        const mixed = kept.length > 0 && kept.length < foldable.length;
        const pasted = byLine.get(at);   // only set when sub-bullets came along
        let folds = mixed
            ? (pasted && !kept.some(f => f.from === at) ? [...kept, pasted] : kept)
            : foldable;

        folds = folds.slice().sort((a, b) => a.from - b.from);
        if (prev.props) folds.unshift({ from: 0, to: 0 });

        const info = { folds, lines: content.split("\n").length };
        const view = app.workspace.getLeavesOfType("markdown").map(l => l.view).find(v => v?.file === file);
        if (view) setTimeout(() => view.currentMode.applyFoldInfo(info), 50);
        await app.foldManager.save(file, info);
    }
}
