import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { cleanup, isolate } from "./helpers";

const dir = isolate("site-visit-conversation");
after(() => cleanup(dir));

/* Imports must follow isolate() so the store points at the temp directory. */
const { read, mutate, resetToBootstrap } = require("../src/lib/db") as typeof import("../src/lib/db");
const { saveAvailability, slots, book, zonedDate, zonedInstant } =
  require("../src/lib/appointments/engine") as typeof import("../src/lib/appointments/engine");
const { DEFAULT_AVAILABILITY } = require("../src/lib/appointments/types") as typeof import("../src/lib/appointments/types");
const { parseVisitPreference, matchSlots } =
  require("../src/lib/ops/router") as typeof import("../src/lib/ops/router");
import type { AvailabilityConfig } from "../src/lib/appointments/types";

/**
 * "Can I come and see it on Saturday?"
 *
 * The engine's own rules are covered in appointments.test.ts. What these cover
 * is the conversation on top of it: the buyer names a day in their own words,
 * the desk is checked for real, and when that day is full they are offered
 * times that exist instead of being told "someone will call you".
 *
 * The failure this guards against is the expensive one — an assistant that
 * cheerfully agrees to a slot the calendar cannot honour, and a buyer who
 * arrives to find nobody expecting them.
 */

let BRAND = "";
const TZ = DEFAULT_AVAILABILITY.timezone;

before(() => {
  resetToBootstrap();
  BRAND = read().brands[0].id;
});

function configure(patch: Partial<AvailabilityConfig> = {}): AvailabilityConfig {
  const windows = [{ start: "10:00", end: "18:00" }];
  return saveAvailability({
    ...DEFAULT_AVAILABILITY,
    brandId: BRAND,
    openHours: { 0: windows, 1: windows, 2: windows, 3: windows, 4: windows, 5: windows, 6: windows },
    slotMinutes: 60,
    concurrentCapacity: 2,
    minNoticeHours: 0,
    maxAdvanceDays: 365,
    blackoutDates: [],
    ...patch,
  });
}

function clearAppointments(): void {
  mutate((d) => { d.appointments = []; });
}

/** The ISO instant of a whole hour, n days ahead, in the brand's zone. */
function at(daysAhead: number, hour: number): string {
  const day = new Date(Date.now() + daysAhead * 86400_000);
  return zonedInstant(zonedDate(day, TZ), hour * 60, TZ).toISOString();
}

/** Days ahead until the next occurrence of a weekday (0 = Sunday). */
function daysUntilWeekday(target: number): number {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() + i * 86400_000);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
    const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    if (idx === target) return i;
  }
  return 7;
}

/** Fill every slot on a given day, so the desk genuinely has no capacity. */
function fillDay(daysAhead: number): void {
  configure();
  for (let hour = 10; hour < 18; hour++) {
    for (let seat = 0; seat < 2; seat++) {
      book({
        brandId: BRAND,
        startsAt: at(daysAhead, hour),
        customerName: `Existing buyer ${hour}-${seat}`,
        customerPhone: `9199000${hour}${seat}0`,
        channel: "walk_in",
        createdBy: "test",
      });
    }
  }
}

