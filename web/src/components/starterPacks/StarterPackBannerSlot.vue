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
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import StarterPackInstallCard from "./StarterPackInstallCard.vue";

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
    <template v-else-if="flow.forbidden.value">
      <OText data-test="first-event-status-pack-card">{{ t("starterPacks.noPermission") }}</OText>
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
    <OButton
      v-else-if="pending"
      class="w-68"
      variant="primary"
      size="sm-action"
      disabled
      data-test="first-event-status-pack-checking"
    >
      {{ t("starterPacks.checking") }}
    </OButton>
    <template v-else-if="flow.interrupted.value">
      <OButton
        class="w-68"
        variant="primary"
        size="sm-action"
        data-test="first-event-status-pack-setup-btn"
        @click="drawerOpen = true"
      >
        {{ t("starterPacks.progress.finish") }}
      </OButton>
    </template>
  </Teleport>
  <StarterPackInstallCard
    :title="t(KUBERNETES_PACK.titleKey)"
    v-if="offering && !pending && !flow.interrupted.value && !flow.forbidden.value"
    :flow="flow"
    :stream-count="matcher.streams.value.length"
    test-id="first-event-status-pack-card"
    :primary-label="matcher.waitedLong.value ? t('starterPacks.partial') : undefined"
    :primary-test-id="
      matcher.waitedLong.value
        ? 'first-event-status-pack-partial-btn'
        : 'first-event-status-pack-setup-btn'
    "
    @install="startSetup"
    @details="drawerOpen = true"
  />
  <StarterPackDrawer
    v-model:open="drawerOpen"
    :flow="flow"
    :clusters="clusters"
    @copy-link="copyLink"
  />
</template>
