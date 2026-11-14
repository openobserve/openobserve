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

import { raw, type I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";

/** One usage figure as the usage tabs compute it. */
export interface UsageKpi {
  key: string;
  label: I18nText;
  icon: IconName;
  value: I18nText;
  hint?: I18nText;
  /** A figure the value replaced, such as the pre-discount amount. */
  struck?: I18nText;
  /** A small figure that qualifies the value, such as the share a saving represents. */
  valueSuffix?: I18nText;
  /** Good news for the reader, such as a saving. */
  positive?: boolean;
  /** Bad news for the reader, such as spend near or past a budget; wins over `positive`. */
  tone?: "warn" | "danger";
}

const EM_DASH = "—";

/** Maps usage figures onto stat tiles; "—" is an unknown value, never text. */
export function usageKpiStats(cards: UsageKpi[], dataTestPrefix: string): StatItem[] {
  return cards.map((card) => {
    const hint = [card.hint, card.struck].filter(Boolean).join(" ");
    const sub = [card.valueSuffix, hint].filter(Boolean).join(" · ");
    return {
      key: card.key,
      label: card.label,
      icon: card.icon,
      value: card.value === EM_DASH ? null : card.value,
      sub: sub ? raw(sub) : undefined,
      tone:
        card.tone === "danger"
          ? "err"
          : card.tone === "warn"
            ? "warn"
            : card.positive
              ? "ok"
              : undefined,
      dataTest: `${dataTestPrefix}-${card.key}`,
    };
  });
}
