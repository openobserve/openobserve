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

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type {
  RepairIssue,
  RepairScope,
  useRepairLater,
} from "@/composables/starterPacks/useRepairLater";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  repair: ReturnType<typeof useRepairLater>;
  issue: RepairIssue | null;
  scope: RepairScope;
}>();
const emit = defineEmits<{ repaired: [] }>();
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();

const timeOf = (us: number) => new Date(us / 1000).toLocaleTimeString();
const last = computed(() => (props.issue ? timeOf(props.issue.lastUs) : ""));
const summary = computed(() => {
  const found = props.issue;
  if (!found) return "";
  const since = raw(last.value);
  return found.panels
    ? t("starterPacks.repairLater.chip", { count: found.panels, since }, found.panels)
    : t("starterPacks.repairLater.chipAlerts", { count: found.alerts, since }, found.alerts);
});

const apply = async () => {
  if (await props.repair.apply(props.scope)) {
    open.value = false;
    emit("repaired");
  }
};
</script>

<template>
  <ODrawer
    v-model:open="open"
    size="sm"
    :title="t('starterPacks.repairLater.title')"
    data-test="starter-pack-repair-panel"
  >
    <div v-if="issue" class="flex flex-col gap-3 p-3 text-sm">
      <p>{{ summary }}</p>
      <div class="border-border-default rounded-default flex flex-col gap-1 border p-3">
        <OText variant="meta">{{ t("starterPacks.repairLater.stopped") }}</OText>
        <strong class="text-text-heading font-medium" data-test="starter-pack-repair-from">{{
          issue.from
        }}</strong>
        <OText variant="meta">{{
          t("starterPacks.repairLater.lastData", { time: raw(last) })
        }}</OText>
      </div>
      <OIcon name="arrow-downward" size="sm" class="text-text-secondary self-center" />
      <div class="border-border-default rounded-default flex flex-col gap-1 border p-3">
        <OText variant="meta">
          {{ t("starterPacks.repairLater.started", { time: raw(timeOf(issue.startedUs)) }) }}
        </OText>
        <strong class="text-text-heading font-medium" data-test="starter-pack-repair-to">{{
          issue.to
        }}</strong>
      </div>
      <OBanner
        v-if="repair.failed.value"
        variant="error-soft"
        dense
        :content="t('starterPacks.repairLater.failed')"
      />
      <OText variant="meta">{{ t("starterPacks.repairLater.note") }}</OText>
    </div>
    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <OButton variant="outline" size="sm-action" class="w-full" @click="open = false">
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          v-if="issue"
          variant="primary"
          size="sm-action"
          class="w-full"
          :loading="repair.busy.value"
          data-test="starter-pack-repair-apply-btn"
          @click="apply"
        >
          {{
            t("starterPacks.repairLater.apply", {
              panels: t("starterPacks.repairLater.panels", { count: issue.panels }, issue.panels),
              alerts: t("starterPacks.countAlerts", { count: issue.alerts }, issue.alerts),
              to: raw(issue.to),
            })
          }}
        </OButton>
      </div>
    </template>
  </ODrawer>
</template>
