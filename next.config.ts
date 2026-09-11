import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A production build and a running `next dev` cannot share one output
  // directory: whichever finishes last wins, and the dev server then serves 500s
  // until it is restarted. `npm run build:check` sets this so bundle sizes can be
  // measured without disturbing a dev server that somebody is using.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Keep the build self-contained: this project lives inside a larger folder that
  // may hold other lockfiles, and Next otherwise guesses the wrong workspace root.
  // On Vercel, allow the standard build environment to manage outputFileTracingRoot.
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: __dirname }),

  experimental: {
    middlewareClientMaxBodySize: "500mb",
    serverActions: {
      bodySizeLimit: "500mb",
    },
    optimizePackageImports: ["lucide-react", "recharts", "date-fns", "motion", "zod"],
    /**
     * Let the client router hold a rendered screen for a few seconds.
     *
     * Every page in the WhatsApp workspace is `force-dynamic` against a
     * database roughly 200ms away, and the router's default for a dynamic
     * route is to keep nothing at all — so going Leads -> a lead -> back to
     * Leads re-rendered and re-queried the list every single time, and "All
     * leads" felt slow for no reason other than that the answer had been
     * thrown away a second earlier.
     *
     * This is only safe because writes already invalidate: the ports' mutating
     * routes call revalidatePath() for every affected screen, including the
     * dynamic lead segment. So an edit is still seen immediately; what is
     * cached is a screen nobody has changed. Thirty seconds is the window the
     * session cache already uses, and it is short enough that a change made in
     * another tab or by the agent surfaces quickly.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
