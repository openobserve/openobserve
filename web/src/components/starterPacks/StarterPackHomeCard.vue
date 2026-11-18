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
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import type { StarterPack } from "@/composables/starterPacks/types";
import { usePackDismissal, usePackHiddenForOrg } from "@/composables/starterPacks/packDismissal";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import StarterPackInstallCard from "./StarterPackInstallCard.vue";
import StarterPackHealthLine from "./StarterPackHealthLine.vue";
import TurnOnAlertsDrawer from "./TurnOnAlertsDrawer.vue";

const props = withDefaults(
  defineProps<{
    org: string;
    pack?: StarterPack;
    /** Off for every card after the first, so Home says no match only once. */
    showEmpty?: boolean;
  }>(),
  { pack: () => KUBERNETES_PACK, showEmpty: true },
);
const emit = defineEmits<{ offered: [offered: boolean] }>();

const { t } = useI18nTyped();
const router = useRouter();
const pack = props.pack;
// Kubernetes keeps the original ids, so existing tests still find its card.
const testId = (id: string) =>
  pack === KUBERNETES_PACK ? id : id.replace("home-pack", `home-pack-${pack.id}`);
const title = t(pack.titleKey);
const flow = useStarterPackFlow(props.org, pack);
const matcher = useStarterPackMatcher(props.org, { pack });
const { dismissed, dismiss, restore } = usePackDismissal("home", props.org, pack.id);
const orgHide = usePackHiddenForOrg(props.org, pack.id);
const drawerOpen = ref(false);
const turnOnOpen = ref(false);

onMounted(() => {
  void flow.load();
  void orgHide.load();
});
// Home is the busiest page, so only a user who can reach the offer pays for the check.
const wantsMatch = computed(
  () =>
    flow.loaded.value &&
    orgHide.loaded.value &&
    !flow.record.value &&
    !dismissed.value &&
    !orgHide.hidden.value,
);
watch(wantsMatch, (wanted) => {
  if (wanted) void matcher.check();
});
watch(drawerOpen, (isOpen) => {
  if (isOpen && matcher.state.value === "checking") void matcher.check();
});
watch(
  flow.isAdmin,
  (admin) => {
    if (admin) void orgHide.loadUserCount();
  },
  { immediate: true },
);
watch(matcher.state, (state) => {
  if (state === "matched") void flow.loadPreview();
});

const canHideForAll = computed(() => flow.isAdmin.value && orgHide.sharedOrg.value);
type CardView =
  | "hidden"
  | "hiddenAdmin"
  | "loading"
  | "dismissed"
  | "interrupted"
  | "installed"
  | "error"
  | "forbidden"
  | "offer"
  | "empty";
const view = computed<CardView>(() => {
  if (!flow.loaded.value || !orgHide.loaded.value) return "loading";
  if (flow.interrupted.value) return "interrupted";
  if (dismissed.value) return "dismissed";
  if (flow.record.value) return "installed";
  if (orgHide.hidden.value) return flow.isAdmin.value ? "hiddenAdmin" : "hidden";
  if (flow.loadFailed.value || matcher.state.value === "error") return "error";
  if (matcher.state.value === "checking") return "loading";
  if (flow.forbidden.value) return "forbidden";
  if (matcher.state.value === "matched") return "offer";
  return props.showEmpty ? "empty" : "hidden";
});
watch(view, (next) => emit("offered", next !== "empty" && next !== "hidden"), {
  immediate: true,
});
const startSetup = async () => {
  drawerOpen.value = true;
  if (await flow.install()) {
    drawerOpen.value = false;
    await flow.land();
  }
};
const retryCheck = () => Promise.all([flow.load(), matcher.retry()]);
const library = () =>
  router.push({ name: "alertLibrary", query: { org_identifier: props.org } }).catch(() => {});
const viewPack = () => router.push(flow.packRoute.value).catch(() => {});
const keepOff = async () => {
  try {
    await flow.keepOff();
  } catch {
    toast({ variant: "error", message: t("starterPacks.home.keepOffFailed") });
  }
};
const setHidden = async (work: () => Promise<void>) => {
  try {
    await work();
  } catch {
    toast({ variant: "error", message: t("starterPacks.home.hideFailed") });
  }
};
const copyLink = () => copyToClipboard(flow.packLink(), t);
</script>

