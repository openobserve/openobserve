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

import { computed, inject, type ComputedRef, type InjectionKey } from "vue";
import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

export interface AiSectionTab {
  key: string;
  label: I18nText;
  icon: IconName;
  locked?: boolean;
  dataTest: string;
}

/** A tabbed rail item's own header: the same on every one of its tabs, as in Alerts. */
export interface AiSectionHeader {
  title: I18nText;
  subtitle: I18nText;
  icon: IconName;
}

export interface AiSectionTabsContext {
  /** The tabs of the current page's rail item; empty for a rail item of its own. */
  tabs: ComputedRef<AiSectionTab[]>;
  /** That rail item's header; null for a rail item of its own. */
  header: ComputedRef<AiSectionHeader | null>;
  active: ComputedRef<string>;
  open: (key: string | number) => void;
}

export const AI_SECTION_TABS: InjectionKey<AiSectionTabsContext> = Symbol("aiSectionTabs");

export function useAiSectionTabs() {
  const ctx = inject(AI_SECTION_TABS, null);
  const tabs = computed(() => {
    const all = ctx?.tabs.value ?? [];
    return all.length > 1 ? all : [];
  });
  const hasTabs = computed(() => tabs.value.length > 0);
  const header = computed(() => (hasTabs.value ? (ctx?.header.value ?? null) : null));
  return { ctx, tabs, hasTabs, header };
}
