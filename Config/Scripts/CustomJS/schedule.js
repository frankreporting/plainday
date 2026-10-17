class Schedule {
    // A task's link to its note: 🗒️ is written (OBS-87). Schedule reads a line's note link through
    // AddTaskNote (trailingNote), whose NOTE_LINK still reads 🔗, the symbol before it.
    static NOTE_MARK = "🗒️";

    async invoke() {
        const { MarkdownView } = customJS.obsidian;
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        const srcFile = app.workspace.getActiveFile();
        if (!view || !srcFile) { new Notice("Need an active editor"); return; }
        const editor = view.editor;
        const lineNum = editor.getCursor().line;
        const lineText = editor.getLine(lineNum);

        const box = lineText.match(/^(\s*)([-*+]\s+)\[(.)\]\s*(.*)$/);
        if (!box) { new Notice("Not on a checklist item"); return; }
        const [, indent, bullet, status, body] = box;
        const statusCh = indent.length + bullet.length + 1;
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
        // A weekly, monthly or yearly note holds tasks with no day yet: they move out whole
        const sourcePeriod = this.periodOf(srcFile);
        // Until Obsidian has indexed the vault at startup, a task's other lines can't be found
        if (app.metadataCache.initialized === false) { new Notice("Obsidian is still indexing the vault; try again in a moment"); return; }
        const tasks = customJS.TaskIds;
        const T = tasks.constructor;
        let id = T.idOf(lineText);
        // The task's lines as they are now, for a line with an ID outside the periodic notes (the first
        // send's guard and Task 9's routing read them)
        const fwd0 = id ? T.forwardOf(lineText) : null;
        const known = id && !sourceIsDaily && !sourcePeriod ? await tasks.gather(id, [fwd0 ? app.metadataCache.getFirstLinkpathDest(fwd0.linkpath, srcFile.path) : null]) : null;

        // An older sent line (its date in front) whose ID, if it has one of your own, no line in a periodic
        // note has: it's matched to its open line first, so Schedule on it moves the task rather than send
        // a second copy. Matched, it keeps an ID of its own (the task's, spec section 4) unless another
        // task's line has it (foreignId); not matched, it's sent as a first send would be, below.
        const older = status === ">" && !sourceIsDaily && !sourcePeriod && T.oldForward(lineText) && !known?.some((l) => tasks.kindOf(l.file) !== "other");
        if (older) {
            const foreign = this.foreignId(known, srcFile);
            const adopted = await this.adopt(editor, srcFile, lineNum, lineText, foreign ? null : id);
            if (adopted) {
                if (foreign) new Notice(`This line's block ID ^${id} is also on a line in another note, so the task got a new ID; a link to ^${id} in this note needs the new one`);
                return this.reschedule({ editor, srcFile, lineNum, lineText: editor.getLine(lineNum), id: adopted });
            }
        }
        // A line already sent or forwarded (OBS-181): Schedule moves the task's open line, wherever it is
        if (status === ">" && id && !older) return this.reschedule({ editor, srcFile, lineNum, lineText, id, lines: known });
        // A sent line clicked back to [ ] (a click turns [>] into [ ]): while the task still has a line in
        // a periodic note, it's this task, so the line goes back to [>] and the task's open line moves
        // A done or canceled one is finished: it isn't sent again. Only a line that shows it was sent, by
        // its forward date: one without is a first send, whose own block ID may be another task's (below)
        if (id && status !== ">" && fwd0 && known?.some((l) => l.file.path !== srcFile.path && tasks.kindOf(l.file) !== "other")) {
            const finished = known.find((l) => l.file.path !== srcFile.path && (l.task === "x" || l.task === "-") && tasks.kindOf(l.file) !== "other");
            if (finished) { new Notice(`This task is ${finished.task === "x" ? "done" : "canceled"} on ${this.labelOf(finished.file)}; untick it there to schedule it again`); return; }
            // The source goes back to [>] only once the move goes ahead (reschedule's `restore`)
            return this.reschedule({ editor, srcFile, lineNum, lineText, id, lines: known, restore: statusCh });
        }

        const children = [];
        for (let i = lineNum + 1; i < editor.lineCount(); i++) {
            const t = editor.getLine(i);
            if (t.trim() === "" || t.match(/^\s*/)[0].length <= indent.length) break;
            children.push(t);
        }
        const wasWorkedOn = children.some(t => /\b\d{1,2}:\d{2}\s?[ap]m\b/i.test(t));
        const destStatus = status === "/" ? "/" : " ";

        const foldBefore = view.currentMode.getFoldInfo?.();

        const rules = customJS.DatePrompt.weekRules();
        const jump = customJS.JumpToDate;
        customJS.DatePrompt.open("Schedule for", async (result, modal) => {
            const dest = this.destination(result, rules);
            // Into the note it's already in: nothing to move
            if (dest.path === srcFile.path) {
                modal.close();
                new Notice("Already in this note");
                return;
            }

            // The source lines of this task, and of tasks nested under it that move with it, read before
            // anything is written (OBS-181): their forward date moves to wherever the task goes now. Only a sent
            // line ([>], or [x] or [-] once finished) in a note that isn't a periodic note counts.
            const moving = !sourceIsDaily && !sourcePeriod ? [] : wasWorkedOn && !sourcePeriod ? [id] : [id, ...children.map((c) => T.idOf(c))];
            // Each read once per command, with the notes its line links (its source among them: sentLine
            // always links it) and the destination, which the cache may not have caught up with
            const found = new Map();
            for (const each of moving.filter(Boolean)) {
                const line = each === id ? lineText : children.find((c) => T.idOf(c) === each);
                found.set(each, await tasks.gather(each, [...this.linkedNotes(line, srcFile.path), app.vault.getFileByPath(dest.path)]));
            }
            const follow = [];
            for (const [each, lines] of found) {
                const sources = lines.filter((l) => l.file.path !== srcFile.path && tasks.kindOf(l.file) === "other" && ">x-".includes(l.task));
                if (sources.length) follow.push({ id: each, sources });
            }

            // Onto a day that already has a line of this task (worked on there before): that line is
            // reopened, rather than a second line with the same ID; onto one where it's open, done or
            // canceled, nothing moves. Read as that note is now, its line found by the ID. A first send
            // from a note has no such line: its ID is new, or another task's line there has it.
            // A worked-on day line whose block ID is another task's (foreignId) gets a fresh one, so no line
            // with that ID is this task's either.
            const destFile = app.vault.getFileByPath(dest.path);
            const foreign = !!id && sourceIsDaily && wasWorkedOn && this.foreignId(found.get(id), srcFile);
            const there = id && destFile && (sourceIsDaily || sourcePeriod) && !foreign ? await this.taskLineIn(destFile, id) : null;
            // An open line there with the ID isn't this task's open line, which is the one moving
            if (there && (there.task === " " || there.task === "/")) {
                modal.close();
                new Notice(`A line on ${dest.label} already ends in this line's block ID ^${id} (a copy of it, or another task's), so nothing was moved; take the ID off one of them first`);
                return;
            }
            if (there && there.task !== ">") {
                modal.close();
                new Notice(`This task is already ${there.task === "x" ? "done" : "canceled"} on ${dest.label}`);
                return;
            }
            // The project a nested line counts toward through the line it's under, read while the lines
            // above the cursor are still as they were
            const home = this.contextHome(editor, lineNum, lineText, srcFile);
            const helper = customJS.AddTaskNote;
            // The line that goes from a periodic note: a worked-on day line's copy (its ID added below),
            // else the line itself, either with the project of a line it leaves behind
            const lead = wasWorkedOn && !sourcePeriod ? helper.withHome(`${bullet}[${destStatus}] ${T.withoutId(body)}`, home)
                : home ? helper.withHome(lineText.slice(indent.length), home) : lineText.slice(indent.length);
            // Reopening keeps that day's time where it counts (it may be invoiced): a line naming another
            // project doesn't take its place, nor one that, in that line's place, would count elsewhere or
            // change whether the time is free
            if (there && this.projectIn(destFile, there.lines, there.at) !== (await this.projectAt(srcFile, lineNum))) {
                modal.close();
                new Notice(this.projectNotice(dest.label));
                return;
            }
            const refusal = there ? this.reopenRefusal(destFile, there, id, T.withId(lead, id), dest.label) : null;
            if (refusal) {
                modal.close();
                new Notice(refusal);
                return;
            }
            // A task nested under it that already has a line there would have its ID there twice
            const nested = moving.length > 1 ? await this.nestedThere(destFile, children) : null;
            if (nested) {
                modal.close();
                new Notice(this.nestedNotice(nested, dest.label));
                return;
            }

            // The note it goes to first, made if need be, so a line is never taken out with nowhere to go
            let file;
            try {
                file = await dest.ensure();
            } catch (err) {
                console.error(err);
                modal.close();
                new Notice(`Couldn't make the ${dest.kind} note, so nothing was scheduled — check console`);
                return;
            }
            if (editor.getLine(lineNum) !== lineText) {
                modal.close();
                new Notice("The line changed before it could be scheduled, so it wasn't");
                return;
            }

            let outgoing;
            let lineSurvives = true;

            if (!sourceIsDaily && !sourcePeriod) {
                // A note that isn't a periodic note: the line stays as the trace, [>] with a forward date to where the
                // task went at its end and the task's ID last, and the new line carries the ID too, so every
                // later move can find this line (OBS-181). A block ID of your own that any line in another
                // note also has isn't this task's alone, so the task gets a fresh one (spec section 4,
                // default 10). (A sent line, one with a forward date, whose ID a periodic note has is routed to
                // reschedule above.)
                let taskId = id;
                if (taskId && known.some((l) => l.file.path !== srcFile.path)) {
                    new Notice(`This line's block ID ^${taskId} is also on a line in another note, so the task got a new ID; a link to ^${taskId} in this note needs the new one`);
                    taskId = null;
                }
                taskId ??= tasks.freshId();
                const plainLine = T.oldForward(lineText)?.line ?? lineText;
                const plainBody = plainLine.replace(/^\s*[-*+]\s+\[.\]\s*/, "");
                const kept = T.withForward(`${T.withoutId(plainLine).replace(/^(\s*[-*+]\s+)\[.\]/, "$1[>]")} ^${taskId}`, T.forwardLink(dest.linktext(), dest.label, taskId));
                editor.replaceRange(kept, { line: lineNum, ch: 0 }, { line: lineNum, ch: lineText.length });
                outgoing = [this.sentLine(`${bullet}[${destStatus}] ${T.withoutId(T.withForward(plainBody, null))} ^${taskId}`, srcFile, home)];
            } else if (wasWorkedOn && !sourcePeriod) {
                // Daily note, already worked on: forward in place, a fresh copy goes forward, both carrying
                // the task's ID (OBS-181), which ties them together without a task note.
                // A hand-made block ID that's another task's (foreignId, above) gives way to a fresh one
                const taskId = id && !foreign ? id : tasks.freshId();
                editor.replaceRange(">", { line: lineNum, ch: statusCh }, { line: lineNum, ch: statusCh + 1 });
                if (taskId !== id) {
                    if (id) new Notice(`This line's block ID ^${id} is also on a line in another note, so the task got a new ID; a link to ^${id} in this note needs the new one`);
                    const bare = T.withoutId(lineText).replace(/\s+$/, "");
                    editor.replaceRange(` ^${taskId}`, { line: lineNum, ch: bare.length }, { line: lineNum, ch: lineText.length });
                }
                outgoing = [T.withId(lead, taskId)];
            } else {
                // Daily note untouched, or any weekly, monthly or yearly note: move the line and its sub-bullets
                lineSurvives = false;
                outgoing = [lead, ...children.map((l) => l.slice(indent.length))];
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
            // Its editor saves these edits only in a moment, so the next lookup reads the note itself
            tasks.touched(srcFile);

            modal.close();

            if (lineSurvives) setTimeout(() => {
                const wasFolded = foldBefore?.folds?.some(f => f.from === lineNum);
                const stillFolded = view.currentMode.getFoldInfo?.()?.folds?.some(f => f.from === lineNum);
                if (wasFolded && !stillFolded && view.currentMode.applyFoldInfo) {
                    view.currentMode.applyFoldInfo(foldBefore);
                }
            }, 50);

            try {
                // That day's [>] line takes the moving line's place, as [/] (reopenIn); if it's gone by
                // now, the line goes in as usual, so it can't be lost
                const reopened = there ? await this.reopen(file, id, outgoing) : false;
                if (!reopened) {
                    const before = await app.vault.cachedRead(file);
                    const prevFolds = this.captureFolds(file, before.split("\n").length);
                    const { content, at, count, item } = dest.unit === "day"
                        ? await this.appendToTopChecklist(file, outgoing)
                        : await this.appendToPeriodNote(file, outgoing);
                    tasks.touched(file);
                    await this.semiFold(file, content, prevFolds, at, count, item);
                }
                for (const f of follow) await this.followForward(f.id, dest, f.sources);
                new Notice(reopened ? `Reopened on ${dest.label}` : `${lineSurvives ? "Forwarded" : "Moved"} to ${dest.label}`);
            } catch (err) {
                console.error(err);
                new Notice(`Couldn't write to the ${dest.kind} note — check console`);
            }
        }, {
            // A week, a month or a year is its note, as for JumpToDate (OBS-96); a day, a week or a
            // month without a year is the next one
            periods: true,
            name: (text) => jump.fromName(text, rules, { ahead: true }),
            label: (r) => (r.unit === "week" ? jump.periodName(r, rules) : null),
        });
    }

    // Where a date (DatePrompt's result) sends a line: { path, unit, kind, label, link(), ensure() }.
    // A day is its daily note; a week, a month or a year its periodic note, named and filed the way
    // JumpToDate finds it, and made from its template the same way when it doesn't exist yet. `label`
    // is its short name ("10/2", "Wk of 10/4", "Oct. 2026", "2027"), `link()` the forward mark's link.
    destination(result, rules) {
        const { unit, m } = result;
        if (unit === "day") {
            const path = this.dailyNotePath(m);
            const label = m.format("M/D");
            const name = path.split("/").pop().replace(/\.md$/, "");
            // By its path when another note has its name, as for a week or a month
            const linktext = () => customJS.AddTaskNote.linktextFor({ path, basename: name }, app.vault.getMarkdownFiles().map((f) => f.path));
            return { path, unit, kind: "daily", label, linktext, link: () => `[[${name}|${label}]]`, ensure: () => this.ensureDailyNote(path) };
        }
        const jump = customJS.JumpToDate;
        const target = jump.target(result, rules);
        // An ISO week's note starts on Monday, whatever day the locale starts weeks on
        const label = Schedule.periodLabel(result, { weekStart: jump.isoWeeks(rules) ? 1 : rules.weekStart, ...jump.monthNames(rules) });
        const linktext = () => customJS.AddTaskNote.linktextFor({ path: target.path, basename: target.name }, app.vault.getMarkdownFiles().map((f) => f.path));
        return {
            path: target.path, unit, kind: target.kind, label, linktext,
            // By its path when another note has its name, so the link can't land on that one
            link: () => {
                const text = linktext();
                return text === label ? `[[${text}]]` : `[[${text}|${label}]]`;
            },
            ensure: async () => app.vault.getFileByPath(target.path) ?? jump.create(target),
        };
    }

    // Whether block ID `id` on a line of `srcFile` belongs to another task (spec section 4, default 10):
    // other lines carry it (`lines`, from gather), and none of them is in a periodic note or is a sent line
    // ([>], [x], [-]), as when a hand-made ID repeats; or, while no sent line carries it, one of them is
    // open in a periodic note, since the line being forwarded is its task's open line and a task has one.
    // A sent line with the ID says it's this task's: a second open line is then a copy (or a click turned
    // a [>] back), which keeps the ID so the checks list it.
    foreignId(lines, srcFile) {
        const tasks = customJS.TaskIds;
        const others = (lines ?? []).filter((l) => l.file.path !== srcFile.path);
        const periodic = (l) => tasks.kindOf(l.file) !== "other";
        const sent = others.some((l) => ">x-".includes(l.task));
        return (!sent && others.some((l) => periodic(l) && " /".includes(l.task))) || (others.length > 0 && !others.some((l) => periodic(l) || ">x-".includes(l.task)));
    }

    // The notes `text` (a line) links, as found from `from`: a moving line's own notes, its source among
    // them, which a lookup reads whatever the cache says (OBS-181)
    linkedNotes(text, from) {
        return [...(text ?? "").matchAll(/\[\[([^\]|#]+)/g)].map((m) => app.metadataCache.getFirstLinkpathDest(m[1].trim(), from));
    }

    // The first of `lines` (lines moving with a task) that is a task with a line in `file` already, read
    // as it is now, or null: moving it there would put its ID in that note twice (OBS-181)
    async nestedThere(file, lines) {
        const T = customJS.TaskIds.constructor;
        const tasks = lines.filter((l) => T.CHECKBOX.test(l) && T.idOf(l));
        if (!file || !tasks.length) return null;
        const there = (await customJS.TaskIds.readNow(file)).split("\n");
        return tasks.find((l) => Schedule.taskLine(there, T.idOf(l)) !== -1) ?? null;
    }

    // What Schedule says when a task nested under the moving one (`line`) has a line on `label` already
    nestedNotice(line, label) {
        const name = customJS.TimeReport.taskText(line.replace(/^\s*[-*+]\s+/, ""));
        return `"${name}", a task under this one, already has a line on ${label}, so nothing was moved; schedule it there on its own first`;
    }

    // Rewrites `file` with `fn(text) → text`: through its editor when it's open in one, changing only
    // the span that differs so the editor keeps its cursor and folds, else through the vault (OBS-181)
    async rewrite(file, fn) {
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file?.path === file.path && v.editor);
        customJS.TaskIds?.touched?.(file);
        if (!view) return app.vault.process(file, fn);
        const before = view.editor.getValue(), after = fn(before);
        if (after === before) return after;
        let s = 0;
        while (s < before.length && s < after.length && before[s] === after[s]) s++;
        let e = 0;
        while (e < before.length - s && e < after.length - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;
        // Never split an emoji's two halves
        if (s > 0 && /[\uDC00-\uDFFF]/.test(before[s] ?? "")) s--;
        if (e > 0 && /[\uD800-\uDBFF]/.test(before[before.length - e - 1] ?? "")) e--;
        view.editor.replaceRange(after.slice(s, after.length - e), view.editor.offsetToPos(s), view.editor.offsetToPos(before.length - e));
        return after;
    }

    // Points the forward date on a task's source lines (`sources`, from TaskIds.gather) at `dest`, where its open
    // line is now (OBS-181). Only a sent line still ending in the task's ID changes, and an older
    // breadcrumb in front of it comes off (TaskIds.setForwardIn).
    async followForward(id, dest, sources) {
        const T = customJS.TaskIds.constructor;
        const link = T.forwardLink(dest.linktext(), dest.label, id);
        for (const file of new Map(sources.map((s) => [s.file.path, s.file])).values()) {
            try {
                await this.rewrite(file, (text) => T.setForwardIn(text, id, link).text);
            } catch (e) {
                console.error(`Schedule: couldn't update the forward date in ${file.path}`, e);
            }
        }
    }

    // An older sent line (its date in front): its open line on that day is the one checklist line there,
    // with no ID, with the same title, that names this note (a ⭕ or 🗃️ for a project or area note,
    // else a 🗒️). With exactly one, both get the task's ID (`own`, the line's own block ID, else a fresh
    // one) and this line its forward date at the end, and the ID comes back. With none open there, the one [>] line
    // there of that title naming this note, when it ends in an ID already (it was worked on and forwarded
    // since), gives this line its ID instead, unless this line has another of its own, and the forward date points
    // where the task is now (its open line's note, or its done line's): reschedule then finds the task's
    // open line by it. Otherwise null, and the line is sent as a first send would
    // (OBS-181). The upgrade stays even if the date prompt is then dismissed: it only rewrites the line
    // as it is now.
    async adopt(editor, srcFile, lineNum, lineText, own = null) {
        const tasks = customJS.TaskIds, T = tasks.constructor;
        const old = T.oldForward(lineText);
        const day = app.metadataCache.getFirstLinkpathDest(old.linkpath, srcFile.path);
        if (!day) return null;
        const title = T.title(lineText), name = srcFile.basename.toLowerCase();
        if (!title) return null;
        const lines = (await tasks.readNow(day)).split("\n");
        const ours = (l) => T.title(l) === title && [...l.matchAll(/\[\[([^\]|#]+)/g)].some((m) => m[1].split("/").pop().trim().toLowerCase() === name);
        const matches = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^\s*[-*+]\s+\[[ /]\]/.test(l) && !T.idOf(l) && ours(l));
        const sent = matches.length ? [] : lines.filter((l) => /^\s*[-*+]\s+\[>\]/.test(l) && T.idOf(l) && ours(l));
        let id, link = null;
        if (matches.length === 1) {
            id = own ?? tasks.freshId();
            const { l, i } = matches[0];
            await this.rewrite(day, (t) => { const ls = t.split("\n"); if (ls[i] === l) ls[i] = T.withId(l, id); return ls.join("\n"); });
            if (this.isDailyNote(day)) await customJS.RefoldDailyNotes?.onLeave?.(day);
        } else if (sent.length === 1 && (!own || own.toLowerCase() === T.idOf(sent[0]).toLowerCase())) {
            id = T.idOf(sent[0]);
            const now = (await tasks.gather(id, [day])).filter((l) => tasks.kindOf(l.file) !== "other");
            const at = now.find((l) => l.task === " " || l.task === "/") ?? now.find((l) => l.task === "x" || l.task === "-");
            if (at) link = this.forwardTo(at.file, id);
        } else return null;
        // An ID the line had that isn't the task's comes off first, so the task's is the one it ends in
        const kept = T.withForward(T.withId(T.withoutId(old.line), id), link ?? T.forwardLink(old.linkpath, old.label, id));
        editor.replaceRange(kept, { line: lineNum, ch: 0 }, { line: lineNum, ch: lineText.length });
        // Its editor saves this edit only in a moment, so the next lookup reads the note itself
        tasks.touched(srcFile);
        return id;
    }

    // Schedule on a line that was already sent or forwarded (OBS-181): the task's open line moves to the
    // date picked, as Schedule would move it from its own note, and the forward date on the task's source lines
    // follows. The prompt says where the task is now. A day that already has one of its [>] lines gets
    // that line reopened. With no open line (deleted by hand), a fresh copy goes; with the task done,
    // nothing does. The destination is written first and the line taken out last, so a write that fails
    // can't lose the task. `lines` are the task's lines when the caller has them (gather); `restore` is
    // where the status of a source clicked back to [ ] is, set to [>] again once the move goes ahead, or
    // when it's refused (while the line is as it was).
    async reschedule({ editor, srcFile, lineNum, lineText, id, lines: given = null, restore = null }) {
        const tasks = customJS.TaskIds, T = tasks.constructor;
        const fromSource = tasks.kindOf(srcFile) === "other";
        const fwd = T.forwardOf(lineText);
        const pointed = fwd ? app.metadataCache.getFirstLinkpathDest(fwd.linkpath, srcFile.path) : null;
        const lines = given ?? await tasks.gather(id, [pointed]);
        const periodic = (l) => tasks.kindOf(l.file) !== "other";
        const open = lines.find((l) => (l.task === " " || l.task === "/") && periodic(l));
        const done = lines.find((l) => (l.task === "x" || l.task === "-") && periodic(l));
        if (!open && done) { new Notice(`This task is already ${done.task === "x" ? "done" : "canceled"}, on ${this.labelOf(done.file)}`); return; }
        const sources = lines.filter((l) => !periodic(l) && ">x-".includes(l.task));
        const rules = customJS.DatePrompt.weekRules();
        const jump = customJS.JumpToDate;
        customJS.DatePrompt.open(open ? `Scheduled for ${this.labelOf(open.file)}. Move it to` : "Schedule for", async (result, modal) => {
            const dest = this.destination(result, rules);
            modal.close();
            // A source clicked back to [ ] is a sent line still when nothing moves: its [>] comes back, while
            // it's the line it was. True when it did.
            const putBack = () => {
                if (restore === null || editor.getLine(lineNum) !== lineText) return false;
                editor.replaceRange(">", { line: lineNum, ch: restore }, { line: lineNum, ch: restore + 1 });
                tasks.touched(srcFile);
                return true;
            };
            const refuse = (message) => { putBack(); new Notice(message); };
            if (open && dest.path === open.file.path) {
                // Its task is on that day. And a forward date that says otherwise (the open line moved there by hand)
                // points there now.
                const back = putBack();
                await this.followForward(id, dest, back ? [...sources, { file: srcFile }] : sources);
                new Notice(`Already on ${dest.label}`);
                return;
            }
            // A source clicked back to [ ] is set to [>] again below, so it must still be the line it was
            if (restore !== null && editor.getLine(lineNum) !== lineText) { new Notice("The line changed before it could be scheduled, so it wasn't"); return; }
            // The task's line on that day, read as that note is now and found by the ID, since the prompt
            // may have been open a while: a [>] line is reopened, any other stops the move
            const destFile = app.vault.getFileByPath(dest.path);
            const there = destFile ? await this.taskLineIn(destFile, id) : null;
            if (there && there.task !== ">") { refuse(`This task is already ${there.task === "x" ? "done" : there.task === "-" ? "canceled" : "open"} on ${dest.label}`); return; }
            const taken = (text) => {
                const ls = text.split("\n");
                const at = Schedule.taskLine(ls, id, " /");
                return at === -1 ? null : { at, before: ls, ...Schedule.leaveBehind(ls, at, { daily: this.isDailyNote(open.file) }) };
            };
            let outgoing, moved = "forwarded", plan = null;
            if (open) {
                plan = taken(await tasks.readNow(open.file));
                if (!plan) { refuse("The task's line changed before it could be moved, so it wasn't"); return; }
                ({ outgoing, moved } = plan);
                // Nested there, it leaves the line it's under behind: it takes that line's project
                const home = this.homeAbove(plan.before, plan.at, open.file);
                if (home) outgoing = [customJS.AddTaskNote.withHome(outgoing[0], home), ...outgoing.slice(1)];
            } else {
                // A fresh copy: from a note, as a first send makes it; from a day's [>] line, that line, open;
                // either with the project of a line it's nested under. An older line's breadcrumb stays behind.
                const body = T.withoutId(T.withForward((T.oldForward(lineText)?.line ?? lineText).replace(/^\s*[-*+]\s+\[.\]\s*/, ""), null));
                const home = this.contextHome(editor, lineNum, lineText, srcFile);
                outgoing = [fromSource ? this.sentLine(`- [ ] ${body} ^${id}`, srcFile, home)
                    : T.withId(customJS.AddTaskNote.withHome(`- [ ] ${body}`, home), id)];
            }
            // Reopening keeps that day's time where it counts: a line naming another project doesn't take
            // its place. Each line as its note is now: the open line as `taken` read it, else this one by its ID.
            if (there) {
                const here = open ? null : await this.taskLineIn(srcFile, id);
                const mine = open ? this.projectIn(open.file, plan.before, plan.at)
                    : here ? this.projectIn(srcFile, here.lines, here.at) : await this.projectAt(srcFile, lineNum);
                if (this.projectIn(destFile, there.lines, there.at) !== mine) { refuse(this.projectNotice(dest.label)); return; }
                // Nor one that, in that line's place, would count elsewhere or change whether the time is free
                const refusal = this.reopenRefusal(destFile, there, id, outgoing[0], dest.label);
                if (refusal) { refuse(refusal); return; }
            }
            // Tasks nested under the open line move with it (as in invoke): one that already has a line
            // there stops the move, since its ID would be there twice; the others' forward dates follow, each
            // task's lines read now with the notes its line links and the destination
            const nested = moved === "moved" ? outgoing.slice(1) : [];
            const clash = await this.nestedThere(destFile, nested);
            if (clash) { refuse(this.nestedNotice(clash, dest.label)); return; }
            const follow = [];
            for (const line of nested) {
                const sub = T.CHECKBOX.test(line) ? T.idOf(line) : null;
                if (!sub) continue;
                const subLines = await tasks.gather(sub, [...this.linkedNotes(line, open.file.path), destFile]);
                follow.push({ id: sub, sources: subLines.filter((l) => !periodic(l) && ">x-".includes(l.task)) });
            }
            let file;
            try {
                file = await dest.ensure();
            } catch (err) {
                console.error(err);
                refuse(`Couldn't make the ${dest.kind} note, so nothing was scheduled — check console`);
                return;
            }
            try {
                // Reopened there (as in invoke), or in as usual when that line is gone by now
                const reopened = there ? await this.reopen(file, id, outgoing) : false;
                if (!reopened) {
                    const before = await app.vault.cachedRead(file);
                    const prevFolds = this.captureFolds(file, before.split("\n").length);
                    const { content, at, count, item } = dest.unit === "day" ? await this.appendToTopChecklist(file, outgoing) : await this.appendToPeriodNote(file, outgoing);
                    await this.semiFold(file, content, prevFolds, at, count, item);
                    tasks.touched(file);
                }
                if (open) {
                    await this.rewrite(open.file, (t) => taken(t)?.lines.join("\n") ?? t);
                    if (this.isDailyNote(open.file)) await customJS.RefoldDailyNotes?.onLeave?.(open.file);
                }
                // A source clicked back to [ ] is a sent line again, now that the task has moved
                if (restore !== null) editor.replaceRange(">", { line: lineNum, ch: restore }, { line: lineNum, ch: restore + 1 });
                await this.followForward(id, dest, restore !== null ? [...sources, { file: srcFile }] : sources);
                for (const f of follow) await this.followForward(f.id, dest, f.sources);
                new Notice(reopened ? `Reopened on ${dest.label}` : `${moved === "moved" ? "Moved" : "Forwarded"} to ${dest.label}`);
            } catch (err) {
                console.error(err);
                new Notice(`Couldn't write to the ${dest.kind} note — check console`);
            }
        }, {
            periods: true,
            name: (text) => jump.fromName(text, rules, { ahead: true }),
            label: (r) => (r.unit === "week" ? jump.periodName(r, rules) : null),
        });
    }

    // Reopens the [>] line ending in `id` in `file` with `outgoing`, the lines moving there (reopenIn), and
    // refreshes a daily note's fold snapshot. False when `file` has no such line any more, and is left as
    // it was, so the caller puts the lines in as usual rather than lose them
    async reopen(file, id, outgoing) {
        let reopened = false;
        await this.rewrite(file, (t) => {
            const next = Schedule.reopenIn(t, id, outgoing, (link) => this.liveLink(link, file));
            reopened = next !== t;
            return next;
        });
        if (reopened && this.isDailyNote(file)) await customJS.RefoldDailyNotes?.onLeave?.(file);
        return reopened;
    }

    // Line `at` of `lines`, in a periodic note (`daily`: a daily note), as Schedule treats it: with time
    // entries under it in a daily note, it stays as [>] and a copy without them goes; otherwise it goes
    // with its sub-bullets. { lines, outgoing, moved }
    static leaveBehind(lines, at, { daily }) {
        const line = lines[at];
        const indent = line.match(/^\s*/)[0];
        const children = [];
        for (let i = at + 1; i < lines.length; i++) {
            const t = lines[i];
            if (t.trim() === "" || t.match(/^\s*/)[0].length <= indent.length) break;
            children.push(t);
        }
        if (daily && children.some((t) => /\b\d{1,2}:\d{2}\s?[ap]m\b/i.test(t))) {
            const status = line.match(/\[(.)\]/)[1] === "/" ? "/" : " ";
            const next = [...lines];
            next[at] = line.replace(/\[(.)\]/, "[>]");
            return { lines: next, outgoing: [line.slice(indent.length).replace(/\[(.)\]/, `[${status}]`)], moved: "forwarded" };
        }
        return { lines: [...lines.slice(0, at), ...lines.slice(at + 1 + children.length)], outgoing: [line, ...children].map((l) => l.slice(indent.length)), moved: "moved" };
    }

    // `text` with the [>] line ending in `id` reopened (a [>] on a day has time logged under it): the line
    // that moved here, `moved[0]`, takes its place as [/], so a wording or deadline it gained is kept, with
    // the old line's project link and note link when it has none (keepLinks; `live` says whether a
    // project link points at a live project or area); the old line's sub-bullets stay, and the ones that
    // came with it follow (OBS-181)
    static reopenIn(text, id, moved, live = () => true) {
        const lines = text.split("\n");
        const at = Schedule.taskLine(lines, id, ">");
        if (at === -1 || !moved.length) return text;
        const indent = lines[at].match(/^\s*/)[0];
        let end = at;
        while (end + 1 < lines.length && lines[end + 1].trim() && lines[end + 1].match(/^\s*/)[0].length > indent.length) end++;
        lines[at] = indent + Schedule.keepLinks(moved[0].trimStart().replace(/\[.\]/, "[/]"), lines[at], live);
        lines.splice(end + 1, 0, ...moved.slice(1).map((c) => indent + c));
        return lines.join("\n");
    }

    // `line` with the ⭕ or 🗃️ and the note link (🗒️, or 🔗 from before OBS-87) of the run ending `old`,
    // each when `line` has none of its own: the ⭕ before a note link, the note link last before the ID.
    // The old line's ⭕ pins that day's time to its project, under whatever line it's nested in, and its
    // note is the day's. Only a ⭕ or 🗃️ for a live project or area (`live(link)`) comes back: a finished
    // one's counts for nothing on an open line. Nothing else does: the moving line's 🚩, or its lack of
    // one, is the newer word on the deadline.
    static keepLinks(line, old, live = () => true) {
        const T = customJS.TaskIds.constructor;
        const note = (i) => /\|\s*(?:🗒|🔗)/u.test(i);
        const home = (i) => /\|\s*(?:⭕|🗃)/u.test(i);
        const { text, items } = T.splitRun(line);
        const was = T.splitRun(old).items;
        const homes = items.some(home) ? [] : was.filter((i) => home(i) && live(i));
        const kept = items.some(note) ? null : was.find(note);
        if (!homes.length && !kept) return line;
        const at = items.findIndex(note);
        items.splice(at === -1 ? items.length : at, 0, ...homes);
        if (kept) items.push(kept);
        const id = T.idOf(line);
        return [text, ...items].join(" ") + (id ? ` ^${id}` : "");
    }

    // Why reopening `there` (task `id`'s [>] line in `file`, as taskLineIn read it) with `lead`, the line
    // moving there, can't go ahead, or null: read in that line's place, under the lines it's nested in
    // there, the reopened line must count toward the same project as the old one and be as free, so the
    // time logged under it stays where it counted (OBS-181)
    reopenRefusal(file, there, id, lead, label) {
        const after = Schedule.reopenIn(there.lines.join("\n"), id, [lead], (link) => this.liveLink(link, file)).split("\n");
        if (this.projectIn(file, after, there.at) !== this.projectIn(file, there.lines, there.at)) return this.projectNotice(label);
        const free = this.freeIn(there.lines[there.at]);
        return this.freeIn(after[there.at]) !== free ? this.freeNotice(label, free) : null;
    }

    // Whether `link`, a ⭕ or 🗃️ link in `file`, points at a live project or area (AddTaskNote.isLiveHome)
    liveLink(link, file) {
        const target = link.match(/^\[\[([^\]|#]+)/)?.[1].trim();
        const dest = target ? app.metadataCache.getFirstLinkpathDest(target, file.path) : null;
        return !!dest && customJS.AddTaskNote.isLiveHome(dest);
    }

    // What Schedule says when a day's [>] line and the line moving there count toward different projects
    projectNotice(label) {
        return `This task's line on ${label} names another project, so it wasn't moved there; give both lines the same project first`;
    }

    // The index in `lines` of the checklist line ending in block ID `id` with its box one of `boxes`
    // (" /" open, ">" forwarded; any box when omitted), or -1
    static taskLine(lines, id, boxes = null) {
        const T = customJS.TaskIds.constructor, want = id.toLowerCase();
        return lines.findIndex((l) => {
            const box = l.match(T.CHECKBOX)?.[1];
            return box !== undefined && (!boxes || boxes.includes(box)) && T.idOf(l)?.toLowerCase() === want;
        });
    }

    // Task `id`'s line in `file`, read as the note is now: { at, task, lines } (the note's lines), or null.
    // A note holds one line of a task, but if a hand edit left two, one that isn't [>] comes first, so
    // a move never reopens a line beside an open one.
    async taskLineIn(file, id) {
        const T = customJS.TaskIds.constructor, want = id.toLowerCase();
        const lines = (await customJS.TaskIds.readNow(file)).split("\n");
        const ours = lines.map((l, at) => ({ at, task: l.match(T.CHECKBOX)?.[1] }))
            .filter(({ at, task }) => task !== undefined && T.idOf(lines[at])?.toLowerCase() === want);
        const hit = ours.find((l) => l.task !== ">") ?? ours[0];
        return hit ? { at: hit.at, task: hit.task, lines } : null;
    }

    // The project or area line `at` of `lines` (`file`'s text) counts toward, as the time report reads it,
    // with the lines it's nested under
    projectIn(file, lines, at) {
        const tr = customJS.TimeReport;
        return tr.lineProject({ path: file.path, kind: customJS.TaskIds.kindOf(file) }, at, lines, tr.appIndex());
    }

    // The same for line `line` of `file`, from the note as it is now
    async projectAt(file, line) {
        return this.projectIn(file, (await customJS.TaskIds.readNow(file)).split("\n"), line);
    }

    // Whether a task line is marked 🆓 itself, as the time report reads it: the entries under it are then
    // free. A reopen puts the moving line in the place of a day's [>] line, so the two must agree on it.
    freeIn(line) {
        const tr = customJS.TimeReport;
        return tr.freeLine(tr.classify(line).body).free;
    }

    // What Schedule says when a day's [>] line and the line moving there differ in 🆓 (`free`: the day's is)
    freeNotice(label, free) {
        return `This task's line on ${label} ${free ? "is marked 🆓 and the line moving there isn't" : "isn't marked 🆓 and the line moving there is"}, so it wasn't moved there; mark both the same first`;
    }

    // The forward date to task `id`'s line in `file`, a periodic note, as Schedule writes one for a date it's given:
    // by name, or by path when another note has it; "10/8", "Wk of 10/4", "Oct. 2026" or "2027"
    forwardTo(file, id) {
        const label = this.isDailyNote(file) ? window.moment(file.basename, this.dailyOpts().format, true).format("M/D") : this.labelOf(file);
        const linktext = customJS.AddTaskNote.linktextFor(file, app.vault.getMarkdownFiles().map((f) => f.path));
        return customJS.TaskIds.constructor.forwardLink(linktext, label, id);
    }

    // Where a periodic note puts a task, as a prompt says it: "Thu 10/8", "Wk of 10/4", "Oct. 2026", "2027"
    labelOf(file) {
        if (this.isDailyNote(file)) return window.moment(file.basename, this.dailyOpts().format, true).format("ddd M/D");
        const unit = this.periodOf(file);
        if (!unit) return file.basename;
        const rules = customJS.DatePrompt.weekRules();
        const jump = customJS.JumpToDate;
        const date = window.moment(file.basename, rules.format[unit], rules.locale, true).format("YYYY-MM-DD");
        return Schedule.periodLabel({ date, unit }, { weekStart: jump.isoWeeks(rules) ? 1 : rules.weekStart, ...jump.monthNames(rules) });
    }

    // A period's short name, as short as a day's M/D: "Wk of 10/4" (the day the week starts, weeks
    // starting on `weekStart`, 0 is Sunday), "Oct. 2026" (the locale's short month name, with a period
    // unless it has one or is the whole name: "May 2026"), "2027"
    static periodLabel({ date, unit }, { weekStart = 0, months = [], short = [] } = {}) {
        const [y, mo, d] = date.split("-").map(Number);
        if (unit === "year") return String(y);
        if (unit === "month") {
            const name = String(short[mo - 1] ?? months[mo - 1] ?? mo);
            return `${name}${name.endsWith(".") || name === String(months[mo - 1]) ? "" : "."} ${y}`;
        }
        const first = new Date(Date.UTC(y, mo - 1, d));
        first.setUTCDate(d - (first.getUTCDay() - weekStart + 7) % 7);
        return `Wk of ${first.getUTCMonth() + 1}/${first.getUTCDate()}`;
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

    // "week", "month" or "year" for a weekly, monthly or yearly note, else null. One is named strictly
    // by its pattern (DatePrompt.weekRules: "2026-09", not "2026-09-07") and lives in its folder
    // (TimeReport.periodFolders), so a note elsewhere with such a name isn't one.
    periodOf(file) {
        const rules = customJS.DatePrompt.weekRules();
        const folders = customJS.TimeReport.periodFolders();
        const folder = file.parent?.path ?? "";
        for (const unit of ["week", "month", "year"]) {
            if (folder === folders[unit] && window.moment(file.basename, rules.format[unit], rules.locale, true).isValid()) return unit;
        }
        return null;
    }

    // A ⭕ or 🗃️ link for the project a nested line counts toward through a line it's under, for a copy
    // or move that leaves that line behind, so its time keeps counting there (OBS-181). Null for a
    // top-level line, one with a ⭕ or 🗃️ of its own, or one under no live project.
    contextHome(editor, lineNum, lineText, srcFile) {
        const lines = [];
        for (let i = 0; i < lineNum; i++) lines.push(editor.getLine(i));
        return this.homeAbove([...lines, lineText], lineNum, srcFile);
    }

    // The same for line `at` of `lines` (`file`'s text, as far as that line), for a line read from a note
    // rather than the editor: an open line Schedule moves from another note (OBS-181)
    homeAbove(lines, at, file) {
        const helper = customJS.AddTaskNote, tr = customJS.TimeReport;
        if (!/^\s+/.test(lines[at]) || helper.trailingProjectLinks(lines[at]).length) return null;
        const path = tr.lineProject({ path: file.path, kind: "period" }, at, lines, tr.appIndex());
        const home = path ? app.vault.getFileByPath(path) : null;
        return home && helper.isLiveHome(home) ? helper.homeLink(home, helper.linktextFor(home, app.vault.getMarkdownFiles().map((f) => f.path))) : null;
    }

    // A line sent here from `src`, a note that isn't a daily, weekly, monthly or yearly note: it links back to `src`,
    // as its ⭕ or 🗃️ when `src` is a project or area, else as its 🗒️ note, after that note's own
    // project or area (OBS-90). A line that already ends in a note link of its own (a sub-task with
    // its own note) keeps that as its note, named with that note's project, and gets no second one.
    // A line with a ⭕ or 🗃️ of its own keeps it, and gets no other. A line nested under one that
    // names a project or area (`context`, contextHome's link) takes that one, as the line in `src`
    // counts toward it, with the 🗒️ back to a source that isn't a project or area note (OBS-181).
    sentLine(line, src, context = null) {
        const helper = customJS.AddTaskNote;
        const paths = () => app.vault.getMarkdownFiles().map((f) => f.path);
        // Only the ⭕ links that end the line are its own (OBS-90); one in the text is its title's
        const own = helper.trailingProjectLinks(line).length > 0;
        const tagged = this.isProjectNote(src) || this.isAreaNote(src);
        const srcLink = tagged ? `[[${helper.linktextFor(src, paths())}|${this.isProjectNote(src) ? "⭕" : "🗃️"}]]` : null;
        const srcHome = tagged ? null : helper.lineHome(src);
        const homeLink = (home) => (home ? helper.homeLink(home, helper.linktextFor(home, paths())) : null);
        const linked = helper.trailingNote(line);
        // The 🗒️ back to a source that isn't a project or area note
        const back = `[[${src.basename}|${Schedule.NOTE_MARK}]]`;
        if (context && !own) {
            const homed = helper.withHome(line, context);
            return tagged || linked ? homed : helper.endWith(homed, back);
        }
        if (linked) {
            if (own) return helper.withHome(line, null);
            // Named with the note's project; the source's only when the note isn't filed anywhere
            // (a finished project's note names none: its time counts there)
            const note = app.metadataCache.getFirstLinkpathDest(linked, src.path);
            if (note && helper.filedIn(note)) return helper.withHome(line, homeLink(helper.lineHome(note)));
            return helper.withHome(line, srcLink ?? homeLink(srcHome));
        }
        if (tagged) return helper.withHome(line, own ? null : srcLink);
        return helper.endWith(helper.withHome(line, own ? null : homeLink(srcHome)), back);
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
            const first = lines.findIndex(l => Schedule.CHECKBOX.test(l));
            if (first === -1) {
                const head = content.replace(/\s+$/, "").split("\n");
                out = { content: [...head, ...newLines].join("\n") + "\n", at: head.length, count: newLines.length, item: head.length };
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
            out = { content: lines.join("\n"), at, count: newLines.length, item: at };
            return out.content;
        });
        return out;
    }

    // The same for a weekly, monthly or yearly note (placeInPeriod)
    async appendToPeriodNote(file, newLines) {
        let out;
        await app.vault.process(file, (content) => {
            out = Schedule.placeInPeriod(content, newLines);
            return out.content;
        });
        return out;
    }

    static CHECKBOX = /^\s*[-*+]\s+\[.\]/;

    // Where lines go in a weekly, monthly or yearly note: the end of its first checklist, as in a daily
    // note, but never inside the time report (its "## Time Report" heading in any case, "## Time tracking"
    // before OBS-133, or its start marker, down to its end marker). With no checklist, they start one just
    // above the report, or at the end when
    // there's none, set off by a blank line from what's above (none straight after the frontmatter) and
    // by another from the report. Returns { content, at, count, item }: the new content, the line the
    // insert starts at, how many lines it adds, and the line of the first one moved there.
    static placeInPeriod(content, newLines) {
        const lines = content.split("\n");
        const fmEnd = lines[0]?.trim() === "---" ? lines.findIndex((l, i) => i > 0 && l.trim() === "---") : -1;
        const start = lines.findIndex((l, i) => i > fmEnd && (/^##\s+time\s+(?:report|tracking)$/i.test(l.trim()) || l.trim() === "%% time:start %%"));
        const endMark = start === -1 ? -1 : lines.findIndex((l, i) => i >= start && l.trim() === "%% time:end %%");
        const end = endMark === -1 ? start : endMark;
        const inReport = (i) => start !== -1 && i >= start && i <= end;

        const first = lines.findIndex((l, i) => i > fmEnd && !inReport(i) && Schedule.CHECKBOX.test(l));
        if (first !== -1) {
            const indent = lines[first].match(/^\s*/)[0];
            let last = first;
            while (last + 1 < lines.length && !inReport(last + 1)) {
                const next = lines[last + 1];
                if (next.trim() === "" || !(/^\s*[-*+]\s/.test(next) || /^\s/.test(next))) break;
                last++;
            }
            lines.splice(last + 1, 0, ...newLines.map((l) => indent + l));
            return { content: lines.join("\n"), at: last + 1, count: newLines.length, item: last + 1 };
        }

        let at = start === -1 ? lines.length : start;
        while (at > fmEnd + 1 && lines[at - 1].trim() === "") at--;
        const above = at > fmEnd + 1 ? [""] : [];
        const block = [...above, ...newLines, ...(at === start ? [""] : []), ...(at === lines.length ? [""] : [])];
        lines.splice(at, 0, ...block);
        return { content: lines.join("\n"), at, count: block.length, item: at + above.length };
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
    // `at` and `count` say where lines went in and how many; `item` is the line of the first one moved
    // there, when blank lines came before it.
    async semiFold(file, content, prev, at, count, item = at) {
        const foldable = this.foldableRanges(content);
        const byLine = new Map(foldable.map(r => [r.from, r]));

        const kept = (prev.folds ?? [])
            .map(f => ({ from: f.from >= at ? f.from + count : f.from }))
            .filter(f => byLine.has(f.from))
            .map(f => byLine.get(f.from));

        const mixed = kept.length > 0 && kept.length < foldable.length;
        const pasted = byLine.get(item);   // only set when sub-bullets came along
        let folds = mixed
            ? (pasted && !kept.some(f => f.from === item) ? [...kept, pasted] : kept)
            : foldable;

        folds = folds.slice().sort((a, b) => a.from - b.from);
        if (prev.props) folds.unshift({ from: 0, to: 0 });

        const info = { folds, lines: content.split("\n").length };
        const view = app.workspace.getLeavesOfType("markdown").map(l => l.view).find(v => v?.file === file);
        if (view) setTimeout(() => view.currentMode.applyFoldInfo(info), 50);
        await app.foldManager.save(file, info);
    }
}
