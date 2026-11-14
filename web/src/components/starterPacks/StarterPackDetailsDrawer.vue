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
import { computed } from "vue";
import { useRouter } from "vue-router";
import StarterPackAdaptedRows from "@/components/starterPacks/StarterPackAdaptedRows.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { packScopeValue } from "@/composables/starterPacks/packCopy";
import { staleSinceText } from "@/composables/starterPacks/usePackHealth";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { raw, useI18nTyped } from "@/types/i18n";

export interface PackStream {
  name: string;
  type: string;
}

const props = defineProps<{
  org: string;
  flow: StarterPackFlow;
  clusters: string[];
  streams: PackStream[];
  staleSince: number | null;
  queriesPerDay: number;
}>();
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const router = useRouter();
const pack = props.flow.pack;

const ITEM_KINDS = ["dashboard", "alert", "savedView"] as const;
const STREAM_TYPES = ["logs", "metrics", "traces"] as const;

const record = computed(() => props.flow.record.value);
const sources = computed(() =>
  props.clusters.length ? props.clusters : [packScopeValue(t, props.clusters)],
);
const staleText = computed(() => staleSinceText(props.staleSince));
const typeLabel = (type: string) =>
  (STREAM_TYPES as readonly string[]).includes(type)
    ? t(`starterPacks.packDetails.type.${type as (typeof STREAM_TYPES)[number]}`)
    : raw(type);
const itemGroups = computed(() =>
  ITEM_KINDS.map((kind) => ({
    kind,
    items: props.flow.items.value.filter((item) => item.kind === kind),
  })).filter(({ items }) => items.length),
);
const folderId = computed(
  () => record.value?.items.find(({ kind }) => kind === "folder")?.id ?? "",
);
const folderLabel = computed(() => record.value?.folderName ?? pack.folder.name);
const installedOn = computed(() => {
  const at = record.value?.installedAt;
  return at ? new Date(at / 1000).toLocaleString() : "";
});
const about = computed(() => {
  const version = raw(record.value?.version ?? pack.version);
  const folder = raw(folderLabel.value);
  const date = raw(installedOn.value);
  return record.value?.installedBy
    ? t("starterPacks.page.subtitle", { who: raw(record.value.installedBy), date, version, folder })
    : t("starterPacks.page.subtitleUnknown", { date, version, folder });
});

const go = (to: Parameters<typeof router.push>[0]) => router.push(to).catch(() => {});
const openStreams = () => go({ name: "logstreams", query: { org_identifier: props.org } });
const checkCollector = () =>
  go({ name: pack.collectorRoute!, query: { org_identifier: props.org } });
const manageAccess = () =>
  go({ name: "alertList", query: { org_identifier: props.org, folder: folderId.value } });
</script>

