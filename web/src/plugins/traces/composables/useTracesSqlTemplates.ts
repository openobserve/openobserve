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

import { computed, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useTraces from "@/composables/useTraces";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { tracesSqlTemplates, type TracesSqlTemplate } from "@/utils/traces/tracesSqlTemplates";

/** The card name and one-line description of a template, with its service names filled in. */
export function useTracesSqlTemplateText() {
  const { t } = useI18nTyped();
  const templateName = (tpl: TracesSqlTemplate) => t(`traces.sqlMode.templates.${tpl.id}.name`);
  const templateDescription = (tpl: TracesSqlTemplate) =>
    t(`traces.sqlMode.templates.${tpl.id}.description`, {
      first: tpl.services[0] ?? "",
      second: tpl.services[1] ?? "",
    });
  return { templateName, templateDescription };
}

/** The SQL templates for the current view and stream, with service names read from the stream. */
export function useTracesSqlTemplates() {
  const store = useStore();
  const { t } = useI18nTyped();
  const { searchObj } = useTraces();
  const { fieldValues, fetchFieldValues, cancelFieldStream, resetFieldValues } =
    useFieldValuesStream(t);

  const services = computed(() =>
    (fieldValues.value.service_name?.values ?? [])
      .map((entry) => entry.key)
      .filter((key) => key && key !== "null"),
  );

  const loadServices = (stream: string) => {
    cancelFieldStream("service_name");
    resetFieldValues("service_name", true);
    fetchFieldValues({
      fields: ["service_name"],
      size: store.state.zoConfig?.query_values_default_num || 10,
      from: 0,
      no_count: false,
      start_time: searchObj.data.datetime.startTime,
      end_time: searchObj.data.datetime.endTime,
      stream_name: stream,
      stream_type: "traces",
      sql: b64EncodeUnicode(`SELECT * FROM "${stream.replaceAll('"', '""')}"`),
      timeout: 30000,
      use_cache: (globalThis as any).use_cache ?? true,
    });
  };

  // The stream and range the names were last asked for; a relative range is keyed by its period, as every Run moves its window.
  let loadedKey = "";

  // Only the trace templates name services, so the Spans view never asks for them; the values API needs a range.
  watch(
    () =>
      [
        searchObj.meta.sqlMode,
        searchObj.meta.searchMode,
        searchObj.data.stream.selectedStream?.value,
        searchObj.data.datetime?.startTime,
        searchObj.data.datetime?.endTime,
        searchObj.data.datetime?.type === "relative"
          ? searchObj.data.datetime.relativeTimePeriod
          : null,
      ] as const,
    ([on, mode, stream, start, end, period]) => {
      if (!on || mode !== "traces" || !stream) return;
      if (!(Number(start) > 0 && Number(end) > Number(start))) return;
      const key = period ? `${stream}|${period}` : `${stream}|${start}|${end}`;
      if (key === loadedKey) return;
      loadedKey = key;
      loadServices(stream);
    },
    { immediate: true },
  );

  const sqlTemplates = computed<TracesSqlTemplate[]>(() => {
    const stream = searchObj.data.stream.selectedStream?.value;
    const mode = searchObj.meta.searchMode;
    if (!stream || (mode !== "traces" && mode !== "spans")) return [];
    return tracesSqlTemplates(mode, stream, {
      services: services.value,
      fields: (searchObj.data.stream.selectedStreamFields ?? []).map((f: any) => f.name),
    });
  });

  return { sqlTemplates };
}
