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
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { copyToClipboard } from "@/utils/clipboard";
import type { PanelNotice, PanelNoticeActionId } from "@/utils/dashboard/panelNotices";

const props = withDefaults(
  defineProps<{
    notice: PanelNotice;
    /** Shows the "Open inspector" link after this notice's own actions. */
    showInspect?: boolean;
  }>(),
  { showInspect: false },
);

const emit = defineEmits<{
  (e: "action", id: PanelNoticeActionId): void;
  (e: "open-inspector"): void;
  /** The notice's text went to the clipboard; the host closes its tooltip. */
  (e: "copied"): void;
}>();

const { t } = useI18nTyped();

const copyError = () => {
  if (!props.notice.copyText) return;
  emit("copied");
  copyToClipboard(props.notice.copyText, t);
};
</script>

<template>
  <div class="flex flex-col gap-1" :data-test="`panel-notice-content-${notice.id}`">
    <div class="text-text-heading flex items-center gap-1.5 font-semibold">
      <OIcon :name="notice.icon" size="xs" class="shrink-0" />
      <span>{{ notice.title }}</span>
    </div>
    <div class="font-normal">{{ notice.body }}</div>
    <div
      v-for="detail in notice.details"
      :key="detail"
      class="text-text-secondary text-2xs max-h-32 overflow-y-auto font-mono font-normal whitespace-pre-wrap"
      :data-test="`panel-notice-detail-${notice.id}`"
    >
      {{ detail }}
    </div>
    <div
      v-if="notice.action || notice.copyText || showInspect"
      class="mt-1 flex flex-wrap items-center gap-2"
    >
      <OButton
        v-if="notice.action"
        variant="outline"
        size="xs"
        :data-test="`panel-notice-action-${notice.action.id}`"
        @click="emit('action', notice.action.id)"
      >
        {{ notice.action.label }}
      </OButton>
      <OButton
        v-if="notice.copyText"
        variant="ghost"
        size="xs"
        icon-left="content-copy"
        data-test="panel-notice-action-copy-error"
        @click="copyError"
      >
        {{ t("dashboard.panelErrorButtons.copyError") }}
      </OButton>
      <OButton
        v-if="showInspect"
        variant="ghost-primary"
        size="xs"
        data-test="panel-notice-action-open-inspector"
        @click="emit('open-inspector')"
      >
        {{ t("dashboard.panelErrorButtons.openInspector") }}
      </OButton>
    </div>
  </div>
</template>
