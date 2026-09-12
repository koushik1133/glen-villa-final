"use strict";
/**
 * VOICE MODULE — store types.
 *
 * The voice agent is white-labelled: nothing in these records names the
 * provider, the model or the voice. `VoiceCallRecord` is the shape the client
 * UI reads, so provider cost lives here only for the admin diagnostics view and
 * is never serialised into the client-facing overview.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOICE_LANGUAGES = void 0;
exports.VOICE_LANGUAGES = ["Hindi", "English", "Telugu"];
