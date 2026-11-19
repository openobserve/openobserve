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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { StarterPack } from "@/composables/starterPacks/types";
import { matchSource, useHomePacks, type HomePacks } from "@/composables/starterPacks/useHomePacks";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import { useStarterPackPopup, type RailPack } from "@/composables/starterPacks/useStarterPackPopup";
import { useI18nTyped } from "@/types/i18n";
import StarterPackListPane from "./StarterPackListPane.vue";

const props = defineProps<{ org: string; packs?: StarterPack[] }>();
// Hands the pack state to Home, which hides Overview while the offer shows.
const emit = defineEmits<{ ready: [packs: HomePacks | null] }>();

const { t } = useI18nTyped();
const gate = usePackGate(props.org);
const home = useHomePacks(props.org, props.packs, () => gate.visible.value);
// An org past onboarding shows no packs, so Home keeps its Overview.
watch(
  () => gate.visible.value,
  (visible) => emit("ready", visible ? home : null),
  { immediate: true },
);
onBeforeUnmount(() => emit("ready", null));
// The badge belongs on a row the user can start, never on an Ask an admin row.
const bestStartId = computed(
  () => home.offered.value.find((item) => item.view.value === "offer")?.pack.id ?? null,
);
const rows = computed<RailPack[]>(() =>
  home.offered.value.map((item) => ({
    entry: { pack: item.pack, flow: item.flow, matcher: item.matcher },
    source: matchSource(item),
    setUp: false,
    stopped: false,
  })),
);
const selectedId = ref<string | null>(null);
// Opens on a pack the user can start, so an Ask an admin pack never hides the button.
const selected = computed(() => {
  const offered = home.offered.value;
  const id = selectedId.value ?? bestStartId.value;
  return offered.find((item) => item.pack.id === id) ?? offered[0] ?? null;
});
const opening = useStarterPackPopup(props.org).opening;
const busy = computed(
  () =>
    !!selected.value &&
    (selected.value.flow.running.value || opening.value === selected.value.pack.id),
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
      class="border-border-default rounded-surface grid h-105 grid-cols-[14.5rem_minmax(0,1fr)] overflow-hidden border"
      data-test="home-pack-card-skeleton"
    >
      <div class="bg-surface-panel border-border-default flex flex-col gap-2 border-e px-2 py-2.5">
        <OSkeleton v-for="n in 2" :key="n" class="h-12.5 w-full" />
      </div>
      <div class="flex flex-col gap-3 p-4">
        <div class="flex items-center gap-3">
          <OSkeleton class="size-9 shrink-0" />
          <div class="flex flex-1 flex-col gap-1.5">
            <OSkeleton class="h-4 w-1/4" />
            <OSkeleton class="h-3 w-1/6" />
          </div>
        </div>
        <div class="grid grid-cols-3 gap-2.5">
          <OSkeleton v-for="n in 3" :key="n" class="h-34 w-full" />
        </div>
      </div>
    </div>

    <template v-for="item in home.notices.value" :key="item.pack.id">
      <OBanner
        v-if="item.view.value === 'interrupted'"
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

    <section
      v-if="home.showSection.value"
      class="bg-surface-base border-border-default rounded-surface flex h-105 flex-col overflow-hidden border"
      data-test="home-pack-offer"
    >
      <StarterPackListPane
        class="min-h-0 flex-1"
        :rows="rows"
        :selected-id="selected?.pack.id"
        :best-start-id="bestStartId"
        test-prefix="home-pack-list"
        @select="selectedId = $event"
      />
      <footer
        v-if="selected"
        class="border-border-default flex h-14.5 shrink-0 items-center justify-end gap-2 border-t px-4"
      >
        <span
          v-if="selected.view.value === 'forbidden'"
          class="text-text-secondary flex items-center gap-2 text-xs"
          data-test="home-pack-list-ask-admin"
        >
          <OIcon name="lock" size="sm" class="shrink-0" />
          {{ t("starterPacks.askAdmin") }}
        </span>
        <OButton
          v-else
          variant="primary"
          size="sm-action"
          class="min-w-35"
          :disabled="busy"
          :loading="busy"
          :aria-label="t('starterPacks.home.reviewSetUpLabel', { title: selected.title })"
          data-test="home-pack-list-primary-btn"
          @click="selected.startSetup"
        >
          {{ t("starterPacks.home.reviewSetUp") }}
        </OButton>
      </footer>
    </section>
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
