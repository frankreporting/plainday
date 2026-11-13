// Obsidian's lint (eslint-plugin-obsidianmd), the rules the community directory's scan runs on
// every release. `npm run lint` runs it from a worktree; CI runs it in the Plugin job. CLAUDE.md
// ("Lint") says what fails and what doesn't.
//
// - The rules: the recommended config, at its own levels. The four rules below are off because
//   the scan switches them off too, so CI never fails on something the directory doesn't check.
// - The files: the ones the scan reads. The scan reviews only what jsconfig.json includes
//   (OBS-265): Plainday's code in plugin/src/, the class files in plugin/src/classes/ among it,
//   and the Templater scripts in Config/Scripts/Templater/. This lint reads those and, as the
//   scan's ignores allow (the list at the end skips tests, .mjs files, build output and folders
//   named `scripts`; folder names match by case), the rest of Config/Scripts/, manifest.json,
//   package.json and LICENSE.
// - Type information (OBS-270): the scan reads every file jsconfig.json includes with it, so this
//   lint does too, and runs Obsidian's rules that need it (`no-unsupported-api` among them, which
//   fails a call to an API newer than the manifest's minAppVersion). Not typescript-eslint's own
//   type checks: the class files have no types, and the scan's `no-unsafe-*` warnings on them wait
//   until they do. Obsidian's types come from the `obsidian` package, pinned at its newest
//   version, since older types don't know the newer APIs.
// - The baseline: errors the class files and the Templater scripts had when this lint started
//   are in .github/ci/eslint-suppressions.json, which ESLint reads only where a command names it
//   with --suppressions-location (`npm run lint` and CI do). Not at the root, where ESLint would
//   read it on its own and the directory's scan stops on it (OBS-268). A new error fails, in any
//   file; so does an error that's fixed but still in the baseline, until `npm run lint:prune`
//   takes it out. Warnings never fail outside plugin/src/ (`npm run lint` passes
//   --max-warnings only for Plainday's own code, in a second run).
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
        rules: {
            // The class files read `customJS`, `app` and `Notice` as globals, which the bundle
            // provides
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
    globalIgnores([
        "main.js", "**/*.min.js", "node_modules", ".dev-vault", "dist", "build", ".obsidian", "**/.obsidian/**",
        "**/*.test.*", "**/test/**", "**/tests/**", "**/*.cjs", "**/*.mjs", "**/scripts/**", "**/docs/**",
    ]),
]);
