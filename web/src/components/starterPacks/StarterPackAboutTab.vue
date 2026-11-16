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
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import type { ContentKind } from "@/composables/starterPacks/packContents";
import type { StarterPackPage } from "@/composables/starterPacks/useStarterPackPage";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ page: StarterPackPage }>();
const emit = defineEmits<{ review: []; openFolder: [] }>();

const { t } = useI18nTyped();
const flow = props.page.flow;
const pack = flow.pack;

const record = computed(() => flow.record.value);
const folder = computed(() => record.value?.folderName ?? pack.folder.name);
const installedOn = computed(() => {
  const at = record.value?.installedAt;
  return at
    ? new Date(at / 1000).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
});
const showUpdate = computed(
  () => STARTER_PACKS_ENABLED && props.page.canManage.value && props.page.updates.available.value,
);
// The flow's counts are what setup would still make, so a set-up pack counts what it made.
const countOf = (kind: ContentKind, planned: number) =>
  record.value
    ? props.page.contents.value.filter(
        (row) => row.kind === kind && !["notCreated", "skipped"].includes(row.state),
      ).length
    : planned;
const adds = computed(() => {
  const dashboards = countOf("dashboard", flow.dashboardCount.value);
  const alerts = countOf("alert", flow.alertCount.value);
  const views = countOf("savedView", flow.viewCount.value);
  const counts = [
    t("starterPacks.page.notice.countDashboards", { count: dashboards }, dashboards),
    t("starterPacks.countAlerts", { count: alerts }, alerts),
    t("starterPacks.countViews", { count: views }, views),
  ];
  return t("starterPacks.page.about.adds", {
    description: t(pack.descriptionKey),
    counts: raw(counts.join(", ")),
  });
});
</script>

<template>
  <OContent y data-test="starter-pack-page-about">
    <ODescriptionList divided>
      <ODescriptionItem :label="t('starterPacks.page.about.setUpBy')">
        <template v-if="record?.installedBy">{{ raw(record.installedBy) }}</template>
      </ODescriptionItem>
      <ODescriptionItem :label="t('starterPacks.page.about.setUpOn')">
        <template v-if="installedOn">{{ raw(installedOn) }}</template>
      </ODescriptionItem>
      <ODescriptionItem :label="t('starterPacks.page.about.version')">
        <span class="flex flex-wrap items-center gap-2" data-test="starter-pack-page-about-version">
          {{ raw(`v${record?.version ?? pack.version}`) }}
          <template v-if="showUpdate">
            <OTag variant="primary-soft" size="sm" :label="t('starterPacks.page.chipUpdate')" />
            <OButton
              variant="outline"
              size="xs"
              data-test="starter-pack-page-about-review"
              @click="emit('review')"
            >
              {{ t("starterPacks.page.reviewUpdate") }}
            </OButton>
          </template>
        </span>
      </ODescriptionItem>
      <ODescriptionItem :label="t('starterPacks.page.about.folder')">
        <OButton
          v-if="record"
          variant="ghost-primary"
          size="xs"
          data-test="starter-pack-page-about-folder"
          @click="emit('openFolder')"
        >
          {{ raw(folder) }}
        </OButton>
        <template v-else>{{ raw(folder) }}</template>
      </ODescriptionItem>
      <ODescriptionItem :label="t('starterPacks.page.about.access')">
        <span class="flex flex-wrap items-center gap-2">
          {{ t("starterPacks.page.folderAccess", { folder: raw(folder) }) }}
          <OButton
            v-if="record"
            variant="outline"
            size="xs"
            icon-left="folder"
            data-test="starter-pack-page-access-btn"
            @click="emit('openFolder')"
          >
            {{ t("starterPacks.page.openFolder") }}
          </OButton>
        </span>
      </ODescriptionItem>
      <ODescriptionItem :label="t('starterPacks.page.about.cost')">
        <template v-if="record">{{
          t("starterPacks.page.about.queries", { count: page.perDay.value.toLocaleString() })
        }}</template>
      </ODescriptionItem>
      <ODescriptionItem
        :label="t('starterPacks.page.about.addsLabel')"
        data-test="starter-pack-page-about-adds"
      >
        {{ adds }}
      </ODescriptionItem>
    </ODescriptionList>
  </OContent>
</template>
