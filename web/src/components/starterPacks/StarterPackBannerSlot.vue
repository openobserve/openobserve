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
import { computed, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { packById } from "@/composables/starterPacks/usePackCatalog";
import type { HomePackRowItem, HomePackView } from "@/composables/starterPacks/useHomePacks";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import StarterPackHomeRow from "./StarterPackHomeRow.vue";

const props = defineProps<{ org: string; clusterName?: string }>();
const emit = defineEmits<{ offered: [offered: boolean] }>();

const { t } = useI18nTyped();
const pack = packById("kubernetes")!;
const flow = useStarterPackFlow(props.org, pack);
const matcher = useStarterPackMatcher(props.org, { poll: true });
const drawerOpen = ref(false);

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

const clusters = computed(() => {
  const typed = props.clusterName ? [props.clusterName] : [];
  return [...new Set([...typed, ...matcher.clusters.value])];
});
const offering = computed(
  () =>
    flow.loaded.value &&
    !flow.installed.value &&
    (matcher.state.value === "matched" || matcher.state.value === "waiting"),
);
const pending = computed(
  () =>
    !flow.loaded.value ||
    matcher.state.value === "checking" ||
    (matcher.state.value === "waiting" && !matcher.waitedLong.value),
);
watch(
  () => offering.value || pending.value,
  (offered) => emit("offered", offered),
  { immediate: true },
);

const showRow = computed(
  () =>
    matcher.state.value !== "error" &&
    !flow.interrupted.value &&
    (flow.forbidden.value || pending.value || offering.value),
);
const view = computed<HomePackView>(() => {
  if (flow.forbidden.value) return "forbidden";
  if (pending.value) return "loading";
  return "offer";
});
const copyLink = () => copyToClipboard(flow.packLink(), t);
const row: HomePackRowItem = {
  pack,
  title: t(pack.titleKey),
  testId: (id: string) => id.replace("home-pack", "first-event-status-pack"),
  flow,
  matcher,
  view,
  copyLink,
  startSetup: () => (drawerOpen.value = true),
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
    v-if="flow.interrupted.value"
    variant="warning"
    dense
    inline-actions
    data-test="first-event-status-pack-interrupted"
  >
    {{
      t("starterPacks.home.interrupted", {
        title: row.title,
        made: flow.made.value.length,
        total: flow.toCreate.value.length,
      })
    }}
    <template #actions>
      <OButton
        variant="primary"
        size="sm-action"
        data-test="first-event-status-pack-interrupted-btn"
        @click="drawerOpen = true"
      >
        {{ t("starterPacks.progress.finish") }}
      </OButton>
    </template>
  </OBanner>
  <StarterPackHomeRow v-else-if="showRow" :item="row" :first="view !== 'forbidden'" />
  <StarterPackDrawer
    v-model:open="drawerOpen"
    :flow="flow"
    :clusters="clusters"
    :match-state="matcher.state.value"
    @copy-link="copyLink"
  />
</template>