describe("a buyer asking for a site visit in their own words", () => {
  test("the day and time are read out of ordinary phrasing", () => {
    const sat = parseVisitPreference("Can I book a site visit this Saturday at 11am?");
    assert.ok(sat, "Saturday 11am was not understood at all");
    assert.equal(sat.weekday, 6);
    assert.equal(sat.hour, 11);

    const tomorrow = parseVisitPreference("can i come tomorrow evening");
    assert.equal(tomorrow?.dayOffset, 1);
    assert.equal(tomorrow?.period, "evening");

    // Indian buyers write like this constantly; it must not be a special case.
    const hinglish = parseVisitPreference("kal shaam 5 baje aa sakta hoon?");
    assert.equal(hinglish?.dayOffset, 1, "kal (tomorrow) missed");
    assert.equal(hinglish?.period, "evening");
    // "5 baje" without am/pm means 5pm — nobody views a villa at 05:00.
    assert.equal(hinglish?.hour, 17);

    assert.equal(parseVisitPreference("what is the price?"), null, "a price question was read as a booking");
  });

  test("a free day offers times on that day, and only that day", () => {
    clearAppointments();
    configure();
    const ahead = daysUntilWeekday(6); // Saturday
    const open = slots(BRAND, new Date().toISOString(), 14);
    const matched = matchSlots(open, { weekday: 6 }, TZ);

    assert.ok(matched.length > 0, "Saturday is open but nothing was offered");
    for (const s of matched) {
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date(s.startsAt));
      assert.equal(wd, "Sat", `offered ${s.startsAt}, which is not a Saturday`);
    }
    assert.ok(ahead >= 1);
  });

  test("a full day offers nothing on that day — so the reply must fall back", () => {
    clearAppointments();
    const sat = daysUntilWeekday(6);
    fillDay(sat);

    const open = slots(BRAND, new Date().toISOString(), 14);
    const onSaturday = matchSlots(open, { weekday: 6 }, TZ).filter((s) => {
      const ymd = zonedDate(new Date(s.startsAt), TZ);
      return ymd === zonedDate(new Date(Date.now() + sat * 86400_000), TZ);
    });

    assert.equal(onSaturday.length, 0, "a fully booked Saturday still offered a slot");
    // The important half: there ARE other times, so the buyer can be given one
    // rather than being told a person will call them back.
    assert.ok(open.length > 0, "nothing anywhere — the fallback would have nothing to offer");
  });

  test("booking a slot that filled up returns real alternatives", () => {
    clearAppointments();
    configure();
    const target = at(2, 11);

    // Two other buyers take the only two seats at that hour.
    for (let i = 0; i < 2; i++) {
      const taken = book({
        brandId: BRAND, startsAt: target,
        customerName: `Buyer ${i}`, customerPhone: `91990001${i}`,
        channel: "walk_in", createdBy: "test",
      });
      assert.equal(taken.ok, true, "fixture booking failed");
    }

    const late = book({
      brandId: BRAND, startsAt: target,
      customerName: "Late buyer", customerPhone: "919900099",
      channel: "whatsapp", createdBy: "ai",
    });

    assert.equal(late.ok, false, "a third buyer got into a two-seat slot");
    assert.ok(late.alternatives && late.alternatives.length > 0,
      "the slot was refused with no alternative offered — this is the case that makes the assistant useless");
    for (const alt of late.alternatives!) {
      assert.notEqual(alt.startsAt, target, "offered back the slot that was just refused");
      assert.ok(alt.remaining > 0, "offered a slot with no capacity");
    }
  });

  test("a slot outside opening hours is never offered", () => {
    clearAppointments();
    configure({ openHours: { 0: [], 1: [{ start: "10:00", end: "18:00" }], 2: [], 3: [], 4: [], 5: [], 6: [] } });
    const open = slots(BRAND, new Date().toISOString(), 14);
    assert.ok(open.length > 0, "Monday is open but nothing was offered");
    for (const s of open) {
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date(s.startsAt));
      assert.equal(wd, "Mon", `offered ${s.startsAt} when only Monday is open`);
    }
    // And a Sunday request now genuinely has nothing, which is the branch that
    // must hand over to a person instead of inventing a time.
    assert.equal(matchSlots(open, { weekday: 0 }, TZ).length, 0);
  });

  test("a blacked-out date disappears from the offer", () => {
    clearAppointments();
    const ymd = zonedDate(new Date(Date.now() + 3 * 86400_000), TZ);
    configure({ blackoutDates: [ymd] });
    const open = slots(BRAND, new Date().toISOString(), 14);
    assert.equal(
      open.filter((s) => zonedDate(new Date(s.startsAt), TZ) === ymd).length,
      0,
      "a blacked-out day was still offered",
    );
  });
});
