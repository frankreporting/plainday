#!/bin/zsh
# Tests one pull request at a time in the demo vault: the clone of this repository that this
# script lives in, opened in Obsidian as a vault of its own. Agents work in worktrees and commit
# on their branches; this puts a branch's commit into the demo vault, and takes it out again.
#
#   dev-vault.sh test <branch> [--plan <file>] [--issue OBS-N]
#       Checks the branch out (detached, since the agent's worktree holds the branch), records
#       which issue is being tested in `.dev-vault/testing`, reloads CustomJS (or the vault, when
#       a settings file changed), and copies the test plan to `<ISSUE> Test Plan.md` at the vault
#       root, opened in front. The issue comes from the branch name (`obs-N`) or `--issue`.
#       Refused while another issue holds the lock, or while the tree has changes and `done`
#       hasn't run. The issue that holds the lock can run it again after a fix round.
#   dev-vault.sh done
#       Restores every tracked file (reports rewritten on startup, tables reformatted by the
#       editor, synced event lines), removes the plan note and the lock, and returns to main,
#       pulled. Refused while `git status --porcelain` still prints anything. The reload it ends
#       with can set the startup report writing again, so it waits for the tree to settle and
#       restores once more: the next thing to read this clone is UpdateObsidianPM, which refuses
#       to install from a tree that isn't clean.
#   dev-vault.sh status
#       The lock, HEAD, and what's changed.
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
# The tests point these at stubs
OBSIDIAN="${OBSIDIAN_CLI:-$(command -v obsidian || echo /usr/local/bin/obsidian)}"
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

# After moving HEAD from $1 to $2: a settings file changed needs the vault reloaded; otherwise
# CustomJS alone. Both are best-effort: the tree is what matters, and the message says.
reload() {
    if [ -n "$(g diff --name-only "$1" "$2" -- '.obsidian/*.json' '.obsidian/plugins/*/data.json')" ]; then
        cli reload >/dev/null 2>&1 && say "Reloaded the vault (settings changed)" || say "Couldn't reload the vault; reload it by hand"
    else
        cli plugin:reload id=customjs >/dev/null 2>&1 && say "Reloaded CustomJS" || say "Couldn't reload CustomJS; reload it by hand"
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

    reach_obsidian

    local before
    before="$(g rev-parse HEAD)"
    # A second round for the same issue: put the tracked notes back before moving HEAD
    [ -n "$holder" ] && { g checkout -q -- . || die "couldn't restore the tracked files"; }
    g checkout -q --detach "$ref" || die "couldn't check out $ref"
    local since
    since="$(lock_value since)"
    [ -n "$since" ] || since="$(date '+%Y-%m-%d %H:%M')"
    mkdir -p "$LOCK_DIR"
    printf 'issue=%s\nbranch=%s\ncommit=%s\nsince=%s\n' "$issue" "$branch" "$(g rev-parse --short HEAD)" "$since" > "$LOCK"

    reload "$before" HEAD

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
    if [ "$(answer)" = "$VAULT" ]; then
        reload "$before" HEAD
        settle
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
