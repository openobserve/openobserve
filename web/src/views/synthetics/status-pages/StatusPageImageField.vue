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
  <div class="flex min-w-0 flex-col gap-1.5" :data-test="`${dataTest}-field`">
    <div class="flex items-center gap-1.5">
      <span class="text-text-label text-sm font-medium">{{ label }}</span>
      <OIcon
        v-if="locked"
        name="lock"
        size="xs"
        class="text-warning-600"
        aria-hidden="true"
        :data-test="`${dataTest}-lock`"
      />
    </div>

    <p v-if="note" class="text-text-secondary text-xs">{{ note }}</p>

    <div v-if="image" class="flex min-w-0 items-center gap-2">
      <img
        :src="imageDataUrl(image)"
        :alt="label"
        :data-test="`${dataTest}-preview`"
        class="object-contain"
        :class="square ? 'h-8 w-8' : 'max-h-9 max-w-37.5'"
      />
      <OButton
        v-if="!locked"
        type="button"
        variant="ghost-destructive"
        size="icon-xs-sq"
        icon-left="close"
        :data-test="`${dataTest}-clear`"
        @click="emit('clear')"
      >
        <OTooltip side="bottom" :content="clearLabel" />
      </OButton>
    </div>
    <div v-else class="contents" @click.capture="onCaptureClick">
      <OFile
        class="min-w-0"
        :model-value="null"
        :placeholder="uploadLabel"
        accept=".png, .jpg, .jpeg, .gif, .svg, .ico, image/*"
        :data-test="`${dataTest}-upload`"
        @update:model-value="(value: FileValue) => emit('select', value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import type { FileValue } from "@/lib/forms/File/OFile.types";
import { imageDataUrl } from "./statusPageBadges";

const props = defineProps<{
  label: I18nText;
  uploadLabel: I18nText;
  clearLabel: I18nText;
  image: string;
  locked: boolean;
  dataTest: string;
  note?: I18nText;
  square?: boolean;
}>();

const emit = defineEmits<{
  select: [value: FileValue];
  clear: [];
  locked: [];
}>();

// A locked field still renders the picker so the upgrade prompt opens instead of the file dialog.
function onCaptureClick(event: MouseEvent) {
  if (!props.locked) return;
  event.preventDefault();
  event.stopPropagation();
  emit("locked");
}
</script>
