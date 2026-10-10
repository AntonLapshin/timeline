export interface DividerProps {
  /** Extra classes appended after the divider classes. */
  className?: string;
}

/**
 * Hairline horizontal divider, subtly translucent in both themes.
 */
export function Divider({ className = "" }: DividerProps) {
  return <hr className={`border-slate-200/80 dark:border-slate-700/60 ${className}`.trim()} />;
}
