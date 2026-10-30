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
  <div class="flex flex-col gap-4" data-test="fleet-config-history">
    <div class="flex flex-col">
      <div
        v-for="v in versions"
        :key="v.version"
        class="border-border-default flex flex-col gap-1.5 border-b py-2.5 last:border-b-0"
      >
        <div class="flex items-center gap-2">
          <OText variant="body-strong" class="tabular-nums">{{
            t("fleet.common.versionShort", { version: v.version })
          }}</OText>
          <OTag v-if="v.live" type="fleetDelivery" value="running" />
          <OTag
            v-if="v.state === 'published'"
            variant="default-soft"
            dot
            :label="t('fleet.history.published')"
            :data-test="`fleet-config-history-state-${v.version}`"
          />
          <OTag
            v-else-if="v.state === 'rolling_out'"
            variant="primary-soft"
            dot
            :label="t('fleet.history.rollingOut')"
            :data-test="`fleet-config-history-state-${v.version}`"
          />
          <span class="text-text-secondary ms-auto inline-flex items-center gap-1 text-xs">
            <OTimeCell :value="v.at" unit="ms" mode="relative" />
          </span>
        </div>
        <OText variant="body">{{ v.message }}</OText>
        <div class="flex items-center gap-1">
          <OText variant="meta" class="flex-1" truncate>{{ v.author }}</OText>
          <OButton
            variant="ghost"
            size="xs"
            icon-left="compare"
            :disabled="v.version === 1"
            :data-test="`fleet-config-history-compare-${v.version}`"
            @click="picked = { configId, version: v.version }"
          >
            {{ t("fleet.configs.compare") }}
          </OButton>
          <template v-if="!v.live && v.state === 'published'">
            <OButton
              variant="outline"
              size="xs"
              icon-left="rocket-launch"
              :data-test="`fleet-config-history-start-${v.version}`"
              @click="openRollout(v.version)"
            >
              {{ t("fleet.fleets.changeVersion") }}
            </OButton>
          </template>
        </div>
      </div>
    </div>

    <OEmptyState
      v-if="comparable() && diffForbidden"
      size="inline"
      preset="no-access"
      data-test="fleet-config-history-diff-forbidden"
    />
    <OEmptyState
      v-else-if="comparable() && diffFailed"
      size="inline"
      preset="load-error"
      data-test="fleet-config-history-diff-error"
      @action="retryDiff"
    />
    <div
      v-else-if="comparable() && !(before && after)"
      class="flex justify-center py-4"
      data-test="fleet-config-history-diff-loading"
    >
      <OSpinner />
    </div>
    <div v-else-if="before && after" class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <OText variant="panel-title">{{
          t("fleet.configs.diffTitle", { from: compareVersion - 1, to: compareVersion })
        }}</OText>
      </div>
      <FleetConfigDiff :before="before.yaml" :after="after.yaml" />
    </div>

    <FleetNewRolloutDialog
      v-model:open="rolloutOpen"
      :config="configId"
      :to-version="rolloutVersion ?? undefined"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useI18nTyped } from "@/types/i18n";
import type { FleetConfigVersionSummary } from "@/services/fleet";
import FleetConfigDiff from "../FleetConfigDiff.vue";
import FleetNewRolloutDialog from "../FleetNewRolloutDialog.vue";
import { isForbidden, useFleetConfigVersion } from "../useFleetApi";

const props = defineProps<{ configId: string; versions: FleetConfigVersionSummary[] }>();

const { t } = useI18nTyped();
const rolloutOpen = ref(false);
const rolloutVersion = ref<number | null>(null);

const latest = () => props.versions[0]?.version ?? 0;
// Keyed by config id, so a selection made on one config is never requested under another.
const picked = ref<{ configId: string; version: number } | null>(null);
const compareVersion = computed(() =>
  picked.value?.configId === props.configId ? picked.value.version : latest(),
);
// Version 1 has nothing before it, so neither side is fetched.
const comparable = () => compareVersion.value > 1;

const beforeRead = useFleetConfigVersion(
  () => props.configId,
  () => compareVersion.value - 1,
  comparable,
);
const afterRead = useFleetConfigVersion(
  () => props.configId,
  () => compareVersion.value,
  comparable,
);
const before = beforeRead.version;
const after = afterRead.version;
const diffForbidden = computed(
  () => isForbidden(beforeRead.error.value) || isForbidden(afterRead.error.value),
);
const diffFailed = computed(
  () => (!!beforeRead.error.value && !before.value) || (!!afterRead.error.value && !after.value),
);
const retryDiff = () => Promise.all([beforeRead.refetch(), afterRead.refetch()]);

// Rolling back is a rollout of the earlier version.
function openRollout(version: number) {
  rolloutVersion.value = version;
  rolloutOpen.value = true;
}
</script>
