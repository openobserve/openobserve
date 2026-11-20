import type { I18nText } from "@/types/i18n";

export interface OCollapsibleProps {
  /** Trigger title (13/500); the `#trigger` slot replaces it. */
  title?: I18nText;
  /** Short state on the trigger's end edge, such as "3 rules" or "none". */
  summary?: I18nText;
  /** Initial open state when `open` is not bound. */
  defaultOpen?: boolean;
  /** Controlled open state, bound with `v-model:open`. */
  open?: boolean;
  /** Items sharing a group name behave as an accordion: one open at a time. */
  group?: string;
  /** Remembers the open state in local storage under this key (N6). */
  persistKey?: string;
}

export interface OCollapsibleEmits {
  (e: "update:open", value: boolean): void;
  (e: "open"): void;
  (e: "opened"): void;
  (e: "close"): void;
  (e: "closed"): void;
}

export interface OCollapsibleSlots {
  default(): unknown;
  /** Custom trigger content in place of title and summary; the chevron stays. */
  trigger(props: { open: boolean }): unknown;
}
