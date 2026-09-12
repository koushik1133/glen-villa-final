"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit = audit;
exports.notify = notify;
const db_1 = require("../db");
const ids_1 = require("../ids");
/**
 * AUDIT LOG — append-only.
 *
 * Nothing in the application updates or deletes an audit row; the only write
 * path is `audit()`. That is what makes it usable as evidence when someone asks
 * "who rejected this document, and when?" months later.
 *
 * Audit is deliberately separate from the user-facing activity feed: the feed is
 * curated and can be filtered, the audit log records everything.
 */
function audit(e) {
    const event = {
        id: (0, ids_1.uid)("aud"),
        orgId: e.orgId,
        actorId: e.actorId,
        actorType: e.actorType,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        customerId: e.customerId,
        metadata: e.metadata ?? {},
        createdAt: new Date().toISOString(),
    };
    (0, db_1.mutate)((db) => void db.auditEvents.push(event));
    return event;
}
function notify(n) {
    const notification = {
        id: (0, ids_1.uid)("ntf"),
        orgId: n.orgId,
        recipientId: n.recipientId,
        recipientRole: n.recipientRole,
        category: n.category,
        event: n.event,
        title: n.title,
        body: n.body,
        customerId: n.customerId,
        severity: n.severity ?? "INFO",
        read: false,
        createdAt: new Date().toISOString(),
    };
    (0, db_1.mutate)((db) => void db.opsNotifications.push(notification));
    return notification;
}
