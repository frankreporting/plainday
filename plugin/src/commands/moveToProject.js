import { Notice } from "obsidian";
import { app, plainday } from "../host.js";

export default class MoveToProject {
    // Moves the note you're on into a project or area picked from the menu AddProjectLink uses, or, when
    // Notebook Navigator's pane has the focus, the notes selected there (rule 8):
    //   - a task note, a log (see AddTaskNote.isLog) or a plain note in `Projects` or the `Inbox`: the note
    //     says where it belongs, and its tasks follow (TaskChange, which asks, refuses and writes). A log goes
    //     into the project's `›logs`, made if missing. Several notes are each their own change, one after
    //     another, each with its own question. Picking the project a note is already in moves nothing and
    //     still writes its lines, which is how a note dragged by hand is put right.
    //   - a project or area's folder note: the whole folder, sub-projects and logs included. It's the same
    //     project at a new path, so its lines are left alone. It asks when it's the only thing moving, since
    //     its parent's totals and any rate it inherits change.
    //   - any other note, or a file that isn't a note: nothing, and the notice says why (stays).
    // Obsidian's move updates links, and SyncArea sets `parent`; this never writes `parent` itself. It refuses,
    // with a notice, a move whose target already has a note or folder of that name, and a folder into itself;
    // the menu leaves out the projects inside a folder being moved. MoveToProjectMenu puts the same move in
    // the file menus.
    async invoke() {
        const files = this.selected();
        if (!files.length) {
            new Notice("Open a note to move, or select notes in Notebook Navigator");
            return;
        }
        await this.move(files);
    }

    // What to move: Notebook Navigator's selected notes while its pane has the focus, else the note
    // you're on
    selected() {
        if (app.workspace.activeLeaf?.view?.getViewType?.() === "notebook-navigator") {
            const files = app.plugins.plugins["notebook-navigator"]?.api?.selection?.getCurrent?.()?.files ?? [];
            if (files.length) return files;
        }
        const file = app.workspace.getActiveFile();
        return file ? [file] : [];
    }

    // Why this command leaves `file`, a note or file (not a folder), where it is, or null when it doesn't
    stays(file) {
        const tasks = plainday.TaskIds;
        if (file.extension !== "md") return `${file.name} isn't a note, so it wasn't moved`;
        const kind = this.billingNote(file);
        if (kind) return `${file.basename} stays where it is: ${kind === "invoice" ? "an invoice" : "a timesheet"} belongs to the time report`;
        if (!tasks.inSystem(file)) return tasks.outside(file);
        return tasks.kindOf(file) !== "other" ? `${file.basename} stays where it is: run AddProjectLink on a line in it` : null;
    }

    // "invoice" or "timesheet" for a note the time report writes and reads wherever it is, else null
    billingNote(file) {
        const cache = app.metadataCache.getFileCache(file);
        const tags = cache ? plainday.AddTaskNote.tagsOf(cache) : [];
        return ["invoice", "timesheet"].find((t) => tags.includes(t)) ?? null;
    }

    // Whether any of `files` is something this command moves, for the file menus. A link's menu
    // offers it for notes only: a slip there shouldn't be one pick away from moving a whole project.
    movable(files, { homes = true } = {}) {
        return files.some((f) => {
            const item = this.itemFor(f);
            return item && !this.stays(item.note) && (homes || !item.home);
        });
    }

