// Copyright 2026 OpenObserve Inc.

import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nText } from "@/types/i18n";

export interface ChoiceCardOption {
  value: string;
  label: I18nText;
  description?: I18nText;
  icon?: IconName;
  disabled?: boolean;
  dataTest?: string;
}

export interface ChoiceCardsProps {
  modelValue?: string;
  options: ChoiceCardOption[];
  /** Names the group for assistive technology. */
  label: I18nText;
  disabled?: boolean;
}

export interface ChoiceCardsEmits {
  (e: "update:modelValue", value: string): void;
}
