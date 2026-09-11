import { PageSkeleton } from "@/components/skeletons";

/**
 * A loading boundary INSIDE the workspace, below its layout.
 *
 * Two things follow from it. The second-level navigation stays on screen while
 * the next screen loads, so moving between the workspace's forty-odd pages no
 * longer blanks the chrome and reflows it back. And it gives the router a
 * boundary to prefetch up to: without one, hovering the nav asks the server to
 * render whole dynamic pages — each with its own database round-trips — for
 * screens nobody has opened yet.
 */
export default function Loading() {
  return <PageSkeleton blocks={4} />;
}
