"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import clsx from "clsx";
import { NAV_GROUPS, activeHref } from "@/components/osf/shell/nav-config";

/**
 * Second-level navigation for the WhatsApp workspace.
 *
 * Two rows rather than one: the workspace carries around forty screens, which
 * is far too many for a single strip, and a vertical rail would be a second
 * sidebar beside the app's own. The first row picks a section, the second
 * lists that section's screens — the same shape as the tab strip used
 * elsewhere in the dashboard, so it reads as part of this product rather than
 * as something bolted on.
 */
export function WorkspaceNav() {
  const pathname = usePathname();
  const active = useMemo(() => activeHref(pathname), [pathname]);

  // The group holding the current page, so the second row is never empty and
  // never shows a section the reader is not in.
  const group =
    NAV_GROUPS.find((g) => g.items.some((i) => i.href === active)) ?? NAV_GROUPS[0];

  return (
    <div className="border-b border-ink-700/70 bg-ink-900/40">
      <div className="flex flex-wrap items-center gap-1 px-6 pt-4">
        {NAV_GROUPS.map((g) => {
          const current = g.label === group.label;
          // Link to the group's first screen — a group is a heading, not a page.
          const target = g.items[0]?.href ?? "/inbox/whatsapp";
          return (
            <Link
              key={g.label}
              href={target}
              aria-current={current ? "page" : undefined}
              className={clsx(
                "rounded-full px-3 py-1.5 text-[12.5px] font-medium transition",
                current
                  ? "bg-ink-700 text-mist-100"
                  : "text-mist-400 hover:bg-ink-800 hover:text-mist-200",
              )}
            >
              {g.label}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 px-6 pb-3 pt-2">
        {group.items.map((item) => {
          const current = item.href === active;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition",
                current
                  ? "bg-ink-800 text-mist-100"
                  : "text-mist-400 hover:bg-ink-800/60 hover:text-mist-200",
              )}
            >
              <Icon size={13} strokeWidth={1.75} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
