"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import CommandPalette from "@/components/osf/shell/CommandPalette";
import Sidebar from "@/components/osf/shell/Sidebar";
import Topbar from "@/components/osf/shell/Topbar";

/**
 * The application chrome, rendered once by the root layout.
 *
 * It lives in a client component so the sidebar can highlight the active route
 * and the palette can bind ⌘K, while every page underneath stays a Server
 * Component — `children` is passed through as an already-rendered tree, so
 * nothing here forces the pages into the client bundle.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Tapping a link in the drawer should reveal the page it opened, not leave
  // the drawer sitting over it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-[var(--color-line)] lg:block">
        <Sidebar />
      </aside>

      {/*
        Kept mounted so it can transition both ways; `inert` is what stops the
        off-screen links from staying in the tab order while it's closed.
      */}
      <div
        className={`fixed inset-0 z-50 lg:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
        inert={!drawerOpen}
      >
        <div
          aria-hidden
          onClick={closeDrawer}
          className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-[var(--color-line)] shadow-[0_0_60px_rgba(0,0,0,0.85)] transition-transform duration-200 ease-out ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close navigation"
            className="absolute right-3 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg text-[var(--color-faint)] transition hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
          <Sidebar onNavigate={closeDrawer} />
        </div>
      </div>

      <div className="lg:pl-64">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} onOpenDrawer={() => setDrawerOpen(true)} />
        <main className="mx-auto max-w-[1400px] p-6 lg:p-8">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
