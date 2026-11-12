#!/bin/zsh
# Tests one pull request at a time in the demo vault: the clone of this repository that this
# script lives in, opened in Obsidian as a vault of its own. Agents work in worktrees and commit
# on their branches; this puts a branch's commit into the demo vault, and takes it out again.
#
#   dev-vault.sh test <branch> [--plan <file>] [--issue OBS-N]
#       Checks the branch out (detached, since the agent's worktree holds the branch), records
#       which issue is being tested in `.dev-vault/testing`, puts Plainday in place (below) and
#       reloads it (or the vault, when a settings file changed), and copies the test plan to
#       `<ISSUE> Test Plan.md` at the vault root, opened in front. The issue comes from the branch
#       name (`obs-N`) or `--issue`.
#       Refused while another issue holds the lock, or while the tree has changes and `done`
#       hasn't run. The issue that holds the lock can run it again after a fix round. A commit
#       without manifest.json is refused: it's from before Plainday (OBS-226), and its class files
#       run only under CustomJS, which the dev vault doesn't run since OBS-257.
#   dev-vault.sh done
#       Restores every tracked file (reports rewritten on startup, tables reformatted by the
#       editor, synced event lines), removes the plan note and the lock, and returns to main,
#       pulled. Refused while `git status --porcelain` still prints anything. The reload it ends
#       with can set the startup report writing again, so it waits for the tree to settle and
#       restores once more: the next thing to read this clone is UpdateObsidianPM, which refuses
#       to install from a tree that isn't clean.
#   dev-vault.sh status
#       The lock, HEAD, whether Plainday is on, and what's changed.
#
# Plainday: the commit is built first, in .dev-vault/build/ (Obsidian skips folders whose names
# start with a dot, and npm never runs in the vault itself: plugin/preinstall.mjs), with `npm ci`
# only when the lockfile changed. A build that fails leaves the dev vault as it was. Then main.js
# and manifest.json go into .obsidian/plugins/plainday/, and Plainday is reloaded, or turned on if
# it was off.
#
# Every run installs the repository's pre-commit hook, which refuses a commit made from the demo
# vault: nothing here is checked for real data, and `done` restores it all. The hook is shared by
# every worktree, so it tells them apart by where it runs.
#
# Every CLI call names this vault, before the command: after the command, `vault=` is silently
# ignored and the command reaches whichever vault Obsidian picks.
set -uo pipefail

VAULT="$(cd "$(dirname "$0")/../.." && pwd)"
VAULT_NAME="$(basename "$VAULT")"
LOCK_DIR="$VAULT/.dev-vault"
LOCK="$LOCK_DIR/testing"
MAIN=main
HOOK_MARK="installed by dev-vault.sh"
BUILD="$LOCK_DIR/build"
PLUGINS="$VAULT/.obsidian/community-plugins.json"
PLAINDAY="$VAULT/.obsidian/plugins/plainday"
# The tests point these at stubs
OBSIDIAN="${OBSIDIAN_CLI:-$(command -v obsidian || echo /usr/local/bin/obsidian)}"
NPM="${NPM_CMD:-$(command -v npm || echo npm)}"
OPEN="${OPEN_CMD:-/usr/bin/open}"
WAIT="${OBSIDIAN_WAIT:-60}"   # seconds to wait for Obsidian to answer after opening the vault
SETTLE="${DEV_VAULT_SETTLE:-12}"   # seconds to watch for writes from the app after a reload

say() { print -r -- "$@"; }
die() { print -r -- "dev-vault: $*" >&2; exit 1; }
g() { git -C "$VAULT" "$@"; }
cli() { "$OBSIDIAN" vault="$VAULT_NAME" "$@"; }

# The demo vault is the clone's main working tree: there, the git dir is the common dir. In a
# linked worktree the two differ.
require_dev_vault() {
    [ -d "$VAULT/.git" ] || die "not the dev vault: $VAULT is not a clone's main working tree"
    [ "$(g rev-parse --git-dir)" = "$(g rev-parse --git-common-dir)" ] \
        || die "not the dev vault: $VAULT is a worktree; run the copy in the clone"
}

