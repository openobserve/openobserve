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

<!-- The copy fallback when the browser refused the automatic copy (4c C6): the link and a Copy button, a second gesture. -->
<template>
  <!-- Modal: the closing context menu hands focus back to the row, which would dismiss a non-modal popover at once. -->
  <OPopover
    :open="open"
    modal
    align="end"
    :aria-label="t('search.linePermalink.popoverTitle')"
    @update:open="onOpenChange"
  >
    <template #trigger>
      <span class="pointer-events-none block size-0" aria-hidden="true" />
    </template>
    <div class="flex w-80 flex-col gap-2 px-3 py-2.5 text-xs" data-test="log-line-link-popover">
      <span class="text-text-heading text-sm font-semibold">{{
        t("search.linePermalink.popoverTitle")
      }}</span>
      <span class="text-text-secondary">{{ t("search.linePermalink.popoverDesc") }}</span>
      <OInput :model-value="url" readonly class="font-mono" data-test="log-line-link-popover-url" />
      <div class="flex justify-end gap-2">
        <OButton
          variant="outline"
          size="sm"
          data-test="log-line-link-popover-close"
          @click="closeLineLinkPopover"
        >
          {{ t("common.close") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm"
          data-test="log-line-link-popover-copy"
          @click="copyUrl"
        >
          {{ t("common.copy") }}
        </OButton>
      </div>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { copyToClipboard } from "@/utils/clipboard";
import {
  closeLineLinkPopover,
  lineLinkPopover,
  type LineLinkSource,
} from "@/composables/useLogs/useLogLineLink";

const props = defineProps<{ source: LineLinkSource }>();

const { t } = useI18nTyped();

const open = computed(() => lineLinkPopover.value?.source === props.source);
const url = computed(() => (open.value ? (lineLinkPopover.value?.url ?? "") : ""));

const onOpenChange = (value: boolean) => {
  if (!value) closeLineLinkPopover();
};

const copyUrl = async () => {
  const copied = await copyToClipboard(url.value, t, {
    successMessage: t("search.linePermalink.toastCopied"),
    errorMessage: t("search.errorCopyingLink"),
  });
  if (copied) closeLineLinkPopover();
};
</script>
