import { NextResponse } from "next/server";
import { read, resolveBrandId } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { getSession, assertBrandAccess } from "@/lib/auth/session";
import { linkedinVersion } from "@/lib/platforms/others";

export const dynamic = "force-dynamic";

function linkedinHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": linkedinVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

/**
 * Turn a LinkedIn failure into something the person reading the screen can act
 * on. "LinkedIn API error (401)" tells them nothing; which of these it is
 * decides whether they reconnect, fix a URN, or simply wait.
 */
function describeFailure(status: number, body: string): { error: string; code: string } {
  if (status === 401) {
    return { code: "token_invalid", error: "LinkedIn rejected the access token. It has expired or been revoked — paste a fresh one." };
  }
  if (status === 403) {
    return { code: "forbidden", error: "The token is valid but lacks permission for this page. It needs r_organization_social for the organisation you are reading." };
  }
  if (status === 426) {
    return { code: "version_retired", error: `LinkedIn has retired API version ${linkedinVersion()}. Set LINKEDIN_API_VERSION to a current one.` };
  }
  if (status === 429) {
    return { code: "rate_limited", error: "LinkedIn is rate-limiting this app. The figures will return on their own." };
  }
  return { code: "api_error", error: `LinkedIn returned ${status}. ${body.slice(0, 160)}` };
}

