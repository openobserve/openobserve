// Copyright 2026 OpenObserve Inc.

import type { InjectionKey } from "vue";

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

/** Provided by OSettingRowPair; a row inside one leaves the rule and padding to the pair. */
export const SETTING_ROW_PAIR_KEY: InjectionKey<true> = Symbol("SettingRowPair");
