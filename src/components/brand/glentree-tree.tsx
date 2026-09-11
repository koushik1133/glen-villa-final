/**
 * The Glentree mark.
 *
 * Inline rather than an <img> so it takes its colour from `currentColor` and
 * therefore follows the theme, and so it costs no extra request on a screen
 * that already draws it in the sidebar on every page.
 *
 * The geometry is the client's own logo: four branch tiers over a trunk that
 * stays visible between them. Square caps and near-whole coordinates keep the
 * branch ends on the pixel grid, which is what stops it turning to mush at the
 * 22px the sidebar draws it at.
 */
export function GlentreeTree({
  size = 24,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Pass a title only where the mark is the sole label; otherwise decorative. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <path d="M32 9V57" />
        <path d="M20.5 25L32 11.5L43.5 25" />
        <path d="M16.5 34.5L32 18L47.5 34.5" />
        <path d="M12.5 44L32 24.5L51.5 44" />
        <path d="M8.5 53.5L32 31L55.5 53.5" />
      </g>
    </svg>
  );
}
