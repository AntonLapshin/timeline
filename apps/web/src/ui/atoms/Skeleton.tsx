export interface SkeletonProps {
  /** Extra classes (sizing, rounding overrides, spacing). */
  className?: string;
}

/**
 * Loading placeholder using the shared `.skeleton` shimmer surface.
 *
 * Pure decoration (`aria-hidden`) — pair it with a real loading announcement
 * (e.g. `Spinner` with `role="status"`) where one is needed.
 */
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div aria-hidden="true" className={`skeleton ${className}`.trim()} />;
}
