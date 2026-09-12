"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOLDS_SLOT = exports.SEED_NOTE = void 0;
exports.seedSiteVisitDesk = seedSiteVisitDesk;
exports.deskIsSeeded = deskIsSeeded;
const db_1 = require("../db");
const types_1 = require("./types");
Object.defineProperty(exports, "HOLDS_SLOT", { enumerable: true, get: function () { return types_1.HOLDS_SLOT; } });
const engine_1 = require("./engine");
const ids_1 = require("../ids");
/**
 * DEMO SEED — NOT LIVE CLIENT DATA.
 *
 * The site-visit desk works from an empty store: with no availability row saved,
 * `availabilityFor()` falls back to sensible opening hours, and the assistant
 * will happily offer and book slots. What an empty store cannot show is the
 * interesting half — a buyer asking for a day that is already full, and being
 * offered real alternatives instead of "someone will call you".
 *
 * So this writes an explicit availability window and a handful of bookings that
 * make the coming Saturday genuinely busy. Everything it creates is marked
 * `Sample booking` in its notes and `seed` as its creator, so neither a reader
 * of the screen nor a reader of this code can mistake it for a real visit.
 *
 * Applied only when the desk has no UPCOMING appointment. A visit that already
 * happened is history, not a commitment, and a desk whose only booking is in
 * the past is still an empty desk going forward — but a single real booking in
 * the future is enough to stop this touching anything.
 */
/** Whole hour, n days ahead, in the brand's own zone. */
function at(daysAhead, hour, tz) {
    const day = new Date(Date.now() + daysAhead * 86_400_000);
    return (0, engine_1.zonedInstant)((0, engine_1.zonedDate)(day, tz), hour * 60, tz).toISOString();
}
/** Days until the next occurrence of a weekday (0 = Sunday), never today. */
function daysUntilWeekday(target, tz) {
    for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() + i * 86_400_000);
        const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
        if (["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name) === target)
            return i;
    }
    return 7;
}
const SAMPLE_BUYERS = [
    "Ramesh Varma", "Sneha Reddy", "Imran Qureshi", "Lakshmi Prasad",
    "Arjun Nair", "Divya Rao", "Suresh Babu", "Anita Menon",
    "Vikram Shetty", "Kavitha Iyer",
];
exports.SEED_NOTE = "Sample booking — demonstration data, replace with real visits.";
/**
 * Give the brand an opening-hours row and a busy weekend, so the booking
 * conversation has something to push against. Returns the number created.
 */
function seedSiteVisitDesk(brandId, timezone) {
    const db = (0, db_1.read)();
    const now = Date.now();
    const upcoming = (db.appointments ?? []).some((a) => a.brandId === brandId && new Date(a.startsAt).getTime() >= now);
    if (upcoming)
        return 0;
    const tz = timezone || (0, engine_1.availabilityFor)(brandId).timezone || types_1.DEFAULT_AVAILABILITY.timezone;
    // An explicit row rather than the implicit default: the availability screen
    // should show what the desk actually promises, not a blank that happens to
    // behave correctly.
    (0, engine_1.saveAvailability)({ ...types_1.DEFAULT_AVAILABILITY, brandId, timezone: tz });
    const saturday = daysUntilWeekday(6, tz);
    const sunday = daysUntilWeekday(0, tz);
    const capacity = types_1.DEFAULT_AVAILABILITY.concurrentCapacity;
    const made = [];
    let n = 0;
    // Saturday: completely full, 10:00–18:00 at capacity. This is the day a buyer
    // is most likely to ask for, and the one the assistant must decline honestly.
    for (let hour = 10; hour < 18; hour++) {
        for (let seat = 0; seat < capacity; seat++) {
            made.push(sample(brandId, at(saturday, hour, tz), SAMPLE_BUYERS[n % SAMPLE_BUYERS.length], n));
            n += 1;
        }
    }
    // Sunday: half full, so the fallback has somewhere real to point.
    for (const hour of [11, 12, 15]) {
        made.push(sample(brandId, at(sunday, hour, tz), SAMPLE_BUYERS[n % SAMPLE_BUYERS.length], n));
        n += 1;
    }
    (0, db_1.mutate)((d) => {
        d.appointments = [...(d.appointments ?? []), ...made];
    });
    return made.length;
}
function sample(brandId, startsAt, name, i) {
    const now = new Date().toISOString();
    return {
        id: (0, ids_1.uid)("apt"),
        brandId,
        projectId: i % 2 === 0 ? "serenity" : "onyx",
        customerName: name,
        // Deliberately obvious placeholder range — never a number that could belong
        // to a real person who would then be reminded about a visit that is fiction.
        customerPhone: `9199000${String(1000 + i).slice(-4)}`,
        startsAt,
        durationMinutes: types_1.DEFAULT_AVAILABILITY.slotMinutes,
        status: "confirmed",
        channel: "walk_in",
        notes: exports.SEED_NOTE,
        createdBy: "seed",
        createdAt: now,
        updatedAt: now,
    };
}
/** True when this brand's desk is still showing seeded data only. */
function deskIsSeeded(brandId) {
    const now = Date.now();
    const list = ((0, db_1.read)().appointments ?? []).filter((a) => a.brandId === brandId && new Date(a.startsAt).getTime() >= now);
    return list.length > 0 && list.every((a) => a.notes === exports.SEED_NOTE);
}
