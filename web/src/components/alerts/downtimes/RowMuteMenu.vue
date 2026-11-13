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

<!-- The row menu of a live mute: Extend and End only when ending it frees this row alone. -->
<template>
  <template v-if="downtime.end_here">
    <MuteMenuItems
      labels="extend"
      :until-clear="untilClear"
      :data-test-prefix="extendTestPrefix"
      @preset="(secs) => emit('preset', secs)"
      @until-clear="emit('untilClear')"
      @until="emit('until')"
    />
    <ODropdownItem
      variant="destructive"
      icon-left="notifications-active"
      :data-test="endTest"
      @select="emit('end')"
    >
      {{ endLabel }}
    </ODropdownItem>
  </template>
  <ODropdownItem v-else icon-left="open-in-new" :data-test="mutedByTest" @select="openDowntime">
    {{ t("alerts.downtimes.mute.mutedBy", { name: downtime.name }) }}
  </ODropdownItem>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import type { ActiveDowntime } from "@/services/downtimes";
import { downtimeLink } from "@/utils/downtimes/link";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import MuteMenuItems from "./MuteMenuItems.vue";

const props = withDefaults(
  defineProps<{
    downtime: ActiveDowntime;
    /** Only an alert's own quick mute can end on its clear. */
    untilClear?: boolean;
    /** A parent alert row ends every group its quick mute names (D3), so the label counts them. */
    countGroups?: boolean;
    extendTestPrefix: string;
    endTest: string;
    mutedByTest: string;
  }>(),
  { untilClear: false, countGroups: false },
);

const emit = defineEmits<{
  preset: [seconds: number];
  until: [];
  untilClear: [];
  end: [];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();

const endLabel = computed(() => {
  const count = props.countGroups ? (props.downtime.alert_groups?.length ?? 0) : 0;
  return count
    ? t("alerts.downtimes.mute.endNowGroups", { count }, count)
    : t("alerts.downtimes.mute.endNow");
});

const openDowntime = () => void router.push(downtimeLink(props.downtime, orgId.value));
</script>