export async function GET(req: Request) {
  const denied = await guard("analytics.view");
  if (denied) return denied;

  const url = new URL(req.url);
  const db = read();
  const brandId = resolveBrandId(db, url.searchParams.get("brandId"));

  // Validate the authenticated user belongs to this brand
  const session = await getSession();
  if (session) {
    try {
      assertBrandAccess(session, brandId);
    } catch {
      return NextResponse.json({ ok: false, error: "Brand not found or access denied." }, { status: 403 });
    }
  }
  
  const conn = db.connections.find(
    (c) => c.brandId === brandId && c.channel === "linkedin" && c.status !== "disconnected"
  );

  if (!conn || !conn.accessToken) {
    return NextResponse.json({
      ok: false,
      error: "No LinkedIn connection with access token found",
      code: "no_token",
      handle: conn?.handle || "LinkedIn",
    });
  }

  const token = conn.accessToken;
  const authorUrn = conn.externalId?.startsWith("urn:li:") 
    ? conn.externalId 
    : process.env.LINKEDIN_ORG_URN;

  if (!authorUrn) {
    return NextResponse.json({
      ok: false,
      error: "No valid LinkedIn URN found. Please configure your Organization or Author URN.",
      code: "no_urn",
      handle: conn.handle,
    });
  }

  // LinkedIn pins every request to a monthly version and retires each after
  // roughly a year. The publishing path already reads LINKEDIN_API_VERSION;
  // this route had the same string frozen inline, so bumping the variable fixed
  // publishing and left this page failing with a 426 nobody would connect to it.
  const headers = linkedinHeaders(token);

  try {
    const postsUrl = `https://api.linkedin.com/rest/posts?author=${encodeURIComponent(authorUrn)}&q=author&count=20&fields=id,commentary,createdAt,lastModifiedAt,visibility`;
    const postsRes = await fetch(postsUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!postsRes.ok) {
      const errText = await postsRes.text().catch(() => "");
      const { error, code } = describeFailure(postsRes.status, errText || postsRes.statusText);
      return NextResponse.json({ ok: false, error, code, handle: conn.handle });
    }

    const postsData = await postsRes.json();
    const elements = postsData.elements || [];

    const posts = await Promise.all(elements.map(async (post: any) => {
      let likes = 0;
      let comments = 0;
      let shares = 0;
      
      try {
        const actionsUrl = `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(post.id)}`;
        const actionsRes = await fetch(actionsUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (actionsRes.ok) {
          const actionsData = await actionsRes.json();
          likes = actionsData.likesSummary?.totalLikes || 0;
          comments = actionsData.commentsSummary?.totalFirstDegreeComments || 0;
          shares = actionsData.sharesSummary?.totalShares || 0;
        }
      } catch {
        // Ignore social action fetch errors per post
      }

      return {
        id: post.id,
        text: post.commentary || "",
        publishedAt: new Date(post.createdAt).toISOString(),
        visibility: post.visibility || "PUBLIC",
        metrics: {
          likes,
          comments,
          shares,
          // Not measured here. Impressions come from
          // organizationalEntityShareStatistics, which needs an organisation
          // URN and r_organization_social; this endpoint returns engagement
          // only. It reported a hardcoded 0, which the page rendered as
          // "0 impressions" — a measurement, and a wrong one. null means
          // "not measured", and the UI omits it instead of inventing a figure.
          impressions: null as number | null,
        }
      };
    }));

    return NextResponse.json({
      ok: true,
      posts,
      handle: conn.handle,
      authorUrn,
      connectionId: conn.id,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : "Failed to connect to LinkedIn API",
      code: "network_error",
      handle: conn.handle,
    });
  }
}

export async function POST(req: Request) {
  const denied = await guard("marketing.publish");
  if (denied) return denied;

  const url = new URL(req.url);
  const db = read();
  const brandId = resolveBrandId(db, url.searchParams.get("brandId"));

  const session = await getSession();
  if (session) {
    try {
      assertBrandAccess(session, brandId);
    } catch {
      return NextResponse.json({ ok: false, error: "Brand not found or access denied." }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const { accessToken, authorUrn, handle } = body;

  if (!accessToken && !authorUrn) {
    return NextResponse.json({ ok: false, error: "Please provide an Access Token or Author/Page URN." }, { status: 400 });
  }

  /**
   * Check the token with LinkedIn before storing it.
   *
   * This route used to accept whatever was pasted, write it, and set the
   * connection to "connected". A token with a truncated tail or a stray space
   * therefore produced a channel the whole application believed was live —
   * the badge said connected, the publish queue would pick it up — and the only
   * symptom was an error on one panel. Verifying here means "connected" is a
   * statement about LinkedIn, not about the shape of the string.
   */
  if (accessToken?.trim()) {
    try {
      const probe = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: linkedinHeaders(accessToken.trim()),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (probe.status === 401) {
        return NextResponse.json(
          { ok: false, error: "LinkedIn rejected that access token. Check it was copied in full and has not expired." },
          { status: 422 },
        );
      }
      // 403 means the token is real but scoped narrowly — that is a legitimate
      // page token, so it is stored. Anything else (5xx, a timeout) is
      // LinkedIn being unreachable, and refusing to save then would strand
      // someone holding a perfectly good token.
    } catch {
      // Network failure reaching LinkedIn — fall through and store it.
    }
  }

  const { mutate } = await import("@/lib/db");
  mutate((draft) => {
    let conn = draft.connections.find(
      (c) => c.brandId === brandId && c.channel === "linkedin"
    );
    if (!conn) {
      const newConn: import("@/lib/types").Connection = {
        id: `con_${Date.now()}`,
        brandId,
        channel: "linkedin",
        handle: handle?.trim() || "LinkedIn Account",
        externalId: authorUrn?.trim() || `urn:li:organization:${Date.now()}`,
        status: "connected",
        followers: 0,
        scopes: ["w_organization_social", "r_organization_social"],
        avatarColor: "#0077b5",
        connectedAt: new Date().toISOString(),
      };
      draft.connections.push(newConn);
      conn = newConn;
    }
    if (accessToken) conn.accessToken = accessToken.trim();
    if (authorUrn) conn.externalId = authorUrn.trim();
    if (handle) conn.handle = handle.trim();
    conn.status = "connected";
    conn.lastSyncedAt = new Date().toISOString();
  });

  return NextResponse.json({ ok: true });
}
