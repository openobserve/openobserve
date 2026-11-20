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

<template>
  <AnnouncementBannerEditorForm
    v-if="target"
    :key="formKey"
    :draft="target.draft"
    :index="target.index"
    :others="target.others"
    :original="target.original"
    :base="target.base"
    :styles="styles"
    @reload="reload"
  />
  <OEmptyState
    v-else-if="configQuery.isError.value"
    kind="error"
    :title="t('announcements.settings.loadFailed')"
    data-test="announcement-editor-error"
    @action="configQuery.refetch()"
  />
  <div v-else class="flex flex-col gap-4 p-4" data-test="announcement-editor-loading">
    <OSkeleton shape="block" class="h-24" />
    <OSkeleton shape="block" class="h-64" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { announcementConfigQuery } from "@/services/announcements.queries";
import { useI18nTyped } from "@/types/i18n";
import AnnouncementBannerEditorForm from "./AnnouncementBannerEditorForm.vue";
import {
  draftFromAuthored,
  emptyDraft,
  newBannerId,
  stylesFromConfig,
  type AuthoredBanner,
  type BannerDraft,
} from "./announcementDrafts";

const { t } = useI18nTyped();
const route = useRoute();
const store = useStore();

const metaOrg = computed<string>(() => store.state.zoConfig?.meta_org ?? "");

const configQuery = useQuery(() =>
  Object.assign(announcementConfigQuery(metaOrg.value), { enabled: !!metaOrg.value }),
);

const styles = computed(() => stylesFromConfig(configQuery.data.value));

const queryIndex = (key: "index" | "duplicate") => {
  const raw = route.query[key];
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

// Remounts only on a new target or an explicit reload; a refetch after saving a style must keep the edits.
const reloadCount = ref(0);
const formKey = computed(() => `${JSON.stringify(route.query)}:${reloadCount.value}`);

const reload = async () => {
  await configQuery.refetch();
  reloadCount.value += 1;
};

interface EditorTarget {
  draft: BannerDraft;
  index: number | null;
  others: BannerDraft[];
  original: Record<string, unknown> | null;
  base: Record<string, unknown> | null;
}

const target = computed<EditorTarget | null>(() => {
  const banners = configQuery.data.value?.banners;
  if (!banners) return null;

  const drafts = banners.map((banner) => draftFromAuthored(banner as AuthoredBanner));
  const editIndex = queryIndex("index");
  const copyIndex = queryIndex("duplicate");

  if (editIndex !== null && editIndex < drafts.length) {
    return {
      draft: drafts[editIndex],
      index: editIndex,
      others: drafts.filter((_, i) => i !== editIndex),
      original: banners[editIndex],
      base: null,
    };
  }
  if (copyIndex !== null && copyIndex < drafts.length) {
    return {
      draft: { ...drafts[copyIndex], id: newBannerId() },
      index: null,
      others: drafts,
      original: null,
      base: banners[copyIndex],
    };
  }
  return { draft: emptyDraft(), index: null, others: drafts, original: null, base: null };
});
</script>
