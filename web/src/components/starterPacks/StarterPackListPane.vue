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
import { computed, ref } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { LibrarySeverity } from "@/constants/alertLibrary";
import { ageText } from "@/composables/starterPacks/packCopy";
import { packTitle } from "@/composables/starterPacks/usePackCatalog";
import { useStreamFit } from "@/composables/starterPacks/streamFit";
import type { RailPack } from "@/composables/starterPacks/useStarterPackPopup";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const props = withDefaults(
  defineProps<{
    rows: RailPack[];
    selectedId?: string | null;
    /** The pack that carries the Best place to start badge, if any. */
    bestStartId?: string | null;
    testPrefix?: string;
  }>(),
  { selectedId: null, bestStartId: null, testPrefix: "starter-pack-list" },
);
const emit = defineEmits<{ select: [packId: string] }>();

type Kind = "dashboard" | "alert" | "savedView";

interface Tile {
  kind: Kind;
  icon: IconName;
  label: I18nText;
  summary?: I18nText;
  severity?: I18nText;
}

const { t } = useI18nTyped();

const KINDS: Kind[] = ["dashboard", "alert", "savedView"];
const SEVERITY_ORDER: LibrarySeverity[] = ["critical", "warning", "info"];
const TILE_LOOKS: Record<Kind, { tile: string; chip: string; icon: IconName }> = {
  dashboard: {
    tile: "border-ingest-accent-blue/25",
    chip: "bg-ingest-accent-blue text-white dark:bg-icon-chip-info-bg dark:text-icon-chip-info-text",
    icon: "dashboard",
  },
  alert: {
    tile: "border-ingest-accent-orange/25",
    chip: "bg-ingest-accent-orange text-white dark:bg-icon-chip-orange-bg dark:text-icon-chip-orange-text",
    icon: "notifications",
  },
  savedView: {
    tile: "border-ingest-accent-purple/25",
    chip: "bg-ingest-accent-purple text-white dark:bg-icon-chip-purple-bg dark:text-icon-chip-purple-text",
    icon: "bookmark",
  },
};

const selected = computed(
  () => props.rows.find(({ entry }) => entry.pack.id === props.selectedId) ?? props.rows[0] ?? null,
);
const streams = computed(() => selected.value?.source?.streams ?? []);
const streamRow = ref<HTMLElement | null>(null);
const streamSizer = ref<HTMLElement | null>(null);
const shownStreams = useStreamFit(streamRow, streamSizer, () => streams.value);
const hiddenStreams = computed(() => streams.value.slice(shownStreams.value));
const bestStart = computed(
  () => !!selected.value && selected.value.entry.pack.id === props.bestStartId,
);

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
</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-[14.5rem_minmax(0,1fr)]">
    <div
      role="listbox"
      :aria-label="t('starterPacks.popup.title')"
      class="bg-surface-panel border-border-default flex min-h-0 flex-col gap-1 overflow-y-auto border-e px-2 py-2.5"
      :data-test="`${testPrefix}-rail`"
    >
      <button
        v-for="row in rows"
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
        :data-test="`${testPrefix}-row-${row.entry.pack.id}`"
        @click="emit('select', row.entry.pack.id)"
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
          :data-test="`${testPrefix}-row-done-${row.entry.pack.id}`"
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
        :data-test="`${testPrefix}-hero`"
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
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-text-heading flex items-center gap-2 text-base font-bold">
            {{ packTitle(selected.entry.pack) }}
            <OBadge
              v-if="bestStart"
              variant="primary"
              size="sm"
              :data-test="`${testPrefix}-best-start`"
              >{{ t("starterPacks.home.bestStart") }}</OBadge
            >
          </span>
          <OText
            v-if="selected.entry.matcher.clusters.value.length"
            variant="meta"
            :data-test="`${testPrefix}-from`"
            >{{
              t("starterPacks.home.fromClusters", {
                clusters: raw(selected.entry.matcher.clusters.value.join(", ")),
              })
            }}</OText
          >
          <span
            v-if="streams.length"
            ref="streamRow"
            class="relative flex min-w-0 items-center gap-1.5 text-xs"
            :data-test="`${testPrefix}-streams`"
          >
            <span class="bg-status-success-text size-1.5 shrink-0 rounded-full" />
            <OTruncatedText class="text-text-body min-w-0 font-mono">{{
              raw(streams.slice(0, shownStreams).join(", "))
            }}</OTruncatedText>
            <OTooltip v-if="hiddenStreams.length" side="bottom" align="start">
              <span tabindex="0" class="text-accent shrink-0 font-semibold">{{
                t(
                  "starterPacks.home.moreStreams",
                  { count: hiddenStreams.length },
                  hiddenStreams.length,
                )
              }}</span>
              <template #content>
                <ul class="m-0 flex max-h-60 list-none flex-col gap-1 overflow-y-auto p-0">
                  <li v-for="stream in hiddenStreams" :key="stream" class="font-mono">
                    {{ raw(stream) }}
                  </li>
                </ul>
              </template>
            </OTooltip>
            <span
              ref="streamSizer"
              aria-hidden="true"
              class="pointer-events-none invisible absolute size-0 overflow-hidden"
            >
              <span class="flex w-max whitespace-nowrap">
                <span data-fit-fixed class="w-3 shrink-0" />
                <span
                  v-for="(stream, index) in streams"
                  :key="stream"
                  data-fit-item
                  class="shrink-0 font-mono"
                  >{{ raw(index ? `, ${stream}` : stream) }}</span
                >
                <span data-fit-more class="shrink-0 ps-1.5 font-semibold">{{
                  t("starterPacks.home.moreStreams", { count: streams.length }, streams.length)
                }}</span>
              </span>
            </span>
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
            :data-test="`${testPrefix}-tile-${tile.kind}`"
          >
            <span class="text-text-heading mb-1 flex items-center gap-2 text-sm font-semibold">
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
              :data-test="`${testPrefix}-tile-summary-${tile.kind}`"
              >{{ tile.summary }}</span
            >
            <span v-else>{{ t("starterPacks.popup.noneInPack") }}</span>
            <span
              v-if="tile.severity"
              class="text-text-secondary"
              :data-test="`${testPrefix}-tile-severity`"
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
</template>