    // Moves `files` (notes, and projects or areas as their folders) into a project or area picked
    // from the menu
    async move(files) {
        const helper = plainday.AddTaskNote;
        if (!helper) return;
        const items = [];
        const told = [];
        const tell = () => { if (told.length) new Notice(told.join("\n")); };
        for (const f of files) {
            const item = this.itemFor(f);
            const stays = item ? this.stays(item.note) : null;
            if (!item) told.push(`${f.name} isn't a project or area folder, so it wasn't moved`);
            else if (stays) told.push(stays);
            else if (!items.some((i) => i.path === item.path)) items.push(item);
        }
        if (!items.length) return tell();
        if (!plainday.TaskChange.ready()) return;

        const folders = items.filter((i) => i.folder).map((i) => i.path);
        const label = items.length === 1 ? items[0].label : `${items.length} ${items.every((i) => !i.home) ? "notes" : "items"}`;
        // A project note without a folder of its own has nowhere to put a note, and a folder can't
        // go into itself
        const home = await helper.pickHome(label, {
            exclude: (f) => !this.isFolderNote(f) || this.inside(f.path, folders),
            placeholder: `Move "${label}" to which project or area? (Esc: cancel)`,
        });
        if (!home) {
            tell();
            return helper.cancelled();
        }

        const into = home.parent.path;
        const movedFolders = [], movedNotes = [], carried = new Map();
        for (const step of this.plan(items, into, (p) => this.exists(p), helper.logsFolder(home))) {
            if (step.skip === "inside") continue;
            if (step.skip && (step.folder || step.skip !== "here")) { told.push(this.why(step, home)); continue; }
            if (step.folder) {
                const result = await this.moveFolder(step, home, into, items.length === 1);
                if (result.cancelled) {
                    tell();
                    new Notice("Nothing was moved");
                    return;
                }
                if (result.told) told.push(result.told);
                if (result.moved) movedFolders.push(step);
                continue;
            }
            // A note of the same task went with an earlier change already
            if (carried.has(step.file)) {
                told.push(`${step.label} moved with ${carried.get(step.file)}`);
                continue;
            }
            const result = await this.moveNote(step, home, into);
            if (result.cancelled) {
                tell();
                if (movedNotes.length) new Notice(`Stopped there: ${movedNotes.join(", ")} had already moved`);
                return;
            }
            if (result.told) told.push(result.told);
            if (result.done && result.moved.length) movedNotes.push(step.label);
            for (const s of result.moved ?? []) if (s.note !== step.file) carried.set(s.note, step.label);
        }
        if (movedFolders.length) new Notice(this.summary(movedFolders, home));
        tell();
    }

    // One note's change (TaskChange), `here` when it's already in the project picked. The menus waited on
    // you, so it's checked again first.
    async moveNote(step, home, into) {
        const change = plainday.TaskChange;
        if (app.vault.getAbstractFileByPath(step.path) !== step.file || app.vault.getAbstractFileByPath(home.path) !== home || home.parent?.path !== into) {
            return { told: `${step.label} or ${home.basename} moved meanwhile, so ${step.label} wasn't moved` };
        }
        const here = step.skip === "here";
        const result = await change.run(await change.find({ note: step.file }), home, { here: here ? step.label : null, name: step.label });
        // A note tagged #project that isn't its folder's own is a plain note (rule 3)
        if (result.done && this.isHomeNote(step.file)) return { ...result, told: `${step.label} moved as a plain note: a project needs a folder of its name, with the note inside` };
        return result;
    }

    // One thing to move, or null for a folder that isn't a project or area's:
    //   { file, note (a project or area's own note), path, name, label, folder: it moves as its
    //     folder, home: it's a project or area, log, from: the project or area it's in now (for a
    //     project or area, the one above it), homeFolder: that one's folder }
    itemFor(f) {
        const helper = plainday.AddTaskNote;
        if (f.children) {
            const note = app.vault.getFileByPath(`${f.path}/${f.name}.md`);
            if (!note || !this.isHomeNote(note)) return null;
            const from = this.homeAbove(f);
            return { file: f, note, path: f.path, name: f.name, label: f.name, folder: true, home: true, log: false, from, homeFolder: from?.parent?.path ?? null };
        }
        if (this.isFolderNote(f)) return this.itemFor(f.parent);
        // Where it's filed, a finished project included: the question's From
        const from = helper.filedAbove(f);
        return { file: f, note: f, path: f.path, name: f.name, label: f.basename, folder: false, home: false, log: helper.isLog(f), from, homeFolder: from?.parent?.path ?? null };
    }

    // The project or area above `file` (a note, or a folder): the nearest folder note tagged
    // #project or #area, not finished, in the folders above it. Null outside any.
    homeAbove(file) {
        const helper = plainday.AddTaskNote;
        for (let dir = file.parent; dir && dir.path !== "/"; dir = dir.parent) {
            const note = app.vault.getFileByPath(`${dir.path}/${dir.name}.md`);
            if (note && note !== file && helper.isHome(note)) return note;
        }
        return null;
    }

    // A project or area's folder note (Folder/Folder.md, tagged exactly #project or #area),
    // finished or not: moving it moves its folder
    isFolderNote(file) {
        return file.extension === "md" && !!file.parent && file.basename === file.parent.name && this.isHomeNote(file);
    }

    isHomeNote(file) {
        const cache = app.metadataCache.getFileCache(file);
        return !!cache && plainday.AddTaskNote.tagsOf(cache).some((t) => t === "project" || t === "area");
    }

