// Timings for task lookups inside Obsidian (OBS-185). Run in a throwaway vault, never the dev vault:
//   obsidian vault=<it> eval code="eval(require('fs').readFileSync('<this file>','utf8'))"
// Returns JSON: note count, IDs, median ms for one lookup by `blocks` and by `listItems`, one full
// pass, whether `blocks` keys are lowercased, and whether IDs after ⭕ and ⋯ links are indexed.
(() => {
    const cache = app.metadataCache;
    const files = app.vault.getMarkdownFiles();
    const ids = [];
    for (const f of files) ids.push(...Object.keys(cache.getFileCache(f)?.blocks ?? {}));
    const step = Math.max(1, Math.floor(ids.length / 20));
    const sample = ids.filter((_, i) => i % step === 0).slice(0, 20);
    const byBlocks = (id) => { const o = []; for (const f of app.vault.getMarkdownFiles()) { const b = cache.getFileCache(f)?.blocks?.[id]; if (b) o.push([f.path, b.position.start.line]); } return o; };
    const byItems = (id) => { const o = []; for (const f of app.vault.getMarkdownFiles()) for (const li of cache.getFileCache(f)?.listItems ?? []) if (li.id === id) o.push([f.path, li.position.start.line]); return o; };
    const fullPass = () => { const m = new Map(); for (const f of app.vault.getMarkdownFiles()) for (const li of cache.getFileCache(f)?.listItems ?? []) if (li.id) { const k = li.id.toLowerCase(); if (!m.has(k)) m.set(k, []); m.get(k).push([f.path, li.position.start.line]); } return m; };
    const median = (fn, n) => { for (let i = 0; i < 3; i++) fn(); const t = []; for (let i = 0; i < n; i++) { const s = performance.now(); fn(); t.push(performance.now() - s); } t.sort((a, b) => a - b); return +t[Math.floor(n / 2)].toFixed(2); };
    const probe = cache.getFileCache(app.vault.getFileByPath("Reference/Planner/days/2026-10-16.md"));
    return JSON.stringify({
        notes: files.length, ids: ids.length,
        oneByBlocksMs: +(median(() => sample.forEach(byBlocks), 9) / sample.length).toFixed(2),
        oneByItemsMs: +(median(() => sample.forEach(byItems), 9) / sample.length).toFixed(2),
        fullPassMs: median(fullPass, 9),
        blockKeys: Object.keys(probe?.blocks ?? {}),
        afterLinksIndexed: probe?.listItems?.some((li) => li.id === "pr0be1") ?? false,
    });
})()
