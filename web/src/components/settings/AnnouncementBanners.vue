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
  <q-dialog
    :model-value="open"
    position="right"
    full-height
    data-test="announcement-banners-settings"
    @update:model-value="$emit('update:open', $event)"
  >
    <q-card class="announcement-drawer-card">
      <q-card-section class="announcement-drawer-header">
        <div class="text-h6">{{ t("announcements.settings.label") }}</div>
        <div class="announcement-drawer-subtitle">
          {{ t("announcements.settings.description") }}
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="announcement-drawer-body">
        <!-- Rendered through the same resolver the live bar uses, so the order here
             is the order users get — not the order the banners were authored in. -->
        <div class="announcement-drawer-block">
          <div class="announcement-drawer-label">
            {{ t("announcements.settings.previewLabel") }}
          </div>
          <div class="announcement-preview" data-test="announcement-banners-preview">
            <div
              v-for="(banner, index) in previewBanners"
              :key="index"
              class="announcement-preview-bar"
              :class="`announcement-preview-bar--${banner.variant ?? 'info'}`"
            >
              <q-icon :name="previewIcon(banner)" size="16px" />
              <span>{{ banner.message }}</span>
            </div>
            <div
              v-if="!previewBanners.length"
              class="announcement-preview-empty"
              data-test="announcement-banners-preview-empty"
            >
              {{ t("announcements.settings.previewEmpty") }}
            </div>
          </div>
        </div>

        <div class="announcement-drawer-block" data-test="announcement-banners-list">
          <div class="announcement-drawer-list-header">
            <span class="announcement-drawer-label">
              {{ t("announcements.settings.bannersLabel") }}
            </span>
            <q-btn
              no-caps
              size="sm"
              icon="add"
              class="o2-secondary-button"
              :label="t('announcements.settings.addBanner')"
              data-test="announcement-banners-add-btn"
              @click="openAdd"
            />
          </div>

          <div v-if="!isLoaded" class="announcement-drawer-placeholder">
            {{ t("announcements.settings.loading") }}
          </div>

          <div
            v-else-if="!drafts.length"
            class="announcement-drawer-empty"
            data-test="announcement-banners-list-empty"
          >
            <span>{{ t("announcements.settings.emptyTitle") }}</span>
            <span class="announcement-drawer-empty-hint">
              {{ t("announcements.settings.emptyHint") }}
            </span>
          </div>

          <div v-else class="announcement-drawer-cards">
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

        <div
          v-if="errorMessage"
          class="announcement-drawer-error"
          data-test="announcement-banners-error"
        >
          <q-icon name="error" size="16px" />
          <span>{{ errorMessage }}</span>
        </div>

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
      </q-card-section>

      <q-separator />

      <!-- Pinned in the footer rather than floating mid-body, so they stay
           reachable however long the banner list gets. -->
      <q-card-actions align="right" class="tw:gap-2">
        <q-btn
          no-caps
          size="md"
          class="o2-secondary-button tw:h-[36px]"
          :disable="isSaving"
          :label="t('announcements.settings.reset')"
          data-test="announcement-banners-discard-btn"
          @click="loadConfig"
        />
        <q-btn
          no-caps
          size="md"
          class="o2-primary-button no-border tw:h-[36px]"
          :loading="isSaving"
          :label="t('announcements.settings.save')"
          data-test="announcement-banners-publish-btn"
          @click="save"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";

import announcements from "@/services/announcements";
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

const { t } = useI18n();
const store = useStore();
const q = useQuasar();

/** `editingIndex` sentinel for a banner that is not in the list yet. */
const NEW_BANNER = -1;

const drafts = ref<BannerDraft[]>([]);

const errorMessage = ref("");
const isSaving = ref(false);
/** False until the saved config has been read; the list shows a placeholder. */
const isLoaded = ref(false);

const dialogOpen = ref(false);
const editingIndex = ref(NEW_BANNER);
const editingDraft = ref<BannerDraft>(emptyDraft());

const metaOrg = computed(() => store.state.zoConfig?.meta_org);

/** Picking from the real org list beats typing identifiers that silently match nothing. */
const orgOptions = computed(() =>
  (store.state.organizations ?? []).map((org: { identifier: string }) => ({
    label: org.identifier,
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
      error?.response?.data?.message || t("announcements.settings.loadFailed");
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
    q.notify({
      type: "positive",
      message: t("announcements.settings.saved"),
      timeout: 2000,
    });
    // Re-read so relative durations come back as the absolute window the server
    // resolved them to.
    await loadConfig();
  } catch (error: any) {
    // The server names the offending banner index and field; surfacing its
    // message verbatim is more useful than a generic failure.
    errorMessage.value =
      error?.response?.data?.message || t("announcements.settings.saveFailed");
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

<style scoped lang="scss">
.announcement-drawer-card {
  width: 720px;
  max-width: 95vw;
  display: flex;
  flex-direction: column;
}

.announcement-drawer-header {
  padding-bottom: 0.5rem;
}

.announcement-drawer-subtitle {
  font-size: 0.8125rem;
  opacity: 0.7;
}

.announcement-drawer-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1;
  overflow-y: auto;
}

.announcement-drawer-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.announcement-drawer-label {
  font-size: 0.875rem;
  font-weight: 700;
}

.announcement-drawer-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.announcement-drawer-cards {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.announcement-drawer-placeholder {
  padding: 1.5rem 0;
  text-align: center;
  font-size: 0.875rem;
  opacity: 0.6;
}

.announcement-drawer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 2rem 1rem;
  text-align: center;
  font-size: 0.875rem;
  opacity: 0.6;
  border: 1px dashed var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 0.375rem;
}

.announcement-drawer-empty-hint {
  font-size: 0.75rem;
}

.announcement-drawer-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}

/* The preview mirrors the live bar's fills so the two cannot read differently. */
.announcement-preview {
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 0.375rem;
  overflow: hidden;
}

.announcement-preview-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.2rem 1rem;
  font-size: 0.8125rem;
  font-weight: 600;
  flex-wrap: wrap;
}

.announcement-preview-empty {
  padding: 0.75rem 1rem;
  text-align: center;
  font-size: 0.875rem;
  opacity: 0.6;
}

.announcement-preview-bar--critical {
  background: #dc2626;
  color: #ffffff;
}

.announcement-preview-bar--warning {
  background: #fbbf24;
  color: #1a1a1a;
}

.announcement-preview-bar--info {
  background: #2563eb;
  color: #ffffff;
}

.announcement-preview-bar--promo {
  background: #7c3aed;
  color: #ffffff;
}
</style>
