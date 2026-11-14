import type { I18nText } from "@/types/i18n";
import type { ButtonSize } from "../Button/OButton.types";

export interface CopyButtonProps {
  /** What lands on the clipboard; a function is read at click time. */
  value: string | (() => string);
  /** Tooltip and aria-label ("Copy trace ID"); defaults to "Copy". */
  label?: I18nText;
  /** Match the host row: xs inside a field or row, sm in a panel header, md in a toolbar. */
  size?: Exclude<ButtonSize, "lg">;
  /** Renders the label as text ("Copy") instead of an icon-only button. */
  showLabel?: boolean;
  /** `secondary` only in toolbars. */
  variant?: "ghost" | "secondary";
}

export interface CopyButtonEmits {
  (e: "copied", value: string): void;
  (e: "failed", value: string): void;
}
