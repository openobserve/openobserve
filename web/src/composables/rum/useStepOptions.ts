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

import { computed, ref } from "vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import useProductAnalytics, {
  PICKER_LIMIT,
  type PickerOption,
  type PickerResult,
} from "@/composables/rum/useProductAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { StepKind, StepRef } from "@/utils/rum/productAnalyticsQueries";

const FULL_LIST = PICKER_LIMIT;
const FULL_ERRORS = 50;
const KIND_ICON: Record<StepKind, string> = {
  p: "article",
  c: "ads-click",
  e: "bookmark",
  r: "error-outline",
};

export interface StepOptionsInput {
  events: () => NamedEvent[];
  kinds: () => StepKind[];
  modelValue?: () => StepRef | null;
}

export interface StepOptionRow {
  step: StepRef;
  label: string;
  sessions: number | null;
  custom?: true;
}

export interface StepOptionGroup {
  kind: StepKind;
  label: I18nText;
  rows: StepOptionRow[];
}

export const encode = (s: { kind: StepKind; key: string }) => `${s.kind}:${s.key}`;

export const decode = (v: string): StepRef => {
  const i = v.indexOf(":");
  return { kind: v.slice(0, i) as StepKind, key: v.slice(i + 1) };
};

/** The grouped page/click/event/error options a step can be picked from, loaded per scope. */
export function useStepOptions(opts: StepOptionsInput) {
  const { t } = useI18nTyped();
  const pa = useProductAnalytics();

  const rows = ref<PickerOption[]>([]);
  const searched = ref<{ scope: string; options: PickerOption[] }>({ scope: "", options: [] });
  const loading = ref(false);
  const failed = ref(false);
  const loadedKey = ref("");

  const headers = computed<Record<StepKind, I18nText>>(() => ({
    e: t("rum.analytics.picker.events"),
    p: t("rum.analytics.picker.pages"),
    c: t("rum.analytics.picker.clicks"),
    r: t("rum.analytics.picker.errors"),
  }));

  const byKind = computed(() => {
    const seen = new Set<string>();
    const out: Record<StepKind, StepOptionRow[]> = { e: [], p: [], c: [], r: [] };
    for (const e of opts.events()) {
      const step: StepRef = { kind: "e", key: e.id };
      out.e.push({ step, label: e.name, sessions: null });
      seen.add(encode(step));
    }
    const found = searched.value.scope === pa.scopeKey.value ? searched.value.options : [];
    for (const r of [...rows.value, ...found]) {
      const v = encode(r);
      if (r.kind === "e" || seen.has(v)) continue;
      seen.add(v);
      out[r.kind].push({
        step: { kind: r.kind, key: r.key },
        label: r.key,
        sessions: r.sessions,
        ...(r.custom ? { custom: true as const } : {}),
      });
    }
    const current = opts.modelValue?.() ?? null;
    if (current && !seen.has(encode(current))) {
      out[current.kind].unshift({ step: current, label: current.key, sessions: null });
    }
    return out;
  });

  /** The same rows as `options`, kept per kind with their session counts. */
  const groups = computed<StepOptionGroup[]>(() =>
    opts
      .kinds()
      .filter((k) => byKind.value[k].length)
      .map((k) => ({ kind: k, label: headers.value[k], rows: byKind.value[k] })),
  );

  const options = computed<SelectOption[]>(() =>
    groups.value.flatMap((g) => [
      { label: g.label, header: true, value: `header:${g.kind}` },
      ...g.rows.map((r) => ({
        label: raw(r.label),
        value: encode(r.step),
        icon: KIND_ICON[g.kind],
        ...(r.custom ? { badge: t("rum.analytics.kind.event") } : {}),
      })),
    ]),
  );

  const withErrors = computed(() => opts.kinds().includes("r"));
  const count = (kind: "r" | "rest") =>
    rows.value.filter((r) => (r.kind === "r") === (kind === "r")).length;

  // Custom actions arrive only from users with telemetry on, so an empty list needs saying why.
  const noCustom = computed(
    () =>
      opts.kinds().includes("c") &&
      loadedKey.value === pa.scopeKey.value &&
      !failed.value &&
      !rows.value.some((r) => r.custom),
  );

  const ok = (...res: PickerResult[]) => res.every((r) => r.status === "ok");

  // Only a successful read marks the scope loaded, so a failure is retried on the next open.
  const load = async () => {
    const key = pa.scopeKey.value;
    if (loadedKey.value === key) return;
    loading.value = true;
    try {
      const [res, errors] = await Promise.all([
        pa.loadPicker(),
        withErrors.value ? pa.loadErrorPicker() : null,
      ]);
      if (key !== pa.scopeKey.value) return;
      const all = errors ? [res, errors] : [res];
      failed.value = !ok(...all);
      rows.value = all.flatMap((r) => r.options);
      if (!failed.value) loadedKey.value = key;
    } finally {
      loading.value = false;
    }
  };

  // The server is asked only for a list whose first rows did not already hold every key.
  // Responses can arrive out of order, so only the latest search may write its rows.
  let searchSeq = 0;
  const onSearch = async (term: string) => {
    failed.value = false;
    const more = count("rest") >= FULL_LIST;
    const moreErrors = withErrors.value && count("r") >= FULL_ERRORS;
    if (!term || (!more && !moreErrors)) return;
    const seq = ++searchSeq;
    const scope = pa.scopeKey.value;
    loading.value = true;
    try {
      const all = await Promise.all([
        ...(more ? [pa.searchPicker(term)] : []),
        ...(moreErrors ? [pa.loadErrorPicker(term)] : []),
      ]);
      if (seq !== searchSeq || scope !== pa.scopeKey.value) return;
      failed.value = !ok(...all);
      searched.value = { scope, options: all.flatMap((r) => r.options) };
    } finally {
      if (seq === searchSeq) loading.value = false;
    }
  };

  return { options, groups, loading, failed, noCustom, load, onSearch };
}

export default useStepOptions;
