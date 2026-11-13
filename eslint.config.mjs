// Obsidian's lint (eslint-plugin-obsidianmd), the rules the community directory's scan runs on
// every release. `npm run lint` runs it from a worktree; CI runs it in the Plugin job. CLAUDE.md
// ("Lint") says what fails and what doesn't.
//
// - The rules: the recommended config, at its own levels. The four rules below are off because
//   the scan switches them off too, so CI never fails on something the directory doesn't check.
// - The files: the ones the scan reads. The scan reviews only what jsconfig.json includes
//   (OBS-265): Plainday's code in plugin/src/, the class files in its commands/, startup/ and
//   shared/ among it, and the Templater scripts in Config/Scripts/Templater/. This lint reads those and, as the
//   scan's ignores allow (the list at the end skips tests, .mjs files, build output and folders
//   named `scripts`; folder names match by case), the rest of Config/Scripts/, manifest.json,
//   package.json and LICENSE.
// - Type information (OBS-270): the scan reads every file jsconfig.json includes with it, so this
//   lint does too, and runs Obsidian's rules that need it (`no-unsupported-api` among them, which
//   fails a call to an API newer than the manifest's minAppVersion). The class files reach Obsidian
//   through typed imports (OBS-271), so the rule sees their calls too. typescript-eslint's own type
//   checks run only on Plainday's own files (plugin/src/main.js, host.js and the three indexes),
//   at warn, where lint's second run fails on any: the class files have no types, and the scan's
//   `no-unsafe-*` warnings on them wait until they do. Obsidian's types come from the `obsidian`
//   package, pinned at its newest version, since older types don't know the newer APIs.
// - Globals: `no-undef` at the recommended level (warn) in plugin/src/, whose files import what
//   they use; off elsewhere, where the Templater scripts read Templater's globals.
// - The baseline: errors the class files and the Templater scripts had when this lint started
//   are in .github/ci/eslint-suppressions.json, which ESLint reads only where a command names it
//   with --suppressions-location (`npm run lint` and CI do). Not at the root, where ESLint would
//   read it on its own and the directory's scan stops on it (OBS-268). A new error fails, in any
//   file; so does an error that's fixed but still in the baseline, until `npm run lint:prune`
//   takes it out. Warnings never fail in the class files or outside plugin/src/ (`npm run lint`
//   passes --max-warnings only for Plainday's own code, in a second run).
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

// typescript-eslint's type-checked rules, at warn, as the scan runs them
const warn = (rules) => Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v === "off" || v === 0 ? v : Array.isArray(v) ? ["warn", ...v.slice(1)] : "warn"]));
const typeChecked = warn(Object.assign({}, ...tseslint.configs.recommendedTypeChecked.map((c) => c.rules ?? {})));

export default defineConfig([
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
        rules: {
            // The Templater scripts read Templater's globals (`tp`, `app`); plugin/src/ turns it
            // back on below
            "no-undef": "off",
            "import/no-unresolved": "off",
            // Plainday's command ids are set (OBS-226) and never change
            "obsidianmd/commands/no-command-in-command-id": "off",
            "obsidianmd/commands/no-plugin-id-in-command-id": "off",
        },
    },
    {
        // What jsconfig.json includes, with type information, as the scan reads it
        files: ["plugin/src/**/*.js", "Config/Scripts/Templater/**/*.js"],
        languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
        rules: { ...obsidianmd.ruleConfigs.recommendedTypeChecked },
    },
    {
        // Plainday's code imports what it uses
        files: ["plugin/src/**/*.js"],
        rules: { "no-undef": "warn" },
    },
    {
        // Plainday's own files, which have types: typescript-eslint's type checks, which lint's
        // second run fails on
        files: ["plugin/src/*.js", "plugin/src/*/index.js"],
        rules: typeChecked,
    },
    globalIgnores([
        "main.js", "**/*.min.js", "node_modules", ".dev-vault", "dist", "build", ".obsidian", "**/.obsidian/**",
        "**/*.test.*", "**/test/**", "**/tests/**", "**/*.cjs", "**/*.mjs", "**/scripts/**", "**/docs/**",
    ]),
]);
