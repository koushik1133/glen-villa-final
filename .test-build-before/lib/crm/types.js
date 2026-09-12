"use strict";
/**
 * CRM domain — built for high-ticket real estate, where a "lead" is worth
 * ₹1.2 Cr to ₹25 Cr+, the sales cycle runs months, and the money arrives in
 * tranches (token → agreement → installments → registration) rather than once.
 *
 * That shape drives three decisions the rest of the module depends on:
 *  - Budget is a *range* per lead, not a number: buyers state a band, and the
 *    grid has to filter on overlap, not equality.
 *  - Contacts and leads are separate records. One HNWI buys three units over
 *    four years; their KYC, net-worth band and transaction history belong to the
 *    person, not to any single enquiry.
 *  - Follow-ups are generated from state, not typed by hand. A site visit or a
 *    paid token implies a known sequence of obligations with statutory-ish
 *    deadlines, and forgetting one is how deals die.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HNWI_LABELS = exports.KYC_LABELS = exports.BUDGET_BANDS = exports.SOURCE_LABELS = exports.LEAD_STATUSES = void 0;
exports.LEAD_STATUSES = [
    { id: "new", label: "New", color: "#8b8b95" },
    { id: "contacted", label: "Contacted", color: "#22d3ee" },
    { id: "site_visit_scheduled", label: "Site Visit Scheduled", color: "#a78bfa" },
    { id: "negotiation", label: "Negotiation", color: "#fbbf24" },
    { id: "booking_token_paid", label: "Booking Token Paid", color: "#f472b6" },
    { id: "won", label: "Won", color: "#34d399" },
    { id: "lost", label: "Lost", color: "#fb7185" },
];
exports.SOURCE_LABELS = {
    instagram: "Instagram",
    facebook: "Facebook",
    whatsapp: "WhatsApp",
    meta_ads: "Meta Ads",
    google_ads: "Google Ads",
    portal_99acres: "99acres",
    portal_magicbricks: "MagicBricks",
    portal_housing: "Housing.com",
    referral: "Referral",
    broker: "Broker",
    walk_in: "Walk-in",
    website: "Website",
    voice: "Voice agent",
};
/** Filter bands, in rupees. The floor matches the cheapest inventory. */
exports.BUDGET_BANDS = [
    { id: "1.2-3", label: "₹1.2 – 3 Cr", min: 1.2e7, max: 3e7 },
    { id: "3-5", label: "₹3 – 5 Cr", min: 3e7, max: 5e7 },
    { id: "5-10", label: "₹5 – 10 Cr", min: 5e7, max: 1e8 },
    { id: "10-25", label: "₹10 – 25 Cr", min: 1e8, max: 2.5e8 },
    { id: "25+", label: "₹25 Cr+", min: 2.5e8, max: Number.MAX_SAFE_INTEGER },
];
exports.KYC_LABELS = {
    not_started: "Not started",
    pending: "Pending",
    verified: "Verified",
    rejected: "Rejected",
};
exports.HNWI_LABELS = {
    none: "Standard",
    affluent: "Affluent",
    hnwi: "HNWI",
    uhnwi: "UHNWI",
};
