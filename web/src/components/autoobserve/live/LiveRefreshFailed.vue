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
  <div
    role="alert"
    class="bg-status-error-bg text-status-error-text rounded-default flex items-center gap-2 ps-2.5 pe-1 text-xs font-medium"
    :class="dense ? 'py-0' : 'py-1'"
    :data-test="dataTest"
  >
    <OIcon name="error-outline" size="xs" class="shrink-0" />
    <OTruncatedText v-if="lines" :lines="lines" class="flex-1 leading-3.5">{{
      text
    }}</OTruncatedText>
    <span v-else class="min-w-0 flex-1 text-pretty">{{ text }}</span>
    <OButton
      variant="ghost"
      size="xs"
      class="shrink-0"
      :loading="busy"
      :data-test="`${dataTest}-retry`"
      @click="emit('retry')"
    >
      {{ t("autoobserveLive.retry") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { TruncatedTextLines } from "@/lib/core/Typography/OTruncatedText.types";
import { refreshFailedText, type LiveStale, type LiveSurface } from "./liveCopy";
import { useLiveZone } from "./liveModel";

const props = defineProps<{
  surface: LiveSurface;
  stale: LiveStale;
  dataTest: string;
  busy?: boolean;
  dense?: boolean;
  // A fixed-height slot clamps the message in tight lines; the tooltip and the alert role still carry all of it.
  lines?: TruncatedTextLines;
}>();

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
const zone = useLiveZone();

const text = computed(() =>
  refreshFailedText(t, zone.value.locale, zone.value.timeZone, props.surface, props.stale),
);
</script>
