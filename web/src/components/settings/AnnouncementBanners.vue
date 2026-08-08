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
  <ODrawer
    :open="open"
    side="right"
    size="xl"
    :title="t('announcements.settings.label')"
    :sub-title="t('announcements.settings.description')"
    :secondary-button-label="t('announcements.settings.reset')"
    :primary-button-label="t('announcements.settings.save')"
    :secondary-button-disabled="isSaving"
    :primary-button-loading="isSaving"
    data-test="announcement-banners-settings"
    @update:open="$emit('update:open', $event)"
    @click:secondary="loadConfig"
    @click:primary="save"
  >
    <div class="flex flex-col gap-4">
      <!-- Rendered through the same resolver the live bar uses, so the order here
           is the order users get — not the order the banners were authored in. -->
      <div class="flex flex-col gap-2">
        <div class="text-text-label text-sm font-bold">
          {{ t("announcements.settings.previewLabel") }}
        </div>
        <div
          class="rounded-surface border-border-default overflow-hidden border"
          data-test="announcement-banners-preview"
        >
          <OBanner
            v-for="(banner, index) in previewBanners"
            :key="index"
            bar
            :variant="previewVariant(banner)"
            :icon="previewIcon(banner)"
          >
            {{ raw(banner.message) }}
          </OBanner>
          <div
            v-if="!previewBanners.length"
            class="text-text-muted px-4 py-3 text-center text-sm"
            data-test="announcement-banners-preview-empty"
          >
            {{ t("announcements.settings.previewEmpty") }}
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2" data-test="announcement-banners-list">
        <div class="flex items-center justify-between gap-2">
          <span class="text-text-label text-sm font-bold">
            {{ t("announcements.settings.bannersLabel") }}
          </span>
          <OButton
            variant="outline"
            size="sm"
            icon-left="add"
            data-test="announcement-banners-add-btn"
            @click="openAdd"
          >
            {{ t("announcements.settings.addBanner") }}
          </OButton>
        </div>

        <div v-if="!isLoaded" class="text-text-muted py-6 text-center text-sm">
          {{ t("announcements.settings.loading") }}
        </div>

        <div
          v-else-if="!drafts.length"
          class="rounded-default border-border-default text-text-muted flex flex-col items-center gap-1 border border-dashed px-4 py-8 text-center text-sm"
          data-test="announcement-banners-list-empty"
        >
          <span>{{ t("announcements.settings.emptyTitle") }}</span>
          <span class="text-xs">{{ t("announcements.settings.emptyHint") }}</span>
        </div>

        <div v-else class="flex flex-col gap-2">
          <AnnouncementBannerCard
            v-for="(draft, index) in drafts"
            :key="index"
            :draft="draft"
            :index="index"
            @edit="openEdit(index)"
            @remove="removeDraft(index)"
          />
        </div>
      </div>

      <OBanner
        v-if="errorMessage"
        variant="error-soft"
        icon="error"
        data-test="announcement-banners-error"
      >
        {{ errorMessage }}
      </OBanner>

      <AnnouncementBannerDialog
        v-if="dialogOpen"
        :key="editingIndex"
        :open="dialogOpen"
        :draft="editingDraft"
        :is-new="editingIndex === NEW_BANNER"
        :org-options="orgOptions"
        @update:open="dialogOpen = $event"
        @save="applyDraft"
      />
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import announcements from "@/services/announcements";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { orderBanners } from "@/utils/announcementOrder";
import AnnouncementBannerCard from "./AnnouncementBannerCard.vue";
import AnnouncementBannerDialog from "./AnnouncementBannerDialog.vue";
import {
  configFromDrafts,
  draftsFromConfig,
  emptyDraft,
  type BannerDraft,
} from "./announcementDrafts";

const props = defineProps<{ open: boolean }>();

defineEmits<{ (_e: "update:open", _value: boolean): void }>();

const { t } = useI18nTyped();
const store = useStore();

/** `editingIndex` sentinel for a banner that is not in the list yet. */
const NEW_BANNER = -1;

const drafts = ref<BannerDraft[]>([]);

