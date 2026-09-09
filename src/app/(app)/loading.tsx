import { PageSkeleton } from "@/components/skeletons";

/**
 * Segment-wide navigation fallback.
 *
 * Every page under (app) is `force-dynamic`, so a nav click renders nothing at
 * all until the server finishes — on the heavier screens (/showcase, the
 * WhatsApp inbox, the ops workspaces) that read as a dead click. Six routes had
 * their own loading.tsx and the other thirty-odd had none; this covers the
 * remainder, and a nested loading.tsx still wins for its own subtree.
 */
export default function Loading() {
  return <PageSkeleton blocks={3} />;
}
