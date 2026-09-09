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

// Burn-rate / error-budget SLO alert schema: `kind` changes the required set outright, since an error-budget alert NULLS both windows on purpose.

import { z } from "zod";

import type { I18nText } from "@/types/i18n";
import { ALERT_NAME_UNSUPPORTED_CHARS, isBlank } from "@/components/alerts/AddAlert.schema";

export type Translator = (_key: string, _named?: Record<string, unknown>) => I18nText;

export const makeSloAlertSchema = (t: Translator) =>
  z
    .looseObject({
      name: z.string().optional(),
      frequencyMinutes: z.unknown().optional(),
      silenceMinutes: z.unknown().optional(),
      destinations: z.array(z.string()).optional(),
      workflows: z.array(z.string()).optional(),
      condition: z.looseObject({}).optional(),
    })
    .superRefine((val: any, ctx) => {
      const add = (path: (string | number)[], message: I18nText) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

      // Same name rule the generic alert form applies: these become ordinary alerts once saved.
      if (isBlank(val.name)) {
        add(["name"], t("alerts.nameRequired"));
      } else if (
        ALERT_NAME_UNSUPPORTED_CHARS.test(String(val.name)) ||
        String(val.name).includes("/")
      ) {
        // "/" is rejected server-side too but is not in the shared regex, so it
        // is checked alongside it rather than by widening a regex other forms use.
        add(["name"], t("alerts.validation.nameUnsupportedChars"));
      }

      if (isBlank(val.frequencyMinutes)) {
        add(["frequencyMinutes"], t("slos.validation.frequencyRequired"));
      } else if (
        !Number.isFinite(Number(val.frequencyMinutes)) ||
        Number(val.frequencyMinutes) < 1
      ) {
        add(["frequencyMinutes"], t("slos.validation.frequencyPositive"));
      }

      // Zero silence means "re-notify every evaluation", a real choice — so the
      // blank must be told apart from 0 rather than tested for truthiness.
      if (isBlank(val.silenceMinutes)) {
        add(["silenceMinutes"], t("slos.validation.silenceRequired"));
      } else if (!Number.isFinite(Number(val.silenceMinutes)) || Number(val.silenceMinutes) < 0) {
        add(["silenceMinutes"], t("slos.validation.silenceNonNegative"));
      }

      // Either channel satisfies the server, so this is a rule about the PAIR.
      if ((val.destinations?.length ?? 0) === 0 && (val.workflows?.length ?? 0) === 0) {
        add(["destinations"], t("slos.validation.targetsRequired"));
      }

      const c = val.condition ?? {};
      const isBurnRate = c.kind === "burn_rate";

      if (isBlank(c.critical)) {
        add(["condition", "critical"], t("slos.validation.criticalRequired"));
      } else {
        const critical = Number(c.critical);
        if (!Number.isFinite(critical) || critical <= 0) {
          add(["condition", "critical"], t("slos.validation.criticalPositive"));
        } else if (!isBurnRate && critical > 100) {
          add(["condition", "critical"], t("slos.validation.budgetRange"));
        }
      }

      if (!isBurnRate) return;

      const long = Number(c.long_window_secs);
      const short = Number(c.short_window_secs);
      if (!Number.isFinite(long) || long <= 0) {
        add(["condition", "long_window_secs"], t("slos.validation.longWindowRequired"));
      }
      if (!Number.isFinite(short) || short <= 0) {
        add(["condition", "short_window_secs"], t("slos.validation.shortWindowRequired"));
      } else if (Number.isFinite(long) && long > 0 && short >= long) {
        // A burn-rate rule compares a fast signal against a slow one; inverted
        // or equal windows are not a burn-rate rule at all.
        add(["condition", "short_window_secs"], t("slos.validation.shortInsideLong"));
      }
    });

export type SloAlertForm = z.infer<ReturnType<typeof makeSloAlertSchema>>;
