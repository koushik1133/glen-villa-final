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
  },
};

export default nextConfig;
