import { NextResponse } from "next/server";
import {
  channelSettings,
  setAssetShareable,
  setChannelEnabled,
  shareableAssets,
} from "@/lib/osf/permissions";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Handles both toggles on /admin. Each row is its own plain <form> — no
 * client JS — so this just flips one boolean and redirects back to the page,
 * which re-fetches fresh state as a server component.
 */
export async function POST(request: Request) {
  const denied = await guard("workflows.manage");
  if (denied) return denied;
  const form = await request.formData();
  const kind = form.get("kind");
  const id = form.get("id");

  if (typeof id === "string" && id.length > 0) {
    if (kind === "channel") {
      const current = (await channelSettings()).find((c) => c.channel === id);
      if (current) await setChannelEnabled(id, !current.enabled);
    } else if (kind === "asset") {
      const current = (await shareableAssets()).find((a) => a.id === id);
      if (current) await setAssetShareable(id, !current.shareable_by_ai);
    }
  }

  return NextResponse.redirect(new URL("/inbox/whatsapp/settings", request.url), { status: 303 });
}
