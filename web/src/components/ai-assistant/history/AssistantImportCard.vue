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
  <!-- OBanner reads its slots once, so a footer that appears later needs a fresh banner. -->
  <OBanner
    :key="view.state"
    variant="info"
    dense
    role="presentation"
    :content="body"
    :data-state="view.state"
    data-test="assistant-local-import-banner"
  >
    <template v-if="view.state === 'moving' || view.state === 'partial'" #footer>
      <div v-if="view.state === 'moving'" class="mt-1 flex flex-col gap-1">
        <OProgressBar :value="progress" data-test="assistant-local-import-progress" />
      </div>
      <ul v-if="view.state === 'partial'" class="mt-1 flex flex-col gap-1">
        <li
          v-for="item in view.failed"
          :key="item.sid"
          class="flex min-w-0 flex-wrap items-center gap-1"
          data-test="assistant-local-import-failed"
        >
          <OTruncatedText class="text-text-body min-w-12 flex-1">{{ item.title }}</OTruncatedText>
          <OButton
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-local-import-retry-one"
            @click="emit('retry')"
          >
            {{ t("assistant.history.import.retry") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            :icon-left="assistantGlyph.download"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-local-import-download-one"
            @click="emit('download', item.sid)"
          >
            {{ t("assistant.history.import.download") }}
          </OButton>
        </li>
      </ul>
    </template>
    <template v-if="actions" #actions>
      <div class="flex flex-wrap items-center gap-2 max-md:w-full">
        <template v-if="view.state === 'offer'">
          <OButton
            variant="primary"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-local-import-move"
            @click="emit('move')"
          >
            {{ t("assistant.history.import.move") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-local-import-not-now"
            @click="emit('dismiss', 'not_now')"
          >
            {{ t("assistant.history.import.notNow") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-local-import-never"
            @click="emit('dismiss', 'never')"
          >
            {{ t("assistant.history.import.never") }}
          </OButton>
        </template>
        <template v-else-if="view.state === 'unavailable'">
          <OButton
            variant="outline"
            size="sm"
            :icon-left="assistantGlyph.download"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            :loading="downloading"
            data-test="assistant-local-import-download-all"
            @click="emit('download-all')"
          >
            {{ t("assistant.history.downloadAll") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-local-import-dismiss"
            @click="emit('dismiss', 'never')"
          >
            {{ t("assistant.history.import.dismiss") }}
          </OButton>
        </template>
        <AssistantAskAdminPopover v-else-if="view.state === 'forbidden'" kind="access" :org="org" />
        <OButton
          v-else
          variant="outline"
          size="sm"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-local-import-retry"
          @click="emit('retry')"
        >
          {{ t("assistant.history.import.retry") }}
        </OButton>
      </div>
    </template>
  </OBanner>
</template>

<script lang="ts">
import type { ImportView, Sid } from "@/composables/assistant";

export interface AssistantImportCardProps {
  view: ImportView;
  org: string;
  /** "Download all" is building its file. */
  downloading?: boolean;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantImportCardProps>(), { downloading: false });

const emit = defineEmits<{
  move: [];
  retry: [];
  dismiss: [kind: "not_now" | "never"];
  download: [sid: Sid];
  "download-all": [];
}>();

const { t } = useI18nTyped();

const progress = computed(() =>
  props.view.count ? Math.min(props.view.done / props.view.count, 1) : 0,
);
const actions = computed(() => props.view.state !== "moving" && props.view.state !== "done");
const body = computed(() => {
  const { state, count, done, failed } = props.view;
  if (state === "moving") return t("assistant.history.import.progress", { done, count });
  if (state === "partial")
    return t("assistant.history.import.failed", { count: failed.length }, failed.length);
  if (state === "unavailable") return t("assistant.history.import.unavailable", { count });
  if (state === "forbidden") return t("assistant.history.import.forbidden");
  if (state === "offline") return t("assistant.history.import.offline");
  if (state === "error") return t("assistant.history.import.error");
  if (state === "done") return t("assistant.history.import.moved", { done, count });
  return t("assistant.history.import.offer", { count });
});
</script>
