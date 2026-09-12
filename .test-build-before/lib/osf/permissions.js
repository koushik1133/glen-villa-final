"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.channelSettings = channelSettings;
exports.setChannelEnabled = setChannelEnabled;
exports.shareableAssets = shareableAssets;
exports.setAssetShareable = setAssetShareable;
const supabase_1 = require("./supabase");
async function channelSettings() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_channel_settings")
        .select("*")
        .order("channel", { ascending: true });
    return (data ?? []);
}
async function setChannelEnabled(channel, enabled) {
    await (0, supabase_1.db)().from("villa_channel_settings").update({ enabled }).eq("channel", channel);
}
async function shareableAssets() {
    const { data } = await (0, supabase_1.db)()
        .from("villa_assets")
        .select("id, project_id, kind, title, url, is_ai_generated, shareable_by_ai, created_at")
        .order("created_at", { ascending: false });
    return (data ?? []);
}
async function setAssetShareable(id, shareable) {
    await (0, supabase_1.db)().from("villa_assets").update({ shareable_by_ai: shareable }).eq("id", id);
}