install_hook() {
    local hook
    hook="$(g rev-parse --path-format=absolute --git-path hooks)/pre-commit"
    if [ -f "$hook" ] && ! grep -q "$HOOK_MARK" "$hook"; then
        say "Note: a pre-commit hook of your own is in place, so the dev vault's isn't installed ($hook)"
        return 0
    fi
    mkdir -p "$(dirname "$hook")"
    cat > "$hook" <<'HOOK'
#!/bin/sh
# installed by dev-vault.sh: no commits from the demo vault. The clone's main working tree is
# the vault Obsidian opens for testing, where the scripts and the editor rewrite tracked notes and
# the calendar sync writes events, and nothing checks any of it. Commit from a worktree instead;
# `dev-vault.sh done` restores this tree. (--no-verify skips this, on purpose only.)
if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
    echo "dev-vault: no commits from the demo vault ($(pwd)); commit from a worktree" >&2
    exit 1
fi
HOOK
    chmod +x "$hook"
}

lock_value() { [ -f "$LOCK" ] && sed -n "s/^$1=//p" "$LOCK"; return 0; }
head_desc() {
    local b
    b="$(g symbolic-ref -q --short HEAD 2>/dev/null)"
    [ -n "$b" ] && say "$b" || say "detached at $(g rev-parse --short HEAD)"
}
changes() { g status --porcelain --untracked-files=all; }

# Does the CLI answer for this vault? Empty: not running, or the vault isn't open. Another path:
# the command would reach another vault.
answer() { cli vault info=path 2>/dev/null; }
reach_obsidian() {
    local got
    got="$(answer)"
    [ "$got" = "$VAULT" ] && return 0
    [ -n "$got" ] && die "the CLI reaches another vault ($got), not $VAULT; open the demo vault in Obsidian"
    say "Obsidian isn't answering for $VAULT_NAME; opening it"
    "$OPEN" -g "obsidian://open?vault=${VAULT_NAME// /%20}" 2>/dev/null || "$OPEN" -g -a Obsidian
    for _ in $(seq 1 "$WAIT"); do
        [ "$(answer)" = "$VAULT" ] && return 0
        sleep 1
    done
    die "Obsidian didn't answer for $VAULT_NAME within ${WAIT}s; open the demo vault and run this again"
}

# Does commit $1 have Plainday, manifest.json at the root? Every commit since OBS-226 does
has_plainday() { g cat-file -e "$1:manifest.json" 2>/dev/null; }
# Is the plugin on? Obsidian lists the plugins that are on in community-plugins.json
enabled() { [ -f "$PLUGINS" ] && grep -q "\"$1\"" "$PLUGINS"; }

# Builds Plainday from commit $1 in .dev-vault/build/tree, leaving main.js there. The tools
# (node_modules) stay between builds; `npm ci` runs again only when the lockfile changed.
build_plainday() {
    local tree="$BUILD/tree" lockfile
    mkdir -p "$tree" || return 1
    find "$tree" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + || return 1
    g archive "$1" | tar -x -C "$tree" || { say "Couldn't export $1 to build it"; return 1; }
    lockfile="$(g rev-parse "$1:package-lock.json" 2>/dev/null)"
    if [ ! -d "$tree/node_modules" ] || [ "$(cat "$BUILD/lockfile" 2>/dev/null)" != "$lockfile" ]; then
        say "Installing Plainday's build tools (npm ci)"
        rm -f "$BUILD/lockfile"
        if ! (cd "$tree" && "$NPM" ci --no-audit --no-fund) > "$BUILD/npm.log" 2>&1; then
            say "npm ci failed:"; tail -n 20 "$BUILD/npm.log"
            return 1
        fi
        print -r -- "$lockfile" > "$BUILD/lockfile"
    fi
    if ! (cd "$tree" && PLAINDAY_OUT= "$NPM" run --silent build) > "$BUILD/build.log" 2>&1 || [ ! -f "$tree/main.js" ]; then
        say "The build failed:"; tail -n 20 "$BUILD/build.log"
        return 1
    fi
    say "Built Plainday from $(g rev-parse --short "$1")"
}

# Copies the build build_plainday made into the plugin folder. Needs no Obsidian.
install_plainday() {
    mkdir -p "$PLAINDAY" || return 1
    cp "$BUILD/tree/main.js" "$BUILD/tree/manifest.json" "$PLAINDAY/" || return 1
    if [ -f "$BUILD/tree/styles.css" ]; then cp "$BUILD/tree/styles.css" "$PLAINDAY/"; else rm -f "$PLAINDAY/styles.css"; fi
}

