class RefoldDailyNotes {
    // Obsidian saves each note's folds per device as {folds, lines} and ignores them once the
    // note's line count stops matching, which is what happens when something outside Obsidian
    // changes it: the Raycast calendar sync, or Obsidian Sync bringing edits from another device.
    // This keeps daily notes folded the way Schedule leaves them: your folds stay, and only what
    // was added gets folded.
    //
    // To tell what was added, each device keeps a snapshot of the daily notes it has seen: each
    // item with sub-bullets, by line, text (checkbox status ignored) and whether it was folded.
    // Snapshots live in this vault's local storage, beside Obsidian's own fold records, so each
    // device has its own and nothing is written to the vault. They're taken when a daily note is
    // opened or left, when Obsidian quits (desktop only), and by the SnapshotDailyNotes command.
    //
    // When a daily note opens (the RefoldOnOpen startup script, on every device):
    // - every item where the snapshot saw it, and the folds saved: left as it is;
    // - otherwise, with a snapshot: items are matched by text in order; matched items keep their
    //   fold and new ones fold (so does an item that only moved);
    // - no snapshot: saved folds that still fit are left as they are; otherwise (none saved on
    //   this device, or gone stale) every item folds, whatever the note's date (Schedule's
    //   fallback). Folds are saved by path, so a moved note has none until it's folded again.
    // invoke() refolds daily notes that are already open. Obsidian carries an open note's
    // folds through an outside change (verified 2026-09-11), so those stay. Within two hours of
    // SnapshotDailyNotes it folds only what was added since; run on its own, it folds the events.
    // Inside Obsidian the calendar sync, Schedule and the rest call this class's methods directly.
    // A tool outside Obsidian (the Raycast timer) runs SnapshotDailyNotes before writing and this
    // after, by eval (`customJS.` in place of `plainday.` under CustomJS, where both are commands):
    //   obsidian vault=<v> eval code="plainday.SnapshotDailyNotes.invoke()"
    //   obsidian vault=<v> eval code="plainday.RefoldDailyNotes.invoke()"
    static RELOAD_WAIT_MS = 3000;
    static STORE = "refold-snapshots";
    static SYNC_KEY = "refold-sync-started";
    static SYNC_WINDOW_MS = 2 * 60 * 60 * 1000;
    static KEEP_DAYS = 31;

    async invoke() {
        const started = app.loadLocalStorage(RefoldDailyNotes.SYNC_KEY);
        const mode = started && Date.now() - started < RefoldDailyNotes.SYNC_WINDOW_MS ? "sync" : "command";
        app.saveLocalStorage(RefoldDailyNotes.SYNC_KEY, null);
        let refolded = 0;
        for (const file of this.openDailyNotes()) {
            try {
                if (await this.refold(file, mode)) refolded++;
            } catch (e) {
                console.error(`RefoldDailyNotes: couldn't refold ${file.path}`, e);
            }
        }
        if (refolded) new Notice(`Refolded ${refolded} daily note${refolded === 1 ? "" : "s"}`);
    }

    async onOpen(file) {
        if (this.isDaily(file)) await this.refold(file, "open");
    }

    // Snapshot a note you're leaving: from its open view if it still has one, else its saved folds
    async onLeave(file) {
        if (!this.isDaily(file) || !app.vault.getFileByPath(file.path)) return;
        const view = this.viewsOf(file)[0];
        if (view) return this.snapshotView(view);
        const text = await app.vault.read(file);
        const saved = app.foldManager.load(file);
        if (saved && saved.lines !== text.split("\n").length) return;   // out of date: keep the last snapshot
        this.remember(file, text, saved?.folds ?? []);
    }

    // Snapshot every open daily note: as Obsidian quits, and for the SnapshotDailyNotes command,
    // which also marks a sync as started so the refold afterwards can trust these snapshots
    snapshotOpen(forSync = false) {
        for (const file of this.openDailyNotes()) this.snapshotView(this.viewsOf(file)[0]);
        if (forSync) app.saveLocalStorage(RefoldDailyNotes.SYNC_KEY, Date.now());
    }

    snapshotView(view) {
        this.remember(view.file, view.getViewData(), view.currentMode.getFoldInfo?.()?.folds ?? []);
    }

