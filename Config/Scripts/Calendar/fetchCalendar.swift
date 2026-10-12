// Reads macOS Calendar with EventKit and writes every calendar and event the Obsidian sync might
// want, as JSON, each event with its status and its Show As availability (busy or free). It makes no choices: which calendars count is ticked in the vault's Calendar Sync
// note, and the note lines are formatted by the SyncCalendar command. Keeping this dumb means a
// Google-API fetcher can produce the same file later without changing anything downstream.
//
//   swift fetchCalendar.swift [--days 183 | --months 6] [--out <events.json>]
//   swift fetchCalendar.swift --list          # calendars only, no events

import EventKit
import Foundation

func fail(_ message: String) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: ["error": message], options: [.sortedKeys])
    FileHandle.standardError.write(data)
    FileHandle.standardError.write("\n".data(using: .utf8)!)
    exit(2)
}

var args = Array(CommandLine.arguments.dropFirst())
var days = 183   // six months
var outPath: String?
var listOnly = false
while let arg = args.first {
    args.removeFirst()
    switch arg {
    case "--months":
        guard let value = args.first, let n = Int(value), n > 0, n <= 24 else { fail("--months needs a number from 1 to 24") }
        days = n * 31
        args.removeFirst()
    case "--days":
        guard let value = args.first, let n = Int(value), n > 0, n <= 750 else { fail("--days needs a number from 1 to 750") }
        days = n
        args.removeFirst()
    case "--out":
        guard let value = args.first else { fail("--out needs a path") }
        outPath = value
        args.removeFirst()
    case "--list": listOnly = true
    default: fail("unknown argument \(arg)")
    }
}

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var granted = false
var authError: String?
if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { ok, error in granted = ok; authError = error?.localizedDescription; semaphore.signal() }
} else {
    store.requestAccess(to: .event) { ok, error in granted = ok; authError = error?.localizedDescription; semaphore.signal() }
}
if semaphore.wait(timeout: .now() + 30) == .timedOut { fail("timed out waiting for calendar access") }
guard granted else { fail("no calendar access: \(authError ?? "denied in System Settings › Privacy & Security › Calendars")") }

let day = Calendar.current
let dateOnly = DateFormatter()
dateOnly.calendar = day
dateOnly.locale = Locale(identifier: "en_US_POSIX")
dateOnly.timeZone = .current
dateOnly.dateFormat = "yyyy-MM-dd"
let stamp = ISO8601DateFormatter()
stamp.formatOptions = [.withInternetDateTime]
stamp.timeZone = .current   // local wall-clock, which is what the daily notes use

func emit(_ payload: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    guard let path = outPath else {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
        exit(0)
    }
    // Write beside the target and move it into place, so a reader never sees half a file
    let tmp = path + ".tmp"
    guard FileManager.default.createFile(atPath: tmp, contents: data) else { fail("can't write \(tmp)") }
    do { _ = try FileManager.default.replaceItemAt(URL(fileURLWithPath: path), withItemAt: URL(fileURLWithPath: tmp)) }
    catch { fail("can't replace \(path): \(error.localizedDescription)") }
    exit(0)
}

// Every calendar, so the Calendar Sync note can list them all and mark new ones
let calendars = store.calendars(for: .event).sorted {
    ($0.source.title, $0.title) < ($1.source.title, $1.title)
}
let calendarList = calendars.map { calendar -> [String: Any] in
    [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "account": calendar.source.title,
        "subscribed": calendar.source.sourceType == .subscribed || calendar.source.sourceType == .birthdays,
    ]
}

if listOnly { emit(["generatedAt": stamp.string(from: Date()), "calendars": calendarList]) }

let windowStart = day.startOfDay(for: Date())
guard let lastDay = day.date(byAdding: .day, value: days, to: windowStart),
      let windowEnd = day.date(byAdding: .day, value: 1, to: day.startOfDay(for: lastDay)) else { fail("can't work out the window") }

let statusNames = ["none", "confirmed", "tentative", "canceled"]
// Show As in Calendar: whether the event takes your time. EKEventAvailability's notSupported (-1)
// is what Birthdays and subscribed calendars report; the sync treats it, and tentative, as busy
let availabilityNames = ["busy", "free", "tentative", "unavailable"]
// An event belongs to the day it starts on, so anything that began before today is already past
let events = store.events(matching: store.predicateForEvents(withStart: windowStart, end: windowEnd, calendars: calendars))
    .filter { $0.startDate >= windowStart && $0.startDate < windowEnd }
    .sorted { $0.startDate == $1.startDate ? ($0.title ?? "") < ($1.title ?? "") : $0.startDate < $1.startDate }
    .compactMap { event -> [String: Any]? in
        guard let id = event.eventIdentifier else { return nil }
        let date = dateOnly.string(from: event.startDate)
        // A repeating event's occurrences share one id, so the date tells them apart
        let key = event.hasRecurrenceRules ? "\(id)@\(dateOnly.string(from: event.occurrenceDate ?? event.startDate))" : id
        return [
            "key": key,
            "id": id,
            "calendarId": event.calendar.calendarIdentifier,
            "calendar": event.calendar.title,
            "account": event.calendar.source.title,
            "title": (event.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            "date": date,
            "start": stamp.string(from: event.startDate),
            "end": stamp.string(from: event.endDate),
            "endsSameDay": dateOnly.string(from: event.endDate) == date,
            "allDay": event.isAllDay,
            "recurring": event.hasRecurrenceRules,
            "status": statusNames[min(max(event.status.rawValue, 0), 3)],
            "availability": event.availability.rawValue < 0 ? "unknown" : availabilityNames[min(event.availability.rawValue, 3)],
        ]
    }

emit([
    "generatedAt": stamp.string(from: Date()),
    "source": "eventkit",
    "windowStart": dateOnly.string(from: windowStart),
    "windowEnd": dateOnly.string(from: lastDay),
    "calendars": calendarList,
    "events": events,
])
