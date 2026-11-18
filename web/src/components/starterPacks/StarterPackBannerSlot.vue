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
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import StarterPackInstallCard, { type StarterPackCardStatus } from "./StarterPackInstallCard.vue";

const props = defineProps<{ org: string; clusterName?: string }>();
const emit = defineEmits<{ offered: [offered: boolean] }>();

const { t } = useI18nTyped();
const flow = useStarterPackFlow(props.org, KUBERNETES_PACK);
const matcher = useStarterPackMatcher(props.org, { poll: true });
const drawerOpen = ref(false);

onMounted(() => {
  void flow.load();
  void matcher.check();
});
watch(matcher.state, (state) => {
  if (state === "matched") void flow.loadPreview();
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

const startSetup = async () => {
  drawerOpen.value = true;
  if (await flow.install()) {
    drawerOpen.value = false;
    await flow.land();
  }
};
const showCard = computed(
  () =>
    matcher.state.value !== "error" &&
    (flow.forbidden.value || pending.value || flow.interrupted.value || offering.value),
);
const status = computed<StarterPackCardStatus>(() => {
  if (flow.forbidden.value) return "forbidden";
  if (pending.value) return "checking";
  if (flow.interrupted.value) return "interrupted";
  if (flow.running.value) return "running";
  if (flow.failed.value.length) return "failed";
  if (matcher.waitedLong.value) return "waiting";
  return "ready";
});
const primaryTestId = computed(() => {
  if (status.value === "checking") return "first-event-status-pack-checking";
  if (status.value === "waiting") return "first-event-status-pack-partial-btn";
  return "first-event-status-pack-setup-btn";
});
const primaryLabel = computed(() => {
  if (status.value === "interrupted") return t("starterPacks.progress.finish");
  if (status.value === "waiting") return t("starterPacks.partial");
  return undefined;
});
const onPrimary = () => {
  if (flow.interrupted.value) drawerOpen.value = true;
  else void startSetup();
};
const copyLink = () => copyToClipboard(flow.packLink(), t);
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
  <StarterPackInstallCard
    v-if="showCard"
    :title="t(KUBERNETES_PACK.titleKey)"
    :flow="flow"
    :status="status"
    :stream-count="matcher.streams.value.length"
    test-id="first-event-status-pack-card"
    :primary-label="primaryLabel"
    :primary-test-id="primaryTestId"
    @install="onPrimary"
    @details="drawerOpen = true"
  >
    <template v-if="status === 'forbidden'" #actions>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="content-copy"
        data-test="first-event-status-pack-copy-link-btn"
        @click="copyLink"
      >
        {{ t("starterPacks.copyLink") }}
      </OButton>
    </template>
  </StarterPackInstallCard>
  <StarterPackDrawer
    v-model:open="drawerOpen"
    :flow="flow"
    :clusters="clusters"
    @copy-link="copyLink"
  />
</template>
