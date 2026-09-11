import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { signInboundMedia } from "@/lib/osf/whatsapp/inbound-media";

/**
 * Read back one stored inbound file.
 *
 * The bucket is private — these are customers' identity documents and voice
 * recordings. Nothing here is served from a guessable public URL. Instead the
 * caller proves a permission, and only then is a short-lived signed URL minted
 * and redirected to.
 *
 * `customers.read` is the floor because that is what the surrounding
 * conversation view needs; anyone who may read the thread may read what was
 * sent in it.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const denied = await guard("customers.read");
  if (denied) return denied;

  const { path } = await ctx.params;
  const objectPath = path.join("/");

  // The stored path is `<leadId>/<timestamp>-<uuid>.<ext>`. Reject anything
  // that tries to climb out of it before it reaches the storage API.
  if (!objectPath || objectPath.includes("..") || objectPath.startsWith("/")) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }

  const url = await signInboundMedia(objectPath);
  if (!url) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Redirect rather than proxy: the bytes go straight from storage to the
  // browser, and a large voice note or video does not pass through this server.
  return NextResponse.redirect(url, { status: 307 });
}
