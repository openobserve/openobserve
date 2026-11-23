// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

export interface SettingRowProps {
  /** The setting's name. */
  label: I18nText;
  /** One line saying what the setting does or what a special value means. */
  description?: I18nText;
  /** Renders the row muted and is forwarded to nothing — the control owns its own disabled state. */
  disabled?: boolean;
  dataTest?: string;
  /** Selector of the printed error; defaults to `<dataTest>-error`. */
  errorDataTest?: string;
  /** Replaces the control with one static placeholder while the value is pending. */
  loading?: boolean;
  /** Field path in the enclosing OForm; the row prints that field's error where the description sits. */
  name?: string;
  /** An error to print where the description sits, for pages without OForm. Wins over `name`. */
  error?: I18nText;
  /** `"end"` pins a fixed control column to the row's end and lets the label grow. Default `"label"`. */
  controlAt?: "label" | "end";
}

export interface SettingRowSlots {
  /** The control on the right. `describedBy` is the shown error's id, for a control wrapped in other markup. */
  default?: (_props: { describedBy: string | undefined }) => unknown;
  /** Rich help in place of the `description` text; an error still takes its place. */
  description?: () => unknown;
}