# Obsidian saves which plugins are on a moment after the CLI answers, and a vault reloaded before
# then would read the old list. Waits up to 5 seconds for plugin $1 to be saved as $2 (on or off).
saved() {
    local i
    for i in {1..10}; do
        if [ "$2" = on ]; then enabled "$1" && return 0; else enabled "$1" || return 0; fi
        sleep 0.5
    done
    return 1
}

# Puts the Plainday that build_plainday built from HEAD in place, and reloads it, or the vault
# when a settings file changed; $1 is HEAD before the move. Best-effort: the tree is what matters,
# and the message says.
use_plugin() {
    install_plainday || { say "Couldn't copy Plainday into $PLAINDAY"; return 1; }
    local fresh=0
    if ! enabled plainday; then
        # Obsidian finds a plugin folder that's new since it started only once it rescans them
        cli eval code="app.plugins.loadManifests().then(() => !!app.plugins.manifests.plainday)" >/dev/null 2>&1
        if cli plugin:enable id=plainday filter=community >/dev/null 2>&1 && saved plainday on; then
            say "Turned Plainday on"
            fresh=1
        else
            say "Couldn't turn Plainday on; turn it on by hand"
            return 1
        fi
    fi
    if [ -n "$(g diff --name-only "$1" HEAD -- '.obsidian/*.json' '.obsidian/plugins/*/data.json')" ]; then
        cli reload >/dev/null 2>&1 && say "Reloaded the vault (settings changed)" || say "Couldn't reload the vault; reload it by hand"
    elif [ "$fresh" -eq 0 ]; then
        # Turning it on just now loaded this build already
        cli plugin:reload id=plainday >/dev/null 2>&1 && say "Reloaded Plainday" || say "Couldn't reload Plainday; reload it by hand"
    fi
}

cmd_test() {
    local branch="" plan="" issue=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --plan) plan="${2:-}"; shift 2 ;;
            --issue) issue="${2:-}"; shift 2 ;;
            -*) die "unknown option $1" ;;
            *) [ -z "$branch" ] && branch="$1" || die "one branch at a time"; shift ;;
        esac
    done
    [ -n "$branch" ] || die "usage: dev-vault.sh test <branch> [--plan <file>] [--issue OBS-N]"
    if [ -z "$issue" ]; then
        issue="$(print -r -- "$branch" | sed -n 's/.*[/-]obs-\([0-9][0-9]*\)\(-.*\)\{0,1\}$/OBS-\1/ip')"
        [ -n "$issue" ] || die "no obs-N in the branch name; say which issue with --issue OBS-N"
    fi
    issue="${issue:u}"
    [ -z "$plan" ] || [ -f "$plan" ] || die "no test plan at $plan"

    require_dev_vault
    install_hook

    local holder
    holder="$(lock_value issue)"
    if [ -n "$holder" ] && [ "$holder" != "$issue" ]; then
        die "$holder is being tested ($(lock_value branch), since $(lock_value since)); finish it with: dev-vault.sh done"
    fi
    if [ -z "$holder" ] && [ -n "$(changes)" ]; then
        die "the tree has changes and no test is in progress; run \`dev-vault.sh done\` to restore it, or look first:"$'\n'"$(changes)"
    fi

    g fetch -q origin 2>/dev/null || say "Couldn't fetch origin; using the local refs"
    local ref
    if g rev-parse -q --verify "refs/heads/$branch" >/dev/null; then ref="$branch"
    elif g rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null; then ref="origin/$branch"
    else die "no branch $branch here or on origin"
    fi
    # One commit for the build and the checkout, even if the branch moves while npm runs
    local sha
    sha="$(g rev-parse "${ref}^{commit}")" || die "couldn't read $ref"
    has_plainday "$sha" || die "$ref has no manifest.json: it's from before Plainday (OBS-226), and its class files run only under CustomJS, which the dev vault doesn't run any more (OBS-257). Rebase it on $MAIN to test it"

    reach_obsidian
    # Built before anything moves, so a build that fails leaves the dev vault as it was
    build_plainday "$sha" || die "couldn't build Plainday from $ref; the dev vault is unchanged"

    local before
    before="$(g rev-parse HEAD)"
    # A second round for the same issue: put the tracked notes back before moving HEAD
    [ -n "$holder" ] && { g checkout -q -- . || die "couldn't restore the tracked files"; }
    g checkout -q --detach "$sha" || die "couldn't check out $ref"
    local since
    since="$(lock_value since)"
    [ -n "$since" ] || since="$(date '+%Y-%m-%d %H:%M')"
    mkdir -p "$LOCK_DIR"
    printf 'issue=%s\nbranch=%s\ncommit=%s\nsince=%s\n' "$issue" "$branch" "$(g rev-parse --short HEAD)" "$since" > "$LOCK"

    use_plugin "$before"

    local note="$VAULT/$issue Test Plan.md"
    [ -n "$plan" ] && cp "$plan" "$note"
    if [ -f "$note" ]; then
        cli open path="$issue Test Plan.md" >/dev/null 2>&1 || say "Couldn't open the test plan; it's at $note"
    fi
    say "Testing $issue: $branch at $(g rev-parse --short HEAD) in $VAULT_NAME$([ -f "$note" ] && say ", test plan in front")"
}

