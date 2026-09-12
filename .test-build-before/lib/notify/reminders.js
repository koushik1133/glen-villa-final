"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDueReminders = sendDueReminders;
const db_1 = require("../db");
const engine_1 = require("../appointments/engine");
const index_1 = require("./index");
/**
 * 24h-before reminders. Runs inside the follow-up tick so it fires on the
 * cron, not on a page load.
 *
 * The appointment is marked reminded *before* the send. Two overlapping ticks
 * would otherwise both see it as due and the buyer would get the reminder
 * twice; a lost send is visible in the notification log and can be chased by
 * hand, a doubled one cannot be unsent. dueReminders() already excludes
 * cancelled, completed and no-show visits.
 */
async function sendDueReminders(withinHours = 24) {
    const result = { considered: 0, sent: 0, failed: 0 };
    for (const brand of (0, db_1.read)().brands) {
        for (const a of (0, engine_1.dueReminders)(brand.id, withinHours)) {
            result.considered += 1;
            (0, engine_1.markReminded)(a.id);
            const outcomes = await (0, index_1.notifyAppointment)({ ...a, reminderSentAt: new Date().toISOString() }, "reminder");
            if (outcomes.some((o) => o.ok))
                result.sent += 1;
            else
                result.failed += 1;
        }
    }
    return result;
}
