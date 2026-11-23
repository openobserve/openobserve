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
import { computed, onMounted, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { packBusyText } from "@/composables/starterPacks/packCardText";
import { packById, packTitle } from "@/composables/starterPacks/usePackCatalog";
import type { HomePackRowItem, HomePackView } from "@/composables/starterPacks/useHomePacks";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import { useStarterPackPopup } from "@/composables/starterPacks/useStarterPackPopup";
import StarterPackHomeRow from "./StarterPackHomeRow.vue";

const props = defineProps<{ org: string; clusterName?: string }>();
const emit = defineEmits<{ offered: [offered: boolean] }>();

const { t } = useI18nTyped();
const pack = packById("kubernetes")!;
const popup = useStarterPackPopup(props.org);
const entry = popup.entryOf(pack);
const flow = entry.flow;
const matcher = useStarterPackMatcher(props.org, { poll: true });
const gate = usePackGate(props.org);
// The typed cluster names the scope until the pack's own match sees it.
const openPack = () => {
  void entry.matcher.checkShared();
  void popup.openWhenReady(entry, { clusters: props.clusterName ? [props.clusterName] : [] });
};

onMounted(() => {
  void flow.load();
  void matcher.check();
});
watch(matcher.state, (state) => {
  if (state === "matched") void flow.loadPreview();
});
// A long wait still offers the logs-only setup, so its card counts load too.
watch(matcher.waitedLong, (long) => {
  if (long) void flow.loadPreview();
});

const offering = computed(
  () =>
    gate.visible.value &&
    flow.loaded.value &&
    !flow.installed.value &&
    (matcher.state.value === "matched" || matcher.state.value === "waiting"),
);
const pending = computed(
  () =>
    gate.visible.value &&
    (!flow.loaded.value ||
      matcher.state.value === "checking" ||
      (matcher.state.value === "waiting" && !matcher.waitedLong.value)),
);
watch(
  () => offering.value || pending.value,
  (offered) => emit("offered", offered),
  { immediate: true },
);

const showRow = computed(
  () =>
    gate.visible.value &&
    matcher.state.value !== "error" &&
    !flow.interrupted.value &&
    flow.runningBy.value === null &&
    (flow.forbidden.value || pending.value || offering.value),
);
const view = computed<HomePackView>(() => {
  if (flow.forbidden.value) return "forbidden";
  if (pending.value) return "loading";
  return "offer";
});
const unfinished = computed(() => flow.interrupted.value || flow.runningBy.value !== null);
const interruptedLine = computed(() => {
  const title = packTitle(pack);
  const running = flow.runningBy.value;
  if (running !== null) return packBusyText(t, running, flow.isMe(running), title);
  const by = flow.interruptedBy.value;
  if (by === null) {
    const counts = { made: flow.made.value.length, total: flow.toCreate.value.length };
    return t("starterPacks.home.interrupted", { title, ...counts });
  }
  return by
    ? t("starterPacks.home.startedBy", { who: raw(by), title })
    : t("starterPacks.home.startedBySomeone", { title });
});
const row: HomePackRowItem = {
  pack,
  title: packTitle(pack),
  testId: (id: string) => id.replace("home-pack", "first-event-status-pack"),
  flow,
  matcher,
  view,
  startSetup: openPack,
};
</script>

<template>
  <Teleport defer to="#first-event-pack-actions">
    <OButton
      v-if="matcher.state.value === 'error'"
      variant="ghost"
      size="sm-action"
      data-test="first-event-status-pack-retry-btn"
      @click="matcher.retry()"
    >
      {{ t("starterPacks.retryCheck") }}
    </OButton>
  </Teleport>
  <OBanner
    v-if="gate.visible.value && unfinished"
    variant="warning"
    dense
    inline-actions
    data-test="first-event-status-pack-interrupted"
  >
    <span data-test="first-event-status-pack-interrupted-line">{{ interruptedLine }}</span>
    <template v-if="flow.interrupted.value && !flow.forbidden.value" #actions>
      <OButton
        variant="primary"
        size="sm-action"
        data-test="first-event-status-pack-interrupted-btn"
        @click="openPack"
      >
        {{ t("starterPacks.progress.finish") }}
      </OButton>
    </template>
  </OBanner>
  <StarterPackHomeRow v-else-if="showRow" :item="row" :first="view !== 'forbidden'" />
</template>