<template>
  <ODrawer
    v-model:open="open"
    size="sm"
    :modal="false"
    :title="t('starterPacks.packDetails.title')"
    data-test="starter-pack-details-drawer"
  >
    <div class="flex flex-col text-sm">
      <section
        class="border-border-default flex flex-col gap-1 border-b px-4 py-3"
        data-test="starter-pack-details-sources"
      >
        <OText variant="card-title">{{ t("starterPacks.packDetails.dataSources") }}</OText>
        <div
          v-for="source in sources"
          :key="source"
          class="flex min-h-7 items-center justify-between gap-2"
          data-test="starter-pack-details-source"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="size-2 shrink-0 rounded-full"
              :class="staleText ? 'bg-service-health-warning' : 'bg-service-health-healthy'"
            />
            <span class="truncate">{{ source }}</span>
          </span>
        </div>
        <div
          v-if="staleText"
          class="flex flex-wrap items-center justify-between gap-2"
          data-test="starter-pack-details-stale"
        >
          <OText variant="meta" class="text-status-warning-text">{{
            t("starterPacks.packDetails.noDataSince", { since: raw(staleText) })
          }}</OText>
          <OButton
            v-if="pack.collectorRoute"
            variant="ghost-primary"
            size="sm-action"
            data-test="starter-pack-page-check-collector-link"
            @click="checkCollector"
          >
            {{ t("starterPacks.health.checkCollector") }}
          </OButton>
        </div>
      </section>

      <section
        class="border-border-default flex flex-col gap-1 border-b px-4 py-3"
        data-test="starter-pack-details-streams"
      >
        <span class="flex min-h-6 items-center justify-between gap-2">
          <OText variant="card-title">{{ t("starterPacks.packDetails.streams") }}</OText>
          <OButton
            variant="ghost-primary"
            size="sm-action"
            data-test="starter-pack-details-open-streams-btn"
            @click="openStreams"
          >
            {{ t("starterPacks.packDetails.openInStreams") }}
          </OButton>
        </span>
        <span
          v-for="stream in streams"
          :key="stream.name"
          class="flex min-h-7 items-center justify-between gap-2"
          data-test="starter-pack-details-stream"
        >
          <span class="truncate font-mono text-xs">{{ stream.name }}</span>
          <OText v-if="stream.type" variant="meta" class="shrink-0">{{
            typeLabel(stream.type)
          }}</OText>
        </span>
      </section>

      <section
        class="border-border-default flex flex-col border-b py-3"
        data-test="starter-pack-page-section-views"
      >
        <span class="flex min-h-6 items-center justify-between gap-2 px-4">
          <span class="flex items-baseline gap-2">
            <OText variant="card-title">{{ t("starterPacks.page.items") }}</OText>
            <OText variant="meta" data-test="starter-pack-page-views-meta">{{
              t("starterPacks.page.installedOf", {
                made: flow.made.value.length,
                total: flow.items.value.length,
              })
            }}</OText>
          </span>
          <OButton
            variant="ghost-primary"
            size="sm-action"
            data-test="starter-pack-page-open-btn"
            @click="flow.land()"
          >
            {{ t("starterPacks.page.open") }}
          </OButton>
        </span>
        <div class="flex flex-col" data-test="starter-pack-page-items">
          <template v-for="group in itemGroups" :key="group.kind">
            <OText
              variant="meta"
              class="px-4 pt-2 pb-0.5"
              :data-test="`starter-pack-page-group-${group.kind}`"
              >{{
                t(`starterPacks.page.group.${group.kind}`, { count: group.items.length })
              }}</OText
            >
            <div
              v-for="item in group.items"
              :key="item.itemId"
              class="flex min-h-7 items-center justify-between gap-2 px-4"
              :data-test="`starter-pack-page-item-${item.status}`"
            >
              <span class="min-w-0 truncate">{{ flow.nameOf(item.itemId) }}</span>
              <OBadge
                v-if="item.status === 'failed' || item.status === 'skipped'"
                :variant="item.status === 'failed' ? 'error-soft' : 'default-soft'"
              >
                {{ t(`starterPacks.page.status.${item.status}`) }}
              </OBadge>
            </div>
          </template>
          <OText
            v-for="repair in record?.repairs ?? []"
            :key="repair.from"
            variant="meta"
            class="px-4 pt-1"
            data-test="starter-pack-page-repair"
          >
            {{ t("starterPacks.page.repair", { from: raw(repair.from), to: raw(repair.to) }) }}
          </OText>
        </div>
      </section>

      <section
        class="border-border-default flex flex-col gap-1 border-b px-4 py-3"
        data-test="starter-pack-page-section-adapted"
      >
        <OText variant="card-title">{{ t("starterPacks.page.sectionAdapted") }}</OText>
        <StarterPackAdaptedRows :flow="flow" readonly />
      </section>

      <section
        class="border-border-default flex flex-col gap-1 border-b px-4 py-3"
        data-test="starter-pack-page-section-access"
      >
        <OText variant="card-title">{{ t("starterPacks.page.sectionAccess") }}</OText>
        <div class="flex flex-wrap items-center gap-2" data-test="starter-pack-page-access">
          <OIcon name="lock" size="sm" class="text-text-secondary" />
          <span class="min-w-0 flex-1">{{
            t("starterPacks.page.folderAccess", { folder: raw(folderLabel) })
          }}</span>
          <OButton
            variant="ghost-primary"
            size="sm-action"
            data-test="starter-pack-page-access-btn"
            @click="manageAccess"
          >
            {{ t("starterPacks.page.manageAccess") }}
          </OButton>
        </div>
      </section>

      <section
        class="border-border-default flex flex-col gap-1 border-b px-4 py-3"
        data-test="starter-pack-page-section-cost"
      >
        <OText variant="card-title">{{ t("starterPacks.page.sectionCost") }}</OText>
        <span data-test="starter-pack-page-about">{{
          t("starterPacks.page.queries", { count: queriesPerDay.toLocaleString() })
        }}</span>
        <OText variant="meta">{{ t("starterPacks.page.scanNote") }}</OText>
      </section>

      <section class="flex flex-col gap-1 px-4 py-3" data-test="starter-pack-details-installer">
        <OText variant="card-title">{{ t("starterPacks.page.about") }}</OText>
        <span>{{ about }}</span>
      </section>
    </div>
  </ODrawer>
</template>
