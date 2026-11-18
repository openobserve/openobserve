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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { KUBERNETES_PACK, STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { packScope } from "@/composables/starterPacks/packCopy";
import { usePackDismissal } from "@/composables/starterPacks/packDismissal";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";
import TurnOnAlertsDrawer from "./TurnOnAlertsDrawer.vue";

const props = defineProps<{ org: string; packId?: string }>();

const { t } = useI18nTyped();
const router = useRouter();
const pack = STARTER_PACKS.find(({ id }) => id === props.packId) ?? KUBERNETES_PACK;
const title = t(pack.titleKey);
const flow = useStarterPackFlow(props.org, pack);
const matcher = useStarterPackMatcher(props.org, { pack });
const { dismissed, dismiss } = usePackDismissal("landing", props.org, pack.id);

const HOUR_US = 60 * 60 * 1_000_000;
const turnOnOpen = ref(false);
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
const madeCount = computed(() => flow.made.value.length);
const availableLabel = computed(() =>
  hoursLeft.value > 0
    ? t("starterPacks.landing.available", { hours: hoursLeft.value })
    : t("starterPacks.landing.availableSoon"),
);
const visible = computed(() => {
  if (!flow.record.value || dismissed.value) return false;
  return off.value > 0 || failedCount.value > 0 || flow.undoLeftUs.value > 0;
});
const readOnly = computed(() => !flow.canManage.value);
const rowTest = computed(() => {
  if (readOnly.value) return "kubernetes-pack-undo-row-readonly";
  return flow.alertsOn.value > 0 ? "kubernetes-pack-watching-row" : "kubernetes-pack-undo-row";
});
const message = computed(() => {
  if (readOnly.value)
    return t("starterPacks.landing.readOnly", { count: off.value, title }, off.value);
  if (flow.alertsOn.value > 0) {
    return t("starterPacks.landing.watching", { on: flow.alertsOn.value, off: off.value, title });
  }
  return t(
    "starterPacks.landing.installedBar",
    { pack: title, count: madeCount.value },
    madeCount.value,
  );
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
const viewPack = () => router.push(flow.packRoute.value).catch(() => {});
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
    :variant="failedCount > 0 ? 'error-soft' : 'default'"
    :icon="failedCount > 0 ? 'error' : 'check'"
    dense
    inline-actions
    :data-test="rowTest"
  >
    <span data-test="kubernetes-pack-installed-message">{{ message }}</span>
    <template v-if="failedCount > 0">
      <span data-test="kubernetes-pack-attention"
        >{{ raw(" · ")
        }}{{ t("starterPacks.landing.attention", { count: failedCount }, failedCount) }}</span
      >
      <OButton
        variant="ghost-primary"
        size="sm-action"
        data-test="kubernetes-pack-see-which-btn"
        @click="viewPack"
      >
        {{ t("starterPacks.landing.seeWhich") }}
      </OButton>
    </template>
    <template #actions>
      <div class="flex items-center gap-2">
        <OButton
          v-if="off > 0 && !readOnly"
          variant="primary"
          size="sm-action"
          data-test="kubernetes-pack-turn-on-btn"
          @click="turnOnOpen = true"
        >
          {{ t("starterPacks.home.turnOn") }}
        </OButton>
        <template v-if="flow.canUndo.value">
          <OButton
            variant="ghost-destructive"
            size="sm-action"
            data-test="kubernetes-pack-undo-btn"
            @click="undoOpen = true"
          >
            {{ t("starterPacks.landing.undo") }}
          </OButton>
          <OText variant="meta" data-test="kubernetes-pack-undo-left">{{ availableLabel }}</OText>
        </template>
        <OButton
          variant="ghost"
          size="sm-action"
          data-test="kubernetes-pack-view-btn"
          @click="viewPack"
        >
          {{ t("starterPacks.home.viewPack") }}
        </OButton>
        <OButton
          variant="ghost"
          size="icon-sm"
          :aria-label="t('starterPacks.card.close')"
          data-test="kubernetes-pack-not-now-btn"
          @click="dismiss"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>
    </template>
  </OBanner>
  <OText
    v-if="visible && !resultText && pack.clusterScoped"
    variant="meta"
    class="px-3 py-1"
    data-test="kubernetes-pack-scope"
    >{{ scope }}</OText
  >
  <StarterPackUndoDialog v-model:open="undoOpen" :flow="flow" mode="undo" />
  <TurnOnAlertsDrawer v-model:open="turnOnOpen" :flow="flow" :clusters="matcher.clusters.value" />
</template>
