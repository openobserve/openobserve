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
  <div class="min-w-0" @click.capture="onCaptureClick">
    <LogoUploadCard
      :title="label"
      :description="note"
      :current-src="image ? imageDataUrl(image) : null"
      accept=".png, .jpg, .jpeg, .gif, .webp, .svg, .ico"
      :remove-label="clearLabel"
      :show-status="false"
      :locked="locked"
      :data-test="dataTest"
      :test-ids="{
        card: `${dataTest}-field`,
        image: `${dataTest}-preview`,
        preview: `${dataTest}-preview-box`,
        file: `${dataTest}-upload`,
        remove: `${dataTest}-clear`,
      }"
      @update:model-value="(file: File | null) => file && emit('select', file)"
      @remove="emit('clear')"
    />
  </div>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import LogoUploadCard from "@/components/common/LogoUploadCard.vue";
import { imageDataUrl } from "./statusPageBadges";

const props = defineProps<{
  label: I18nText;
  clearLabel: I18nText;
  image: string;
  locked: boolean;
  dataTest: string;
  note?: I18nText;
}>();

const emit = defineEmits<{
  select: [value: File];
  clear: [];
  locked: [];
}>();

// A locked, empty field still renders the picker so the upgrade prompt opens instead of the file dialog.
function onCaptureClick(event: MouseEvent) {
  if (!props.locked || props.image) return;
  event.preventDefault();
  event.stopPropagation();
  emit("locked");
}
</script>
