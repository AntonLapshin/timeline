import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

/** Button color treatments (compose the shared `.btn-*` classes in CSS). */
export type ButtonVariant = "primary" | "accent" | "ghost" | "danger" | "danger-solid";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  accent: "btn-accent",
  ghost: "btn-ghost",
  danger: "btn-danger",
  "danger-solid": "btn-danger-solid",
};

/** Button sizes. Fixed heights keep every inline control on one 32px rhythm. */
export type ButtonSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
  lg: "h-10 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Color treatment. Defaults to `"ghost"`. */
  variant?: ButtonVariant;
  /** Size treatment. Defaults to `"md"`. */
  size?: ButtonSize;
  /**
   * Square mode for single-icon buttons (arrows, Close, theme toggle, …).
   *
   * Applies the shared `.btn-square` footprint (32×32).
   */
  square?: boolean;
  /**
   * Loading state: renders a spinner before the children and disables the
   * button (`disabled` + `aria-busy="true"`).
   */
  loading?: boolean;
  /** Stretches the button to the full width of its container. */
  fullWidth?: boolean;
}

/**
 * Shared button. Compositional: `variant` picks the color treatment,
 * `size` the footprint, `square` a 32×32 icon footprint, `loading` a
 * spinner + disabled state, `fullWidth` a block layout.
 *
 * All other props (including `onClick`, `disabled`, `aria-*`) pass through
 * to the native `<button>`, `type` defaults to `"button"`, and `className`
 * is appended last so callers can extend the styles.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "ghost",
      size = "md",
      square = false,
      loading = false,
      fullWidth = false,
      disabled = false,
      className = "",
      type = "button",
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={loading || disabled}
        aria-busy={loading || undefined}
        className={
          `${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${square ? "btn-square" : ""} ${fullWidth ? "w-full" : ""} ${className}`.trim()
        }
        {...rest}
      >
        {loading && <Spinner size="sm" />}
        {children}
      </button>
    );
  },
);
