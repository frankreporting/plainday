class UpdateObsidianPM {
    // Command "Update Obsidian PM": installs this repository's system files into the vault it runs
    // in, from a local clone. The vault is never a git repository, so a vault full of real notes can
    // never be committed, overwritten by the repository's sample notes, or emptied by a git command.
    //
    // It copies only what the repository holds under `Config/`, plus README.md, CLAUDE.md, the
    // Projects base and the three settings files the scripts depend on. It never touches a note,
    // never touches anything under `Config/` that the repository doesn't have (your own fonts,
    // templates, notes or tests stay), and never copies the repository's tests: they read the class
    // files in plugin/src/, which a vault doesn't get (Plainday runs its own build of them), and the
    // demo's own rewrite notes when they run.
    //
    // One file goes somewhere of the vault's choosing (OBS-112): the Invoices base sits beside the
    // invoices, in the `folder` Invoice Settings names, so it can be opened as a file even when
    // `Config` is excluded. Everything is planned by where it goes in the vault. When the base's
    // place changes, the copy it had is moved there, edits and all (a base saves its own sorting and
    // filters into its file), and then treated like any installed file: updated if you never
    // changed it, left alone if you did. While Invoice Settings can't be read, the base sits this
    // update out, wherever it is.
    //
    // Nothing is written until you've seen the list. Removals (a file the repository dropped) are
    // listed on their own, and a file you've changed yourself is never removed and only overwritten
    // if you say so.
    //
    // It installs only what a pull request merged: the clone must be on main with a clean tree.
    // The clone doubles as the dev vault where a branch is tested (dev-vault.sh), so a half-tested
    // branch, or a note the app rewrote, would otherwise land here. It shows where the clone is
    // and stops. The dialog can stay open for as long as it likes, and the clone can move
    // underneath it (a test starts, a pull runs in a terminal, a worktree is deleted), so the same
    // check runs again when Update is clicked, and a clone that moved installs nothing.
    //
    // Git state isn't the whole story: an edit hidden with skip-worktree shows in none of it. So
    // each file is hashed again as it's copied, and one that isn't what the dialog was built from
    // stops the copy. Should the copy stop partway, for that or for a file that can't be written or
    // a removal the trash refuses, the manifest still records what did land, and the notice names
    // where it stopped, so the next run sees an install to finish, not a vault full of local edits.
    //
    // Where the clone is: `Config/Scripts/update-source`, a one-line file holding its path. It
    // isn't in the repository, since it's yours. The command asks for the path on the first run.
    // A folder is a clone when its manifest.json is Plainday's, which stays put when files move.
    // What it installed last time: `Config/Scripts/update-manifest.json` (also yours), which is
    // how it can tell your edits from an old version.
    //
    // Desktop only: it reads another folder and runs git.
    static SOURCE_FILE = "Config/Scripts/update-source";
    // The base that goes beside the invoices: the repository keeps it beside the demo's invoices, and
    // a vault gets it beside its own, or in Config/Bases with no invoice folder (where every
    // version before OBS-112 put it). The note that says where the invoices are is the vault's own.
    static INVOICES_BASE = "Reference/Invoices/Invoices.base";
    static INVOICES_BASE_HOME = "Config/Bases/Invoices.base";
    static INVOICE_SETTINGS = "Config/Invoice Settings.md";
    static MANIFEST_FILE = "Config/Scripts/update-manifest.json";
    // The plugin's id in a clone's manifest.json
    static PLUGIN_ID = "plainday";
    // The only branch that installs
    static BRANCH = "main";
    // What the repository installs into a vault
    static INCLUDE = [
        "Config/",
        "README.md",
        "CLAUDE.md",
        // Beside the projects and the invoices, so they open as files even when `Config` is
        // excluded (OBS-112). The Invoices base goes where the vault keeps its invoices (placed()).
        "Projects/Projects.base",
        "Reference/Invoices/Invoices.base",
        ".obsidian/daily-notes.json",
        ".obsidian/plugins/templater-obsidian/data.json",
    ];
    // Parts of the repository for working on the system, not for using it. The tests read the
    // class files from plugin/src/, outside `Config/`, so they couldn't run in a vault (OBS-270);
    // demoVault.test.mjs asserts the demo's own notes, and the demo's render script writes report
    // blocks into notes. dev-vault.sh drives the clone as a test vault. A vault's own tests in
    // that folder (its private ones) were never installed, so they're never touched.
    static EXCLUDE = [
        "Config/Scripts/tests/",
        "Config/Scripts/dev-vault.sh",
        // The demo's invented details: a vault's own settings note is never the repository's
        "Config/Invoice Settings.md",
    ];
    // Settings notes a vault gets once, as the repository has them, and keeps as its own: installed when
    // the vault has none, then never updated, listed or removed (OBS-238). Nothing makes them on first use,
    // as the Invoice command makes Invoice Settings, and the repository's copy holds no demo details.
    static ONCE = [
        "Config/Table Settings.md",
    ];

    // ---------------------------------------------------------------- planning (no app, no fs)

    // Whether `text`, a folder's manifest.json, is a clone's: Plainday's manifest. A folder
    // without one, or with another plugin's, isn't.
    isManifest(text) {
        try { return JSON.parse(text)?.id === UpdateObsidianPM.PLUGIN_ID; } catch { return false; }
    }

    installs(path) {
        return UpdateObsidianPM.INCLUDE.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p))
            && !UpdateObsidianPM.EXCLUDE.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
    }

    // Invoice Settings' `folder` as a vault path: { folder, error }, with "" for none. The same rules
    // as Billing.folderOf (a test holds them to it): this command uses no other script, so it can
    // install them.
    folderOf(raw) {
        if (raw === undefined || raw === null) return { folder: "", error: null };
        const shown = typeof raw === "string" ? raw.trim() : JSON.stringify(raw);
        const bad = { folder: "", error: `isn't a folder in the vault (${shown})` };
        if (typeof raw !== "string" || /[\u0000-\u001f\u007f]/.test(raw)) return bad;
        const folder = raw.trim().replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
        if (!folder) return { folder: "", error: null };
        const parts = folder.split("/");
        if (/[\\:*?"<>|[\]#^]/.test(folder) || parts.some((p) => !p.trim() || p !== p.trim() || p.startsWith("."))) return bad;
        // The system's folder and the archive are often excluded, and a base doesn't list what's excluded
        if (["config", "archive"].includes(parts[0].toLowerCase())) return { folder: "", error: `is inside ${parts[0]}, where invoices don't belong (${shown})` };
        return { folder, error: null };
    }

    // The repository's files keyed by where they go in this vault: { files: Map(vault path → hash),
    // origin: Map(vault path → repository path) for a file that goes somewhere else }. The Invoices
    // base goes in `invoiceFolder` when that's set, else in Config/Bases, and there too when
    // another installed file has its place (in any case: a Mac's disk doesn't tell them apart).
    // With `hold`, it's left out altogether.
    placed(source, { invoiceFolder = "", hold = false } = {}) {
        const files = new Map(), origin = new Map();
        const fold = (p) => p.normalize("NFC").toLowerCase();
        const taken = new Set([...source.keys()].map(fold));
        for (const [rel, hash] of source) {
            let at = rel;
            if (rel === UpdateObsidianPM.INVOICES_BASE) {
                if (hold) continue;
                const want = invoiceFolder ? `${invoiceFolder}/${rel.split("/").pop()}` : UpdateObsidianPM.INVOICES_BASE_HOME;
                at = fold(want) !== fold(rel) && taken.has(fold(want)) ? UpdateObsidianPM.INVOICES_BASE_HOME : want;
            }
            files.set(at, hash);
            if (at !== rel) origin.set(at, rel);
        }
        return { files, origin };
    }

    // A file that can change places: the Invoices base
    movable(rel) {
        return rel === UpdateObsidianPM.INVOICES_BASE;
    }

    // The manifest split for an update the Invoices base sits out: { manifest, held }, where `held`
    // is every record of an installed Invoices base, put back as it was afterwards
    hold(manifest) {
        const name = UpdateObsidianPM.INVOICES_BASE.split("/").pop();
        const held = new Map([...manifest].filter(([p]) => p.split("/").pop() === name));
        return { manifest: new Map([...manifest].filter(([p]) => !held.has(p))), held };
    }

    // What an update would do, from three pictures of the same paths, each a path in the vault:
    //   source   Map(path → hash)  the repository's files, as `git ls-files` lists them, at their place
    //   vault    Map(path → hash)  what the vault has now (missing paths are absent)
    //   manifest Map(path → hash)  what this command installed last time, empty on a first run
    //   origin   Map(path → path)  the repository path of a file placed elsewhere (placed())
    // Every list is sorted, and each path appears in exactly one of the first six, but for a file in
    // ONCE that the vault has, which is in none:
    //   add      not in the vault
    //   update   differs from the repository, and matches what was installed (so it's an old version)
    //   local    differs from both: changed in the vault since it was installed (or never installed)
    //   remove   the repository dropped it, and the vault still has what was installed
    //   keep     the repository dropped it, but it differs from what was installed: left alone
    //   same     already up to date
    // and `move` lists [{ from, to }]: a movable file missing at its place, whose earlier place (an
    // installed copy of the same name the repository doesn't have there now, or the Invoices base's
    // old home in Config/Bases, which an older version of this command may have stopped
    // recording) is still in the vault. It moves first, and is then judged at `to` by what it was at
    // `from`. Paths are told apart in any case: on a Mac's disk, `Invoices/` and `invoices/` are the
    // same folder, so a manifest path that differs from a source path only in case is never removed.
    plan(source, vault, manifest = new Map(), origin = new Map()) {
        const out = { add: [], update: [], local: [], remove: [], keep: [], same: [], move: [] };
        const fold = (p) => p.normalize("NFC").toLowerCase();
        const placed = new Set([...source.keys()].map(fold));
        const sorted = (m) => [...m].sort(([a], [b]) => a.localeCompare(b));
        const home = UpdateObsidianPM.INVOICES_BASE_HOME;
        const earlier = [...sorted(manifest).map(([p]) => p), ...(manifest.has(home) ? [] : [home])]
            .filter((p) => !placed.has(fold(p)) && vault.has(p));
        const moved = new Set();
        for (const [path, hash] of sorted(source)) {
            const rel = origin.get(path) ?? path;
            if (!this.installs(rel)) continue;
            let have = vault.get(path), was = manifest.get(path);
            if (have === undefined && this.movable(rel)) {
                const name = rel.split("/").pop();
                const from = earlier.find((p) => !moved.has(p) && p.split("/").pop() === name);
                if (from) {
                    moved.add(from);
                    out.move.push({ from, to: path });
                    have = vault.get(from);
                    was = manifest.get(from);
                }
            }
            if (have === undefined) out.add.push(path);
            else if (UpdateObsidianPM.ONCE.includes(rel)) continue;
            else if (have === hash) out.same.push(path);
            else if (was === have) out.update.push(path);
            else out.local.push(path);
        }
        for (const [path, hash] of sorted(manifest)) {
            if (moved.has(path) || placed.has(fold(path)) || !vault.has(path) || UpdateObsidianPM.ONCE.includes(path)) continue;
            (vault.get(path) === hash ? out.remove : out.keep).push(path);
        }
        return out;
    }

    // Why the clone can't install right now, or null when it's on main with nothing changed.
    //   branch  the checked-out branch, or "" when HEAD is detached
    //   commit  the short commit, for the message
    //   dirty   what `git status --porcelain` lists: changed, and untracked but not ignored
    refusal({ branch, commit, dirty = [] }) {
        const where = branch ? `on branch \`${branch}\`` : `detached at ${commit}`;
        if (branch !== UpdateObsidianPM.BRANCH) {
            return `The clone is ${where}, not \`${UpdateObsidianPM.BRANCH}\`: a branch under test doesn't install.`
                + ` Finish the test (dev-vault.sh done), then run this again.`;
        }
        if (dirty.length) {
            const n = dirty.length;
            return `The clone has ${n} uncommitted change${n === 1 ? "" : "s"} (${dirty[0]}${n > 1 ? ", …" : ""}):`
                + ` only what a pull request merged installs. Restore it (dev-vault.sh done), then run this again.`;
        }
        return null;
    }

    // Why the clone can't be copied from now, when it passed when the dialog opened, or null when
    // it hasn't moved. `before` and `now` are what state() returned then and now; `now` is null
    // when the clone's folder is gone.
    moved(before, now) {
        const why = !now ? "The clone is no longer there. Run this again."
            : this.refusal(now)
            ?? (now.head !== before.head ? `It moved from ${before.commit} to ${now.commit}. Run this again.` : null);
        return why && `The clone changed while the dialog was open, so nothing was written. ${why}`;
    }

    // The confirmation, as lines. `local` needs a decision, so it comes first. Long lists are cut
    // to `max` paths and counted, so the dialog stays readable.
    summary(plan, { source, commit, firstRun = false, max = 8, hidden = [], invoiceFolder = "", held = false } = {}) {
        const lines = [];
        const list = (label, paths, note = "") => {
            if (!paths.length) return;
            const shown = paths.slice(0, max);
            lines.push(`**${label}: ${paths.length}**${note}`, ...shown.map((p) => `- ${p}`));
            if (paths.length > shown.length) lines.push(`- …and ${paths.length - shown.length} more`);
            lines.push("");
        };
        if (source) lines.push(`From \`${source}\`${commit ? ` at ${commit}` : ""}`, "");
        if (invoiceFolder) lines.push(`The Invoices base goes in \`${invoiceFolder}\`, the \`folder\` in Invoice Settings.`, "");
        if (held) lines.push("The Invoices base is left as it is this time: Invoice Settings can't be read (see the notice).", "");
        if (firstRun && plan.local.length) {
            lines.push("No record of an earlier install here, so every file that differs is listed as changed in this vault."
                + " On a vault that already ran the system, tick the box below to take the repository's versions.", "");
        }
        list(firstRun ? "Differs from the repository" : "Changed in this vault, would be overwritten", plan.local);
        list("Moved", (plan.move ?? []).map(({ from, to }) => `${from} → ${to}`), " (to where it belongs now, as it is)");
        list("New", plan.add);
        list("Updated", plan.update);
        list("Removed", plan.remove, " (the repository doesn't install these any more)");
        list("Kept, changed here since it was installed", plan.keep, " (nothing will happen to these)");
        // Files git has been told to ignore changes to (`update-index --skip-worktree`) never show
        // in a diff or in `git status`, so the branch-and-clean check above can't see them: they'd
        // travel silently, and they're the likeliest edits to be wrong for a vault.
        list("Hidden from git in the clone", hidden.filter((p) => this.installs(p)),
            " (skip-worktree: git shows no change, but this copies what's on disk)");
        if (this.upToDate(plan)) lines.push(`Already up to date (${plan.same.length} files).`);
        return lines.join("\n").trim();
    }

    // Nothing to write but, perhaps, the manifest
    upToDate(plan) {
        return !plan.add.length && !plan.update.length && !plan.local.length && !plan.remove.length && !(plan.move ?? []).length;
    }

    // What writing the plan comes down to: files to move, copy and delete, and the ones already up
    // to date, which the manifest records too (one that matches the repository is what's installed,
    // however it got there)
    steps(plan, { overwriteLocal = false, remove = true } = {}) {
        return {
            move: [...(plan.move ?? [])],
            copy: [...plan.add, ...plan.update, ...(overwriteLocal ? plan.local : [])].sort(),
            delete: remove ? [...plan.remove] : [],
            same: [...plan.same],
        };
    }

    // The record of what's installed, for the next run. A moved file takes what was recorded for it
    // where it was, so an edit of yours still counts as yours at its new place.
    manifestAfter(source, previous, steps) {
        const out = new Map(previous);
        for (const { from, to } of steps.move ?? []) {
            if (out.has(from)) out.set(to, out.get(from));
            out.delete(from);
        }
        for (const path of [...steps.copy, ...(steps.same ?? [])]) out.set(path, source.get(path));
        for (const path of steps.delete) out.delete(path);
        for (const path of [...out.keys()]) if (!source.has(path)) out.delete(path);
        return out;
    }

    done(steps, commit) {
        const bits = [];
        if (steps.move?.length) bits.push(`${steps.move.length} moved`);
        if (steps.copy.length) bits.push(`${steps.copy.length} file${steps.copy.length === 1 ? "" : "s"} copied`);
        if (steps.delete.length) bits.push(`${steps.delete.length} removed`);
        return `${bits.join(", ") || "Nothing to do"}${commit ? ` (${commit})` : ""}`;
    }

    // ---------------------------------------------------------------- the command

    async invoke() {
        const { Notice } = customJS.obsidian;
        if (!this.desktop()) { new Notice("Update Obsidian PM runs on the desktop only"); return; }
        const fs = require("fs"), path = require("path");
        const vaultPath = this.vaultPath();

        let source = (await this.read(UpdateObsidianPM.SOURCE_FILE))?.trim();
        if (!source) {
            source = (await this.ask("Where is your clone of the obsidian-pm repository?", "~/src/obsidian-pm"))?.trim();
            if (!source) return;
        }
        source = source.replace(/^~(?=$|\/)/, process.env.HOME ?? "");
        source = path.resolve(source);

        const isClone = () => {
            try { return this.isManifest(fs.readFileSync(path.join(source, "manifest.json"), "utf8")); } catch { return false; }
        };
        if (!isClone()) {
            new Notice(`No obsidian-pm clone at ${source}`, 0); return;
        }
        if (path.resolve(vaultPath) === source) { new Notice("That's this vault, not a clone of the repository", 0); return; }

        // Before the pull: a detached HEAD has nothing to pull into, and a dirty tree shouldn't move
        const refusal = this.refusal(this.state(source));
        if (refusal) { new Notice(`Update Obsidian PM: ${refusal}`, 0); return; }

        const pull = this.git(source, ["pull", "--ff-only"]);
        if (!pull.ok) new Notice(`Couldn't update the clone (${pull.message}); using it as it is`, 8000);
        // What the plan is built from; checked again when Update is clicked
        const before = this.state(source);
        const commit = before.commit || undefined;

        const listed = this.git(source, ["ls-files", "-z"]);
        if (!listed.ok) { new Notice(`Couldn't read the clone: ${listed.message}`, 0); return; }
        const repoFiles = new Map();
        for (const rel of listed.out.split("\0").filter(Boolean)) {
            if (!this.installs(rel)) continue;
            const full = path.join(source, rel);
            if (fs.existsSync(full)) repoFiles.set(rel, this.hash(fs.readFileSync(full)));
        }
        if (!repoFiles.size) { new Notice("That clone has no system files to install", 0); return; }
        // From here on, every path is where the file goes in the vault; `origin` says where a file
        // placed elsewhere comes from in the clone. While Invoice Settings can't be read, the
        // Invoices base sits the update out, and its records are kept as they are.
        const where = await this.invoiceFolder(vaultPath);
        const { files: sourceFiles, origin } = this.placed(repoFiles, { invoiceFolder: where.folder, hold: where.hold });
        const recorded = new Map(Object.entries(JSON.parse((await this.read(UpdateObsidianPM.MANIFEST_FILE)) || "{}").files ?? {}));
        const { manifest, held } = where.hold ? this.hold(recorded) : { manifest: recorded, held: new Map() };
        const vaultFiles = new Map();
        for (const rel of new Set([...sourceFiles.keys(), ...manifest.keys()])) {
            const full = path.join(vaultPath, rel);
            if (fs.existsSync(full)) vaultFiles.set(rel, this.hash(fs.readFileSync(full)));
        }

        const plan = this.plan(sourceFiles, vaultFiles, manifest, origin);
        // `ls-files -v` tags each entry: "S" for skip-worktree, a lowercase letter for
        // assume-unchanged. Both tell git to ignore changes, so neither shows in a diff.
        const hidden = (this.git(source, ["ls-files", "-v"]).out ?? "").split("\n")
            .filter((line) => /^(S|[a-z]) /.test(line)).map((line) => line.slice(2)).filter(Boolean).sort();
        const summary = this.summary(plan, { source, commit, firstRun: recorded.size === 0, hidden, invoiceFolder: where.folder, held: where.hold });
        if (this.upToDate(plan)) {
            // Still record what's already in place, so a later update reaches it
            const after = new Map([...this.manifestAfter(sourceFiles, manifest, this.steps(plan)), ...held]);
            const same = after.size === recorded.size && [...after].every(([p, h]) => recorded.get(p) === h);
            if (!same) await this.record(after, { source, commit });
            new Notice(`Obsidian PM is up to date (${commit ?? "no commit"})`, 6000); return;
        }
        const choice = await this.confirm(summary, plan);
        if (!choice) return;

        // The dialog may have been open for a while: the clone has to be where the plan left it
        const moved = this.moved(before, isClone() ? this.state(source) : null);
        if (moved) { new Notice(`Update Obsidian PM: ${moved}`, 0); return; }

        if (!(await this.read(UpdateObsidianPM.SOURCE_FILE))) await this.write(UpdateObsidianPM.SOURCE_FILE, source + "\n");

        // `landed` follows every write, so a stop partway can still record what's installed
        const steps = this.steps(plan, choice);
        const landed = new Map(manifest);
        const copied = [];
        let rel;
        try {
            for (const { from, to } of steps.move) {
                rel = to;
                await this.moveFile(vaultPath, from, to);
                if (landed.has(from)) landed.set(to, landed.get(from));
                landed.delete(from);
            }
            for (rel of steps.copy) {
                // Byte for byte what the dialog was built from: git state can't see an edit hidden
                // with skip-worktree, and the folder can move between the check and the copy
                const buffer = fs.readFileSync(path.join(source, origin.get(rel) ?? rel));
                if (this.hash(buffer) !== sourceFiles.get(rel)) throw new Error("changed while the dialog was open");
                // Your own version of a file outside Config goes to the trash, not just away
                if (plan.local.includes(rel) && !rel.startsWith("Config/")) {
                    const yours = app.vault.getAbstractFileByPath(rel);
                    if (yours) await app.fileManager.trashFile(yours);
                }
                const to = path.join(vaultPath, rel);
                fs.mkdirSync(path.dirname(to), { recursive: true });
                fs.writeFileSync(to, buffer);
                landed.set(rel, sourceFiles.get(rel));
                copied.push(rel);
            }
            for (rel of steps.delete) {
                const file = app.vault.getAbstractFileByPath(rel);
                if (file) await app.fileManager.trashFile(file);
                else fs.rmSync(path.join(vaultPath, rel), { force: true });
                landed.delete(rel);
            }
        } catch (e) {
            await this.record(new Map([...landed, ...held]), { source, commit, failed: rel });
            new Notice(`Update Obsidian PM: ${copied.length} of ${steps.copy.length} file${steps.copy.length === 1 ? "" : "s"} copied,`
                + ` then ${rel} failed (${String(e?.message ?? e).split("\n")[0]}). The manifest records what landed; run this again.`, 0);
            return;
        }
        await this.record(new Map([...this.manifestAfter(sourceFiles, manifest, steps), ...held]), { source, commit });

        new Notice(`Update Obsidian PM: ${this.done(steps, commit)}`, 8000);
    }

    // ---------------------------------------------------------------- the bits that touch the app

    // Where the Invoices base goes: { folder, hold }. `folder` is Invoice Settings' `folder`, spelled
    // as the vault's folders are, or "" with no settings note or no `folder` (Config/Bases). A
    // note whose properties don't read, or a `folder` that isn't a folder, says so and holds the
    // base where it is for this update: guessing would move it out of sight.
    async invoiceFolder(vaultPath) {
        const { Notice } = customJS.obsidian;
        const hold = (why) => {
            new Notice(`Update Obsidian PM: ${why}, so the Invoices base is left where it is this time`, 0);
            return { folder: "", hold: true };
        };
        const text = await this.read(UpdateObsidianPM.INVOICE_SETTINGS);
        if (!text) return { folder: "", hold: false };
        let raw;
        try {
            const { getFrontMatterInfo, parseYaml } = customJS.obsidian;
            const info = getFrontMatterInfo(text);
            raw = info.exists ? (parseYaml(info.frontmatter) ?? {}).folder : undefined;
        } catch (e) {
            return hold(`Invoice Settings' properties don't read (${String(e?.message ?? e).split("\n")[0]})`);
        }
        const { folder, error } = this.folderOf(raw);
        if (error) return hold(`\`folder\` in Invoice Settings ${error}`);
        if (!folder) return { folder: "", hold: false };
        const real = this.realFolder(vaultPath, folder);
        const file = this.fileOnTheWay(vaultPath, real);
        if (file) return hold(`\`folder\` in Invoice Settings goes through ${file}, which is a file`);
        return { folder: real, hold: false };
    }

    // The first part of `folder` that exists as something other than a folder, or null
    fileOnTheWay(vaultPath, folder) {
        const fs = require("fs"), path = require("path");
        let at = "";
        for (const part of folder.split("/")) {
            at = at ? `${at}/${part}` : part;
            let stat = null;
            try { stat = fs.statSync(path.join(vaultPath, at)); } catch (e) { return null; }
            if (!stat.isDirectory()) return at;
        }
        return null;
    }

    // Moves a file in the vault, through Obsidian when it knows the file (so links follow it),
    // making the folders it needs
    async moveFile(vaultPath, from, to) {
        const fs = require("fs"), path = require("path");
        const dir = to.split("/").slice(0, -1).join("/");
        const file = app.vault.getAbstractFileByPath(from);
        if (!file) {
            fs.mkdirSync(path.join(vaultPath, dir), { recursive: true });
            fs.renameSync(path.join(vaultPath, from), path.join(vaultPath, to));
            return;
        }
        let at = "";
        for (const part of dir ? dir.split("/") : []) {
            at = at ? `${at}/${part}` : part;
            if (!app.vault.getAbstractFileByPath(at)) await app.vault.createFolder(at);
        }
        await app.fileManager.renameFile(file, to);
    }

    // `folder` with each part the vault already has spelled as it is on disk, matched in any case, so
    // the manifest records the path Obsidian shows
    realFolder(vaultPath, folder) {
        const fs = require("fs"), path = require("path");
        let at = vaultPath;
        return folder.split("/").map((part) => {
            let names = [];
            try { names = fs.readdirSync(at, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { /* not made yet */ }
            const name = names.find((n) => n === part) ?? names.find((n) => n.toLowerCase() === part.toLowerCase()) ?? part;
            at = path.join(at, name);
            return name;
        }).join("/");
    }

    desktop() {
        return !app.isMobile && typeof require === "function" && Boolean(this.vaultPath());
    }

    vaultPath() {
        return app.vault.adapter.getBasePath?.() ?? app.vault.adapter.basePath ?? "";
    }

    hash(buffer) {
        return require("crypto").createHash("sha1").update(buffer).digest("hex");
    }

    // The clone as it is right now, for refusal() and moved(): the checked-out branch ("" when
    // HEAD is detached), the commit, short and full, and what `git status --porcelain` lists
    state(source) {
        return {
            branch: (this.git(source, ["symbolic-ref", "-q", "--short", "HEAD"]).out ?? "").trim(),
            commit: (this.git(source, ["rev-parse", "--short", "HEAD"]).out ?? "").trim(),
            head: (this.git(source, ["rev-parse", "HEAD"]).out ?? "").trim(),
            // -z: paths come unquoted, so one with a space reads as it is
            dirty: (this.git(source, ["status", "--porcelain", "-z", "--untracked-files=all"]).out ?? "")
                .split("\0").filter(Boolean).map((line) => line.slice(3)),
        };
    }

    // Writes the manifest: what's installed now, from where, and `failed` when a copy stopped there
    async record(files, { source, commit, failed } = {}) {
        await this.write(UpdateObsidianPM.MANIFEST_FILE, JSON.stringify({
            source, commit: commit ?? null, updated: window.moment().format("YYYY-MM-DD HH:mm"),
            ...(failed ? { failed } : {}),
            files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b))),
        }, null, 2) + "\n");
    }

    // git in the clone, never in the vault
    git(cwd, args) {
        try {
            const out = require("child_process").execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 60000 });
            return { ok: true, out };
        } catch (e) {
            return { ok: false, message: String(e.stderr || e.message).trim().split("\n")[0], out: "" };
        }
    }

    async read(rel) {
        return (await app.vault.adapter.exists(rel)) ? app.vault.adapter.read(rel) : null;
    }

    async write(rel, text) {
        return app.vault.adapter.write(rel, text);
    }

    ask(question, placeholder) {
        const { Modal, Setting } = customJS.obsidian;
        return new Promise((resolve) => {
            const modal = new Modal(app);
            let value = "";
            modal.titleEl.setText(question);
            new Setting(modal.contentEl).addText((t) => t.setPlaceholder(placeholder).onChange((v) => { value = v; }));
            new Setting(modal.contentEl)
                .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
                .addButton((b) => b.setButtonText("Use this folder").setCta().onClick(() => { modal.close(); resolve(value); }));
            modal.onClose = () => resolve(value || "");
            modal.open();
        });
    }

    // Shows the plan and asks. Returns null for cancel, else what to do about local changes and removals.
    confirm(summary, plan) {
        const { Modal, Setting, MarkdownRenderer, Component } = customJS.obsidian;
        return new Promise((resolve) => {
            const modal = new Modal(app);
            let answer = null, overwriteLocal = false, remove = true;
            modal.titleEl.setText("Update Obsidian PM");
            const body = modal.contentEl.createDiv({ cls: "markdown-rendered" });
            body.style.maxHeight = "50vh";
            body.style.overflow = "auto";
            const component = new Component();
            MarkdownRenderer.render(app, summary, body, "", component);
            if (plan.local.length) {
                const outside = plan.local.some((p) => !p.startsWith("Config/"));
                new Setting(modal.contentEl)
                    .setName("Take the repository's version of those files")
                    .setDesc(`Off: they're left as they are and stay out of date.${outside ? " On: yours outside Config go to the vault's trash first." : ""}`)
                    .addToggle((t) => t.setValue(false).onChange((v) => { overwriteLocal = v; }));
            }
            if (plan.remove.length) {
                new Setting(modal.contentEl)
                    .setName("Remove the files the repository dropped")
                    .setDesc("They go to the vault's trash.")
                    .addToggle((t) => t.setValue(true).onChange((v) => { remove = v; }));
            }
            new Setting(modal.contentEl)
                .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
                .addButton((b) => b.setButtonText("Update").setCta().onClick(() => { answer = { overwriteLocal, remove }; modal.close(); }));
            modal.onClose = () => { component.unload(); resolve(answer); };
            modal.open();
        });
    }
}
