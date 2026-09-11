import type { Metadata } from "next";
import AppShell from "./layout-shell";

export const metadata: Metadata = {
  title: "Sales OS — Glentree",
  description:
    "AI sales agent, CRM, marketing studio and revenue intelligence for Glentree.",
};

/**
 * The ported villa-os-f module.
 *
 * It keeps its own chrome and its own Supabase project, so it gets its own
 * route group rather than being folded into the `(app)` shell — nothing here
 * can affect a page outside `/os`, and nothing outside can restyle these.
 *
 * `osf-root` scopes the module's dark-luxury palette. The source app set those
 * colours on `html, body` globally, which would have repainted every Villa-os
 * screen; here they apply only inside this subtree.
 *
 * Access is Villa-os's: middleware requires a session and `page-access.ts`
 * requires a permission before this layout ever renders. The module's own
 * Supabase RBAC is not in play, which is why it reads through the service-role
 * client rather than a per-viewer one.
 */
export default function OsfLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="osf-root min-h-screen">
      <AppShell>{children}</AppShell>
    </div>
  );
}
