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

import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import type { AppFilterCounts } from "@/composables/rum/useAppFilterCounts";
import type { I18nText } from "@/types/i18n";
import type {
  FilterNotice,
  FilterValuesState,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import type { FieldSampleState } from "@/composables/rum/useFunnelFieldSample";
import type { FieldSample } from "@/utils/rum/funnelFields";
import type { FunnelResult, NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { FunnelCompareView } from "@/utils/rum/funnelCompare";
import type { FunnelDef, SampleRatio, StepRef } from "@/utils/rum/productAnalyticsQueries";

/** Everything a funnel layout renders; a layout reads these and never runs a query of its own. */
export interface FunnelLayoutProps {
  def: FunnelDef;
  result: FunnelResult | null;
  removed: (number | null)[];
  suggestions: { step: StepRef; units: number }[];
  suggestionsState: PanelState<unknown>;
  state: PanelState<unknown>;
  sampled: SampleRatio;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
  deletedNames?: Readonly<Record<string, string>>;
  unitLabel: I18nText;
  unitNoun: I18nText;
  hideTime: boolean;
  app: string;
  appFilters: AppFilterCounts | null;
  includeHidden: boolean;
  filterFields: readonly string[];
  filterFieldTypes?: Readonly<Record<string, string>>;
  filterValues: FilterValuesState;
  failed?: boolean;
  compare?: FunnelCompareView | null;
  /** The card shows the `trend` slot in place of the steps table. */
  trend?: boolean;
  /** Fields each step's events carry, for the step menus and Property rows. */
  fieldSample?: FieldSample | null;
  fieldSampleState?: FieldSampleState;
  filterNotice?: FilterNotice | null;
}

export interface FunnelLayoutEmits {
  "update:def": [FunnelDef];
  dropoff: [number];
  "suggestions-retry": [];
  "include-hidden": [];
  "hide-hidden": [];
  "edit-app-filters": [];
  "filter-values": [string];
  "load-fields": [];
  "break-down": [string];
  "break-down-step": [number];
}

/** A layout places the page's card header, its notices and its footer, so it decides where the card sits. */
export interface FunnelLayoutSlots {
  breakdown?: () => unknown;
  header?: () => unknown;
  actions?: () => unknown;
  notices?: () => unknown;
  trend?: () => unknown;
  footer?: () => unknown;
}
