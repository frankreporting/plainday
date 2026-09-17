// Picker for the parent area or project of a new note, called from the Area, Log, Project
// and Task templates as tp.user.pickParent(tp, keepFolder, prompt).
// Replaces dv.pages("#area or #project") with Obsidian's own metadata cache so the
// templates no longer need Dataview. Matches the exact tags #area and #project only
// (not nested tags like #project/sample), skips notes with `completed` set in
// frontmatter, and labels each note by its first alias or, failing that, its name.
// Resolves to the picked TFile, or null if the picker is dismissed.

const cacheOf = (f) => app.metadataCache.getFileCache(f);

// Frontmatter tags (list or comma/space-separated string) plus inline #tags, lowercased, no "#".
const tagsOf = (c) => {
    const raw = c.frontmatter?.tags ?? c.frontmatter?.tag ?? [];
    return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
        .filter(Boolean)
        .map((t) => String(t).replace(/^#/, ""))
        .concat((c.tags ?? []).map((t) => t.tag.slice(1)))
        .map((t) => t.toLowerCase());
};

const aliasOf = (f) => [].concat(cacheOf(f)?.frontmatter?.aliases ?? [])[0] || f.basename;

async function pickParent(tp, keepFolder, prompt) {
    // A command that already knows the parent hands it over for the one note it's creating, and the
    // menu is skipped for that note only (AddTaskNote, from the project linked on the task line)
    const preset = globalThis.customJS?.AddTaskNote?.takePresetParent?.(tp.config?.target_file?.path);
    if (preset) return preset;
    const candidates = app.vault.getMarkdownFiles()
        .filter((f) => {
            const c = cacheOf(f);
            return c
                && tagsOf(c).some((t) => t === "area" || t === "project")
                && keepFolder(f.parent.path)
                && !c.frontmatter?.completed;
        })
        .sort((a, b) => aliasOf(a).localeCompare(aliasOf(b)));
    return await tp.system.suggester(aliasOf, candidates, false, prompt);
}

module.exports = pickParent;
