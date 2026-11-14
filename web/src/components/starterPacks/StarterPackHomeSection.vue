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
import { computed, onBeforeUnmount } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { StarterPack } from "@/composables/starterPacks/types";
import { useHomePacks, type HomePacks } from "@/composables/starterPacks/useHomePacks";
import { raw, useI18nTyped } from "@/types/i18n";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import StarterPackFindMore from "./StarterPackFindMore.vue";
import StarterPackHealthLine from "./StarterPackHealthLine.vue";
import StarterPackHomeRow from "./StarterPackHomeRow.vue";
import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";
import TurnOnAlertsDrawer from "./TurnOnAlertsDrawer.vue";

const props = defineProps<{ org: string; packs?: StarterPack[] }>();
// Hands the one copy of pack state to Home, which shares it with the Overview tab.
const emit = defineEmits<{ ready: [packs: HomePacks | null] }>();

const { t } = useI18nTyped();
const home = useHomePacks(props.org, props.packs);
emit("ready", home);
onBeforeUnmount(() => emit("ready", null));

const compact = computed(() =>
  home.items.filter((item) =>
    ["hiddenAdmin", "dismissed", "interrupted", "error"].includes(item.view.value),
  ),
);
</script>

<template>
  <div class="mt-2.5 mb-3 flex shrink-0 flex-col gap-3 empty:hidden" data-test="home-pack-section">
    <div
      v-if="home.loading.value"
      class="border-border-default rounded-surface flex flex-col gap-2 border p-4"
      data-test="home-pack-card-skeleton"
    >
      <OSkeleton class="h-6 w-1/2" />
      <OSkeleton class="h-4 w-full" />
      <OSkeleton class="h-8 w-1/3" />
    </div>

    <template v-for="item in compact" :key="item.pack.id">
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
          <OButton
            variant="ghost-primary"
            size="sm-action"
            :data-test="item.testId('home-pack-card-library-link')"
            @click="home.library"
          >
            {{ t("starterPacks.library") }}
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

    <template v-for="item in home.setUp.value" :key="`health-${item.pack.id}`">
      <StarterPackHealthLine :org="org" :pack="item.pack" />
    </template>

    <OBanner
      v-if="home.empty.value"
      variant="default"
      dense
      inline-actions
      data-test="home-pack-empty"
    >
      {{ t("starterPacks.home.empty") }}
      <template #actions>
        <OButton
          variant="ghost-primary"
          size="sm-action"
          data-test="home-pack-empty-library-link"
          @click="home.library"
        >
          {{ t("starterPacks.library") }}
        </OButton>
      </template>
    </OBanner>

    <section v-if="home.showSection.value" class="flex flex-col gap-2" data-test="home-pack-offer">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-test="home-pack-offer-header">
        <h2 class="text-text-heading text-base font-semibold">
          {{ t("starterPacks.home.stripTitle") }}
        </h2>
        <OText variant="meta">
          {{ raw("·") }}
          {{
            t(
              "starterPacks.home.stripMeta",
              { count: home.offered.value.length },
              home.offered.value.length,
            )
          }}
        </OText>
      </div>

      <div
        class="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1"
        data-test="home-pack-offer-rows"
      >
        <StarterPackHomeRow v-for="item in home.offered.value" :key="item.pack.id" :item="item" />
        <div
          class="border-border-default rounded-surface flex min-w-0 flex-col items-start justify-center gap-2.5 border border-dashed p-3.5"
          data-test="home-pack-find-other"
        >
          <div class="text-text-secondary flex items-center gap-2">
            <OIcon name="manage-search" size="sm" class="shrink-0" />
            <OText variant="body-strong" class="text-text-heading">{{
              t("starterPacks.home.findOther")
            }}</OText>
          </div>
          <OText variant="meta">{{ t("starterPacks.home.findOtherSub") }}</OText>
          <OButton
            variant="outline"
            size="sm"
            data-test="home-pack-find-other-browse-btn"
            @click="home.library"
          >
            {{ t("starterPacks.home.browse") }}
          </OButton>
        </div>
      </div>
    </section>

    <div
      v-if="
        !home.showSection.value &&
        !home.setUp.value.length &&
        !home.loading.value &&
        home.hasData.value
      "
      class="flex justify-end"
    >
      <StarterPackFindMore :org="org" variant="link" />
    </div>

    <template v-for="item in home.items" :key="`overlays-${item.pack.id}`">
      <StarterPackDrawer
        v-model:open="item.drawerOpen.value"
        :flow="item.flow"
        :clusters="item.matcher.clusters.value"
        @copy-link="item.copyLink"
      />
      <TurnOnAlertsDrawer
        v-model:open="item.turnOnOpen.value"
        :flow="item.flow"
        :clusters="item.matcher.clusters.value"
      />
      <StarterPackUndoDialog v-model:open="item.undoOpen.value" :flow="item.flow" mode="undo" />
    </template>
  </div>
</template>
