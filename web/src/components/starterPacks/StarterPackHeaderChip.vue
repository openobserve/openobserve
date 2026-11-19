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
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { LibrarySeverity } from "@/constants/alertLibrary";
import type { FindMoreSource } from "@/composables/starterPacks/findMore";
import { ageText } from "@/composables/starterPacks/packCopy";
import { packs, packTitle } from "@/composables/starterPacks/usePackCatalog";
import { useBrowserMatches } from "@/composables/starterPacks/useBrowserMatches";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import { useRefreshMatches } from "@/composables/starterPacks/useRefreshMatches";
import {
  useStarterPackPopup,
  type PackEntry,
} from "@/composables/starterPacks/useStarterPackPopup";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import StarterPackDrawer from "./StarterPackDrawer.vue";

type Kind = "dashboard" | "alert" | "savedView";

interface RailPack {
  entry: PackEntry;
  source?: FindMoreSource;
  setUp: boolean;
  stopped: boolean;
}

interface Tile {
  kind: Kind;
  icon: IconName;
  label: I18nText;
  summary?: I18nText;
  severity?: I18nText;
}

// The header passes its spacing class; the popup is a sibling of the chip.
defineOptions({ inheritAttrs: false });

const { t } = useI18nTyped();
const store = useStore();

const KINDS: Kind[] = ["dashboard", "alert", "savedView"];
const SEVERITY_ORDER: LibrarySeverity[] = ["critical", "warning", "info"];
const TILE_LOOKS: Record<Kind, { tile: string; chip: string; icon: IconName }> = {
  dashboard: {
    tile: "bg-ingest-tint-blue border-ingest-accent-blue/25",
    chip: "bg-ingest-accent-blue text-white dark:bg-icon-chip-info-bg dark:text-icon-chip-info-text",
    icon: "dashboard",
  },
  alert: {
    tile: "bg-ingest-tint-orange border-ingest-accent-orange/25",
    chip: "bg-ingest-accent-orange text-white dark:bg-icon-chip-orange-bg dark:text-icon-chip-orange-text",
    icon: "notifications",
  },
  savedView: {
    tile: "bg-ingest-tint-purple border-ingest-accent-purple/25",
    chip: "bg-ingest-accent-purple text-white dark:bg-icon-chip-purple-bg dark:text-icon-chip-purple-text",
    icon: "bookmark",
  },
};

// The header remounts this per org, so every composable below binds to one org.
const org: string = store.state.selectedOrganization?.identifier ?? "";
const matches = useBrowserMatches(org);
const checker = useRefreshMatches(org);
const gate = usePackGate(org);
const popup = useStarterPackPopup(org);
const { open: popupOpen, screen, packId } = popup;
// Created here, in setup, so Home, the banner and the popup share one state per pack.
const entries = packs().map((pack) => popup.entryOf(pack));

