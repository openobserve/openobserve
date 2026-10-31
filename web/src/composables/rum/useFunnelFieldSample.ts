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

import { computed, type ComputedRef } from "vue";
import type useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import type useProductAnalytics from "@/composables/rum/useProductAnalytics";
import {
  FIELD_SAMPLE_ROWS,
  foldFieldSample,
  isSampledField,
  type FieldSample,
} from "@/utils/rum/funnelFields";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import { stepFieldSampleSql, type FunnelDef } from "@/utils/rum/productAnalyticsQueries";

export type FieldSampleState = "idle" | "loading" | "ok" | "error";

interface SampleDeps {
  pa: ReturnType<typeof useProductAnalytics>;
  runner: ReturnType<typeof useAnalyticsSearch>;
  def: ComputedRef<FunnelDef>;
  events: ComputedRef<NamedEvent[]>;
}

const EMPTY: FieldSample = { fields: [] };

/** The fields each funnel step's events carry, from a per-step sample run once per funnel on demand. */
export default function useFunnelFieldSample(deps: SampleDeps) {
  const { pa, runner, def, events } = deps;
  const panel = runner.panel<Record<string, unknown>>("field-sample");

  const fields = computed(() =>
    Object.keys(pa.schema.value)
      .filter((f) => pa.schema.value[f] && isSampledField(f))
      .sort(),
  );

  // Step filters never change which rows an event has, so only the steps' targets key the sample.
  const key = computed(() => {
    const steps = def.value.steps;
    const rules = steps
      .filter((s) => s.kind === "e")
      .map((s) => events.value.find((e) => e.id === s.key)?.rules ?? null);
    return `${pa.scopeKey.value}|${JSON.stringify(steps.map((s) => [s.kind, s.key]))}|${JSON.stringify(rules)}|${fields.value.join(",")}`;
  });

  const state = computed<FieldSampleState>(() => {
    if (!def.value.steps.length) return "idle";
    if (!fields.value.length) return "ok";
    const p = panel.value;
    if (p.key !== key.value) return "idle";
    if (p.status === "ok" || p.status === "loading") return p.status;
    return p.status === "error" || p.status === "forbidden" ? "error" : "idle";
  });

  const sample = computed<FieldSample | null>(() => {
    if (state.value !== "ok") return null;
    if (!fields.value.length) return EMPTY;
    return foldFieldSample(panel.value.rows, def.value.steps, fields.value);
  });

  /** Runs the sample unless this funnel's is answered or running; `force` reruns it. */
  const load = (force = false) => {
    const d = def.value;
    if (!d.steps.length || !fields.value.length) return;
    const k = key.value;
    const p = panel.value;
    if (!force && p.key === k && (p.status === "ok" || p.status === "loading")) return;
    void runner.run(
      "field-sample",
      {
        sql: stepFieldSampleSql(pa.scope.value, d, events.value, fields.value, FIELD_SAMPLE_ROWS),
        ...pa.resolveRange(),
        limit: FIELD_SAMPLE_ROWS * d.steps.length,
        sampled: 1,
      },
      k,
    );
  };

  return { state, sample, load };
}
