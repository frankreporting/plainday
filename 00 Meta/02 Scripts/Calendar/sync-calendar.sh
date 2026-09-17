#!/bin/zsh
# Keeps the daily notes' calendar events current: by hand, or on a schedule from launchd.
#
# Obsidian does the work. Its *Calendar sync* command reads this Mac's calendars and writes the
# events into the daily notes, using Obsidian's own calendar permission. A process launchd starts
# has no calendar permission of its own, so fetching here only works when someone has granted it
# in System Settings; it's kept as a fallback, which at least refreshes the events file for the
# phone. When Obsidian isn't running, this opens it in the background (--no-launch to skip that).
#
#   sync-calendar.sh [--no-launch] [months]   sync now (months only matters for the fallback fetch)
#   sync-calendar.sh on | off | status        the launchd schedule (7:15am, 12:15pm, 5:15pm, 9:15pm)
#
# Log: ~/Library/Logs/calendar-sync.log (where launchd sends this script's output).
set -uo pipefail

VAULT="$(cd "$(dirname "$0")/../../.." && pwd)"
FETCH="$VAULT/00 Meta/02 Scripts/Calendar/fetchCalendar.swift"
EVENTS="$VAULT/00 Meta/02 Scripts/Calendar/calendar-events.json"
# The launchd job: the first *calendar-sync.plist in LaunchAgents, and the label inside it
PLIST="${CALENDAR_SYNC_PLIST:-$(print -r -- "$HOME"/Library/LaunchAgents/*calendar-sync.plist(N[1]))}"
LABEL="$([ -n "$PLIST" ] && [ -f "$PLIST" ] && /usr/bin/plutil -extract Label raw -o - "$PLIST" 2>/dev/null)"
LOG="$HOME/Library/Logs/calendar-sync.log"
# The tests point these at stubs
OBSIDIAN="${OBSIDIAN_CLI:-$(command -v obsidian || echo /usr/local/bin/obsidian)}"
OPEN="${OPEN_CMD:-/usr/bin/open}"
LAUNCHCTL="${LAUNCHCTL_CMD:-/bin/launchctl}"
SWIFT="${SWIFT_CMD:-/usr/bin/swift}"
JQ="${JQ_CMD:-/opt/homebrew/bin/jq}"
WAIT="${OBSIDIAN_WAIT:-60}"   # seconds to wait for Obsidian to answer after opening it

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
# The CLI only answers while the app is running
running() { "$OBSIDIAN" vault info=path >/dev/null 2>&1; }
sync_now() { "$OBSIDIAN" command id=customjs:invoke-CalendarSync >/dev/null 2>&1; }

schedule() {
    case "$1" in
        on)
            [ -n "$PLIST" ] && [ -f "$PLIST" ] || { print -r -- "No schedule to turn on: no *calendar-sync.plist in ~/Library/LaunchAgents"; return 1; }
            "$LAUNCHCTL" bootstrap "gui/$UID" "$PLIST" 2>/dev/null
            ;;
        off)
            "$LAUNCHCTL" bootout "gui/$UID/$LABEL" 2>/dev/null
            ;;
    esac
    if [ -n "$LABEL" ] && "$LAUNCHCTL" list "$LABEL" >/dev/null 2>&1; then
        print -r -- "Scheduled sync: on — 7:15am, 12:15pm, 5:15pm, 9:15pm"
        local exited
        exited="$("$LAUNCHCTL" list "$LABEL" 2>/dev/null | sed -n 's/.*"LastExitStatus" = \([0-9]*\).*/\1/p')"
        # launchctl reports the raw wait status, so 1 comes back as 256
        [ -n "$exited" ] && [ "$exited" -ge 256 ] && exited=$((exited / 256))
        [ -n "$exited" ] && print -r -- "Last run exited $exited"
    else
        print -r -- "Scheduled sync: off — turn it on with: \"$0\" on"
    fi
    [ -f "$LOG" ] && print -r -- "Last log line: $(tail -n 1 "$LOG")"
    return 0
}

case "${1:-}" in
    on|off|status) schedule "$1"; exit $? ;;
esac

LAUNCH=1
[ "${1:-}" = "--no-launch" ] && { LAUNCH=0; shift; }
MONTHS="${1:-6}"

if running; then
    sync_now && { log "Obsidian synced the calendar"; exit 0; }
    log "Obsidian is running but the sync command failed; falling back to a fetch"
elif [ "$LAUNCH" -eq 1 ]; then
    log "Obsidian isn't running — opening it in the background"
    "$OPEN" -g -a Obsidian
    for _ in $(seq 1 "$WAIT"); do
        running && break
        sleep 1
    done
    if running && sync_now; then
        log "Obsidian synced the calendar"
        exit 0
    fi
    log "Obsidian didn't answer within ${WAIT}s; falling back to a fetch"
fi

# Fallback: refresh the events file, so the phone has it and Obsidian applies it next time
if "$SWIFT" "$FETCH" --months "$MONTHS" --out "$EVENTS"; then
    log "fetched $("$JQ" '.events | length' "$EVENTS" 2>/dev/null || echo '?') events into $EVENTS; Obsidian will apply them when it next syncs"
    exit 0
fi
log "couldn't reach Obsidian, and the fetch failed — a scheduled run has no calendar permission of its own (grant it in System Settings › Privacy & Security › Calendars, or let this open Obsidian)"
exit 1
