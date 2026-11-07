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
import { useRouter } from "vue-router";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import { packScope } from "@/composables/starterPacks/packCopy";
import { usePackDismissal } from "@/composables/starterPacks/packDismissal";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";

const props = defineProps<{ org: string }>();

const { t } = useI18nTyped();
const router = useRouter();
const flow = useStarterPackFlow(props.org, KUBERNETES_PACK);
const matcher = useStarterPackMatcher(props.org);
const { dismissed, dismiss } = usePackDismissal("landing", props.org, KUBERNETES_PACK.id);

const HOUR_US = 60 * 60 * 1_000_000;
const drawerOpen = ref(false);
const undoOpen = ref(false);

onMounted(() => void flow.load());
// A page without a pack spends nothing past the record list.
watch(flow.record, (record, previous) => {
  if (!record || previous) return;
  void matcher.check();
  void flow.loadPreview();
});

const off = computed(() => flow.alertsOff.value);
const failedCount = computed(() => flow.failed.value.length);
const hoursLeft = computed(() => Math.floor(flow.undoLeftUs.value / HOUR_US));
const undoLabel = computed(() =>
  hoursLeft.value > 0
    ? t("starterPacks.landing.undoLeft", { hours: hoursLeft.value })
    : t("starterPacks.landing.undoLeftSoon"),
);
const visible = computed(() => {
  if (!flow.record.value || dismissed.value) return false;
  return off.value > 0 || failedCount.value > 0 || flow.undoLeftUs.value > 0;
});
const readOnly = computed(() => !flow.canManage.value);
const message = computed(() => {
  if (readOnly.value) return t("starterPacks.landing.readOnly", { count: off.value }, off.value);
  if (failedCount.value > 0) {
    return t(
      "starterPacks.landing.partial",
      { count: off.value, failed: failedCount.value },
      off.value,
    );
  }
  return off.value > 0
    ? t("starterPacks.landing.set", { count: off.value }, off.value)
    : t("starterPacks.landing.setAllOn");
});
const resultText = computed(() => {
  const result = flow.removal.value;
  if (!result) return undefined;
  if (flow.removalFailed.value) {
    return t("starterPacks.landing.undoFailed", { count: result.kept.length }, result.kept.length);
  }
  const removed = result.removed.filter(({ kind }) => kind !== "folder").length;
  return result.kept.length
    ? t("starterPacks.landing.undone", { removed, kept: result.kept.length }, removed)
    : t("starterPacks.landing.undoneAll", { removed }, removed);
});
const scope = computed(() => packScope(t, matcher.clusters.value));
const openAlerts = () => router.push(flow.alertsRoute.value).catch(() => {});
</script>

<template>
  <OBanner
    v-if="resultText"
    :variant="flow.removalFailed.value ? 'error-soft' : 'info'"
    dense
    inline-actions
    data-test="kubernetes-pack-undo-result"
  >
    {{ resultText }}
    <template #actions>
      <OButton
        v-if="flow.removalFailed.value"
        variant="outline"
        size="sm-action"
        @click="flow.undo()"
      >
        {{ t("common.retry") }}
      </OButton>
    </template>
  </OBanner>
  <OBanner
    v-else-if="visible"
    :variant="failedCount > 0 ? 'warning' : 'info'"
    dense
    inline-actions
    :data-test="readOnly ? 'kubernetes-pack-undo-row-readonly' : 'kubernetes-pack-undo-row'"
  >
    <span>{{ message }}</span>
    <template #actions>
      <div class="flex items-center gap-2">
        <OButton
          v-if="flow.canUndo.value"
          variant="ghost-destructive"
          size="sm-action"
          data-test="kubernetes-pack-undo-btn"
          @click="undoOpen = true"
        >
          {{ undoLabel }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm-action"
          data-test="kubernetes-pack-not-now-btn"
          @click="dismiss"
        >
          {{ t("starterPacks.home.notNow") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          data-test="kubernetes-pack-view-btn"
          @click="drawerOpen = true"
        >
          {{ t("starterPacks.home.viewPack") }}
        </OButton>
        <OButton
          v-if="off > 0 && !readOnly"
          variant="primary"
          size="sm-action"
          data-test="kubernetes-pack-turn-on-btn"
          @click="openAlerts"
        >
          {{ t("starterPacks.home.turnOn") }}
        </OButton>
      </div>
    </template>
  </OBanner>
  <OText
    v-if="visible && !resultText"
    variant="meta"
    class="px-3 py-1"
    data-test="kubernetes-pack-scope"
    >{{ scope }}</OText
  >
  <StarterPackDrawer v-model:open="drawerOpen" :flow="flow" :clusters="matcher.clusters.value" />
  <StarterPackUndoDialog v-model:open="undoOpen" :flow="flow" mode="undo" />
</template>
