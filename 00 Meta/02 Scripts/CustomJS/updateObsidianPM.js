class UpdateObsidianPM {
    // Command "Update Obsidian PM": installs this repository's system files into the vault it runs
    // in, from a local clone. The vault is never a git repository, so a vault full of real notes can
    // never be committed, overwritten by the repository's sample notes, or emptied by a git command.
    //
    // It copies only what the repository holds under `00 Meta/`, plus README.md, CLAUDE.md and the
    // three settings files the scripts depend on. It never touches a note, never touches anything
    // under `00 Meta/` that the repository doesn't have (your own fonts, templates or notes stay),
    // and never copies the demo's own test files, which rewrite notes when they run.
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
    // Where the clone is: `00 Meta/02 Scripts/update-source`, a one-line file holding its path. It
    // isn't in the repository, since it's yours. The command asks for the path on the first run.
    // What it installed last time: `00 Meta/02 Scripts/update-manifest.json` (also yours), which is
    // how it can tell your edits from an old version.
    //
    // Desktop only: it reads another folder and runs git.
    static SOURCE_FILE = "00 Meta/02 Scripts/update-source";
    static MANIFEST_FILE = "00 Meta/02 Scripts/update-manifest.json";
    // The only branch that installs
    static BRANCH = "main";
    // What the repository installs into a vault
    static INCLUDE = [
        "00 Meta/",
        "README.md",
        "CLAUDE.md",
        ".obsidian/daily-notes.json",
        ".obsidian/plugins/templater-obsidian/data.json",
        ".obsidian/plugins/customjs/data.json",
    ];
    // Parts of the repository that belong to the demo vault only. demoVault.test.mjs asserts the
    // demo's own notes, and its render script writes report blocks into notes, so neither belongs
    // in a vault of real notes. dev-vault.sh drives the clone as a test vault, and its test builds
    // throwaway clones: both are for working on the system, not for using it.
    static EXCLUDE = [
        "00 Meta/02 Scripts/tests/demoVault.test.mjs",
        "00 Meta/02 Scripts/tests/demo/",
        "00 Meta/02 Scripts/dev-vault.sh",
        "00 Meta/02 Scripts/tests/devVault.test.mjs",
    ];

    // ---------------------------------------------------------------- planning (no app, no fs)

    installs(path) {
        return UpdateObsidianPM.INCLUDE.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p))
            && !UpdateObsidianPM.EXCLUDE.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
    }

    // What an update would do, from three pictures of the same paths:
    //   source   Map(path → hash)  the repository's files, as `git ls-files` lists them
    //   vault    Map(path → hash)  what the vault has now (missing paths are absent)
    //   manifest Map(path → hash)  what this command installed last time, empty on a first run
    // Every list is sorted, and each path appears in exactly one of them:
    //   add      not in the vault
    //   update   differs from the repository, and matches what was installed (so it's an old version)
    //   local    differs from both: changed in the vault since it was installed (or never installed)
    //   remove   the repository dropped it, and the vault still has what was installed
    //   keep     the repository dropped it, but it differs from what was installed: left alone
    //   same     already up to date
    plan(source, vault, manifest = new Map()) {
        const out = { add: [], update: [], local: [], remove: [], keep: [], same: [] };
        for (const [path, hash] of [...source].sort(([a], [b]) => a.localeCompare(b))) {
            if (!this.installs(path)) continue;
            const have = vault.get(path);
            if (have === undefined) out.add.push(path);
            else if (have === hash) out.same.push(path);
            else if (manifest.get(path) === have) out.update.push(path);
            else out.local.push(path);
        }
        for (const [path, hash] of [...manifest].sort(([a], [b]) => a.localeCompare(b))) {
            if (source.has(path) || !vault.has(path)) continue;
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
    summary(plan, { source, commit, firstRun = false, max = 8, hidden = [] } = {}) {
        const lines = [];
        const list = (label, paths, note = "") => {
            if (!paths.length) return;
            const shown = paths.slice(0, max);
            lines.push(`**${label}: ${paths.length}**${note}`, ...shown.map((p) => `- ${p}`));
            if (paths.length > shown.length) lines.push(`- …and ${paths.length - shown.length} more`);
            lines.push("");
        };
        if (source) lines.push(`From \`${source}\`${commit ? ` at ${commit}` : ""}`, "");
        if (firstRun && plan.local.length) {
            lines.push("No record of an earlier install here, so every file that differs is listed as changed in this vault."
                + " On a vault that already ran the system, tick the box below to take the repository's versions.", "");
        }
        list(firstRun ? "Differs from the repository" : "Changed in this vault, would be overwritten", plan.local);
        list("New", plan.add);
        list("Updated", plan.update);
        list("Removed", plan.remove, " (the repository doesn't install these any more)");
        list("Kept, changed here since it was installed", plan.keep, " (nothing will happen to these)");
        // Files git has been told to ignore changes to (`update-index --skip-worktree`) never show
        // in a diff or in `git status`, so the branch-and-clean check above can't see them: they'd
        // travel silently, and they're the likeliest edits to be wrong for a vault.
        list("Hidden from git in the clone", hidden.filter((p) => this.installs(p)),
            " (skip-worktree: git shows no change, but this copies what's on disk)");
        if (!plan.add.length && !plan.update.length && !plan.local.length && !plan.remove.length) {
            lines.push(`Already up to date (${plan.same.length} files).`);
        }
        return lines.join("\n").trim();
    }

    // What writing the plan comes down to: files to copy and files to delete
    steps(plan, { overwriteLocal = false, remove = true } = {}) {
        return {
            copy: [...plan.add, ...plan.update, ...(overwriteLocal ? plan.local : [])].sort(),
            delete: remove ? [...plan.remove] : [],
        };
    }

    // The record of what's installed, for the next run
    manifestAfter(source, previous, steps) {
        const out = new Map(previous);
        for (const path of steps.copy) out.set(path, source.get(path));
        for (const path of steps.delete) out.delete(path);
        for (const path of [...out.keys()]) if (!source.has(path)) out.delete(path);
        return out;
    }

    done(steps, commit) {
        const bits = [];
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

        if (!fs.existsSync(path.join(source, "00 Meta/02 Scripts/CustomJS"))) {
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
        const sourceFiles = new Map();
        for (const rel of listed.out.split("\0").filter(Boolean)) {
            if (!this.installs(rel)) continue;
            const full = path.join(source, rel);
            if (fs.existsSync(full)) sourceFiles.set(rel, this.hash(fs.readFileSync(full)));
        }
        if (!sourceFiles.size) { new Notice("That clone has no system files to install", 0); return; }

        const manifest = new Map(Object.entries(JSON.parse((await this.read(UpdateObsidianPM.MANIFEST_FILE)) || "{}").files ?? {}));
        const vaultFiles = new Map();
        for (const rel of new Set([...sourceFiles.keys(), ...manifest.keys()])) {
            const full = path.join(vaultPath, rel);
            if (fs.existsSync(full)) vaultFiles.set(rel, this.hash(fs.readFileSync(full)));
        }

        const plan = this.plan(sourceFiles, vaultFiles, manifest);
        // `ls-files -v` tags each entry: "S" for skip-worktree, a lowercase letter for
        // assume-unchanged. Both tell git to ignore changes, so neither shows in a diff.
        const hidden = (this.git(source, ["ls-files", "-v"]).out ?? "").split("\n")
            .filter((line) => /^(S|[a-z]) /.test(line)).map((line) => line.slice(2)).filter(Boolean).sort();
        const summary = this.summary(plan, { source, commit, firstRun: manifest.size === 0, hidden });
        if (!plan.add.length && !plan.update.length && !plan.local.length && !plan.remove.length) {
            new Notice(`Obsidian PM is up to date (${commit ?? "no commit"})`, 6000); return;
        }
        const choice = await this.confirm(summary, plan);
        if (!choice) return;

        // The dialog may have been open for a while: the clone has to be where the plan left it
        const isClone = fs.existsSync(path.join(source, "00 Meta/02 Scripts/CustomJS"));
        const moved = this.moved(before, isClone ? this.state(source) : null);
        if (moved) { new Notice(`Update Obsidian PM: ${moved}`, 0); return; }

        if (!(await this.read(UpdateObsidianPM.SOURCE_FILE))) await this.write(UpdateObsidianPM.SOURCE_FILE, source + "\n");

        // `landed` follows every write, so a stop partway can still record what's installed
        const steps = this.steps(plan, choice);
        const landed = new Map(manifest);
        const copied = [];
        let rel;
        try {
            for (rel of steps.copy) {
                // Byte for byte what the dialog was built from: git state can't see an edit hidden
                // with skip-worktree, and the folder can move between the check and the copy
                const buffer = fs.readFileSync(path.join(source, rel));
                if (this.hash(buffer) !== sourceFiles.get(rel)) throw new Error("changed while the dialog was open");
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
            await this.record(landed, { source, commit, failed: rel });
            new Notice(`Update Obsidian PM: ${copied.length} of ${steps.copy.length} file${steps.copy.length === 1 ? "" : "s"} copied,`
                + ` then ${rel} failed (${String(e?.message ?? e).split("\n")[0]}). The manifest records what landed; run this again.`, 0);
            await this.offerReload(copied);
            return;
        }
        await this.record(this.manifestAfter(sourceFiles, manifest, steps), { source, commit });

        new Notice(`Update Obsidian PM: ${this.done(steps, commit)}`, 8000);
        await this.offerReload(steps.copy);
    }

    // When a script or the CustomJS settings landed, the new versions only run after a reload
    async offerReload(copied) {
        if (!copied.some((p) => p.startsWith("00 Meta/02 Scripts/CustomJS/") || p.endsWith("customjs/data.json"))) return;
        if (await this.confirmReload()) {
            await app.plugins.disablePlugin("customjs");
            await app.plugins.enablePlugin("customjs");
            new Notice("CustomJS reloaded");
        }
    }

    // ---------------------------------------------------------------- the bits that touch the app

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
                new Setting(modal.contentEl)
                    .setName("Take the repository's version of those files")
                    .setDesc("Off: they're left as they are and stay out of date.")
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

    confirmReload() {
        const { Modal, Setting } = customJS.obsidian;
        return new Promise((resolve) => {
            const modal = new Modal(app);
            let yes = false;
            modal.titleEl.setText("Reload CustomJS?");
            modal.contentEl.setText("The scripts changed. Reloading CustomJS puts the new versions to work now.");
            new Setting(modal.contentEl)
                .addButton((b) => b.setButtonText("Later").onClick(() => modal.close()))
                .addButton((b) => b.setButtonText("Reload").setCta().onClick(() => { yes = true; modal.close(); }));
            modal.onClose = () => resolve(yes);
            modal.open();
        });
    }
}
