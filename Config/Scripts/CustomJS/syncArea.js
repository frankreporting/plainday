class SyncArea {
    // Startup script: when notes move to another folder (one at a time or as a whole folder),
    // points their `area` property at the nearest project or area above them, i.e. the first
    // folder note (Folder/Folder.md) tagged #project or #area. A folder note looks from the
    // folder above its own, so a moved project points at its new parent. Notes that land
    // outside any project or area, or anywhere in Archive or Config, are left untouched,
    // and renaming a folder in place changes nothing (Obsidian updates the links itself).
    // An invoice is never touched either: its `area` is the project it bills (OBS-114), fixed
    // when it's made, so moving the note mustn't change what it bills.
    // Runs on every device, and each one only ever sees its own moves: Obsidian Sync delivers
    // a move made elsewhere as a delete plus a new file, not a rename (verified 2026-09-11).
    static IGNORED = ["Archive/", "Config/"];
    static DEBOUNCE_MS = 300;
    // Templater moves notes mid-template and rewrites them when it finishes; wait for that.
    static TEMPLATER_WAIT_MS = 120000;

    async invoke() {
        // CustomJS doesn't run deconstructors when the plugin itself reloads, so keep the
        // handle on window to guarantee a single listener.
        this.deconstructor();
        this.queue = new Map();
        this.renamedFolders = new Map();
        window.syncAreaRef = app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath));
    }

    deconstructor() {
        if (window.syncAreaRef) app.vault.offref(window.syncAreaRef);
        window.syncAreaRef = null;
        clearTimeout(this.timer);
    }

    onRename(file, oldPath) {
        // The listener outlives CustomJS being switched off, so check on every event
        if (!app.plugins.enabledPlugins.has("customjs")) return;

        const oldFolder = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "/";
        if (file.children) {
            // A folder renamed where it is: its notes fire their own renames next, which aren't moves
            if (oldFolder === file.parent?.path) this.renamedFolders.set(oldPath + "/", { to: file.path + "/", at: Date.now() });
            return;
        }
        if (file.extension !== "md") return;
        if (oldFolder === file.parent.path) return; // renamed in place, not moved
        if (this.insideRenamedFolder(file, oldPath)) return;
        if (SyncArea.IGNORED.some((p) => file.path.startsWith(p))) return;

        // Keyed by the TFile so a note moved twice in quick succession is handled once;
        // keeps the first old path, which is the one Templater knows it by.
        if (!this.queue.has(file)) this.queue.set(file, oldPath);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            // One batch at a time, so a note is never written by two batches at once
            this.chain = (this.chain ?? Promise.resolve()).then(() => this.flush());
        }, SyncArea.DEBOUNCE_MS);
    }

    insideRenamedFolder(file, oldPath) {
        for (const [from, { to, at }] of this.renamedFolders) {
            if (Date.now() - at > 5000) { this.renamedFolders.delete(from); continue; }
            if (oldPath.startsWith(from) && file.path === to + oldPath.slice(from.length)) return true;
        }
        return false;
    }

    async flush() {
        const batch = [...this.queue];
        this.queue.clear();
        let updated = 0;
        for (const [file, oldPath] of batch) {
            try {
                const templated = await this.waitForTemplater(file, oldPath);
                if (await this.sync(file, templated)) updated++;
            } catch (e) {
                console.error(`SyncArea: couldn't update ${file.path}`, e);
            }
        }
        if (updated) new Notice(`Updated area on ${updated} note${updated === 1 ? "" : "s"}`);
    }

    // Returns true if the note was mid-template when it moved
    async waitForTemplater(file, oldPath) {
        const pending = app.plugins.plugins["templater-obsidian"]?.templater?.files_with_pending_templates;
        const isPending = () => pending?.has(oldPath) || pending?.has(file.path);
        if (!isPending()) return false;
        const deadline = Date.now() + SyncArea.TEMPLATER_WAIT_MS;
        while (isPending() && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 250));
        }
        return true;
    }

    // Returns true if the note's area was written
    async sync(file, templated) {
        if (app.vault.getAbstractFileByPath(file.path) !== file) return false; // deleted since
        if (SyncArea.IGNORED.some((p) => file.path.startsWith(p))) return false; // moved again since

        const parent = this.nearestProjectOrArea(file);
        if (!parent) return false;

        const linktext = app.metadataCache.fileToLinktext(parent, file.path, true);
        const alias = [].concat(app.metadataCache.getFileCache(parent)?.frontmatter?.aliases ?? [])[0];
        const link = alias ? `[[${linktext}|${alias}]]` : `[[${linktext}]]`;

        // The key to write, or null if the area is already right. Decided from the frontmatter
        // as written, not the metadata cache, which can lag a template's final write.
        const keyToWrite = (f) => {
            const key = Object.keys(f).find((k) => k.toLowerCase() === "area") ?? "area";
            if (templated && f[key]) return null; // keep the area a template just picked
            return this.linksTo(f[key], file, parent) ? null : key;
        };
        // processFrontMatter rewrites the whole YAML block even when nothing changes, so check first
        const { getFrontMatterInfo, parseYaml } = customJS.obsidian;
        const text = await app.vault.read(file);
        const info = getFrontMatterInfo(text);
        const front = info.exists ? parseYaml(info.frontmatter) ?? {} : {};
        // An invoice that lost its tag but still has its Billed entries still bills, so it's left alone too
        if (this.isInvoice(front) || customJS.Billing?.hasBilled?.(text) || !keyToWrite(front)) return false;

        let wrote = false;
        const recached = this.waitForCache(file);
        await app.fileManager.processFrontMatter(file, (f) => {
            if (this.isInvoice(f)) return;
            const key = keyToWrite(f);
            if (!key) return;
            f[key] = Array.isArray(f[key]) ? [link] : link;
            wrote = true;
        });
        // Until Obsidian re-reads a note we just wrote, its cached tags read as empty, so a
        // moved project's own notes would skip past it; wait before the next lookup
        if (wrote) await recached;
        return wrote;
    }

    // Resolves once the metadata cache has re-read the note, or after 2 seconds
    waitForCache(file) {
        return new Promise((resolve) => {
            const done = () => { app.metadataCache.offref(ref); clearTimeout(timer); resolve(); };
            const ref = app.metadataCache.on("changed", (f) => { if (f === file) done(); });
            const timer = setTimeout(done, 2000);
        });
    }

    nearestProjectOrArea(file) {
        let folder = file.parent;
        // A folder note belongs to the folder above its own
        if (folder && file.basename === folder.name) folder = folder.parent;
        while (folder && !folder.isRoot()) {
            const note = app.vault.getAbstractFileByPath(`${folder.path}/${folder.name}.md`);
            if (note && note !== file && this.isProjectOrArea(note)) return note;
            folder = folder.parent;
        }
        return null;
    }

    // Whether frontmatter makes the note an invoice: its tags include `invoice`, as the Invoice
    // command writes them and Billing finds invoices. Pure, so it's tested.
    isInvoice(front) {
        const raw = front?.tags ?? front?.tag ?? [];
        return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
            .some((t) => String(t ?? "").replace(/^#/, "").trim().toLowerCase() === "invoice");
    }

    // Exact #project or #area tag, in frontmatter or inline (same rule as AddTaskNote's menus)
    isProjectOrArea(note) {
        const c = app.metadataCache.getFileCache(note);
        if (!c) return false;
        const raw = c.frontmatter?.tags ?? c.frontmatter?.tag ?? [];
        return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
            .filter(Boolean)
            .map((t) => String(t).replace(/^#/, ""))
            .concat((c.tags ?? []).map((t) => t.tag.slice(1)))
            .some((t) => ["area", "project"].includes(t.toLowerCase()));
    }

    // Whether an existing area value (a "[[Link|Alias]]" string, or a list of them) already
    // points at the parent, so an alias or path difference alone doesn't cause a rewrite
    linksTo(value, file, parent) {
        const first = [].concat(value ?? [])[0];
        const match = typeof first === "string" && first.match(/\[\[([^\]|#]+)/);
        return !!match && app.metadataCache.getFirstLinkpathDest(match[1].trim(), file.path) === parent;
    }
}
