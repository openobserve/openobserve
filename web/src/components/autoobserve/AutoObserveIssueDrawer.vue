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
  <ODrawer
    :open="open"
    :width="85"
    :title="liveTitle"
    :sub-title="liveSubTitle"
    bleed
    data-test="autoobserve-issue-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <template v-if="liveItem" #header-right>
      <OButton
        variant="outline"
        size="sm"
        icon-left="open-in-new"
        data-test="autoobserve-issue-open-incident"
        @click="openIncidentPage"
      >
        {{ t("autoobserve.issueLive.openIncident") }}
      </OButton>
    </template>
    <LiveIssueBody v-if="liveItem" :item="liveItem" :initial-tab="liveTab" />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import LiveIssueBody from "./live/LiveIssueBody.vue";
import { findingSentence, incidentLink } from "./live/incidentsCopy";
import { issueShortId, type LiveIssueTab } from "./live/issueModel";
import { formatWhen } from "./live/liveCopy";
import { useLiveZone } from "./live/liveModel";

const props = withDefaults(
  defineProps<{
    open: boolean;
    liveItem?: AutoObserveIncidentItem | null;
    liveTab?: LiveIssueTab;
  }>(),
  { liveItem: null, liveTab: "overview" },
);

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const zone = useLiveZone();

const liveTitle = computed(() => (props.liveItem ? findingSentence(t, props.liveItem) : undefined));
const liveSubTitle = computed(() => {
  const item = props.liveItem;
  if (!item) return undefined;
  const started = formatWhen(
    item.finding.first_seen_at / 1000,
    zone.value.locale,
    zone.value.timeZone,
  );
  return raw(`${issueShortId(item.incident.id)} · ${started}`);
});

// The incident page keeps on-call, acknowledge and comments, so the drawer always links to it.
const openIncidentPage = () => {
  const item = props.liveItem;
  const org: string = store.state.selectedOrganization?.identifier ?? "";
  if (item) void router.push(incidentLink(org, item.incident.id));
};
</script>
