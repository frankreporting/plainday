// CI: a summary of Obsidian's lint for the Plugin job's page: the errors the baseline lets
// through, and the warnings by rule. Warnings never fail (CLAUDE.md, "Lint"); this is where
// their count shows.
//
//   npx eslint . --format json --output-file <file>
//   node .github/ci/lintSummary.mjs <file> >> "$GITHUB_STEP_SUMMARY"
import fs from "node:fs";
import path from "node:path";
import { BASELINE, ruleTotals } from "./checkBaseline.mjs";

// results: ESLint's JSON output; suppressions: the baseline's contents. Returns Markdown.
export function summary(results, suppressions) {
    const warnings = {};
    let errors = 0;
    for (const file of results) {
        for (const m of file.messages) {
            if (m.severity === 2) errors++;
            else if (m.severity === 1) warnings[m.ruleId ?? "(no rule)"] = (warnings[m.ruleId ?? "(no rule)"] ?? 0) + 1;
        }
    }
    const baseline = ruleTotals(suppressions);
    const sum = (t) => Object.values(t).reduce((a, n) => a + n, 0);
    const rows = (t) => Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([r, n]) => `| \`${r}\` | ${n} |`);
    const out = [
        "### Obsidian lint",
        "",
        `${results.length} files. ${errors ? `**${errors} errors not in the baseline.** ` : ""}${sum(baseline)} errors let through by the baseline (\`${BASELINE}\`), ${sum(warnings)} warnings.`,
    ];
    if (sum(warnings)) out.push("", "| Warnings by rule | Count |", "|---|---|", ...rows(warnings));
    if (sum(baseline)) out.push("", "| Baseline by rule | Errors |", "|---|---|", ...rows(baseline));
    return `${out.join("\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    // The lint step that follows says what went wrong
    if (!fs.existsSync(process.argv[2] ?? "")) {
        process.stdout.write("### Obsidian lint\n\nThe lint didn't run: see the next step.\n");
        process.exit(0);
    }
    const results = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const suppressions = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {};
    process.stdout.write(summary(results, suppressions));
}
