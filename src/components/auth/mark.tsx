import clsx from "clsx";
import { GlentreeTree } from "../brand/glentree-tree";

/**
 * The product mark on the sign-in screens.
 *
 * This was an abstract orbiting dot, which said nothing about who the product
 * belongs to. It is now the client's actual logo — the first screen anyone
 * sees is the wrong place to be generic. The orbit ring is kept behind it, so
 * the page keeps the motion it was designed around.
 */
export function GlentreeMark({ size = 52 }: { size?: number }) {
  return (
    <span className="auth-mark shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <span className="auth-mark-orbit" />
      <GlentreeTree size={Math.round(size * 0.56)} className="text-[color:var(--brand-tree)]" />
    </span>
  );
}

export function WordMark({ className }: { className?: string }) {
  return (
    <span className={clsx("font-semibold tracking-tight text-mist-100", className)}>Glentree</span>
  );
}
