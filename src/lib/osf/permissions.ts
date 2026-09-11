import { db } from "./supabase";

/**
 * Content permissions — reads/writes for /admin.
 *
 * Two independent policies live here: which channels are switched on at all,
 * and which uploaded assets the agent is allowed to hand a customer. Neither
 * of these performs any publishing — see supabase/migrations/0004_content_permissions.sql.
 */

export type CredentialStatus = "not_connected" | "connected" | "error";

export interface ChannelSetting {
  id: string;
  channel: string;
  enabled: boolean;
  credential_status: CredentialStatus;
  notes: string | null;
  updated_at: string;
}

export interface ShareableAsset {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  url: string;
  is_ai_generated: boolean;
  shareable_by_ai: boolean;
  created_at: string;
}

export async function channelSettings(): Promise<ChannelSetting[]> {
  const { data } = await db()
    .from("villa_channel_settings")
    .select("*")
    .order("channel", { ascending: true });
  return (data ?? []) as ChannelSetting[];
}

export async function setChannelEnabled(channel: string, enabled: boolean): Promise<void> {
  await db().from("villa_channel_settings").update({ enabled }).eq("channel", channel);
}

export async function shareableAssets(): Promise<ShareableAsset[]> {
  const { data } = await db()
    .from("villa_assets")
    .select("id, project_id, kind, title, url, is_ai_generated, shareable_by_ai, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as ShareableAsset[];
}

export async function setAssetShareable(id: string, shareable: boolean): Promise<void> {
  await db().from("villa_assets").update({ shareable_by_ai: shareable }).eq("id", id);
}
