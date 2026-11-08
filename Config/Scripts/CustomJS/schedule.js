class Schedule {
    // A task's link to its own note: ⋯ (OBS-208). Schedule reads a line's note link through AddTaskNote
    // (trailingNote), whose NOTE_LINK reads its ⋯, else its ↗.
    static NOTE_MARK = "⋯";
    // The link to the note a line was sent from (rule 13, OBS-208), after the line's own ⋯
    static FROM_MARK = "↗";
    // The tag on every write the system makes through an editor (CodeMirror's userEvent), so CheckOff tells it
    // from your own edits and leaves it alone (OBS-232). A write through the vault reaches an editor as "set".
    static ORIGIN = "obsidian-pm";

    async invoke() {
        const { MarkdownView } = customJS.obsidian;
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        const srcFile = app.workspace.getActiveFile();
        if (!view || !srcFile) { new Notice("Need an active editor"); return; }
        if (customJS.TaskIds && !customJS.TaskIds.works(srcFile)) return;
        const editor = view.editor;
        const cursor = editor.getCursor().line;
        // Rule 5 (OBS-193): on a sub-task, or any line under a task or event, Schedule acts on the line at the
        // top of the nest, in every note. Events belong to the calendar, in any of their forms (rule 1): moving
        // one here would put the note out of sync with it.
        const top = customJS.TimeReport.topOf((n) => editor.getLine(n), cursor);
        if (top.event) {
            new Notice(top.event === "canceled" ? "This event was canceled in your calendar" : "Events must be moved in your calendar app");
            return;
        }
        const lineNum = top.at;
        const lineText = top.line;
        const box = lineText.match(/^(\s*)([-*+]\s+)\[(.)\]\s*(.*)$/);
        if (!box) { new Notice("Not on a checklist item"); return; }
        const [, indent, bullet, status] = box;
        const statusCh = indent.length + bullet.length + 1;
        // Run from a line under the task, the notice names the task
        const named = lineNum !== cursor ? this.nameOf(lineText) : null;
        const sourceIsDaily = this.isDailyNote(srcFile);
        // A weekly, monthly or yearly note holds tasks with no day yet: they move out whole
        const sourcePeriod = this.periodOf(srcFile);
        const periodic = sourceIsDaily || !!sourcePeriod;
        // Until Obsidian has indexed the vault at startup, a task's other lines can't be found
        if (app.metadataCache.initialized === false) { new Notice("Obsidian is still indexing the vault; try again in a moment"); return; }
        const tasks = customJS.TaskIds;
        const T = tasks.constructor;
        const id = T.idOf(lineText);
        // The task's lines as they are now, for a line with an ID outside the periodic notes (the first
        // send's guard and the routing below read them)
        const fwd0 = id ? T.forwardOf(lineText) : null;
        const known = id && !periodic ? await tasks.gather(id, [fwd0 ? app.metadataCache.getFirstLinkpathDest(fwd0.linkpath, srcFile.path) : null]) : null;

        // An older sent line (its date in front) whose ID, if it has one of your own, no line in a periodic
        // note has: it's matched to its open line first, so Schedule on it moves the task rather than send
        // a second copy. Matched, it keeps an ID of its own (the task's, spec section 4) unless another
        // task's line has it (foreignId); not matched, it's sent as a first send would be, below.
        const older = status === ">" && !periodic && T.oldForward(lineText) && !known?.some((l) => tasks.kindOf(l.file) !== "other");
        if (older) {
            const foreign = this.foreignId(known, srcFile);
            const adopted = await this.adopt(editor, srcFile, lineNum, lineText, foreign ? null : id);
            if (adopted) {
                if (foreign) new Notice(`This line's block ID ^${id} is also on a line in another note, so the task got a new ID; a link to ^${id} in this note needs the new one`);
                return this.reschedule({ editor, srcFile, lineNum, lineText: editor.getLine(lineNum), id: adopted, named });
            }
        }
        // A line already sent or forwarded (OBS-181): Schedule moves the task's open line, wherever it is
        if (status === ">" && id && !older) return this.reschedule({ editor, srcFile, lineNum, lineText, id, lines: known, named });
        // A sent line clicked back to [ ] (a click turns [>] into [ ]), or ticked done or canceled: while the
        // task still has a line in a periodic note, it's this task, so the line goes back to [>] and the
        // task's line there moves; a finished task reopens (rule 13). Only a line that shows it was sent, by
        // its forward date: one without is a first send, whose own block ID may be another task's (below)
        if (id && status !== ">" && fwd0 && known?.some((l) => l.file.path !== srcFile.path && tasks.kindOf(l.file) !== "other")) {
            // The source goes back to [>] only once the move goes ahead (reschedule's `restore`)
            return this.reschedule({ editor, srcFile, lineNum, lineText, id, lines: known, restore: statusCh, named });
        }

        const foldBefore = view.currentMode.getFoldInfo?.();

        const rules = customJS.DatePrompt.weekRules();
        const jump = customJS.JumpToDate;
        customJS.DatePrompt.open("Schedule for", async (result, modal) => {
            const dest = this.destination(result, rules);
            // Into the note it's already in: nothing to move. A done or canceled line there reopens in place (rule 13).
            if (dest.path === srcFile.path) {
                modal.close();
                if (!"xX-".includes(status) || editor.getLine(lineNum) !== lineText) { new Notice("Already in this note"); return; }
                const found = id ? await tasks.gather(id, this.linkedNotes(lineText, srcFile.path)) : [];
                const others = found.filter((l) => l.file.path !== srcFile.path);
                const started = Schedule.nest(Schedule.editorLines(editor), lineNum).time || await this.started(others);
                if (editor.getLine(lineNum) !== lineText) { new Notice("The line changed before it could be scheduled, so it wasn't"); return; }
                editor.replaceRange(started ? "/" : " ", { line: lineNum, ch: statusCh }, { line: lineNum, ch: statusCh + 1 }, Schedule.ORIGIN);
                tasks.touched(srcFile);
                if (id) {
                    await this.followForward(id, dest, others.filter((l) => tasks.kindOf(l.file) === "other" && ">xX-".includes(l.task)), { reopen: true });
                    await this.reopenFinished(id, others, [srcFile]);
                }
                new Notice(Schedule.said({ reopened: true, named, label: dest.label }));
                return;
            }
            const destFile = app.vault.getFileByPath(dest.path);
            // The task's lines, read before anything is written (OBS-181): the forward date on its sent lines
            // outside the periodic notes follows it, and its done or canceled lines elsewhere become [>]
            // (rule 13). Read with the notes its line links (its source among them) and the destination,
            // which the cache may not have caught up with.
            const found = id && periodic ? await tasks.gather(id, [...this.linkedNotes(lineText, srcFile.path), destFile]) : [];
            const others = found.filter((l) => l.file.path !== srcFile.path);
            // The task's nest as the note is now: from a day, time logged under it keeps it there
            const now = Schedule.editorLines(editor);
            const weighed = Schedule.nest(now, lineNum);
            const forwarded = sourceIsDaily && status !== ">" && weighed.time;
            // A day line that stays whose block ID is another task's (foreignId) gets a fresh one, so no line
            // with that ID is this task's either
            const foreign = !!id && forwarded && this.foreignId(found, srcFile);
            // Onto a periodic note that has a [>], done or canceled line of this task, that line reopens
            // (rule 13), rather than a second line with the same ID; onto one where it's open, nothing moves,
            // since the task is there already. Read as that note is now, found by the ID among its top lines.
            const there = id && destFile && periodic && !foreign ? await this.taskLineIn(destFile, id) : null;
            if (there && " /".includes(there.task)) {
                modal.close();
                new Notice(`A line on ${dest.label} already ends in this line's block ID ^${id} (a copy of it, or another task's), so nothing was moved; take the ID off one of them first`);
                return;
            }
            // Whether the task has time logged on any of its lines: a finished task reopens as [/] then, else [ ]
            const started = weighed.time || (!foreign && await this.started(others));

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
            modal.close();

            // `outgoing`: the lines that go; `kept`: what's left in place of lines lineNum to `end`
            let outgoing, kept, end = lineNum, taskId = id;
            if (!periodic || status === ">") {
                // A note that isn't a periodic note: the line stays as the trace, [>] with a forward date to where
                // the task went at its end and the task's ID last, and its sub-tasks stay under it; the new line
                // carries the ID too, so every later move can find this line (OBS-181). A block ID of your own
                // that any line in another note also has isn't this task's alone, so the task gets a fresh one
                // (spec section 4, default 10). (A sent line, one with a forward date, whose ID a periodic note
                // has is routed to reschedule above.)
                if (taskId && known.some((l) => l.file.path !== srcFile.path)) {
                    new Notice(`This line's block ID ^${taskId} is also on a line in another note, so the task got a new ID; a link to ^${taskId} in this note needs the new one`);
                    taskId = null;
                }
                taskId ??= tasks.freshId();
                const plainLine = T.oldForward(lineText)?.line ?? lineText;
                const plainBody = plainLine.replace(/^\s*[-*+]\s+\[.\]\s*/, "");
                kept = [T.withForward(`${T.withoutId(plainLine).replace(/^(\s*[-*+]\s+)\[.\]/, "$1[>]")} ^${taskId}`, T.forwardLink(dest.linktext(), dest.label, taskId))];
                const copy = `${bullet}[${status === "/" ? "/" : " "}] ${T.withoutId(T.withForward(plainBody, null))} ^${taskId}`;
                // Its open sub-tasks go with it, so the steps are on the day (Brian, 2026-10-26); finished ones and
                // notes stay under the [>] line. A [>] line with no ID in a periodic note (a hand edit) is never taken
                // out: it gets an ID and the forward date like a first send, and an open copy goes.
                end = Schedule.nest(now, lineNum).end;
                const go = Schedule.openSteps(now, lineNum, end);
                for (let k = lineNum + 1; k <= end; k++) if (!go.has(k) && now[k].replace(/\r$/, "").trim()) kept.push(now[k]);
                const out = (l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()).replace(/\r$/, "");
                outgoing = [periodic ? copy : this.sentLine(copy, srcFile), ...[...go].filter((k) => now[k].replace(/\r$/, "").trim()).map((k) => out(now[k]))];
            } else {
                // A periodic note (leaveBehind): from a day, the line stays [>] with what has to stay (its time,
                // its finished sub-tasks) and an open copy goes, both carrying the task's ID (OBS-181), which
                // ties them together without a task note; with nothing to stay, or from a week, month or year,
                // it moves whole. A hand-made block ID that's another task's (foreignId) gives way to a fresh one.
                if (forwarded) taskId = id && !foreign ? id : tasks.freshId();
                if (id && taskId !== id) new Notice(`This line's block ID ^${id} is also on a line in another note, so the task got a new ID; a link to ^${id} in this note needs the new one`);
                const lines = [...now];
                if (taskId !== id) lines[lineNum] = `${T.withoutId(lineText).replace(/\s+$/, "")} ^${taskId}`;
                ({ outgoing, kept, end } = Schedule.leaveBehind(lines, lineNum, { daily: sourceIsDaily, started }));
            }
            const lineSurvives = kept.length > 0;

            // The destination first (rule 13), so a write that fails leaves the line where it was. That day's
            // [>], done or canceled line takes the moving line's place (reopenIn); if it's gone by now, the line
            // goes in as usual, so it can't be lost.
            let reopened;
            try {
                reopened = there ? await this.reopen(file, taskId, outgoing, { started }) : false;
                if (!reopened) {
                    const before = await tasks.readNow(file);
                    const prevFolds = this.captureFolds(file, before.split("\n").length);
                    const { content, at, count, item } = dest.unit === "day"
                        ? await this.appendToTopChecklist(file, outgoing)
                        : await this.appendToPeriodNote(file, outgoing);
                    tasks.touched(file);
                    await this.semiFold(file, content, prevFolds, at, count, item);
                }
            } catch (err) {
                console.error(err);
                new Notice(`Couldn't write to the ${dest.kind} note, so nothing was scheduled — check console`);
                return;
            }

            // Then the source, if it's still as it was read
            const current = Schedule.editorLines(editor);
            // A task moving whole must still end where it did, so nothing typed under it meanwhile is left behind;
            // one that stays here keeps whatever was added under it
            if (current.slice(lineNum, end + 1).join("\n") !== now.slice(lineNum, end + 1).join("\n") || (!kept.length && Schedule.nest(current, lineNum).end !== end)) {
                new Notice(`The task changed while it was scheduled: it's on ${dest.label} now, so ${lineSurvives ? "set its line here to [>]" : "take it out here"} by hand`);
                return;
            }
            if (lineSurvives) {
                editor.replaceRange(kept.join("\n"), { line: lineNum, ch: 0 }, { line: end, ch: editor.getLine(end).length }, Schedule.ORIGIN);
            } else {
                // Moved whole: the line and its sub-bullets come out
                if (end + 1 < editor.lineCount()) {
                    editor.replaceRange("", { line: lineNum, ch: 0 }, { line: end + 1, ch: 0 }, Schedule.ORIGIN);
                } else if (lineNum > 0) {
                    const prev = lineNum - 1;
                    editor.replaceRange("", { line: prev, ch: editor.getLine(prev).length }, { line: end, ch: editor.getLine(end).length }, Schedule.ORIGIN);
                } else {
                    editor.replaceRange("", { line: 0, ch: 0 }, { line: end, ch: editor.getLine(end).length }, Schedule.ORIGIN);
                }
                // Park the cursor after the checkbox (or bullet) of whatever line is now here
                const landing = Math.min(lineNum, editor.lineCount() - 1);
                const after = editor.getLine(landing).match(/^\s*[-*+]\s+(\[.\]\s?)?/)?.[0].length ?? 0;
                editor.setCursor({ line: landing, ch: after });
            }
            // Its editor saves these edits only in a moment, so the next lookup reads the note itself
            tasks.touched(srcFile);

            if (lineSurvives) setTimeout(() => {
                const wasFolded = foldBefore?.folds?.some(f => f.from === lineNum);
                const stillFolded = view.currentMode.getFoldInfo?.()?.folds?.some(f => f.from === lineNum);
                if (wasFolded && !stillFolded && view.currentMode.applyFoldInfo) {
                    view.currentMode.applyFoldInfo(foldBefore);
                }
            }, 50);

            try {
                if (taskId && !foreign) {
                    await this.followForward(taskId, dest, others.filter((l) => tasks.kindOf(l.file) === "other" && ">xX-".includes(l.task)), { reopen: true });
                    await this.reopenFinished(taskId, others, [file]);
                }
            } catch (err) {
                console.error(err);
            }
            new Notice(Schedule.said({ reopened, forwarded: lineSurvives, named, label: dest.label }));
        }, {
            // A week, a month or a year is its note, as for JumpToDate (OBS-96); a day, a week or a
            // month without a year is the next one
            periods: true,
            name: (text) => jump.fromName(text, rules, { ahead: true }),
            label: (r) => (r.unit === "week" ? jump.periodName(r, rules) : null),
        });
    }

    // What Schedule says once it's done: "Moved to 9/18", "Forwarded to Wk of 9/20", "Reopened on 9/16", with
    // the task's name in quotes when it was run from a line under the task (OBS-193)
    static said({ reopened, forwarded, named, label }) {
        const what = named ? ` "${named}"` : "";
        const counts = reopened?.counts ? `; that day's time now counts toward ${reopened.counts}` : "";
        return reopened ? `Reopened${what} on ${label}${counts}` : `${forwarded ? "Forwarded" : "Moved"}${what} to ${label}`;
    }

    // A task line's name for a notice: its text, without checkbox, links that end it, or ID
    nameOf(line) {
        return customJS.TimeReport.taskText(line.replace(/^\s*[-*+]\s+/, ""));
    }

    // The editor's lines, as an array
    static editorLines(editor) {
        return editor.getValue ? editor.getValue().split("\n") : Array.from({ length: editor.lineCount() }, (_, n) => editor.getLine(n));
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
        const sent = others.some((l) => ">xX-".includes(l.task));
        return (!sent && others.some((l) => periodic(l) && " /".includes(l.task))) || (others.length > 0 && !others.some((l) => periodic(l) || ">xX-".includes(l.task)));
    }

    // The notes `text` (a line) links, as found from `from`: a moving line's own notes, its source among
    // them, which a lookup reads whatever the cache says (OBS-181)
    linkedNotes(text, from) {
        return [...(text ?? "").matchAll(/\[\[([^\]|#]+)/g)].map((m) => app.metadataCache.getFirstLinkpathDest(m[1].trim(), from));
    }

    // Rewrites `file` with `fn(text) → text`: through its editor when it's open in one, changing only
    // the span that differs so the editor keeps its cursor and folds, else through the vault (OBS-181). Only an
    // editor in editing view: one in reading view still has an editor, but an edit there never reaches the file
    // (as ToggleTimeEntry found, 2026-09-15).
    async rewrite(file, fn) {
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file?.path === file.path && v.editor && (v.getMode?.() ?? "source") === "source");
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
        view.editor.replaceRange(after.slice(s, after.length - e), view.editor.offsetToPos(s), view.editor.offsetToPos(before.length - e), Schedule.ORIGIN);
        return after;
    }

    // Points the forward date on a task's source lines (`sources`, from TaskIds.gather) at `dest`, where its open
    // line is now (OBS-181). Only a sent line still ending in the task's ID changes, and an older
    // breadcrumb in front of it comes off (TaskIds.setForwardIn). `reopen` sets a finished one to [>]; `mark`
    // ("x" or "-") finishes each one instead (CheckOff, OBS-232).
    async followForward(id, dest, sources, { reopen = false, mark = null } = {}) {
        const T = customJS.TaskIds.constructor;
        const link = T.forwardLink(dest.linktext(), dest.label, id);
        for (const file of new Map(sources.map((s) => [s.file.path, s.file])).values()) {
            try {
                await this.rewrite(file, (text) => T.setForwardIn(text, id, link, { reopen, mark }).text);
            } catch (e) {
                console.error(`Schedule: couldn't update the forward date in ${file.path}`, e);
            }
        }
    }

    // An older sent line (its date in front): its open line on that day is the one checklist line there,
    // with no ID, with the same title, that names this note (a ⭕ or 🗃️ for a project or area note,
    // else a ⋯). With exactly one, both get the task's ID (`own`, the line's own block ID, else a fresh
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
        // A line nested under another is a sub-task (rule 5): never the task's line (isTop, below)
        const ours = (l) => T.title(l) === title && [...l.matchAll(/\[\[([^\]|#]+)/g)].some((m) => m[1].split("/").pop().trim().toLowerCase() === name);
        const matches = lines.map((l, i) => ({ l, i })).filter(({ l, i }) => /^\s*[-*+]\s+\[[ /]\]/.test(l) && !T.idOf(l) && ours(l) && T.isTop(lines, i));
        const sent = matches.length ? [] : lines.filter((l, i) => /^\s*[-*+]\s+\[>\]/.test(l) && T.idOf(l) && ours(l) && T.isTop(lines, i));
        let id, link = null;
        if (matches.length === 1) {
            id = own ?? tasks.freshId();
            const { l, i } = matches[0];
            await this.rewrite(day, (t) => { const ls = t.split("\n"); if (ls[i] === l) ls[i] = T.withId(l, id); return ls.join("\n"); });
            if (this.isDailyNote(day)) await customJS.RefoldDailyNotes?.onLeave?.(day);
        } else if (sent.length === 1 && (!own || own.toLowerCase() === T.idOf(sent[0]).toLowerCase())) {
            id = T.idOf(sent[0]);
            const now = (await tasks.gather(id, [day])).filter((l) => tasks.kindOf(l.file) !== "other");
            const at = now.find((l) => l.task === " " || l.task === "/") ?? now.find((l) => "xX-".includes(l.task));
            if (at) link = this.forwardTo(at.file, id);
        } else return null;
        // An ID the line had that isn't the task's comes off first, so the task's is the one it ends in
        const kept = T.withForward(T.withId(T.withoutId(old.line), id), link ?? T.forwardLink(old.linkpath, old.label, id));
        editor.replaceRange(kept, { line: lineNum, ch: 0 }, { line: lineNum, ch: lineText.length }, Schedule.ORIGIN);
        // Its editor saves this edit only in a moment, so the next lookup reads the note itself
        tasks.touched(srcFile);
        return id;
    }

    // Schedule on a line that was already sent or forwarded (OBS-181): the task's line on a periodic note moves
    // to the date picked, as Schedule would move it from its own note, and the forward date on the task's
    // source lines follows. That line is its open line, or, with none, its done or canceled one, which
    // reopens (rule 13). The prompt says where the task is now. A day that already has one of its [>], done or
    // canceled lines gets that line reopened. With no line on a periodic note (deleted by hand), a fresh copy
    // goes. The destination is written first and the line taken out last, so a write that fails can't lose
    // the task. `lines` are the task's lines when the caller has them (gather); `restore` is where the status
    // of a source clicked back to [ ] (or ticked) is, set to [>] again once the move goes ahead, or when it's
    // refused (while the line is as it was). `named`: the task's name, for the notice, when run from under it.
    async reschedule({ editor, srcFile, lineNum, lineText, id, lines: given = null, restore = null, named = null }) {
        const tasks = customJS.TaskIds, T = tasks.constructor;
        const fwd = T.forwardOf(lineText);
        const pointed = fwd ? app.metadataCache.getFirstLinkpathDest(fwd.linkpath, srcFile.path) : null;
        const lines = given ?? await tasks.gather(id, [pointed]);
        const { open, done } = this.whereIs(lines);
        const rules = customJS.DatePrompt.weekRules();
        const jump = customJS.JumpToDate;
        const title = open ? `Scheduled for ${this.labelOf(open.file)}. Move it to`
            : done ? `${done.task === "-" ? "Canceled" : "Done"} on ${this.labelOf(done.file)}. Reopen it on` : "Schedule for";
        customJS.DatePrompt.open(title, async (result, modal) => {
            const dest = this.destination(result, rules);
            modal.close();
            const moved = await this.moveTask({ editor, srcFile, lineNum, lineText, id, lines, restore, named, dest });
            new Notice(moved.notice);
        }, {
            periods: true,
            name: (text) => jump.fromName(text, rules, { ahead: true }),
            label: (r) => (r.unit === "week" ? jump.periodName(r, rules) : null),
        });
    }

    // Where task `id` is, among `lines` (its lines, from gather): { open, done, current, sources }. `open`: its
    // open line in a periodic note; `done`: with none, its done or canceled line there, since scheduling a
    // finished task reopens it (rule 13); `current`: whichever of the two it has; `sources`: its sent lines
    // outside the periodic notes ([>], or done or canceled once finished).
    whereIs(lines) {
        const tasks = customJS.TaskIds;
        const periodic = (l) => tasks.kindOf(l.file) !== "other";
        const open = lines.find((l) => " /".includes(l.task) && periodic(l)) ?? null;
        const done = open ? null : lines.find((l) => "xX-".includes(l.task) && periodic(l)) ?? null;
        return { open, done, current: open ?? done, sources: lines.filter((l) => !periodic(l) && ">xX-".includes(l.task)) };
    }

    // Moves task `id`'s open line (or, with none, its done or canceled line, which reopens) to `dest`
    // (destination()), as Schedule does from its prompt, and points its forward dates there: the move reschedule
    // and CheckOff share (OBS-232). The destination is written first and the line taken out last, so a write that
    // fails can't lose the task. With no line on a periodic note (deleted by hand), a fresh copy goes.
    // `lines`: the task's lines (gather), read before the prompt. `restore`, with `editor`, `srcFile`, `lineNum`
    // and `lineText`: a source clicked back to [ ] (reschedule). A refusal writes nothing. Returns { ok, notice,
    // reopened, moved, from }: what Schedule says, whether a line on `dest` was reopened, "moved" or "forwarded"
    // (null when nothing moved), and the note the line came from.
    async moveTask({ editor = null, srcFile = null, lineNum = null, lineText = null, id, lines, restore = null, named = null, dest }) {
        const tasks = customJS.TaskIds, T = tasks.constructor;
        const { open, done, current, sources } = this.whereIs(lines);
        const fromSource = !!srcFile && tasks.kindOf(srcFile) === "other";
        const none = { reopened: false, moved: null, from: null };
        // A source clicked back to [ ] is a sent line still when nothing moves: its [>] comes back, while
        // it's the line it was. True when it did.
        const putBack = () => {
            if (restore === null || editor.getLine(lineNum) !== lineText) return false;
            editor.replaceRange(">", { line: lineNum, ch: restore }, { line: lineNum, ch: restore + 1 }, Schedule.ORIGIN);
            tasks.touched(srcFile);
            return true;
        };
        const refuse = (notice) => { putBack(); return { ok: false, notice, ...none }; };
        // A fresh copy needs the line it's made from
        if (!current && lineText === null) return refuse("This task's line is gone, so nothing was moved");
        const started = await this.started(lines);
        if (current && dest.path === current.file.path) {
            // Its task is on that day. And a forward date that says otherwise (the line moved there by hand)
            // points there now. A done or canceled line there reopens where it is.
            const back = putBack();
            const sent = back ? [...sources, { file: srcFile }] : sources;
            if (done) {
                await this.rewrite(done.file, (t) => {
                    const ls = t.split("\n"), at = Schedule.taskLine(ls, id, "xX-");
                    return at === -1 ? t : Schedule.reopenIn(t, id, [ls[at].trimStart()], { started });
                });
                await this.followForward(id, dest, sent, { reopen: true });
                await this.reopenFinished(id, lines, [done.file]);
                return { ok: true, notice: Schedule.said({ reopened: true, named, label: dest.label }), ...none, reopened: true };
            }
            await this.followForward(id, dest, sent);
            return { ok: true, notice: `Already on ${dest.label}`, ...none };
        }
        // A source clicked back to [ ] is set to [>] again below, so it must still be the line it was
        if (restore !== null && editor.getLine(lineNum) !== lineText) return { ok: false, notice: "The line changed before it could be scheduled, so it wasn't", ...none };
        // The task's line on that day, read as that note is now and found by the ID among its top lines,
        // since the prompt may have been open a while: a [>], done or canceled line is reopened; an open
        // one means the task is there already
        const destFile = app.vault.getFileByPath(dest.path);
        const there = destFile ? await this.taskLineIn(destFile, id) : null;
        if (there && " /".includes(there.task)) return refuse(`This task is already open on ${dest.label}`);
        const taken = (text) => {
            const ls = text.split("\n");
            const at = Schedule.taskLine(ls, id, open ? " /" : "xX-");
            return at === -1 ? null : { at, before: ls, ...Schedule.leaveBehind(ls, at, { daily: this.isDailyNote(current.file), started }) };
        };
        let outgoing, moved = "forwarded", plan = null;
        if (current) {
            plan = taken(await tasks.readNow(current.file));
            if (!plan) return refuse("The task's line changed before it could be moved, so it wasn't");
            ({ outgoing, moved } = plan);
        } else {
            // A fresh copy: from a note, as a first send makes it; from a day's [>] line, that line, open.
            // An older line's breadcrumb stays behind.
            const body = T.withoutId(T.withForward((T.oldForward(lineText)?.line ?? lineText).replace(/^\s*[-*+]\s+\[.\]\s*/, ""), null));
            outgoing = [fromSource ? this.sentLine(`- [ ] ${body} ^${id}`, srcFile) : T.withId(`- [ ] ${body}`, id)];
        }
        let file;
        try {
            file = await dest.ensure();
        } catch (err) {
            console.error(err);
            return refuse(`Couldn't make the ${dest.kind} note, so nothing was scheduled — check console`);
        }
        try {
            // Reopened there (as in invoke), or in as usual when that line is gone by now
            const reopened = there ? await this.reopen(file, id, outgoing, { started }) : false;
            let said = null;
            if (!reopened) {
                const before = await tasks.readNow(file);
                const prevFolds = this.captureFolds(file, before.split("\n").length);
                const { content, at, count, item } = dest.unit === "day" ? await this.appendToTopChecklist(file, outgoing) : await this.appendToPeriodNote(file, outgoing);
                await this.semiFold(file, content, prevFolds, at, count, item);
                tasks.touched(file);
            }
            if (current) {
                // Only while the task's lines there are as they were read: a sub-task added meanwhile isn't lost
                const nest = (p) => p.before.slice(p.at, p.end + 1).join("\n");
                let changed = false;
                await this.rewrite(current.file, (t) => {
                    const p = taken(t);
                    if (!p || nest(p) !== nest(plan)) { changed = true; return t; }
                    return p.lines.join("\n");
                });
                if (changed) said = `The task changed while it was scheduled: it's on ${dest.label} now, so take it out of ${this.labelOf(current.file)} by hand`;
                else if (this.isDailyNote(current.file)) await customJS.RefoldDailyNotes?.onLeave?.(current.file);
            }
            // A source clicked back to [ ] is a sent line again, now that the task has moved, while it's the line it was
            if (restore !== null && editor.getLine(lineNum) === lineText) editor.replaceRange(">", { line: lineNum, ch: restore }, { line: lineNum, ch: restore + 1 }, Schedule.ORIGIN);
            await this.followForward(id, dest, restore !== null ? [...sources, { file: srcFile }] : sources, { reopen: true });
            await this.reopenFinished(id, lines, [current?.file, file]);
            return { ok: !said, notice: said ?? Schedule.said({ reopened: reopened || (done ? true : false), forwarded: moved !== "moved", named, label: dest.label }), reopened: !!reopened, moved, from: current?.file ?? null };
        } catch (err) {
            console.error(err);
            return { ok: false, notice: `Couldn't write to the ${dest.kind} note — check console`, ...none };
        }
    }

    // Where `file`, a periodic note, puts a task, as destination() gives it for that day, week, month or year:
    // how CheckOff moves a task onto a note it has (OBS-232). Null for any other note.
    destinationOf(file) {
        const rules = customJS.DatePrompt.weekRules();
        if (this.isDailyNote(file)) return this.destination(customJS.DatePrompt.result(window.moment(file.basename, this.dailyOpts().format, true).format("YYYY-MM-DD"), "day"), rules);
        const unit = this.periodOf(file);
        if (!unit) return null;
        return this.destination(customJS.DatePrompt.result(window.moment(file.basename, rules.format[unit], rules.locale, true).format("YYYY-MM-DD"), unit), rules);
    }

    // Reopens the [>], done or canceled line ending in `id` in `file` with `outgoing`, the lines moving there
    // (reopenIn), and refreshes a daily note's fold snapshot. False when `file` has no such line any more, and
    // is left as it was, so the caller puts the lines in as usual rather than lose them
    async reopen(file, id, outgoing, { started = false } = {}) {
        // Where that day's time counts, as the report reads it, before and after: the notice says when it changed
        const tr = customJS.TimeReport, index = tr.appIndex();
        const note = { path: file.path, kind: customJS.TaskIds.kindOf(file) };
        const name = (path) => (path ? path.split("/").pop().replace(/\.md$/, "") : "no project");
        let reopened = false;
        await this.rewrite(file, (t) => {
            const before = t.split("\n"), at = Schedule.taskLine(before, id, ">xX-");
            const next = Schedule.reopenIn(t, id, outgoing, { started });
            // The line is there and already says what the move would write: it's reopened, so no second line goes in
            if (next === t) { if (at !== -1) reopened = { counts: null }; return t; }
            const was = tr.lineProject(note, at, before, index), now = tr.lineProject(note, at, next.split("\n"), index);
            // Only when that day has time logged under the line is there time whose project changed
            reopened = { counts: now !== was && Schedule.nest(before, at).time ? name(now) : null };
            return next;
        });
        if (reopened && this.isDailyNote(file)) await customJS.RefoldDailyNotes?.onLeave?.(file);
        return reopened;
    }

    // Each done or canceled line of a task among `lines` (from gather) in a periodic note, other than in
    // `skip` (files), set to [>]: the task is open elsewhere now (rule 13)
    async reopenFinished(id, lines, skip = []) {
        const tasks = customJS.TaskIds, T = tasks.constructor;
        const files = new Map(lines.filter((l) => "xX-".includes(l.task) && tasks.kindOf(l.file) !== "other" && !skip.some((f) => f?.path === l.file.path)).map((l) => [l.file.path, l.file]));
        for (const f of files.values()) {
            try {
                await this.rewrite(f, (t) => T.reopenIn(t, id).text);
            } catch (e) {
                console.error(`Schedule: couldn't reopen the task's line in ${f.path}`, e);
            }
        }
    }

    // Whether the task has time logged under any of `lines` (its lines, from gather) in a daily note
    async started(lines) {
        for (const l of lines) {
            if (!this.isDailyNote(l.file)) continue;
            if (Schedule.nest((await customJS.TaskIds.readNow(l.file)).split("\n"), l.line).time) return true;
        }
        return false;
    }

    // The nest under line `at` of `lines`: { end, time }, its last line (TimeReport.subtreeEnd: blank lines
    // between are passed over) and whether time is logged anywhere in it, as the report reads a line: an entry,
    // a running clock, or a range it lists as a Problem; not a time in a line's text, or a commented-out one.
    // A line's \r is read past.
    static nest(lines, at) {
        const tr = customJS.TimeReport;
        const raw = lines.map((l) => l.replace(/\r$/, ""));
        const end = tr.subtreeEnd(raw, at);
        const { visible, hidden } = tr.scan(raw.slice(at, end + 1));
        const time = visible.some((v, k) => k > 0 && !hidden[k] && ["entry", "open", "rangeish"].includes(tr.classify(v).kind));
        return { end, time };
    }

    // The lines under line `at` (to `end`) that go when the task moves on with something left behind (OBS-210):
    // each open sub-task ([ ] or [/]) directly under it, with everything under that one, unless time is logged
    // under it. A Set of line indexes.
    static openSteps(lines, at, end) {
        const tr = customJS.TimeReport;
        const raw = lines.map((l) => l.replace(/\r$/, ""));
        const go = new Set();
        for (let j = at + 1; j <= end;) {
            if (!raw[j].trim()) { j++; continue; }
            const last = Math.min(tr.subtreeEnd(raw, j), end);
            if (/^\s*[-*+]\s+\[[ /]\]/.test(raw[j]) && !Schedule.nest(raw.slice(0, last + 1), j).time) for (let k = j; k <= last; k++) go.add(k);
            j = last + 1;
        }
        return go;
    }

    // Line `at` of `lines`, in a periodic note (`daily`: a daily note), as Schedule treats it. From a day, with
    // time logged under it, it stays as [>] and an open copy goes, as [/] since work was done (OBS-210): each line
    // directly under it goes or stays with everything under that line. An open sub-task ([ ] or [/]) goes, unless
    // time is logged under it; everything else stays with the [>] line: time entries, finished sub-tasks, notes.
    // Blank lines don't travel. Otherwise, and from a week, month or year, it goes whole. A done or canceled line
    // moving whole reopens as [/] when the task has time logged (`started`), else [ ]; an open one keeps its box.
    // { lines, outgoing, moved, end, kept }: the note's lines after, the lines that go (indent taken off),
    // "forwarded" or "moved", the nest's last line, and what's left in its place.
    static leaveBehind(lines, at, { daily, started = false }) {
        const line = lines[at];
        const indent = line.match(/^\s*/)[0];
        const w = Schedule.nest(lines, at);
        const box = line.match(/\[(.)\]/)[1];
        const finished = "xX-".includes(box);
        const out = (l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()).replace(/\r$/, "");
        if (daily && w.time) {
            const raw = lines.map((l) => l.replace(/\r$/, ""));
            const go = Schedule.openSteps(lines, at, w.end);
            const kept = [line.replace(/\[(.)\]/, "[>]")];
            for (let k = at + 1; k <= w.end; k++) if (!go.has(k) && raw[k].trim()) kept.push(lines[k]);
            const outgoing = [out(line).replace(/\[(.)\]/, "[/]"), ...[...go].filter((k) => raw[k].trim()).map((k) => out(lines[k]))];
            return { lines: [...lines.slice(0, at), ...kept, ...lines.slice(w.end + 1)], outgoing, moved: "forwarded", end: w.end, kept };
        }
        const reopened = (l) => l.replace(/\[(.)\]/, `[${finished ? (started || w.time ? "/" : " ") : box === ">" ? " " : box}]`);
        const children = lines.slice(at + 1, w.end + 1).filter((l) => l.trim());
        return { lines: [...lines.slice(0, at), ...lines.slice(w.end + 1)], outgoing: [reopened(out(line)), ...children.map(out)], moved: "moved", end: w.end, kept: [] };
    }

    // `text` with the [>], done or canceled line ending in `id`, at the top of its nest, reopened: the line that
    // moved here, `moved[0]`, takes its place, keeping that day's project, 🆓 and entries (keepLinks), and the
    // moved line's text, 🚩 and note link (OBS-181, OBS-193). Its box is [/] when the moved line was, or the task
    // has time logged (`started`, or time under the line), else [ ]. The old line's sub-bullets stay, and the
    // ones that came with it follow.
    static reopenIn(text, id, moved, { started = false } = {}) {
        const lines = text.split("\n");
        const at = Schedule.taskLine(lines, id, ">xX-");
        if (at === -1 || !moved.length) return text;
        const indent = lines[at].match(/^\s*/)[0];
        // A CRLF note keeps its line endings
        const cr = lines[at].endsWith("\r") ? "\r" : "";
        const w = Schedule.nest(lines, at);
        const box = moved[0].match(/\[(.)\]/)?.[1] === "/" || started || w.time ? "/" : " ";
        lines[at] = indent + Schedule.keepLinks(moved[0].trimStart().replace(/\[.\]/, `[${box}]`), lines[at].replace(/\r$/, "")) + cr;
        lines.splice(w.end + 1, 0, ...moved.slice(1).map((c) => indent + c + cr));
        return lines.join("\n");
    }

    // `line` (moving onto a day) as it reopens `old`, that day's line (rule 13): it takes everything the moving line
    // says, its text, ⭕ or 🗃️, 🆓, 🚩 and note link, since those are the newer word (Brian, 2026-10-26); only the
    // old note link stays when the moving line has none. That day's entries stay under the line and count where the
    // line now says (the report lists a billed one that changed). The note link stays last before the ID.
    static keepLinks(line, old) {
        const T = customJS.TaskIds.constructor;
        // Its own note (its ⋯) stays when the moving line has none; the ↗ is the moving line's (OBS-208)
        const note = (i) => /\|\s*⋯\s*\]\]$/u.test(i);
        const from = (i) => /\|\s*↗\uFE0F?\s*\]\]$/u.test(i);
        const { text, items } = T.splitRun(line);
        const oldNote = T.splitRun(old).items.find(note);
        if (oldNote && !items.some(note)) {
            const at = items.findIndex(from);
            items.splice(at === -1 ? items.length : at, 0, oldNote);
        }
        const id = T.idOf(line);
        return [text, ...items].join(" ") + (id ? ` ^${id}` : "");
    }

    // The index in `lines` of the checklist line at the top of its nest ending in block ID `id`, with its box
    // one of `boxes` (" /" open, ">" forwarded; any box when omitted), or -1. A nested line is a sub-task, and
    // its ID counts for nothing (rule 5).
    static taskLine(lines, id, boxes = null) {
        const T = customJS.TaskIds.constructor, want = id.toLowerCase();
        return lines.findIndex((l, i) => {
            const box = l.match(T.CHECKBOX)?.[1];
            return box !== undefined && (!boxes || boxes.includes(box)) && T.idOf(l)?.toLowerCase() === want && T.isTop(lines, i);
        });
    }

    // Task `id`'s line in `file`, read as the note is now, among its top lines: { at, task, lines } (the note's
    // lines), or null. A note holds one line of a task, but if a hand edit left two, an open one comes first,
    // then a finished one, so a move never reopens a line beside an open one.
    async taskLineIn(file, id) {
        const T = customJS.TaskIds.constructor, want = id.toLowerCase();
        const lines = (await customJS.TaskIds.readNow(file)).split("\n");
        const ours = lines.map((l, at) => ({ at, task: l.match(T.CHECKBOX)?.[1] }))
            .filter(({ at, task }) => task !== undefined && T.idOf(lines[at])?.toLowerCase() === want && T.isTop(lines, at));
        const hit = ours.find((l) => " /".includes(l.task)) ?? ours.find((l) => l.task !== ">") ?? ours[0];
        return hit ? { at: hit.at, task: hit.task, lines } : null;
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
    // (TimeReport.periodFolders), so a note elsewhere with such a name isn't one. A report passes the
    // two in, read when it began: they come off `customJS`, which CustomJS can start over during a run.
    periodOf(file, rules = customJS.DatePrompt.weekRules(), folders = customJS.TimeReport.periodFolders()) {
        const folder = file.parent?.path ?? "";
        for (const unit of ["week", "month", "year"]) {
            if (folder === folders[unit] && window.moment(file.basename, rules.format[unit], rules.locale, true).isValid()) return unit;
        }
        return null;
    }

    // A line sent here from `src`, a note that isn't a daily, weekly, monthly or yearly note (rule 13,
    // OBS-208): its ⭕ (or 🗃️) is its own note's project when it has a ⋯ filed in one, else the project
    // of the note it came from, finished or not; a project or area note names itself. A ⭕ it had in that
    // note gives way, since a line outside a periodic note has no project of its own (rule 4), and from a
    // note in no project (the Inbox) nothing takes its place. Then a ↗ to the note it came
    // from, after its own ⋯, unless that note is a project or area note, which its ⭕ already names. The
    // ↗ links the task's own line there by its ID, `Source#^id`, the line that keeps the same ID (Brian,
    // 2026-10-28).
    sentLine(line, src) {
        const helper = customJS.AddTaskNote;
        const paths = app.vault.getMarkdownFiles().map((f) => f.path);
        const tagged = this.isProjectNote(src) || this.isAreaNote(src);
        const own = helper.trailingNote(line, helper.constructor.OWN_NOTE_LINK);
        const ownNote = own ? app.metadataCache.getFirstLinkpathDest(own, src.path) : null;
        const ownHome = ownNote ? helper.filedIn(ownNote) : null;
        const srcHome = tagged ? null : helper.filedIn(src);
        const homeLink = ownHome ? helper.homeLink(ownHome, helper.linktextFor(ownHome, paths))
            : tagged ? `[[${helper.linktextFor(src, paths)}|${this.isProjectNote(src) ? "⭕" : "🗃️"}]]`
            : srcHome ? helper.homeLink(srcHome, helper.linktextFor(srcHome, paths)) : null;
        const sent = helper.withHome(line, homeLink, helper.trailingProjectLinks(line).map((l) => l.raw), { inRun: true });
        const id = customJS.TaskIds?.constructor.idOf?.(line);
        return tagged ? sent : helper.withFrom(sent, `[[${helper.linktextFor(src, paths)}${id ? `#^${id}` : ""}|${Schedule.FROM_MARK}]]`);
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
    // Returns the new content plus where the block landed, so the fold pass can find it. Written through the
    // note's editor when it's open (rewrite), so an edit there not yet saved is never merged with this one: a
    // line just taken out in that editor would come back (OBS-232).
    async appendToTopChecklist(file, newLines) {
        let out;
        await this.rewrite(file, (content) => {
            const lines = content.split("\n");
            const first = lines.findIndex(l => Schedule.CHECKBOX.test(l));
            if (first === -1) {
                // A CRLF note keeps its line endings
                const eol = content.includes("\r\n") ? "\r\n" : "\n";
                const head = content.replace(/\s+$/, "").split(/\r?\n/);
                out = { content: [...head, ...newLines].join(eol) + eol, at: head.length, count: newLines.length, item: head.length };
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
            // A CRLF note keeps its line endings
            const cr = content.includes("\r\n") ? "\r" : "";
            lines.splice(at, 0, ...newLines.map(l => destIndent + l + cr));
            out = { content: lines.join("\n"), at, count: newLines.length, item: at };
            return out.content;
        });
        return out;
    }

    // The same for a weekly, monthly or yearly note (placeInPeriod)
    async appendToPeriodNote(file, newLines) {
        let out;
        await this.rewrite(file, (content) => {
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
        // A CRLF note keeps its line endings
        const cr = content.includes("\r\n") ? "\r" : "";
        newLines = newLines.map((l) => l + cr);
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
        const above = at > fmEnd + 1 ? [cr] : [];
        const block = [...above, ...newLines, ...(at === start ? [cr] : []), ...(at === lines.length ? [""] : [])];
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
