import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps {
  /** Accessible name (rendered as `aria-label`). */
  label: string;
  /** The icon (decorative — the label provides the accessible name). */
  children: ReactNode;
  /** Color treatment. Defaults to `"ghost"`. */
  variant?: "ghost" | "primary";
  /** Click handler. */
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  /** Disables the button. */
  disabled?: boolean;
  /** Extra classes appended after the button classes. */
  className?: string;
  /** Button type. Defaults to `"button"`. */
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
}

/**
 * Single-icon button with the shared 40×40 `.btn-square` footprint.
 *
 * The icon is wrapped in an `aria-hidden` span; the `label` prop is the
 * accessible name.
 */
export function IconButton({
  label,
  children,
  variant = "ghost",
  onClick,
  disabled = false,
  className = "",
  type = "button",
}: IconButtonProps) {
  const variantClass = variant === "primary" ? "btn-primary" : "btn-ghost";
  return (
    <button
      type={type}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`${variantClass} btn-square ${className}`.trim()}
    >
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  );
}