const running = computed(() => entries.find(({ flow }) => flow.running.value) ?? null);
const shown = computed(
  () => !store.state.kioskMode && gate.visible.value && (matches.show.value || !!running.value),
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
const bestStart = computed(
  () =>
    !!selected.value && selected.value === rail.value[0] && !rail.value.some((row) => row.setUp),
);
const current = computed(() => entries.find(({ pack }) => pack.id === packId.value) ?? null);

const listSubtitle = computed(() => {
  if (!rail.value.length) return t("starterPacks.popup.subtitleNone");
  const count = notSetUp.value;
  return count
    ? t("starterPacks.popup.subtitle", { count }, count)
    : t("starterPacks.popup.subtitleAllSetUp");
});

const railLine = (row: RailPack): I18nText => {
  if (row.stopped) return t("starterPacks.popup.stopped");
  const at = row.entry.flow.record.value?.installedAt;
  if (row.setUp && at) {
    return t("starterPacks.popup.setUpAgo", { when: ageText(t, Date.now() - at / 1000) });
  }
  const count = KINDS.reduce((sum, kind) => sum + itemsOf(row, kind).length, 0);
  return count ? t("starterPacks.popup.items", { count }, count) : raw("");
};

/** Names of a kind the pack makes here: the check's fitted items, else the pack's own list. */
const itemsOf = (row: RailPack, kind: Kind): Array<{ id: string; name: string }> => {
  const { pack, flow } = row.entry;
  if (row.setUp) {
    return flow.items.value
      .filter((item) => item.kind === kind && item.status === "created")
      .map(({ itemId, copyOf }) => ({ id: copyOf ?? itemId, name: flow.nameOf(itemId) }));
  }
  if (row.source) {
    return row.source.items
      .filter((item) => item.kind === kind)
      .map(({ id, name }) => ({ id, name }));
  }
  if (kind === "dashboard") return pack.dashboards.map(({ id, title }) => ({ id, name: title }));
  if (kind === "alert") return pack.alerts.map((id) => ({ id, name: flow.nameOf(id) }));
  return pack.savedViews.map(({ id, name }) => ({ id, name }));
};

const severityLine = (row: RailPack, ids: string[]): I18nText | undefined => {
  const severities = row.entry.flow.preview.value?.severities;
  if (!severities) return undefined;
  const keys = {
    critical: "starterPacks.popup.sevCritical",
    warning: "starterPacks.popup.sevWarning",
    info: "starterPacks.popup.sevInfo",
  } as const;
  const parts = SEVERITY_ORDER.flatMap((level) => {
    const count = ids.filter((id) => severities[id] === level).length;
    return count ? [t(keys[level], { count })] : [];
  });
  return parts.length ? raw(parts.join(" · ")) : undefined;
};

const tiles = computed<Tile[]>(() => {
  const row = selected.value;
  if (!row) return [];
  const summaries = row.entry.pack.tileSummaries;
  return KINDS.map((kind): Tile => {
    const items = itemsOf(row, kind);
    const count = items.length;
    const look = TILE_LOOKS[kind];
    const own = {
      dashboard: summaries?.dashboards,
      alert: summaries?.alerts,
      savedView: summaries?.savedViews,
    }[kind];
    const labels = {
      dashboard: t("starterPacks.popup.tileDashboards", { count }, count),
      alert: t("starterPacks.popup.tileAlerts", { count }, count),
      savedView: t("starterPacks.popup.tileSavedViews", { count }, count),
    };
    const none = {
      dashboard: t("starterPacks.popup.noneDashboards"),
      alert: t("starterPacks.popup.noneAlerts"),
      savedView: t("starterPacks.popup.noneSavedViews"),
    };
    if (!count) return { kind, icon: look.icon, label: none[kind] };
    return {
      kind,
      icon: look.icon,
      label: labels[kind],
      summary: raw(own ?? items.map(({ name }) => name).join(", ")),
      severity:
        kind === "alert"
          ? severityLine(
              row,
              items.map(({ id }) => id),
            )
          : undefined,
    };
  });
});

const primaryLabel = computed(() => {
  const row = selected.value;
  if (row?.setUp) return t("starterPacks.popup.viewPack");
  if (row?.stopped) return t("starterPacks.progress.finish");
  return t("starterPacks.popup.reviewSetUp");
});

// The list reads each pack's record once, and the selected pack's clusters and plan, only once shown.
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
    if (!popupOpen.value || screen.value !== "list" || !selected.value) return "";
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
  if (running.value) popup.openPack(running.value.pack.id);
  else popup.openList();
};
const select = (row: RailPack) => {
  packId.value = row.entry.pack.id;
};
const openSelected = () => {
  if (selected.value) popup.openPack(selected.value.entry.pack.id);
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
    size="lg"
    :show-close="false"
    :aria-title="t('starterPacks.popup.title')"
    data-test="starter-pack-popup"
  >
    <div class="-mx-dialog-content-px -my-dialog-content-py h-150 max-h-[calc(90vh-0.125rem)]">
      <StarterPackDrawer
        v-if="screen === 'pack' && current"
        :key="current.pack.id"
        :flow="current.flow"
        :clusters="popup.clustersOf(current.pack.id, current.matcher.clusters.value)"
        :choices="popup.choicesOf(current.pack.id)"
        @close="popup.close()"
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

        <div v-else class="grid min-h-0 grid-cols-[14.5rem_minmax(0,1fr)]">
          <div
            role="listbox"
            :aria-label="t('starterPacks.popup.title')"
            class="bg-surface-panel border-border-default flex min-h-0 flex-col gap-1 overflow-y-auto border-e px-2 py-2.5"
            data-test="starter-pack-list-rail"
          >
            <button
              v-for="row in rail"
              :key="row.entry.pack.id"
              type="button"
              role="option"
              :aria-selected="row === selected"
              :class="[
                'rounded-default flex h-12.5 shrink-0 cursor-pointer items-center gap-2.5 border px-2.5 text-left',
                row === selected
                  ? 'bg-surface-base border-accent/45'
                  : 'hover:bg-surface-subtle border-transparent',
              ]"
              :data-test="`starter-pack-list-row-${row.entry.pack.id}`"
              @click="select(row)"
            >
              <span
                class="border-border-default bg-surface-base rounded-default flex size-7.5 shrink-0 items-center justify-center border"
              >
                <img
                  v-if="row.entry.pack.logo"
                  :src="getImageURL(row.entry.pack.logo)"
                  class="size-4.5 object-contain"
                  alt=""
                />
                <OIcon v-else name="package-2" size="sm" class="text-text-secondary" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span
                  :class="[
                    'truncate text-sm leading-tight font-semibold',
                    row === selected ? 'text-accent' : 'text-text-heading',
                  ]"
                  >{{ packTitle(row.entry.pack) }}</span
                >
                <OText variant="meta" class="truncate leading-tight">{{ railLine(row) }}</OText>
              </span>
              <OIcon
                v-if="row.setUp"
                name="check-circle"
                size="sm"
                class="text-status-positive shrink-0"
                :data-test="`starter-pack-list-row-done-${row.entry.pack.id}`"
              />
              <OIcon
                v-else-if="row.stopped"
                name="warning"
                size="sm"
                class="text-status-warning-text shrink-0"
              />
              <OIcon
                v-else-if="row === selected"
                name="chevron-right"
                size="sm"
                class="text-accent shrink-0"
              />
            </button>
          </div>

          <div v-if="selected" class="flex min-h-0 min-w-0 flex-col overflow-y-auto">
            <div
              :class="[
                'border-border-default flex min-h-24 shrink-0 items-center gap-3 border-b px-4',
                bestStart && 'from-accent/15 to-ingest-accent-purple/10 bg-linear-to-br',
              ]"
              data-test="starter-pack-list-hero"
            >
              <span
                class="border-border-default bg-surface-base rounded-default flex size-9 shrink-0 items-center justify-center border"
              >
                <img
                  v-if="selected.entry.pack.logo"
                  :src="getImageURL(selected.entry.pack.logo)"
                  class="size-6 object-contain"
                  alt=""
                />
                <OIcon v-else name="package-2" size="sm" class="text-text-secondary" />
              </span>
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="text-text-heading flex items-center gap-2 text-base font-bold">
                  {{ packTitle(selected.entry.pack) }}
                  <OBadge
                    v-if="bestStart"
                    variant="primary"
                    size="sm"
                    data-test="starter-pack-list-best-start"
                    >{{ t("starterPacks.home.bestStart") }}</OBadge
                  >
                </span>
                <OText
                  v-if="selected.entry.matcher.clusters.value.length"
                  variant="meta"
                  data-test="starter-pack-list-from"
                  >{{
                    t("starterPacks.home.fromClusters", {
                      clusters: raw(selected.entry.matcher.clusters.value.join(", ")),
                    })
                  }}</OText
                >
                <span
                  v-if="selected.source?.streams.length"
                  class="flex min-w-0 items-center gap-1.5 text-xs"
                  data-test="starter-pack-list-streams"
                >
                  <span class="bg-status-success-text size-1.5 shrink-0 rounded-full" />
                  <OTruncatedText class="text-text-body min-w-0 font-mono">{{
                    raw(selected.source.streams[0])
                  }}</OTruncatedText>
                  <OTooltip v-if="selected.source.streams.length > 1" side="bottom" align="start">
                    <span tabindex="0" class="text-accent shrink-0 font-semibold">{{
                      t(
                        "starterPacks.home.moreStreams",
                        { count: selected.source.streams.length - 1 },
                        selected.source.streams.length - 1,
                      )
                    }}</span>
                    <template #content>
                      <ul class="m-0 flex max-h-60 list-none flex-col gap-1 overflow-y-auto p-0">
                        <li
                          v-for="stream in selected.source.streams.slice(1)"
                          :key="stream"
                          class="font-mono"
                        >
                          {{ raw(stream) }}
                        </li>
                      </ul>
                    </template>
                  </OTooltip>
                </span>
              </div>
            </div>

            <div class="flex flex-col gap-2.5 px-4 py-3.5">
              <span class="text-text-secondary text-xs font-semibold">{{
                t("starterPacks.popup.whatGetsCreated")
              }}</span>
              <div class="grid grid-cols-3 gap-2.5">
                <div
                  v-for="tile in tiles"
                  :key="tile.kind"
                  :class="[
                    'rounded-default flex h-34 min-w-0 flex-col gap-1 border p-3 text-xs',
                    tile.summary
                      ? TILE_LOOKS[tile.kind].tile
                      : 'border-border-default text-text-secondary border-dashed',
                  ]"
                  :data-test="`starter-pack-list-tile-${tile.kind}`"
                >
                  <span
                    class="text-text-heading mb-1 flex items-center gap-2 text-sm font-semibold"
                  >
                    <span
                      :class="[
                        'rounded-default flex size-6 shrink-0 items-center justify-center',
                        tile.summary
                          ? TILE_LOOKS[tile.kind].chip
                          : 'bg-surface-subtle text-text-secondary',
                      ]"
                    >
                      <OIcon :name="tile.icon" size="xs" />
                    </span>
                    {{ tile.label }}
                  </span>
                  <span
                    v-if="tile.summary"
                    class="text-text-body line-clamp-3 leading-4.5"
                    :data-test="`starter-pack-list-tile-summary-${tile.kind}`"
                    >{{ tile.summary }}</span
                  >
                  <span v-else>{{ t("starterPacks.popup.noneInPack") }}</span>
                  <span
                    v-if="tile.severity"
                    class="text-text-secondary"
                    data-test="starter-pack-list-tile-severity"
                    >{{ tile.severity }}</span
                  >
                </div>
              </div>
            </div>

            <div
              v-if="!selected.setUp"
              class="text-text-secondary flex flex-col gap-1.5 px-4 pb-3.5 text-xs"
            >
              <span class="flex items-center gap-2">
                <OIcon name="tune" size="sm" class="shrink-0" />
                {{ t("starterPacks.popup.chooseNext") }}
              </span>
              <span class="flex items-center gap-2">
                <OIcon name="undo" size="sm" class="shrink-0" />
                {{ t("starterPacks.popup.undoWindow") }}
              </span>
            </div>
          </div>
        </div>

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
