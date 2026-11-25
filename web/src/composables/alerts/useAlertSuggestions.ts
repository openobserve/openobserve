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

import { computed, reactive, ref, watch, type ComputedRef, type InjectionKey, type Ref } from "vue";
import { getIntlLocale } from "@/locales";
import analytics from "@/services/product_analytics";
import { raw, type TranslateFn } from "@/types/i18n";
import type { AlertSectionId } from "@/components/alerts/alertFormSections";
import type { AlertSettingId } from "@/components/alerts/alertSettingTiers";
import {
  pickSuggestion,
  promqlComparisons,
  type ActiveSuggestion,
  type AlertSuggestionId,
  type BacktestSignal,
  type SuggestionContext,
} from "@/components/alerts/alertSuggestions";
import type { AlertSettingTiers } from "./useAlertSettingTiers";

export interface AlertSuggestions {
  current(section: AlertSectionId): ActiveSuggestion | null;
  add(id: AlertSuggestionId): void;
  notNow(id: AlertSuggestionId): void;
  /** The owning step's own value write for Add; returns the unregister. */
  onApply(id: AlertSuggestionId, handler: () => void): () => void;
}

export const ALERT_SUGGESTIONS_KEY: InjectionKey<AlertSuggestions> = Symbol("alertSuggestions");
/** Written only by the 24 h check; null while it has no finished result. */
export const ALERT_BACKTEST_SIGNAL_KEY: InjectionKey<Ref<BacktestSignal | null>> =
  Symbol("alertBacktestSignal");

interface SuggestionScope {
  user: string;
  org: string;
  alertId: string | null;
}

const storageKey = (s: SuggestionScope) =>
  s.alertId === null ? null : `o2.alerts.suggestionsDismissed:${s.user}:${s.org}:${s.alertId}`;

const readDismissed = (key: string | null): AlertSuggestionId[] => {
  if (!key) return [];
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeDismissed = (key: string | null, ids: ReadonlySet<AlertSuggestionId>) => {
  if (!key) return;
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Blocked storage: Not now lasts for this page only.
  }
};

function suggestionText(id: AlertSuggestionId, ctx: SuggestionContext, t: TranslateFn) {
  const b = ctx.backtest;
  const minutes = 2 * (b?.frequencyMinutes ?? 0);
  switch (id) {
    case "ruleExpression":
      return t("alerts.form.suggest.ruleExpression", {
        ops: raw(promqlComparisons(ctx.promql).join(", ")),
      });
    case "holdFor":
      return t("alerts.form.suggest.holdFor", {
        spikes: b?.singleCheckSpikes ?? 0,
        alerts: b?.alerts ?? 0,
        minutes,
      });
    case "keepFiring":
      return t(
        "alerts.form.suggest.keepFiring",
        { count: b?.refires ?? 0, minutes },
        b?.refires ?? 0,
      );
    case "recovery":
      return ctx.resolvingDestinations.length
        ? t("alerts.form.suggest.recoveryDestinations", {
            destinations: raw(
              new Intl.ListFormat(getIntlLocale(), { type: "conjunction" }).format(
                ctx.resolvingDestinations,
              ),
            ),
          })
        : t("alerts.form.suggest.recoveryIncident");
    case "oncall":
      return t("alerts.form.suggest.oncall");
    case "priority":
      return t("alerts.form.suggest.priority");
  }
}

/** One suggestion per section; Not now is remembered per user, org and alert on this device. */
export function useAlertSuggestions(input: {
  context: ComputedRef<SuggestionContext>;
  scope: () => SuggestionScope;
  tiers: AlertSettingTiers;
  t: TranslateFn;
  /** Moves focus to the setting once Add has shown it. */
  focus?: (id: AlertSettingId) => void;
}): AlertSuggestions {
  const key = computed(() => storageKey(input.scope()));
  const dismissed = ref(new Set<AlertSuggestionId>(readDismissed(key.value)));
  const applied = reactive(new Set<AlertSuggestionId>());
  watch(key, (next) => {
    dismissed.value = new Set(readDismissed(next));
    applied.clear();
  });
  const handled = computed(() => new Set([...dismissed.value, ...applied]));
  const handlers = new Map<AlertSuggestionId, () => void>();

  return {
    current(section) {
      const ctx = input.context.value;
      const pick = pickSuggestion(section, ctx, handled.value);
      if (!pick) return null;
      return {
        ...pick,
        text: suggestionText(pick.id, ctx, input.t),
        actionLabel:
          pick.id === "ruleExpression"
            ? input.t("alerts.form.suggest.useAsRule")
            : input.t("common.add"),
        anchor: pick.id === "ruleExpression" ? "query" : "end",
      };
    },
    add(id) {
      handlers.get(id)?.();
      input.tiers.reveal(id);
      applied.add(id);
      analytics.track("alert_suggestion_applied", { suggestion: id });
      input.focus?.(id);
    },
    notNow(id) {
      dismissed.value = new Set([...dismissed.value, id]);
      writeDismissed(key.value, dismissed.value);
    },
    onApply(id, handler) {
      handlers.set(id, handler);
      return () => {
        if (handlers.get(id) === handler) handlers.delete(id);
      };
    },
  };
}
