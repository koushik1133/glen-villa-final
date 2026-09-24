import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { uploadPostApiKey, uploadPostUser } from "@/lib/uploadpost/client";

export const dynamic = "force-dynamic";

interface DailyPoint {
  date: string;
  value: number;
}

interface TotalDayPoint {
  date: string;
  reach: number;
  views: number;
  total: number;
}

// In-memory cache to ensure instant tab responses
let cachedData: any = null;
let cacheExpiry = 0;

/**
 * Cross-channel performance for the analytics screens.
 *
 * `analytics.view`, which is what every other reporting surface takes. It had
 * no permission check, so the reach, follower and engagement numbers for every
 * connected account — the business performance the analytics permission exists
 * to fence off — were readable by any signed-in account.
 *
 * The responses are also marked `private`. They were `public, s-maxage=60`,
 * which invites a shared proxy or CDN to keep one account's answer and serve it
 * to the next caller; on a per-account response that is a cache-poisoning
 * disclosure, and `public` is never right for something behind a session.
 */
export async function GET(req: NextRequest) {
  const denied = await guard("analytics.view");
  if (denied) return denied;

  try {
    const key = uploadPostApiKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "Upload-Post API key is not configured in .env" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get("refresh") === "true";
    const requestedProfile = searchParams.get("profile") || uploadPostUser();
    // The screen's 7/30/90 toggle used to be decorative here: `days` was pinned
    // to 30, so switching range re-fetched the identical window.
    const days = [7, 30, 90].includes(Number(searchParams.get("days")))
      ? Number(searchParams.get("days"))
      : 30;

    const now = Date.now();
    if (!forceRefresh && cachedData && cachedData.profile === requestedProfile && cachedData.days === days && now < cacheExpiry) {
      return NextResponse.json(
        { ok: true, cached: true, ...cachedData },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const headers = { Authorization: `Apikey ${key}` };

    // Run users and analytics fetch in parallel
    let profiles: any[] = [];
    let activeProfileObj: any = null;
    let facebookPageId = "1368849489636077";
    let facebookPageName = "";
    const profileUsername = requestedProfile || "default";

    const analyticsUrl = `https://api.upload-post.com/api/analytics/${encodeURIComponent(
      profileUsername
    )}?platforms=instagram,facebook,linkedin,youtube&page_id=${encodeURIComponent(
      facebookPageId
    )}&days=${days}`;

    let rawAnalytics: any = {};
    /**
     * Non-null when the upstream call did not produce usable data. The numbers
     * on this screen are labelled "Live synced", so a failed fetch must reach
     * the UI as a failure — never as a plausible-looking constant.
     */
    let upstreamError: string | null = null;

    const [usersResult, analyticsResult] = await Promise.allSettled([
      fetch("https://api.upload-post.com/api/uploadposts/users", {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }),
      // Upload-Post aggregates four networks server-side and consistently takes
      // 7-9s for a 30-day window. The old 5s abort therefore fired on EVERY
      // request, which is why the chart was always empty while the tiles still
      // showed numbers — those were the hardcoded fallbacks below, not live data.
      fetch(analyticsUrl, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      }),
    ]);

    if (usersResult.status === "fulfilled" && usersResult.value.ok) {
      try {
        const usersJson = await usersResult.value.json();
        profiles = usersJson.profiles || [];
        activeProfileObj =
          profiles.find((p: any) => p.username.toLowerCase() === requestedProfile.toLowerCase()) ||
          profiles[0];
        if (activeProfileObj?.facebook_page_id) {
          facebookPageId = activeProfileObj.facebook_page_id;
        }
        if (activeProfileObj?.facebook_page_name) {
          facebookPageName = activeProfileObj.facebook_page_name;
        }
      } catch (e) {
        console.warn("Error parsing usersJson:", e);
      }
    }

    if (analyticsResult.status === "fulfilled" && analyticsResult.value.ok) {
      try {
        rawAnalytics = await analyticsResult.value.json();
      } catch (e) {
        upstreamError = `Could not parse the Upload-Post response: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else if (analyticsResult.status === "rejected") {
      const r = analyticsResult.reason;
      upstreamError =
        r?.name === "TimeoutError"
          ? "Upload-Post did not respond in time."
          : `Upload-Post request failed: ${r instanceof Error ? r.message : String(r)}`;
    } else {
      upstreamError = `Upload-Post returned HTTP ${analyticsResult.value.status}.`;
    }

    // 3. Process Instagram Data
    const rawIg = rawAnalytics.instagram || {};
    const igReachSeries: DailyPoint[] = Array.isArray(rawIg.reach_timeseries)
      ? rawIg.reach_timeseries
      : [];
    const instagram = {
      connected: Boolean(activeProfileObj?.social_accounts?.instagram),
      handle: activeProfileObj?.social_accounts?.instagram?.handle?.replace(/^@/, "") || "",
      displayName: activeProfileObj?.social_accounts?.instagram?.display_name || "",
      avatar: activeProfileObj?.social_accounts?.instagram?.social_images || null,
      followers: Number(rawIg.followers ?? 0),
      reach: Number(rawIg.reach ?? 0),
      views: Number(rawIg.views ?? rawIg.impressions ?? 0),
      accountsEngaged: Number(rawIg.accounts_engaged ?? rawIg.profileViews ?? 0),
      likes: Number(rawIg.likes ?? 0),
      comments: Number(rawIg.comments ?? 0),
      shares: Number(rawIg.shares ?? 0),
      saves: Number(rawIg.saves ?? 0),
      reachTimeseries: igReachSeries,
    };

    // 4. Process Facebook Data
    const rawFb = rawAnalytics.facebook || {};
    const fbReachSeries: DailyPoint[] = Array.isArray(rawFb.reach_timeseries)
      ? rawFb.reach_timeseries
      : [];
    const fbImpSeries: DailyPoint[] = Array.isArray(rawFb.impressions_timeseries)
      ? rawFb.impressions_timeseries
      : [];
    const facebook = {
      connected: Boolean(activeProfileObj?.social_accounts?.facebook),
      pageId: "61594222312601",
      pageName: facebookPageName,
      managerName: activeProfileObj?.social_accounts?.facebook?.display_name || "",
      handle: facebookPageName || "",
      avatar: activeProfileObj?.social_accounts?.facebook?.social_images || null,
      followers: Number(rawFb.followers ?? 0),
      reach: Number(rawFb.reach ?? 0),
      impressions: Number(rawFb.impressions ?? 0),
      profileViews: Number(rawFb.profileViews ?? 0),
      reachTimeseries: fbReachSeries,
      impressionsTimeseries: fbImpSeries,
    };

    // 5. Process YouTube Data
    const rawYt = rawAnalytics.youtube || {};
    const ytReachSeries: DailyPoint[] = Array.isArray(rawYt.reach_timeseries)
      ? rawYt.reach_timeseries
      : [];
    const youtube = {
      connected: Boolean(activeProfileObj?.social_accounts?.youtube),
      displayName: activeProfileObj?.social_accounts?.youtube?.display_name || "",
      handle: activeProfileObj?.social_accounts?.youtube?.handle || "",
      avatar: activeProfileObj?.social_accounts?.youtube?.social_images || null,
      followers: Number(rawYt.followers ?? 0),
      reach: Number(rawYt.reach ?? 0),
      views: Number(rawYt.impressions ?? 0),
      likes: Number(rawYt.likes ?? 0),
      comments: Number(rawYt.comments ?? 0),
      watchTimeMinutes: Number(rawYt.watch_time_minutes ?? 0),
      avgViewDurationSeconds: Number(rawYt.average_view_duration_seconds ?? 0),
      reachTimeseries: ytReachSeries,
    };

    // 6. Process LinkedIn Data
    const linkedin = {
      connected: Boolean(activeProfileObj?.social_accounts?.linkedin),
      displayName: activeProfileObj?.social_accounts?.linkedin?.display_name || "",
      handle: activeProfileObj?.social_accounts?.linkedin?.handle || "",
      avatar: activeProfileObj?.social_accounts?.linkedin?.social_images || null,
      isPersonalProfile: true,
      note:
        "LinkedIn only provides analytics for organization/company pages you administer, not personal profiles. This is a LinkedIn API limitation. Connect a LinkedIn page you manage to view its analytics.",
    };

    // 7. Compute Unified Total Reach / Views 30-Day Timeseries for Top Chart
    // Collect all dates from all series
    const dateMap = new Map<string, { reach: number; views: number }>();

    const mergeSeries = (series: DailyPoint[], isView = false) => {
      for (const pt of series) {
        if (!pt.date) continue;
        const cur = dateMap.get(pt.date) || { reach: 0, views: 0 };
        if (isView) {
          cur.views += pt.value;
        } else {
          cur.reach += pt.value;
        }
        dateMap.set(pt.date, cur);
      }
    };

    mergeSeries(igReachSeries);
    mergeSeries(fbReachSeries);
    if (fbImpSeries.length > 0) {
      mergeSeries(fbImpSeries, true);
    }
    mergeSeries(ytReachSeries);

    const sortedDates = Array.from(dateMap.keys()).sort();
    const totalTimeseries: TotalDayPoint[] = sortedDates.map((date) => {
      const d = dateMap.get(date)!;
      return {
        date,
        reach: d.reach,
        views: d.views > 0 ? d.views : d.reach,
        total: Math.max(d.reach, d.views),
      };
    });

    const responsePayload = {
      profile: profileUsername,
      profiles: profiles.map((p) => ({
        username: p.username,
        createdAt: p.created_at,
        facebookPageName: p.facebook_page_name,
      })),
      totalTimeseries,
      summary: {
        totalReach: instagram.reach + facebook.reach + youtube.reach,
        totalViews: instagram.views + facebook.impressions + youtube.views,
        totalLikes: instagram.likes + (facebook.followers ? 1 : 0) + youtube.likes,
        totalFollowers: instagram.followers + facebook.followers + youtube.followers,
      },
      platforms: {
        instagram,
        facebook,
        youtube,
        linkedin,
      },
      updatedAt: new Date().toISOString(),
      days,
      stale: upstreamError !== null,
      upstreamError,
    };

    // Never cache a failed fetch: doing so would keep a blank chart on screen
    // for a minute after the upstream recovered.
    if (!upstreamError) {
      cachedData = responsePayload;
      cacheExpiry = Date.now() + 60_000;
    }

    return NextResponse.json(
      { ok: true, cached: false, ...responsePayload },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
