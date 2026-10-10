/** Spinner sizes. */
export type SpinnerSize = "xs" | "sm" | "md";

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-5 w-5",
};

export interface SpinnerProps {
  /** Size. Defaults to `"sm"`. */
  size?: SpinnerSize;
  /** Extra classes (e.g. color overrides). */
  className?: string;
}

/**
 * Indeterminate loading spinner (`role="status"`) with a screen-reader
 * "Loading…" announcement.
 *
 * Same circle + arc SVG treatment as the SmartInputBox submit spinner.
 */
export function Spinner({ size = "sm", className = "" }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className={`${SIZE_CLASSES[size]} animate-spin ${className}`.trim()}
      >
        <circle
          cx="8"
          cy="8"
          r="6.5"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="2"
        />
        <path
          d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">Loading…</span>
    </span>
  );
}
