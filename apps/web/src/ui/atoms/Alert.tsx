import type { ComponentType, ReactNode } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

/** Alert tones. `error` announces assertively, the rest politely. */
export type AlertTone = "error" | "info" | "success";

interface ToneConfig {
  container: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  iconColor: string;
}

const TONE_CONFIG: Record<AlertTone, ToneConfig> = {
  error: {
    container:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
    icon: ExclamationTriangleIcon,
    iconColor: "text-red-500 dark:text-red-400",
  },
  info: {
    container:
      "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-400/20 dark:bg-brand-400/10 dark:text-brand-200",
    icon: InformationCircleIcon,
    iconColor: "text-brand-500 dark:text-brand-300",
  },
  success: {
    container:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200",
    icon: CheckCircleIcon,
    iconColor: "text-emerald-500 dark:text-emerald-400",
  },
};

export interface AlertProps {
  /** Tone: `error` renders with `role="alert"`, `info`/`success` with `role="status"`. */
  tone: AlertTone;
  /** Optional bolded title line. */
  title?: ReactNode;
  /** Alert body. */
  children: ReactNode;
  /** Extra classes appended after the alert classes. */
  className?: string;
}

/**
 * Inline feedback message with a tone icon.
 *
 * Assertive for errors (`role="alert"`), polite for info/success
 * (`role="status"`).
 */
export function Alert({ tone, title, children, className = "" }: AlertProps) {
  const config = TONE_CONFIG[tone];
  const Icon = config.icon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${config.container} ${className}`.trim()}
    >
      <Icon aria-hidden="true" className={`h-5 w-5 shrink-0 ${config.iconColor}`} />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
