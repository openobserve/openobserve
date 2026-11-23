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
import { computed, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { packs } from "@/composables/starterPacks/usePackCatalog";
import { useBrowserMatches } from "@/composables/starterPacks/useBrowserMatches";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import { useRefreshMatches } from "@/composables/starterPacks/useRefreshMatches";
import {
  useStarterPackPopup,
  type PackEntry,
  type RailPack,
} from "@/composables/starterPacks/useStarterPackPopup";
import { raw, useI18nTyped } from "@/types/i18n";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import StarterPackListPane from "./StarterPackListPane.vue";

// The header passes its spacing class; the popup is a sibling of the chip.
defineOptions({ inheritAttrs: false });

const { t } = useI18nTyped();
const store = useStore();

// The header remounts this per org, so every composable below binds to one org.
const org: string = store.state.selectedOrganization?.identifier ?? "";
const matches = useBrowserMatches(org);
const checker = useRefreshMatches(org);
const popup = useStarterPackPopup(org);
const { open: popupOpen, screen, packId } = popup;
// Created here, in setup, so Home, the banner and the popup share one state per pack.
const entries = packs().map((pack) => popup.entryOf(pack));

const running = computed(() => entries.find(({ flow }) => flow.running.value) ?? null);
// With nothing saved and nothing running the chip cannot show, so it asks the server nothing.
const gate = usePackGate(org, () => matches.show.value || !!running.value);
// A retired org stays retired, so dropping its copy keeps later page loads from asking again.
watch(
  () => gate.retired.value && !running.value,
  (done) => done && matches.clear(),
  { immediate: true },
);
const shown = computed(
  () => !store.state.kioskMode && (!!running.value || (gate.visible.value && matches.show.value)),
);

const rail = computed<RailPack[]>(() => {
  const copy = matches.copy.value;
  const installedIds = copy?.installedPackIds ?? [];
  return entries.flatMap((entry): RailPack[] => {
    const { pack, flow } = entry;
    const source = copy?.sources.find(({ packId: id }) => id === pack.id);
    const known = installedIds.includes(pack.id);
    // A loaded record knows better than the last check, so a fresh setup or undo shows at once.
    const setUp = flow.loaded.value ? flow.installed.value : known;
    const stopped =
      flow.interrupted.value || (!flow.loaded.value && copy?.interrupted?.packId === pack.id);
    if (!source && !setUp && !stopped && !known) return [];
    return [{ entry, source, setUp, stopped }];
  });
});
const selected = computed(
  () => rail.value.find(({ entry }) => entry.pack.id === packId.value) ?? rail.value[0] ?? null,
);
const notSetUp = computed(() => rail.value.filter(({ setUp }) => !setUp).length);
// Nothing ranks packs, so the badge sits on the first in catalog order until one is set up.
const bestStartId = computed(() =>
  rail.value.some((row) => row.setUp) ? null : (rail.value[0]?.entry.pack.id ?? null),
);
const current = computed(() => entries.find(({ pack }) => pack.id === packId.value) ?? null);

const listSubtitle = computed(() => {
  if (!rail.value.length) return t("starterPacks.popup.subtitleNone");
  const count = notSetUp.value;
  return count
    ? t("starterPacks.popup.subtitle", { count }, count)
    : t("starterPacks.popup.subtitleAllSetUp");
});

const primaryLabel = computed(() => {
  const row = selected.value;
  if (row?.setUp) return t("starterPacks.popup.viewPack");
  if (row?.stopped) return t("starterPacks.progress.finish");
  return t("starterPacks.popup.reviewSetUp");
});

// The list reads each pack's record once, and the selected pack's clusters and plan, only once shown;
// an org past onboarding reads none.
const asked = new Set<string>();
const loadOnce = ({ pack, flow }: PackEntry) => {
  if (flow.loaded.value || asked.has(pack.id)) return;
  asked.add(pack.id);
  void flow.load();
};
const prepare = (row: RailPack) => {
  const { flow, matcher } = row.entry;
  loadOnce(row.entry);
  if (row.setUp) return;
  void matcher.checkShared();
  if (flow.previewState.value === "idle") void flow.loadPreview();
};
// A string key, so a rail recompute with the same rows and selection does not re-run it.
watch(
  () => {
    if (!popupOpen.value || !gate.visible.value || screen.value !== "list" || !selected.value) {
      return "";
    }
    const rows = rail.value.map(({ entry }) => entry.pack.id).join(",");
    return `${selected.value.entry.pack.id}:${selected.value.setUp}:${rows}`;
  },
  (key) => {
    if (!key) return;
    for (const row of rail.value) loadOnce(row.entry);
    if (selected.value) prepare(selected.value);
  },
  { immediate: true },
);

// Reopening while a setup runs goes straight back to it.
const openFromChip = () => {
  if (running.value) popup.openPack(running.value.pack.id, [], { fromList: true });
  else popup.openList();
};
const select = (id: string) => {
  packId.value = id;
};
const openSelected = () => {
  if (selected.value) void popup.openWhenReady(selected.value.entry, { fromList: true });
};
</script>

<template>
  <OButton
    v-if="shown"
    v-bind="$attrs"
    variant="outline"
    size="xs"
    class="bg-button-ghost-primary-active-bg! text-button-ghost-primary-text! border-accent/45! hover:border-accent! max-md:gap-1! max-md:ps-1.5! max-md:pe-1.5!"
    :aria-label="
      running
        ? t('starterPacks.headerChip.ariaLabelRunning', {
            made: running.flow.made.value.length,
            total: running.flow.toCreate.value.length,
          })
        : t(
            'starterPacks.headerChip.ariaLabel',
            { count: matches.count.value },
            matches.count.value,
          )
    "
    data-test="header-starter-packs-btn"
    @click="openFromChip"
  >
    <template #icon-left>
      <OIcon name="package-2" size="sm" />
    </template>
    <span class="max-md:hidden">{{ t("starterPacks.headerChip.label") }}</span>
    <span aria-hidden="true" class="opacity-60 max-md:hidden">{{ raw("·") }}</span>
    <span
      v-if="running"
      class="flex items-center gap-1 font-bold"
      data-test="header-starter-packs-progress"
    >
      <OSpinner size="xs" />
      {{
        t("starterPacks.headerChip.progress", {
          made: running.flow.made.value.length,
          total: running.flow.toCreate.value.length,
        })
      }}
    </span>
    <span v-else class="font-bold" data-test="header-starter-packs-count">{{
      matches.count.value
    }}</span>
  </OButton>

  <ODialog
    v-model:open="popupOpen"
    size="xl"
    :show-close="false"
    :aria-title="t('starterPacks.popup.title')"
    data-test="starter-pack-popup"
  >
    <div class="-mx-dialog-content-px -my-dialog-content-py h-180 max-h-[calc(90vh-0.125rem)]">
      <StarterPackDrawer
        v-if="screen === 'pack' && current"
        :key="current.pack.id"
        :flow="current.flow"
        :clusters="popup.clustersOf(current.pack.id, current.matcher.clusters.value)"
        :choices="popup.choicesOf(current.pack.id)"
        @close="popup.close()"
        :show-back="popup.fromList.value"
        @back="popup.back()"
      />
      <div
        v-else
        class="grid h-full min-h-0 grid-rows-[3.75rem_minmax(0,1fr)_3.625rem]"
        data-test="starter-pack-list"
      >
        <header class="border-border-default flex min-w-0 items-center gap-3 border-b px-4">
          <span
            class="bg-icon-chip-primary-bg text-icon-chip-primary-text rounded-default flex size-9 shrink-0 items-center justify-center"
          >
            <OIcon name="package-2" size="sm" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-text-heading truncate text-base font-semibold">{{
              t("starterPacks.popup.title")
            }}</span>
            <OText variant="meta" class="truncate" data-test="starter-pack-list-subtitle">{{
              listSubtitle
            }}</OText>
          </div>
          <OButton
            variant="ghost-muted"
            size="icon"
            icon-left="close"
            :aria-label="t('components.dialog.closeDialog')"
            data-test="starter-pack-popup-close-btn"
            @click="popup.close()"
          />
        </header>

        <OEmptyState
          v-if="!rail.length"
          size="block"
          illustration="radar"
          class="min-h-0"
          :title="t('starterPacks.popup.emptyTitle')"
          :description="t('starterPacks.popup.emptyText')"
          data-test="starter-pack-list-empty"
        />

        <StarterPackListPane
          v-else
          :rows="rail"
          :selected-id="selected?.entry.pack.id"
          :best-start-id="bestStartId"
          @select="select"
        />

        <footer class="border-border-default flex min-w-0 items-center gap-2 border-t px-4">
          <span
            :class="[
              'flex min-w-0 flex-1 items-center gap-1.5 text-xs whitespace-nowrap',
              checker.failed.value ? 'text-status-error-text' : 'text-text-secondary',
            ]"
            data-test="starter-pack-list-checked"
          >
            <OIcon :name="checker.failed.value ? 'error' : 'schedule'" size="sm" class="shrink-0" />
            <span v-if="checker.failed.value" class="truncate">{{
              t("starterPacks.popup.checkFailed")
            }}</span>
            <OTooltip
              v-else-if="checker.checkedTip.value"
              side="top"
              :content="checker.checkedTip.value"
            >
              <span tabindex="0" class="truncate">{{ checker.checkedLabel.value }}</span>
            </OTooltip>
            <OButton
              variant="ghost-primary"
              size="xs"
              :loading="checker.running.value"
              :disabled="checker.running.value"
              data-test="starter-pack-list-check-again"
              @click="checker.refresh()"
            >
              {{ t("starterPacks.popup.checkAgain") }}
            </OButton>
          </span>
          <OButton
            v-if="selected"
            variant="primary"
            size="sm-action"
            class="min-w-35"
            :loading="popup.opening.value === selected.entry.pack.id"
            :disabled="popup.opening.value === selected.entry.pack.id"
            data-test="starter-pack-list-primary-btn"
            @click="openSelected"
          >
            {{ primaryLabel }}
          </OButton>
        </footer>
      </div>
    </div>
  </ODialog>
</template>