    // Whether `path` is inside any of `folders`
    inside(path, folders) {
        return folders.some((f) => path.startsWith(`${f}/`));
    }

    exists(path) {
        return !!(app.vault.getAbstractFileByPathInsensitive?.(path) ?? app.vault.getAbstractFileByPath(path));
    }

    // Where each of `items` goes in `into` (the picked project or area's folder; `logs` is its logs
    // folder, AddTaskNote.logsFolderIn), in order: [{ ...item, into, to, skip }]. `skip` is null
    // to move it, or why not:
    //   "inside": it's in a folder that's moving too, and goes along with it;
    //   "loop": a folder into itself or one of its own folders;
    //   "here": already there (a note already in that project or area, a log anywhere in its
    //     `›logs`, a folder already in that folder, anything already at the very path);
    //   "clash": something of that name is there already (`exists`, any case), or another item in
    //     this move is going there.
    plan(items, into, exists, logs = plainday.AddTaskNote.logsFolderIn(into)) {
        const folders = items.filter((i) => i.folder).map((i) => i.path);
        const parentOf = (path) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));
        const under = (path, folder) => path.toLowerCase().startsWith(`${folder.toLowerCase()}/`);
        const claimed = new Set();
        return items.map((item) => {
            const to = `${item.log ? logs : into}/${item.name}`;
            let skip = null;
            if (this.inside(item.path, folders.filter((f) => f !== item.path))) skip = "inside";
            else if (item.folder && (into === item.path || into.startsWith(`${item.path}/`))) skip = "loop";
            else if (to.toLowerCase() === item.path.toLowerCase()
                || (item.folder ? parentOf(item.path) === into : item.homeFolder === into && (!item.log || under(item.path, logs)))) skip = "here";
            else if (claimed.has(to.toLowerCase()) || exists(to)) skip = "clash";
            if (!skip) claimed.add(to.toLowerCase());
            return { ...item, into, to, skip };
        });
    }

    // The notice for a step `plan` skipped
    why(step, home) {
        const where = step.to.slice(0, step.to.lastIndexOf("/"));
        if (step.skip === "loop") return `${home.basename} is inside ${step.label}, so ${step.label} can't move there`;
        if (step.skip === "here") return `${step.label} is already in ${home.basename}`;
        return `${where} already has a ${step.folder ? "folder" : "note"} named ${step.label}, so it wasn't moved`;
    }

    // Moves a project or area's folder, asking first (when `ask`). Resolves to { moved, told, cancelled }.
    async moveFolder(step, home, into, ask) {
        const helper = plainday.AddTaskNote;
        const { file, from } = step;
        if (ask) {
            const choice = await helper.confirmMove(step.note, from, home);
            if (!choice) return { cancelled: true };
            if (choice === "leave") return { told: `${step.label} stays ${from ? `in ${from.basename}` : "where it is"}, so nothing changed` };
        }
        // The menus waited on you: check again
        if (app.vault.getAbstractFileByPath(step.path) !== file || app.vault.getAbstractFileByPath(home.path) !== home || home.parent?.path !== into) {
            return { told: `${step.label} or ${home.basename} moved meanwhile, so ${step.label} wasn't moved` };
        }
        if (this.exists(step.to)) return { told: this.why({ ...step, skip: "clash" }, home) };
        await app.fileManager.renameFile(file, step.to);
        return { moved: true };
    }

    // The notes that link `note`, other than itself
    linkingNotes(note) {
        return Object.entries(app.metadataCache.resolvedLinks ?? {})
            .filter(([path, links]) => path !== note.path && links?.[note.path])
            .map(([path]) => app.vault.getFileByPath(path))
            .filter((f) => f?.extension === "md");
    }

    // "2 lines now link ⭕ Pinecrest Library Brochure"
    linesNow(count, home) {
        const mark = plainday.AddTaskNote.isArea(home) ? "🗃️" : "⭕";
        return `${count === 1 ? "A line now links" : `${count} lines now link`} ${mark} ${home.basename}`;
    }

    // "Moved Kestrel with everything in it to Projects/Freelance", or for several, "Moved 2 folders to Freelance"
    summary(moved, home) {
        if (moved.length > 1) return `Moved ${moved.length} folders to ${home.basename}`;
        const [step] = moved;
        return `Moved ${step.label} with everything in it to ${step.to.slice(0, step.to.lastIndexOf("/"))}`;
    }
}
