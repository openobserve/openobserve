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
import { computed, onBeforeUnmount, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { StarterPack } from "@/composables/starterPacks/types";
import { useHomePacks, type HomePacks } from "@/composables/starterPacks/useHomePacks";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import { useI18nTyped } from "@/types/i18n";
import StarterPackHomeRow from "./StarterPackHomeRow.vue";
import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";

const props = defineProps<{ org: string; packs?: StarterPack[] }>();
// Hands the pack state to Home, which hides Overview while the offer shows.
const emit = defineEmits<{ ready: [packs: HomePacks | null] }>();

const { t } = useI18nTyped();
const home = useHomePacks(props.org, props.packs);
const gate = usePackGate(props.org);
// An org past onboarding shows no packs, so Home keeps its Overview.
watch(
  () => gate.visible.value,
  (visible) => emit("ready", visible ? home : null),
  { immediate: true },
);
onBeforeUnmount(() => emit("ready", null));
// The badge belongs on a row the user can start, never on an Ask an admin row.
const firstOffer = computed(() =>
  home.offered.value.findIndex((item) => item.view.value === "offer"),
);
</script>

<template>
  <div
    v-if="gate.visible.value"
    class="mt-2.5 mb-3 flex shrink-0 flex-col gap-3 empty:hidden"
    data-test="home-pack-section"
  >
    <div
      v-if="home.offerShown.value"
      class="bg-surface-panel border-border-default rounded-surface flex items-center gap-4 border p-4"
      data-test="home-pack-hero"
    >
      <span
        class="relative flex size-11 shrink-0 items-center justify-center"
        data-test="home-pack-hero-icon"
      >
        <span
          class="pack-hero-ring border-status-success-text pointer-events-none absolute inset-0 rounded-full border-2 opacity-0"
          aria-hidden="true"
        />
        <span
          class="pack-hero-ring pack-hero-ring-late border-status-success-text pointer-events-none absolute inset-0 rounded-full border-2 opacity-0"
          aria-hidden="true"
        />
        <span
          class="bg-icon-chip-success-bg text-icon-chip-success-text rounded-default relative flex size-11 items-center justify-center"
        >
          <OIcon name="sensors" size="md" />
        </span>
      </span>
      <div class="flex min-w-0 flex-col gap-1">
        <OText variant="section" as="div" data-test="home-pack-label">{{
          t("starterPacks.home.label")
        }}</OText>
        <h2 class="text-text-heading text-base font-semibold">
          {{ t("starterPacks.home.heroTitle") }}
        </h2>
        <OText variant="meta" wrap>{{ t("starterPacks.home.heroSub") }}</OText>
      </div>
    </div>
    <OText v-else-if="home.labelShown.value" variant="section" data-test="home-pack-label">{{
      t("starterPacks.home.label")
    }}</OText>
    <div
      v-if="home.loading.value"
      class="border-border-default rounded-surface flex flex-col overflow-hidden border"
      data-test="home-pack-card-skeleton"
    >
      <div class="border-border-subtle flex items-center gap-3 border-b px-4 py-3">
        <OSkeleton class="size-8 shrink-0" />
        <div class="flex flex-1 flex-col gap-1.5">
          <OSkeleton class="h-4 w-1/4" />
          <OSkeleton class="h-3 w-1/6" />
        </div>
        <OSkeleton class="h-8 w-36 shrink-0" />
      </div>
      <div class="flex max-md:flex-col">
        <div
          class="border-border-subtle flex w-60 shrink-0 flex-col gap-2 border-e px-4 py-3 max-md:w-full max-md:border-e-0 max-md:border-b"
        >
          <OSkeleton class="h-4 w-3/4" />
          <OSkeleton class="h-4 w-2/3" />
        </div>
        <div class="grid flex-1 grid-cols-3 gap-3 p-3 max-sm:grid-cols-1">
          <OSkeleton v-for="n in 3" :key="n" class="h-16 w-full" />
        </div>
      </div>
    </div>

    <template v-for="item in home.notices.value" :key="item.pack.id">
      <OBanner
        v-if="item.view.value === 'hiddenAdmin'"
        variant="default"
        dense
        inline-actions
        :data-test="item.testId('home-pack-hidden-all')"
      >
        {{ t("starterPacks.home.hiddenForEveryone", { title: item.title }) }}
        <template #actions>
          <OButton
            variant="ghost"
            size="sm-action"
            :data-test="item.testId('home-pack-card-show-all-btn')"
            @click="item.setHidden(item.orgHide.show)"
          >
            {{ t("starterPacks.home.showForEveryone") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else-if="item.view.value === 'dismissed'"
        variant="default"
        dense
        inline-actions
        :data-test="item.testId('home-pack-dismissed')"
      >
        {{ t("starterPacks.home.hidden", { title: item.title }) }}
        <template #actions>
          <OButton
            variant="ghost"
            size="sm-action"
            :data-test="item.testId('home-pack-card-show-again-btn')"
            @click="item.dismissal.restore"
          >
            {{ t("starterPacks.home.showAgain") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else-if="item.view.value === 'interrupted'"
        variant="warning"
        dense
        inline-actions
        :data-test="item.testId('home-pack-interrupted')"
      >
        {{
          t("starterPacks.home.interrupted", {
            title: item.title,
            made: item.flow.made.value.length,
            total: item.flow.toCreate.value.length,
          })
        }}
        <template #actions>
          <OButton
            variant="primary"
            size="sm-action"
            :data-test="item.testId('home-pack-interrupted-btn')"
            @click="item.openDetails"
          >
            {{ t("starterPacks.progress.finish") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else
        variant="default"
        dense
        inline-actions
        :data-test="item.testId('home-pack-error')"
      >
        {{ t("starterPacks.home.error") }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm-action"
            :data-test="item.testId('home-pack-card-retry-btn')"
            @click="item.retry"
          >
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>
    </template>

    <OBanner v-if="home.askAdmin.value" variant="default" dense data-test="home-pack-ask-admin">
      {{ t("starterPacks.home.askAdminLine") }}
    </OBanner>

    <section v-if="home.showSection.value" class="flex flex-col gap-3" data-test="home-pack-offer">
      <div class="flex flex-col gap-3" data-test="home-pack-offer-rows">
        <StarterPackHomeRow
          v-for="(item, index) in home.offered.value"
          :key="item.pack.id"
          :item="item"
          :first="index === firstOffer"
        />
      </div>
    </section>

    <StarterPackUndoDialog
      v-for="item in home.items"
      :key="`undo-${item.pack.id}`"
      v-model:open="item.undoOpen.value"
      :flow="item.flow"
      mode="undo"
    />
  </div>
</template>

<style scoped>
/* keep(keyframes): scoped rewrites the keyframe name, so the rings' animation and its keyframes stay together */
@media (prefers-reduced-motion: no-preference) {
  .pack-hero-ring {
    animation: pack-hero-ring 2.4s ease-out infinite;
  }

  .pack-hero-ring-late {
    animation-delay: 1.2s;
  }
}

@keyframes pack-hero-ring {
  from {
    opacity: 0.3;
    transform: scale(0.55);
  }
  to {
    opacity: 0;
    transform: scale(1.5);
  }
}
</style>
