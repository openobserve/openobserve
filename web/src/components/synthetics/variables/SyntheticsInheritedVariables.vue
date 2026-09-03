<!--
Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.

The Inherited group of the 4b names-only panel: the union of every selected
environment plus globals, one row per distinct name, filterable by source.
Purely presentational — the panel owns the grouped fetch.
-->

<template>
  <section class="flex flex-col gap-2" data-test="synthetics-inherited-variables">
    <div class="flex items-center gap-2">
      <h4 class="text-text-heading m-0 text-sm font-semibold">
        {{ t("synthetics.inherited.title") }}
      </h4>
      <OBadge variant="default" size="sm">{{ rows.length }}</OBadge>
      <!-- Resets per visit by design: local state, never persisted. -->
      <div v-if="filterOptions.length > 2" class="ml-auto">
        <OSelect
          :model-value="filter"
          :options="filterOptions"
          size="sm"
          class="w-30!"
          :aria-label="t('synthetics.inherited.filterLabel')"
          data-test="synthetics-inherited-filter"
          @update:model-value="filter = String($event)"
        />
      </div>
    </div>

    <p
      v-if="!filteredRows.length"
      class="text-text-secondary m-0 text-sm"
      data-test="synthetics-inherited-empty"
    >
      {{
        filter === ALL
          ? t("synthetics.inherited.emptyNone")
          : t("synthetics.inherited.emptyIn", { env: filterName })
      }}
    </p>

    <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
      <li
        v-for="row in filteredRows"
        :key="row.name"
        class="flex items-center gap-2 text-sm"
        data-test="synthetics-inherited-variable"
      >
        <!-- Same scope vocabulary as the Environments & Variables rail:
             public = Global, layers = an environment. -->
        <OIcon
          :name="row.global && !row.envs.length ? 'public' : 'layers'"
          size="sm"
          class="text-text-secondary shrink-0"
          role="img"
          :aria-label="sourceLabel(row)"
          data-test="synthetics-inherited-scope-icon"
        />
        <!-- The strike is the whole visible signal for a shadowed name; the
             relation and the per-source value hints live on the tooltip. -->
        <span
          class="min-w-0 truncate font-mono"
          :class="row.overridden ? 'text-text-muted line-through' : 'text-text-secondary'"
          :aria-label="row.overridden ? t('synthetics.inherited.overriddenByCheck') : undefined"
          >{{ row.name
          }}<OTooltip side="top">
            <template #content>
              <div v-if="row.overridden" class="text-warning">
                {{ t("synthetics.inherited.overriddenByCheck") }}
              </div>
              <div>{{ hintsLine(row) }}</div>
            </template>
          </OTooltip></span
        >
        <!-- shrink-0 wrappers: on overflow the NAME ellipsizes, never these. -->
        <span v-if="gapText(row)" class="flex shrink-0">
          <!-- Fires only on non-uniformity; the env names live in the tooltip
               and on aria-label, so hover is not the only path to them. -->
          <OTooltip :content="gapText(row)" side="top">
            <OIcon
              name="warning"
              size="xs"
              class="text-warning cursor-help"
              role="img"
              :aria-label="gapText(row)"
              data-test="synthetics-inherited-gap-badge"
            />
          </OTooltip>
        </span>
        <span v-if="row.secret" class="flex shrink-0">
          <OTooltip :content="t('synthetics.variablesPanel.secretTooltip')" side="top">
            <OIcon
              name="lock"
              size="xs"
              class="text-text-secondary cursor-help"
              data-test="synthetics-inherited-secret-lock"
            />
          </OTooltip>
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { InheritedUnionRow } from "./resolved";

const ALL = "__all__";
const GLOBAL = "__global__";

const props = withDefaults(
  defineProps<{
    /** One row per distinct inherited name — see inheritedUnion(). */
    rows: InheritedUnionRow[];
    /** The check's environment names, for the source filter. */
    environments?: string[];
    /** Environments each name fails to resolve in, from coverageGaps(). */
    gaps?: Map<string, string[]>;
  }>(),
  { environments: () => [], gaps: () => new Map() },
);

const { t } = useI18nTyped();

const filter = ref(ALL);

const filterOptions = computed(() => [
  { label: t("synthetics.inherited.filterAll"), value: ALL },
  { label: t("synthetics.variables.global"), value: GLOBAL },
  ...props.environments.filter((env) => env !== "").map((env) => ({ label: raw(env), value: env })),
]);

const filteredRows = computed(() => {
  if (filter.value === ALL) return props.rows;
  if (filter.value === GLOBAL) return props.rows.filter((row) => row.global);
  return props.rows.filter((row) => row.envs.includes(filter.value));
});

const filterName = computed<I18nText>(() =>
  filter.value === GLOBAL ? t("synthetics.variables.global") : raw(filter.value),
);

function sourceLabel(row: InheritedUnionRow): I18nText {
  const sources = [...row.envs];
  if (row.global) sources.push("Global");
  return raw(sources.join(", "));
}

/**
 * Per-source value hints, the closest the metadata-only API allows to a value
 * on hover: the declared `example` when one exists, else whether a value is
 * set. Secrets never show more than that by design.
 */
function hintsLine(row: InheritedUnionRow): I18nText {
  const hints = row.hints.map((hint) => {
    const label = hint.source === "global" ? "Global" : hint.source;
    const value = row.secret
      ? "••••••"
      : hint.example ||
        (hint.has_value
          ? t("synthetics.inherited.valueSet")
          : t("synthetics.inherited.valueNotSet"));
    return `${label}: ${value}`;
  });
  return raw(`${row.name} — ${hints.join(" · ")}`);
}

function gapText(row: InheritedUnionRow): string {
  const missing = props.gaps.get(row.name);
  if (!missing?.length) return "";
  return missing.length > 2
    ? t("synthetics.inherited.notInMany", { count: missing.length })
    : t("synthetics.inherited.notIn", { envs: missing.join(", ") });
}
</script>
