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
  /** Explains the setting in a tooltip on an info icon after the label. */
  info?: I18nText;
  /** Appends the required marker to the label. */
  required?: boolean;
  /** The control takes the rest of the row, left-aligned, and the label sits at its first line: for wide or multi-line controls. */
  fill?: boolean;
  dataTest?: string;
}

export interface SettingRowSlots {
  /** The control on the right. */
  default?: () => unknown;
}

/** Provided by OSettingRowPair; a row inside one leaves the rule and padding to the pair. */
export const SETTING_ROW_PAIR_KEY: InjectionKey<true> = Symbol("SettingRowPair");

/** Provided by a form that sets rows directly on the page; a row inside one drops its rule and side padding. */
export const SETTING_ROW_BARE_KEY: InjectionKey<true> = Symbol("SettingRowBare");
