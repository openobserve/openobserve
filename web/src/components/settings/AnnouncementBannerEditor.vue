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
    :key="routeKey"
    :draft="target.draft"
    :index="target.index"
    :others="target.others"
    :original="target.original"
  />
  <div
    v-else
    class="flex h-full items-center justify-center"
    data-test="announcement-editor-loading"
  >
    <div v-if="configQuery.isError.value" class="flex flex-col items-center gap-3">
      <span class="text-text-secondary text-sm">{{ t("announcements.settings.loadFailed") }}</span>
      <OButton variant="outline" size="sm" @click="configQuery.refetch()">
        {{ t("common.retry") }}
      </OButton>
    </div>
    <OSpinner v-else />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { announcementConfigQuery } from "@/services/announcements.queries";
import { useI18nTyped } from "@/types/i18n";
import AnnouncementBannerEditorForm from "./AnnouncementBannerEditorForm.vue";
import {
  draftFromAuthored,
  emptyDraft,
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

const queryIndex = (key: "index" | "duplicate") => {
  const raw = route.query[key];
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

// A fresh form per target and per reload, so edits never carry across banners or stale data.
const routeKey = computed(
  () => `${JSON.stringify(route.query)}:${configQuery.dataUpdatedAt.value}`,
);

interface EditorTarget {
  draft: BannerDraft;
  index: number | null;
  others: BannerDraft[];
  original: Record<string, unknown> | null;
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
    };
  }
  if (copyIndex !== null && copyIndex < drafts.length) {
    // A copy needs its own dismissal key, or dismissing one would hide both.
    return { draft: { ...drafts[copyIndex], id: "" }, index: null, others: drafts, original: null };
  }
  return { draft: emptyDraft(), index: null, others: drafts, original: null };
});
</script>
