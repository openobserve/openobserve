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
import { raw, useI18nTyped } from "@/types/i18n";
import type { StarterPackFlow } from "./useStarterPackFlow";

/** What the preview changed to fit this org's data: stream choices, field matches and the version. */
export const useAdaptedData = (flow: StarterPackFlow) => {
  const { t } = useI18nTyped();

  const preview = computed(() => flow.preview.value);
  const questions = computed(() => preview.value?.questions ?? []);
  const answered = computed(() => questions.value.filter(({ answer }) => answer));
  const open = computed(() => questions.value.filter(({ answer }) => !answer));
  const bindings = computed(() => {
    const rows = new Map(
      (preview.value?.bindings ?? []).map((row) => [`${row.from}/${row.to}`, row]),
    );
    return [...rows.values()];
  });
  const flavours = computed(() => {
    const ids = new Set(Object.values(preview.value?.flavours ?? {}));
    return (flow.pack.flavours ?? []).filter(({ id }) => ids.has(id));
  });
  const hasAny = computed(
    () => questions.value.length + bindings.value.length + flavours.value.length > 0,
  );
  const version = computed(() => flavours.value.map(({ titleKey }) => t(titleKey)).join(", "));

  const withVersion = (meta: string) => (version.value ? `${meta} · ${version.value}` : meta);

  const matchedMeta = () => {
    const streams = answered.value.length;
    const fields = bindings.value.length;
    const parts = [
      streams ? t("starterPacks.adapted.streamCount", { count: streams }, streams) : "",
      fields ? t("starterPacks.adapted.fieldCount", { count: fields }, fields) : "",
    ].filter(Boolean);
    if (!parts.length)
      return version.value ? t("starterPacks.adapted.flavour", { name: raw(version.value) }) : "";
    const matched =
      parts.length === 2
        ? t("starterPacks.adapted.matchedBoth", { streams: parts[0], fields: parts[1] })
        : t("starterPacks.adapted.matchedOne", { what: parts[0] });
    return withVersion(matched);
  };

  const choiceMeta = () => {
    const asks = open.value.filter(({ kind }) => kind !== "none").length;
    const missing = open.value.length - asks;
    const matched = answered.value.length + bindings.value.length;
    return withVersion(
      [
        asks ? t("starterPacks.adapted.needsChoiceCount", { count: asks }, asks) : "",
        missing ? t("starterPacks.adapted.notFoundCount", { count: missing }) : "",
        matched ? t("starterPacks.adapted.matchedCount", { count: matched }) : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  };

  const meta = computed(() => raw(open.value.length ? choiceMeta() : matchedMeta()));
  // A stream that is simply missing is not a choice, so it stays neutral.
  const warn = computed(() => open.value.some(({ kind }) => kind !== "none"));

  return { answered, open, bindings, flavours, hasAny, meta, warn };
};
