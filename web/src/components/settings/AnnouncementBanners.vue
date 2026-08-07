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
    <!-- The form is the authoring surface; JSON stays for bulk edits and for
         anything the form does not yet cover. It rides in the header so the body
         opens on the banners themselves. -->
    <template #header-right>
      <OToggleGroup
        class="shrink-0"
        :model-value="mode"
        data-test="announcement-banners-mode"
        @update:model-value="onModeChange"
      >
        <OToggleGroupItem value="form" size="sm" icon-left="edit">
          {{ t("announcements.settings.modeForm") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="json" size="sm" icon-left="code">
          {{ t("announcements.settings.modeJson") }}
        </OToggleGroupItem>
      </OToggleGroup>
    </template>

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

      <!-- ── Form mode ──────────────────────────────────────────────────────── -->
      <div v-if="mode === 'form'" class="flex flex-col gap-2" data-test="announcement-banners-list">
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

      <!-- ── JSON mode ──────────────────────────────────────────────────────── -->
      <template v-else>
        <div class="flex flex-col gap-2">
          <div class="text-text-label text-sm font-bold">
            {{ t("announcements.settings.editorLabel") }}
          </div>

          <!-- Mounted only once the saved config is in hand, and remounted via `:key`
             whenever the buffer is replaced. CodeQueryEditor reads `query` only at
             monaco.editor.create() and never watches it, so without both the editor
             keeps whatever it was created with — and creating it while the drawer is
             still animating open lays Monaco out at zero width, which is the blank
             black panel you get on the second open. -->
          <QueryEditor
            v-if="isLoaded"
            :key="bufferKey"
            editor-id="announcement-banners-editor"
            class="rounded-default border-border-default min-h-90! w-full resize-y overflow-auto border"
            language="json"
            :query="editorValue"
            data-test="announcement-banners-editor"
            @update:query="onEditorChange"
          />
          <div
            v-else
            class="rounded-default border-border-default text-text-muted flex min-h-90 items-center justify-center border text-sm"
            data-test="announcement-banners-editor-loading"
          >
            {{ t("announcements.settings.loading") }}
          </div>
        </div>

        <!-- A working document beats a field table: every field appears here in
           place, annotated, and one click drops it into the editor. -->
        <div class="flex flex-col gap-2" data-test="announcement-banners-reference">
          <div class="flex items-center justify-between gap-2">
            <span class="text-text-label text-sm font-bold">
              {{ t("announcements.settings.exampleLabel") }}
            </span>
            <OButton
              variant="outline"
              size="sm"
              data-test="announcement-banners-insert-example-btn"
              @click="insertExample"
            >
              {{ t("announcements.settings.insertExample") }}
            </OButton>
          </div>
          <OCodeBlock :code="EXAMPLE_CONFIG" lang="json" data-test="announcement-banners-example" />
        </div>
      </template>

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

      <ConfirmDialog
        v-model="showCommentWarning"
        :title="t('announcements.settings.dropCommentsTitle')"
        :message="t('announcements.settings.dropCommentsMessage')"
        :ok-label="t('announcements.settings.dropCommentsConfirm')"
        @update:ok="confirmSwitchToForm"
        @update:cancel="showCommentWarning = false"
      />
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
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
  EXAMPLE_CONFIG,
  parseBannerConfig,
  previewBannersFrom,
  stripJsonComments,
  type PreviewBanner,
} from "./announcementConfig";
import {
  bufferFromDrafts,
  configFromDrafts,
  draftsFromConfig,
  emptyDraft,
  type BannerDraft,
} from "./announcementDrafts";

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const props = defineProps<{ open: boolean }>();

defineEmits<{ (_e: "update:open", _value: boolean): void }>();

const { t } = useI18nTyped();
const store = useStore();

/** `editingIndex` sentinel for a banner that is not in the list yet. */
const NEW_BANNER = -1;

type Mode = "form" | "json";

/** Whichever mode is showing owns the config; the other is rebuilt on switch. */
const mode = ref<Mode>("form");
const drafts = ref<BannerDraft[]>([]);
const editorValue = ref("");

const errorMessage = ref<I18nText | "">("");
const isSaving = ref(false);
/** False until the saved config has been read; gates the editor's first mount. */
const isLoaded = ref(false);
/** Bumped whenever the buffer is replaced behind the editor's back. */
const bufferKey = ref(0);

const dialogOpen = ref(false);
const editingIndex = ref(NEW_BANNER);
const editingDraft = ref<BannerDraft>(emptyDraft());
const showCommentWarning = ref(false);

const metaOrg = computed(() => store.state.zoConfig?.meta_org);

/** Picking from the real org list beats typing identifiers that silently match nothing. */
const orgOptions = computed<SelectOption[]>(() =>
  (store.state.organizations ?? []).map((org: { identifier: string }) => ({
    label: raw(org.identifier),
    value: org.identifier,
  })),
);

const previewBanners = computed<PreviewBanner[]>(() =>
  mode.value === "form"
    ? orderBanners(drafts.value.map((d) => ({ message: d.message, variant: d.variant })))
    : previewBannersFrom(editorValue.value),
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

/** Replace the editor buffer and force the editor to pick the new text up. */
const setBuffer = (value: string) => {
  editorValue.value = value;
  bufferKey.value += 1;
};

const onEditorChange = (value: string) => {
  editorValue.value = value;
  errorMessage.value = "";
};

const insertExample = () => {
  setBuffer(EXAMPLE_CONFIG);
  errorMessage.value = "";
};

// ── Mode switching ─────────────────────────────────────────────────────────

/** Parse the buffer into drafts, or report why it cannot be. */
const adoptBufferAsDrafts = (): boolean => {
  const parsed = parseBannerConfig(editorValue.value);
  if (!parsed.ok) {
    errorMessage.value = t("announcements.settings.invalidJson");
    return false;
  }

  drafts.value = draftsFromConfig(parsed.payload);
  errorMessage.value = "";
  return true;
};

const confirmSwitchToForm = () => {
  showCommentWarning.value = false;
  if (adoptBufferAsDrafts()) mode.value = "form";
};

const onModeChange = (value: unknown) => {
  const next = value as Mode | null;
  // OToggleGroup deselects on a second click of the active item; ignore that
  // rather than leaving the component with no authoring surface at all.
  if (!next || next === mode.value) return;

  if (next === "json") {
    setBuffer(bufferFromDrafts(drafts.value));
    errorMessage.value = "";
    mode.value = "json";
    return;
  }

  // A form has nowhere to put a comment, so going back drops them. Say so first
  // rather than silently deleting an author's annotations.
  if (stripJsonComments(editorValue.value) !== editorValue.value) {
    showCommentWarning.value = true;
    return;
  }
  confirmSwitchToForm();
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
  // Cleared first so the editor is torn down and rebuilt on every open. This
  // component now outlives the drawer, and a Monaco instance created while the
  // panel is still animating lays out at zero width — the blank black editor.
  isLoaded.value = false;

  try {
    const response = await announcements.getConfig(metaOrg.value);
    const source = response?.data ?? { banners: [] };

    drafts.value = draftsFromConfig(source);
    setBuffer(JSON.stringify(source, null, 2));
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
  let payload: unknown;

  if (mode.value === "form") {
    payload = configFromDrafts(drafts.value);
  } else {
    const parsed = parseBannerConfig(editorValue.value);
    if (!parsed.ok) {
      errorMessage.value = t("announcements.settings.invalidJson");
      return;
    }
    payload = parsed.payload;
  }

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
// buttons above do. The rest is exposed for tests that assert the form/JSON
// round-trip actually reaches the editor.
defineExpose({
  save,
  reload: loadConfig,
  switchMode: onModeChange,
  confirmSwitchToForm,
  applyDraft,
  isSaving,
  editorValue,
  bufferKey,
  drafts,
  mode,
  editingIndex,
  showCommentWarning,
});
</script>