# After a reload the app can still write: TimeReportOnStartup refreshes the reports once the vault
# is indexed, and an index rebuilt right after a checkout has been seen to give different numbers.
# Watches for `quiet` seconds of no change, restoring tracked files whenever they come back, so
# `done` leaves a tree that stays clean. Untracked files are left for the caller to judge.
settle() {
    local quiet=3 waited=0
    while [ "$waited" -lt "$SETTLE" ]; do
        sleep 1
        waited=$((waited + 1))
        if [ -n "$(g diff --name-only)" ]; then
            g checkout -q -- . 2>/dev/null
            quiet=3
        else
            quiet=$((quiet - 1))
            [ "$quiet" -le 0 ] && return 0
        fi
    done
    return 0
}

cmd_done() {
    require_dev_vault
    install_hook
    local issue
    issue="$(lock_value issue)"
    [ -n "$issue" ] || say "No test in progress; restoring the tree anyway"
    g checkout -q -- . || die "couldn't restore the tracked files"
    local left
    left="$(changes)"
    [ -z "$left" ] || die "the tree still has changes after restoring tracked files; deal with these first:"$'\n'"$left"
    rm -f "$VAULT"/*" Test Plan.md"(N)
    rm -f "$LOCK"
    rmdir "$LOCK_DIR" 2>/dev/null
    local before
    before="$(g rev-parse HEAD)"
    g checkout -q "$MAIN" || die "couldn't check out $MAIN"
    g pull -q --ff-only 2>/dev/null || say "Couldn't pull $MAIN; it's as it was"
    local built=1
    if ! build_plainday HEAD; then
        built=0
        say "Couldn't build Plainday from $MAIN, so the dev vault keeps the build it had"
    fi
    if [ "$(answer)" = "$VAULT" ]; then
        [ "$built" -eq 1 ] && use_plugin "$before"
        settle
    else
        # The build goes in anyway: Obsidian loads it when the vault next opens
        [ "$built" -eq 1 ] && install_plainday
        if ! enabled plainday; then
            say "Obsidian isn't answering for $VAULT_NAME, so Plainday wasn't turned on; open the dev vault and run \`dev-vault.sh done\` again"
        fi
    fi
    left="$(changes)"
    if [ -n "$left" ]; then
        say "Done${issue:+ with $issue}: $VAULT_NAME is on $MAIN at $(g rev-parse --short HEAD), but the app wrote again after the reload:"
        say "$left"
        say "Restore it with \`git -C \"$VAULT\" checkout -- .\` before installing from this clone."
        return 1
    fi
    say "Done${issue:+ with $issue}: $VAULT_NAME is on $MAIN at $(g rev-parse --short HEAD), clean"
}

cmd_status() {
    require_dev_vault
    install_hook
    local issue
    issue="$(lock_value issue)"
    if [ -n "$issue" ]; then say "Testing $issue: $(lock_value branch) (since $(lock_value since))"
    else say "No test in progress"
    fi
    say "HEAD: $(head_desc)"
    say "Plainday: $(enabled plainday && say on || say off)"
    local c
    c="$(changes)"
    if [ -n "$c" ]; then say "Changes:"; say "$c"; else say "Changes: none"; fi
}

case "${1:-}" in
    test) shift; cmd_test "$@" ;;
    done) cmd_done ;;
    status) cmd_status ;;
    *) die "usage: dev-vault.sh test <branch> [--plan <file>] [--issue OBS-N] | done | status" ;;
esac