const errorMessage = ref<I18nText | "">("");
const isSaving = ref(false);
/** False until the saved config has been read; the list shows a placeholder. */
const isLoaded = ref(false);

const dialogOpen = ref(false);
const editingIndex = ref(NEW_BANNER);
const editingDraft = ref<BannerDraft>(emptyDraft());

const metaOrg = computed(() => store.state.zoConfig?.meta_org);

/** Picking from the real org list beats typing identifiers that silently match nothing. */
const orgOptions = computed<SelectOption[]>(() =>
  (store.state.organizations ?? []).map((org: { identifier: string }) => ({
    label: raw(org.identifier),
    value: org.identifier,
  })),
);

/** A banner as far as the preview cares. */
interface PreviewBanner {
  message: string;
  variant?: string;
}

const previewBanners = computed<PreviewBanner[]>(() =>
  orderBanners(drafts.value.map((d) => ({ message: d.message, variant: d.variant }))),
);

const previewVariant = (banner: PreviewBanner) => {
  switch (banner.variant) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "promo":
      return "default";
    default:
      return "info";
  }
};

const previewIcon = (banner: PreviewBanner) => {
  switch (banner.variant) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "promo":
      return "campaign";
    default:
      return "info";
  }
};

// ── Banner list editing ────────────────────────────────────────────────────

const openAdd = () => {
  editingDraft.value = emptyDraft();
  editingIndex.value = NEW_BANNER;
  dialogOpen.value = true;
};

const openEdit = (index: number) => {
  // A copy, so cancelling the dialog leaves the list untouched.
  editingDraft.value = { ...drafts.value[index] };
  editingIndex.value = index;
  dialogOpen.value = true;
};

const applyDraft = (draft: BannerDraft) => {
  if (editingIndex.value === NEW_BANNER) {
    drafts.value = [...drafts.value, draft];
  } else {
    drafts.value = drafts.value.map((existing, index) =>
      index === editingIndex.value ? draft : existing,
    );
  }
  errorMessage.value = "";
};

const removeDraft = (index: number) => {
  drafts.value = drafts.value.filter((_, i) => i !== index);
};

// ── Load / save ────────────────────────────────────────────────────────────

const loadConfig = async () => {
  // Cleared first so a re-open never shows the previous org's banners while the
  // read is still in flight.
  isLoaded.value = false;

  try {
    const response = await announcements.getConfig(metaOrg.value);
    const source = response?.data ?? { banners: [] };

    drafts.value = draftsFromConfig(source);
    errorMessage.value = "";
  } catch (error: any) {
    errorMessage.value =
      raw(error?.response?.data?.message) || t("announcements.settings.loadFailed");
  } finally {
    // Even a failed read has to let the surface mount, or the drawer is stuck on
    // its placeholder with no way to author anything.
    isLoaded.value = true;
  }
};

const save = async () => {
  const payload = configFromDrafts(drafts.value);

  isSaving.value = true;
  try {
    await announcements.setConfig(metaOrg.value, payload);
    errorMessage.value = "";
    toast({ variant: "success", message: t("announcements.settings.saved") });
    // Re-read so relative durations come back as the absolute window the server
    // resolved them to.
    await loadConfig();
  } catch (error: any) {
    // The server names the offending banner index and field; surfacing its
    // message verbatim is more useful than a generic failure.
    errorMessage.value =
      raw(error?.response?.data?.message) || t("announcements.settings.saveFailed");
  } finally {
    isSaving.value = false;
  }
};

// The drawer owns the lifecycle now, so read on open rather than on mount —
// otherwise every Settings visit fetches a config nobody asked to see, and a
// second open would show whatever was left over from the first.
watch(
  () => props.open,
  (isOpen) => void (isOpen && loadConfig()),
  { immediate: true },
);

// Still exposed so the drawer (or a test) can drive the same two actions the
// footer buttons do; the rest is what tests assert the list round-trip on.
defineExpose({
  save,
  reload: loadConfig,
  applyDraft,
  isSaving,
  drafts,
  editingIndex,
});
</script>
