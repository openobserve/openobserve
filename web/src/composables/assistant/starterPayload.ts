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

import { gt, raw, type I18nText } from "@/types/i18n";
import { uiIntlLocale } from "@/utils/formatters";

import { periodMs } from "./context/contextChips";
import type { ContextChip } from "./context/types";
import { periodText, type Starter } from "./useAssistantStarters";

/** The window an empty default-window answer offers instead (PO A26). */
export const WIDER_PERIOD = "1h";

/** What a starter stages; its window is a door range ending at the click, so it never goes stale. */
export function starterPayload(
  starter: Pick<Starter, "prompt" | "chips" | "period" | "home">,
  org: string,
  now: number = Date.now(),
): { text: string; chips: ContextChip[]; homeStarter?: true } {
  const home = starter.home ? { homeStarter: true as const } : {};
  if (!starter.period) return { text: starter.prompt, chips: starter.chips, ...home };
  const from = now - periodMs(starter.period);
  const period = periodText(starter.period, uiIntlLocale()) ?? starter.period;
  const time: ContextChip = {
    id: "starter-time",
    kind: "time",
    label: gt("assistant.welcome.lastRange", { period: raw(period) }),
    ref: { type: "time", org, from, to: now },
    sizeBytes: 32,
    provenance: "door",
    sent: "whitelist",
  };
  return { text: starter.prompt, chips: [time, ...starter.chips], ...home };
}

/** "1 h" in the UI locale, the duration the empty-window offer names. */
export function widerPeriodText(): I18nText {
  return raw(periodText(WIDER_PERIOD, uiIntlLocale()) ?? WIDER_PERIOD);
}
