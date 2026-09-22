import { forwardRef, type ButtonHTMLAttributes } from "react";

/** Button color treatments (compose the shared `.btn-*` classes in CSS). */
export type ButtonVariant = "primary" | "accent" | "ghost" | "danger";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  accent: "btn-accent",
  ghost: "btn-ghost",
  danger:
    "btn border border-red-200 bg-white text-red-700 shadow-sm hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/40",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Color treatment. Defaults to `"ghost"`. */
  variant?: ButtonVariant;
  /**
   * Square mode for single-icon buttons (arrows, Close, theme toggle, …).
   *
   * Renders a perfect 32×32 square (`h-8 w-8 p-0`) so every icon button in
   * the app shares one footprint.
   */
  square?: boolean;
}

/**
 * Shared button with a `"square"` variant for single-icon buttons.
 *
 * Compositional: `variant` picks the color treatment, `square` pins a
 * perfect-square footprint. All other props pass through to the native
 * `<button>`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "ghost", square = false, className = "", type = "button", ...rest },
    ref,
  ) {
    const squareClasses = square ? "btn-square h-8 w-8 shrink-0 !px-0" : "";
    return (
      <button
        ref={ref}
        type={type}
        className={`${VARIANT_CLASSES[variant]} ${squareClasses} ${className}`.trim()}
        {...rest}
      />
    );
  },
);
