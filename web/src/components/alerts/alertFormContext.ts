// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { ComputedRef, InjectionKey, Ref, ShallowRef } from "vue";
import type { I18nText } from "@/types/i18n";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { AlertSectionId } from "./alertFormSections";

/** A message for a row's message line: amber when `warning`, with an optional fix. */
export interface AlertLineNote {
  text: I18nText;
  action?: I18nText | null;
  warning?: boolean;
  run?: () => void;
  dataTest: string;
}

/** Step 2's threshold row as a starter sentence reuses it: unit, message line and change handlers. */
export interface ThresholdGuide {
  unit: ComputedRef<I18nText | "">;
  note: ComputedRef<AlertLineNote | null | undefined>;
  help: ComputedRef<I18nText>;
  operators: ComputedRef<SelectOption[]>;
  spanDuration: ComputedRef<boolean>;
  durationUnit: Ref<string>;
  durationUnits: ComputedRef<SelectOption[]>;
  setDurationUnit(unit: SelectModelValue): void;
  /** Runs step 2's own handler for a threshold or operator path, so both fields write alike. */
  change(path: string, value: unknown): void;
}

/** Page-level facts and moves the sectioned alert editor offers its step components. */
export interface AlertFormContext {
  isEditing: ComputedRef<boolean>;
  showAll: Ref<boolean>;
  goToSection(id: AlertSectionId): void;
  /** Scrolls an element inside the form into view. */
  reveal(el: HTMLElement): void;
  /** Shows a setting even from under More options, scrolls to it and focuses it. */
  openSetting?(id: string): Promise<void>;
  /** What the schedule says about the condition, shown in the condition row's message line. */
  conditionNote?: Ref<AlertLineNote | null>;
  /** Filled by step 2 once it mounts. */
  thresholdGuide?: ShallowRef<ThresholdGuide | null>;
  /** The preview's verdict at the latest window: how many groups would fire now. */
  previewStatus?: ComputedRef<{
    wouldTrigger: boolean;
    count?: number;
    atLeast?: boolean;
    grouped?: boolean;
  } | null>;
}

export const ALERT_FORM_CONTEXT_KEY: InjectionKey<AlertFormContext> = Symbol("alertFormContext");
