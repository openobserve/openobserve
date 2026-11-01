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

import { gt, raw, type TranslateFn } from "@/types/i18n";

import {
  finish,
  ident,
  inline,
  num,
  promptClock,
  promptRange,
  promptTime,
  zoneOf,
  type PromptBuild,
  type PromptRange,
} from "./format";
import { alertChip, thresholdText, type AlertInput } from "./alert";

/** One evaluation that fired: a row of the alert groups table or the history drawer. */
export interface AlertFiringInput extends Pick<AlertInput, "org" | "alertId" | "name" | "route"> {
  firedAt: number;
  observed?: { value: number; unit?: string };
  threshold?: { op: string; value: number; unit?: string };
  /** The window the evaluation read. */
  window?: PromptRange;
  stream?: string;
  query?: string;
  timeZone: string;
}

/** Troubleshoot this alert firing: the observed number, threshold and windows in the text; name, stream and query in the Alert block. */
export function buildAlertFiringPrompt(input: AlertFiringInput, t: TranslateFn = gt): PromptBuild {
  const unit = input.observed?.unit ? ident(input.observed.unit) : null;
  const observed = input.observed
    ? `observed ${num(input.observed.value)}${unit ? ` ${unit}` : ""}`
    : null;
  const threshold = input.threshold ? thresholdText(input.threshold) : null;
  const window = input.window
    ? `over the evaluated window ${promptRange(input.window, input.timeZone)}`
    : null;
  const measured = [observed, threshold && `against threshold ${threshold}`, window]
    .filter(Boolean)
    .join(" ");
  const text = finish([
    `The alert in the attached Alert block fired at ${promptTime(input.firedAt, input.timeZone)} ${zoneOf(input.timeZone)}${measured ? `: ${measured}` : ""}.`,
    "The block holds its name, stream and query.",
    "Why did it fire and what changed?",
  ]);
  const clock = promptClock(input.firedAt, input.timeZone).slice(0, 5);
  const name = inline(input.name, 60);
  const chip = alertChip(
    { ...input, ...(input.query && { condition: input.query }) },
    {
      label: t("assistant.entry.chip.alertFired", { name: raw(name), time: raw(clock) }),
      type: "alert_firing",
      id: `${input.alertId ?? input.name}:${input.firedAt}`,
    },
  );
  const title = t("assistant.context.chip.alert", { name: raw(`${name} · ${clock}`) });
  return { text, chips: [chip], title };
}
