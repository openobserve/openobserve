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

import { computed } from "vue";
import { raw } from "@/types/i18n";

/** Toggle value standing for "no stored choice"; toggle groups drop null values. */
export const DEFAULT_CHOICE = "__default__";

/** Config writers for the HTML panel settings: each key is stored only while it differs from its default. */
export const useHtmlPanelConfig = (dashboardPanelData: any) => {
  const config = computed<Record<string, any>>(() => dashboardPanelData.data.config);

  const setTextConfig = (key: string, value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) config.value[key] = text;
    else delete config.value[key];
  };
  const setNumberConfig = (key: string, value: unknown) => {
    const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof numeric === "number" && Number.isFinite(numeric)) config.value[key] = numeric;
    else delete config.value[key];
  };
  const setFlagConfig = (key: string, value: unknown) => {
    if (value === true) config.value[key] = true;
    else delete config.value[key];
  };
  const setDefaultOnFlag = (key: string, value: unknown) => {
    if (value === false) config.value[key] = false;
    else delete config.value[key];
  };
  const setListConfig = (key: string, value: unknown) => {
    const list = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
    if (list.length) config.value[key] = list;
    else delete config.value[key];
  };
  const listModel = (key: string) =>
    computed<string[]>(() => (Array.isArray(config.value[key]) ? config.value[key] : []));
  // Default drops the key, so a panel left on it follows whatever the default behaviour is at render time.
  const choiceModel = <T extends string>(key: string, allowed: readonly T[]) =>
    computed({
      get: (): string => (allowed.includes(config.value[key]) ? config.value[key] : DEFAULT_CHOICE),
      set: (value: string) => {
        if (allowed.includes(value as T)) config.value[key] = value;
        else delete config.value[key];
      },
    });
  // A query that names its columns offers those; `SELECT *` names none, so the stream's schema stands in.
  const queryFieldOptions = computed(() => {
    const queryColumns = (dashboardPanelData.meta?.stream?.customQueryFields ?? []).map(
      (field: any) => field?.name,
    );
    const query =
      dashboardPanelData.data?.queries?.[dashboardPanelData.layout?.currentQueryIndex ?? 0];
    const schemaColumns = queryColumns.length
      ? []
      : (dashboardPanelData.meta?.streamFields?.groupedFields ?? [])
          .filter((stream: any) => !query?.fields?.stream || stream?.name === query.fields.stream)
          .flatMap((stream: any) => (stream?.schema ?? []).map((field: any) => field?.name));
    const names = [...queryColumns, ...schemaColumns].filter(
      (name: unknown): name is string => typeof name === "string" && !!name && name !== "*",
    );
    return [...new Set(names)].map((name) => ({ label: raw(name), value: name }));
  });

  return {
    config,
    setTextConfig,
    setNumberConfig,
    setFlagConfig,
    setDefaultOnFlag,
    setListConfig,
    listModel,
    choiceModel,
    queryFieldOptions,
  };
};
