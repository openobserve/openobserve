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
  <div class="flex flex-col gap-4" data-test="announcement-banners-settings">
    <OBanner variant="info" icon="info" data-test="announcement-banners-help">
      {{ t("announcements.settings.help") }}
    </OBanner>

    <!-- Rendered from the editor buffer, so the author sees the real component
         before publishing rather than after. -->
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

    <OBanner
      v-if="errorMessage"
      variant="error-soft"
      icon="error"
      data-test="announcement-banners-error"
    >
      {{ errorMessage }}
    </OBanner>

    <!-- Directly under the editor: the actions belong with the buffer they act
         on, and the drawer footer put them a scroll away from it. -->
    <div class="flex items-center justify-end gap-2">
      <OButton
        variant="outline"
        size="sm"
        :disabled="isSaving"
        data-test="announcement-banners-discard-btn"
        @click="loadConfig"
      >
        {{ t("announcements.settings.reset") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm"
        :loading="isSaving"
        data-test="announcement-banners-save-btn"
        @click="save"
      >
        {{ t("announcements.settings.save") }}
      </OButton>
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
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import announcements from "@/services/announcements";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  EMPTY_CONFIG,
  EXAMPLE_CONFIG,
  parseBannerConfig,
  previewBannersFrom,
  type PreviewBanner,
} from "./announcementConfig";

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const { t } = useI18nTyped();
const store = useStore();

const editorValue = ref(EMPTY_CONFIG);
const errorMessage = ref<I18nText | "">("");
const isSaving = ref(false);
/** False until the saved config has been read; gates the editor's first mount. */
const isLoaded = ref(false);
/** Bumped whenever the buffer is replaced behind the editor's back. */
const bufferKey = ref(0);

/** Replace the editor buffer and force the editor to pick the new text up. */
const setBuffer = (value: string) => {
  editorValue.value = value;
  bufferKey.value += 1;
  errorMessage.value = "";
};

const metaOrg = computed(() => store.state.zoConfig?.meta_org);

const previewBanners = computed<PreviewBanner[]>(() => previewBannersFrom(editorValue.value));

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

const onEditorChange = (value: string) => {
  editorValue.value = value;
  errorMessage.value = "";
};

/** Drops the example into the editor; nothing is published until Save. */
const insertExample = () => {
  setBuffer(EXAMPLE_CONFIG);
};

const loadConfig = async () => {
  try {
    const response = await announcements.getConfig(metaOrg.value);
    setBuffer(JSON.stringify(response?.data ?? { banners: [] }, null, 2));
  } catch (error: any) {
    errorMessage.value =
      raw(error?.response?.data?.message) || t("announcements.settings.loadFailed");
  } finally {
    // Even a failed read has to let the editor mount, or the drawer is stuck on
    // its placeholder with no way to author anything.
    isLoaded.value = true;
  }
};

const save = async () => {
  const parsed = parseBannerConfig(editorValue.value);
  if (!parsed.ok) {
    errorMessage.value = t("announcements.settings.invalidJson");
    return;
  }

  isSaving.value = true;
  try {
    await announcements.setConfig(metaOrg.value, parsed.payload);
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

onMounted(loadConfig);

// Still exposed so the drawer (or a test) can drive the same two actions the
// buttons above do. `editorValue`/`bufferKey` are exposed for the tests that
// assert a buffer replacement actually reaches the editor.
defineExpose({ save, reload: loadConfig, isSaving, editorValue, bufferKey });
</script>
