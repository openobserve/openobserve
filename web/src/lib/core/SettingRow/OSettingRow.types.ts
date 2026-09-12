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
}

export interface SettingRowSlots {
  /** The control on the right. */
  default?: () => unknown;
}
