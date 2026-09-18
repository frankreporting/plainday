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
    // Where the clone is: `00 Meta/02 Scripts/update-source`, a one-line file holding its path. It
    // isn't in the repository, since it's yours. The command asks for the path on the first run.
    // What it installed last time: `00 Meta/02 Scripts/update-manifest.json` (also yours), which is
    // how it can tell your edits from an old version.
    //
    // Desktop only: it reads another folder and runs git.
    static SOURCE_FILE = "00 Meta/02 Scripts/update-source";
    static MANIFEST_FILE = "00 Meta/02 Scripts/update-manifest.json";
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
    // in a vault of real notes.
    static EXCLUDE = [
        "00 Meta/02 Scripts/tests/demoVault.test.mjs",
        "00 Meta/02 Scripts/tests/demo/",
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

    // The confirmation, as lines. `local` needs a decision, so it comes first. Long lists are cut
    // to `max` paths and counted, so the dialog stays readable.
    summary(plan, { source, commit, firstRun = false, max = 8 } = {}) {
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
        list("Removed", plan.remove, " (the repository no longer has these)");
        list("Kept, changed here since it was installed", plan.keep, " (nothing will happen to these)");
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

        const pull = this.git(source, ["pull", "--ff-only"]);
        if (!pull.ok) new Notice(`Couldn't update the clone (${pull.message}); using it as it is`, 8000);
        const commit = this.git(source, ["rev-parse", "--short", "HEAD"]).out?.trim();

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
        const summary = this.summary(plan, { source, commit, firstRun: manifest.size === 0 });
        if (!plan.add.length && !plan.update.length && !plan.local.length && !plan.remove.length) {
            new Notice(`Obsidian PM is up to date (${commit ?? "no commit"})`, 6000); return;
        }
        const choice = await this.confirm(summary, plan);
        if (!choice) return;

        const steps = this.steps(plan, choice);
        for (const rel of steps.copy) {
            const to = path.join(vaultPath, rel);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(path.join(source, rel), to);
        }
        for (const rel of steps.delete) {
            const file = app.vault.getAbstractFileByPath(rel);
            if (file) await app.fileManager.trashFile(file);
            else fs.rmSync(path.join(vaultPath, rel), { force: true });
        }
        const after = this.manifestAfter(sourceFiles, manifest, steps);
        await this.write(UpdateObsidianPM.MANIFEST_FILE, JSON.stringify({
            source, commit: commit ?? null, updated: window.moment().format("YYYY-MM-DD HH:mm"),
            files: Object.fromEntries([...after].sort(([a], [b]) => a.localeCompare(b))),
        }, null, 2) + "\n");
        if (!(await this.read(UpdateObsidianPM.SOURCE_FILE))) await this.write(UpdateObsidianPM.SOURCE_FILE, source + "\n");

        new Notice(`Update Obsidian PM: ${this.done(steps, commit)}`, 8000);
        if (steps.copy.some((p) => p.startsWith("00 Meta/02 Scripts/CustomJS/") || p.endsWith("customjs/data.json"))) {
            if (await this.confirmReload()) {
                await app.plugins.disablePlugin("customjs");
                await app.plugins.enablePlugin("customjs");
                new Notice("CustomJS reloaded");
            }
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