    // Returns true if the note's folds changed; in "sync" and "command" an open editor gets its folds
    // again either way. `mode` is "open" (a note being opened), "sync" (the command after
    // SnapshotDailyNotes) or "command" (the command on its own).
    async refold(file, mode) {
        const text = await app.vault.read(file);
        const lines = text.split("\n");

        // Only a view showing exactly what's on disk can take new folds (applyFoldInfo does
        // nothing unless `lines` matches); one that never catches up is being typed in, so leave it
        const views = this.viewsOf(file);
        const ready = [];
        for (const view of views) if (await this.catchesUp(view, text)) ready.push(view);
        if (views.length && !ready.length) return false;

        const foldable = customJS.Schedule.foldableRanges(text);
        const all = new Set(foldable.map((r) => r.from));
        const saved = app.foldManager.load(file);
        const savedOk = !!saved && saved.lines === lines.length;
        const snap = this.snapshots()[file.path];
        const editor = mode === "open" ? null : ready[0] ?? null;
        const shown = editor ? editor.currentMode.getFoldInfo?.() ?? { folds: [] } : null;

        let fold = null;      // lines to fold, or null to leave the note as it is
        let props = false;    // whether the frontmatter stays collapsed
        if (editor) {
            const fresh = mode === "sync" && snap ? this.match(foldable, lines, snap).fresh : this.events(foldable, lines);
            fold = new Set([...shown.folds.map((f) => f.from).filter((l) => all.has(l)), ...fresh]);
            props = shown.folds.some(RefoldDailyNotes.isProps);
        } else if (snap) {
            if (!(savedOk && this.unchanged(snap, foldable, lines))) {
                const { known, fresh } = this.match(foldable, lines, snap);
                fold = new Set([...[...known].filter(([, folded]) => folded).map(([l]) => l), ...fresh]);
                props = snap.props;
            }
        } else if (!savedOk) {
            fold = all;
            props = !!saved?.folds.some(RefoldDailyNotes.isProps);
        }

        if (!fold) {
            // Remember what's showing: the open editor's folds, else the saved ones
            const showing = ready[0]?.currentMode.getFoldInfo?.() ?? (savedOk ? saved : null);
            this.remember(file, text, showing?.folds ?? []);
            return false;
        }

        const folds = foldable.filter((r) => fold.has(r.from));
        if (props) folds.unshift({ from: 0, to: 0 });
        this.remember(file, text, folds);

        // Nothing to write when the saved record already says this (an empty list is saved as
        // no record) and, for an open note, the editor already shows it
        const key = (fs) => JSON.stringify(fs.map((f) => [f.from, f.to]).sort((a, b) => a[0] - b[0]));
        const recordOk = folds.length ? savedOk && key(saved.folds) === key(folds) : !saved;
        const changed = !(recordOk && (!editor || key(shown.folds) === key(folds)));
        if (!changed && !editor) return false;

        // An open editor gets its folds again even when its lines already match (OBS-64): an
        // outside edit that adds text to the last line inside a fold leaves the fold ending where
        // that line used to end, so the new text shows beside the folded item, while getFoldInfo
        // still reports the same lines. Cleared first, which is how the fix was verified.
        const info = { folds, lines: lines.length };
        if (changed) app.foldManager.save(file, info);
        for (const view of ready) {
            view.currentMode.applyFoldInfo?.({ folds: [], lines: lines.length });
            view.currentMode.applyFoldInfo?.(info);
        }
        return changed;
    }

    // Whether every item sits on the line, with the text, the snapshot saw it
    unchanged(snap, foldable, lines) {
        return snap.lines === lines.length && snap.items.length === foldable.length &&
            foldable.every((r, i) => (snap.items[i].from ?? r.from) === r.from &&
                snap.items[i].text === RefoldDailyNotes.norm(lines[r.from]));
    }

    // Pairs each foldable item with the snapshot by text, in order. `known` maps an item's line
    // to whether it was folded; `fresh` holds the lines of items the snapshot doesn't have.
    match(foldable, lines, snap) {
        const known = new Map();
        const fresh = new Set();
        let next = 0;
        for (const r of foldable) {
            const text = RefoldDailyNotes.norm(lines[r.from]);
            const i = snap.items.findIndex((item, j) => j >= next && item.text === text);
            if (i === -1) { fresh.add(r.from); continue; }
            known.set(r.from, snap.items[i].folded);
            next = i + 1;
        }
        return { known, fresh };
    }

    // Without a snapshot to compare against, events are the items known to belong folded
    events(foldable, lines) {
        // (a canceled event, marked [-] by the calendar sync, is still an event)
        return foldable.filter((r) => /^\s*[-*+]\s+(?:\[<\]|\[-\]\s+(?:all day|\d{1,2}:\d{2}\s?[ap]m)\t)/i.test(lines[r.from])).map((r) => r.from);
    }

    remember(file, text, folds) {
        const lines = text.split("\n");
        const folded = new Set(folds.map((f) => f.from));
        const store = this.snapshots();
        store[file.path] = {
            taken: Date.now(),
            lines: lines.length,
            props: folds.some(RefoldDailyNotes.isProps),
            items: customJS.Schedule.foldableRanges(text)
                .map((r) => ({ from: r.from, text: RefoldDailyNotes.norm(lines[r.from]), folded: folded.has(r.from) })),
        };
        // Drop snapshots of notes that are gone or too old for an outside change to matter
        const { format } = customJS.Schedule.dailyOpts();
        const cutoff = window.moment().startOf("day").subtract(RefoldDailyNotes.KEEP_DAYS, "days");
        for (const path of Object.keys(store)) {
            const date = window.moment(path.split("/").pop().replace(/\.md$/, ""), format, true);
            if (!app.vault.getFileByPath(path) || (date.isValid() && date.isBefore(cutoff))) delete store[path];
        }
        app.saveLocalStorage(RefoldDailyNotes.STORE, store);
    }

    snapshots() {
        return app.loadLocalStorage(RefoldDailyNotes.STORE) ?? {};
    }

    isDaily(file) {
        return !!file && file.extension === "md" && customJS.Schedule.isDailyNote(file);
    }

    openDailyNotes() {
        const files = new Set();
        app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view?.getViewType?.() === "markdown" && this.isDaily(leaf.view.file)) files.add(leaf.view.file);
        });
        return files;
    }

    viewsOf(file) {
        const views = [];
        app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view?.getViewType?.() === "markdown" && leaf.view.file === file) views.push(leaf.view);
        });
        return views;
    }

    // An open note reloads a moment after an outside change; true once the view shows `text`
    async catchesUp(view, text) {
        const deadline = Date.now() + RefoldDailyNotes.RELOAD_WAIT_MS;
        while (view.getViewData() !== text) {
            if (Date.now() > deadline) return false;
            await new Promise((r) => setTimeout(r, 100));
        }
        return true;
    }

    static isProps(f) {
        return f.from === 0 && f.to === 0;   // collapsed frontmatter marker
    }

    // An item's line with its checkbox status blanked, so ticking a task off doesn't make it new
    static norm(line) {
        return line.replace(/^(\s*[-*+]\s+\[).\]/, "$1]").trimEnd();
    }
}
