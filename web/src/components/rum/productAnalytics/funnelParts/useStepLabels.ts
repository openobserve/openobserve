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

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { StepKind, StepRef } from "@/utils/rum/productAnalyticsQueries";
import { stepLabel } from "@/utils/rum/productAnalyticsPanels";

const KIND_LABEL = {
  p: "rum.analytics.kind.page",
  c: "rum.analytics.kind.click",
  e: "rum.analytics.kind.event",
  r: "rum.analytics.kind.error",
} as const;
const KIND_VARIANT: Record<StepKind, BadgeVariant> = {
  p: "blue-soft",
  c: "teal-soft",
  e: "purple-soft",
  r: "error-soft",
};

/** How a funnel step is named and tagged, shared by every funnel part. */
export default function useStepLabels(
  events: () => NamedEvent[],
  eventsStatus: () => NamedEventsStatus,
  deletedNames: () => Readonly<Record<string, string>> = () => ({}),
) {
  const { t } = useI18nTyped();

  // With no list to name it, an event's id is opaque, so it stays neutral until the list is ready.
  const labelOf = (s: StepRef): I18nText =>
    s.kind === "e" && eventsStatus() !== "ready" && !events().some((e) => e.id === s.key)
      ? t("rum.analytics.events.unloadedStep")
      : raw(stepLabel(s, events(), deletedNames()));

  const kindLabel = (s: StepRef) => t(KIND_LABEL[s.kind]);

  const kindVariant = (s: StepRef): BadgeVariant => KIND_VARIANT[s.kind];

  const filterChips = (s: StepRef): I18nText[] => [
    ...(s.f?.minMs !== undefined
      ? [t("rum.analytics.funnel.filterOnPage", { seconds: s.f.minMs / 1000 })]
      : []),
    ...(s.f?.frustrated ? [t("rum.analytics.funnel.filterFrustratedTag")] : []),
    ...(s.f?.errored ? [t("rum.analytics.funnel.filterErroredTag")] : []),
    ...(s.f?.vc ?? []).map((c) =>
      c.t === "param"
        ? t("rum.analytics.funnel.condParamTag", {
            key: raw(c.key),
            values: raw(c.values.join(" | ")),
          })
        : t("rum.analytics.funnel.condRefTag", { values: raw(c.values.join(" | ")) }),
    ),
  ];

  return { labelOf, kindLabel, kindVariant, filterChips };
}
