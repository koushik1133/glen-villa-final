"use strict";
/**
 * SITE VISIT APPOINTMENTS
 *
 * A villa sale turns on getting the buyer onto the plot. Until now the CRM only
 * carried a `siteVisitAt` timestamp on the lead, auto-filled to "three days from
 * now" when someone moved the lead to `site_visit_scheduled` — a date nobody
 * chose, that nobody was told, and that nothing could double-book against.
 *
 * This models the real thing: bookable slots derived from configured opening
 * hours, a booking that holds one slot against one lead, and the state a visit
 * actually moves through.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AVAILABILITY = exports.HOLDS_SLOT = void 0;
/** Live statuses hold a slot; terminal ones release it. */
exports.HOLDS_SLOT = ["requested", "confirmed", "rescheduled"];
exports.DEFAULT_AVAILABILITY = {
    timezone: "Asia/Kolkata",
    openHours: {
        1: [{ start: "10:00", end: "18:00" }],
        2: [{ start: "10:00", end: "18:00" }],
        3: [{ start: "10:00", end: "18:00" }],
        4: [{ start: "10:00", end: "18:00" }],
        5: [{ start: "10:00", end: "18:00" }],
        6: [{ start: "10:00", end: "18:00" }],
        // Sunday is the day site visits actually happen for working buyers.
        0: [{ start: "11:00", end: "17:00" }],
    },
    slotMinutes: 60,
    concurrentCapacity: 2,
    minNoticeHours: 2,
    maxAdvanceDays: 45,
    blackoutDates: [],
};
