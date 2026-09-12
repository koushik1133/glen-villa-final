"use strict";
/**
 * PROPERTY PRICING & NEGOTIATION
 *
 * Models the priced quotation sheet a builder hands a buyer — the thing that is
 * a spreadsheet today, reprinted on every round of negotiation.
 *
 * The requirement, in the client's own terms: a base rate per sft, then rows for
 * east-facing, corner, floor-rise (₹25/sft *per floor*), amenities, parking,
 * documentation, registration and GST — "at least 10 to 15 rows". Some rows are
 * charged per square foot and therefore differ per buyer; others are flat and
 * identical for everyone. During negotiation a component is waived or a rate
 * tweaked, and a *new sheet* is produced while the old one is kept beside it for
 * comparison.
 *
 * Two consequences drive this design:
 *  1. Calculation is a pure function of (component set + unit attributes +
 *     overrides). It never mutates a stored total.
 *  2. A negotiation produces a new immutable version. Nothing is overwritten,
 *     because "what did we offer him last week?" must always be answerable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_PRICING = exports.FACINGS = void 0;
exports.FACINGS = ["EAST", "WEST", "NORTH", "SOUTH", "NORTH_EAST", "NORTH_WEST", "SOUTH_EAST", "SOUTH_WEST"];
exports.EMPTY_PRICING = {
    pricingModels: [],
    pricingComponents: [],
    quotes: [],
    quoteVersions: [],
};