<template>
  <div
    v-if="view !== 'hidden'"
    class="mt-2.5 mb-3 shrink-0"
    :data-test="testId('home-pack-section')"
  >
    <div
      v-if="view === 'loading'"
      class="border-border-default rounded-default flex flex-col gap-2 border p-3"
      :data-test="testId('home-pack-card-skeleton')"
    >
      <OSkeleton class="h-6 w-1/2" />
      <OSkeleton class="h-4 w-full" />
      <OSkeleton class="h-8 w-1/3" />
    </div>

    <OBanner v-else-if="view === 'hiddenAdmin'" variant="default" dense inline-actions>
      {{ t("starterPacks.home.hiddenForEveryone", { title }) }}
      <template #actions>
        <OButton
          variant="ghost"
          size="sm-action"
          :data-test="testId('home-pack-card-show-all-btn')"
          @click="setHidden(orgHide.show)"
        >
          {{ t("starterPacks.home.showForEveryone") }}
        </OButton>
      </template>
    </OBanner>

    <OBanner v-else-if="view === 'dismissed'" variant="default" dense inline-actions>
      {{ t("starterPacks.home.hidden", { title }) }}
      <template #actions>
        <OButton
          variant="ghost"
          size="sm-action"
          :data-test="testId('home-pack-card-show-again-btn')"
          @click="restore"
        >
          {{ t("starterPacks.home.showAgain") }}
        </OButton>
        <OButton
          variant="ghost-primary"
          size="sm-action"
          :data-test="testId('home-pack-card-library-link')"
          @click="library"
        >
          {{ t("starterPacks.library") }}
        </OButton>
      </template>
    </OBanner>

    <OBanner v-else-if="view === 'interrupted'" variant="warning" dense inline-actions>
      {{
        t("starterPacks.progress.interrupted", {
          made: flow.made.value.length,
          total: flow.toCreate.value.length,
        })
      }}
      <template #actions>
        <OButton
          variant="primary"
          size="sm-action"
          :data-test="testId('home-pack-interrupted-btn')"
          @click="drawerOpen = true"
        >
          {{ t("starterPacks.progress.finish") }}
        </OButton>
      </template>
    </OBanner>

    <div v-else-if="view === 'installed'" class="flex flex-col gap-3">
      <StarterPackHealthLine :org="props.org" :pack="pack" />
      <OBanner
        v-if="flow.remindAlerts.value"
        variant="info"
        dense
        inline-actions
        :data-test="testId('home-pack-reminder')"
      >
        {{
          t(
            "starterPacks.home.reminder",
            { count: flow.alertsOff.value, title },
            flow.alertsOff.value,
          )
        }}
        <template #actions>
          <OButton
            v-if="flow.canManage.value"
            variant="ghost"
            size="sm-action"
            :data-test="testId('home-pack-reminder-keep-off-btn')"
            @click="keepOff"
          >
            {{ t("starterPacks.home.keepOff") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm-action"
            :data-test="testId('home-pack-reminder-dismiss-btn')"
            @click="dismiss"
          >
            {{ t("starterPacks.home.notNow") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            :data-test="testId('home-pack-view-btn')"
            @click="viewPack"
          >
            {{ t("starterPacks.home.viewPack") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :data-test="testId('home-pack-reminder-turn-on-btn')"
            @click="turnOnOpen = true"
          >
            {{ t("starterPacks.home.turnOn") }}
          </OButton>
        </template>
      </OBanner>
      <div
        class="border-border-default rounded-default flex w-56 flex-col border p-3"
        :data-test="testId('home-pack-alerts-on-tile')"
      >
        <OText variant="meta">{{ t("starterPacks.home.alertsOnLabel") }}</OText>
        <strong class="text-lg">{{
          t("starterPacks.home.alertsOnValue", {
            on: flow.alertsOn.value,
            total: flow.alertsTotal.value,
          })
        }}</strong>
      </div>
    </div>

    <OBanner v-else-if="view === 'error'" variant="default" dense inline-actions>
      {{ t("starterPacks.home.error") }}
      <template #actions>
        <OButton
          variant="outline"
          size="sm-action"
          :data-test="testId('home-pack-card-retry-btn')"
          @click="retryCheck"
        >
          {{ t("common.retry") }}
        </OButton>
      </template>
    </OBanner>

    <OBanner v-else-if="view === 'forbidden'" variant="default" dense inline-actions icon="lock">
      {{ t("starterPacks.askAdmin") }}
      <template #actions>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="content-copy"
          :data-test="testId('home-pack-card-copy-link-btn')"
          @click="copyLink"
        >
          {{ t("starterPacks.copyLink") }}
        </OButton>
      </template>
    </OBanner>

    <StarterPackInstallCard
      v-else-if="view === 'offer'"
      :flow="flow"
      :stream-count="matcher.streams.value.length"
      :title="title"
      :test-id="testId('home-pack-card')"
      dismissible
      @install="startSetup"
      @details="drawerOpen = true"
      @dismiss="dismiss"
    >
      <template v-if="canHideForAll" #actions>
        <OButton
          variant="ghost"
          size="sm-action"
          :data-test="testId('home-pack-card-hide-all-btn')"
          @click="setHidden(orgHide.hide)"
        >
          {{ t("starterPacks.home.hideForEveryone") }}
        </OButton>
      </template>
    </StarterPackInstallCard>

    <OBanner v-else variant="default" dense inline-actions>
      {{ t("starterPacks.home.empty") }}
      <template #actions>
        <OButton
          variant="ghost-primary"
          size="sm-action"
          :data-test="testId('home-pack-empty-library-link')"
          @click="library"
        >
          {{ t("starterPacks.library") }}
        </OButton>
      </template>
    </OBanner>

    <StarterPackDrawer
      v-model:open="drawerOpen"
      :flow="flow"
      :clusters="matcher.clusters.value"
      @copy-link="copyLink"
    />
    <TurnOnAlertsDrawer v-model:open="turnOnOpen" :flow="flow" :clusters="matcher.clusters.value" />
  </div>
</template>
