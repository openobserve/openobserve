<!-- Copyright 2026 OpenObserve Inc.

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
-->

<template>
  <div class="flex flex-col gap-3" data-test="fleet-version-bars">
    <OEmptyState
      v-if="!rows.length"
      size="inline"
      :title="t('fleet.upgrades.noVersions')"
      data-test="fleet-version-bars-empty"
    />
    <div
      v-for="row in rows"
      :key="row.version"
      class="grid grid-cols-[6rem_minmax(0,1fr)_3rem] items-center gap-3"
      :data-test="`fleet-version-bars-row-${row.version}`"
    >
      <div class="flex items-center gap-1.5">
        <OText variant="mono">{{ row.version }}</OText>
      </div>
      <OProgressBar
        :value="row.count / max"
        :variant="row.outdated === null ? 'default' : row.outdated ? 'warning' : 'success'"
        size="sm"
      />
      <OText variant="meta" class="text-end tabular-nums">{{ row.count }}</OText>
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
      <OText v-if="target" variant="meta">{{
        t("fleet.upgrades.latestIs", { version: raw(target) })
      }}</OText>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OText from "@/lib/core/Typography/OText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FleetVersionCount } from "@/services/fleet";
import { compareVersions } from "./fleetFormat";

const props = defineProps<{
  versions: FleetVersionCount[];
  target: string;
  /** Server-flagged outdated versions; null renders every bar neutral. */
  outdatedVersions: string[] | null;
}>();

const { t } = useI18nTyped();

const rows = computed(() =>
  [...props.versions]
    .sort((a, b) => compareVersions(b.version, a.version))
    .map(({ version, count }) => ({
      version,
      count,
      outdated: props.outdatedVersions ? props.outdatedVersions.includes(version) : null,
    })),
);

const max = computed(() => Math.max(1, ...rows.value.map((r) => r.count)));
</script>
