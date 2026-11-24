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
    class="bg-surface-subtle rounded-surface flex h-32 flex-col gap-1.5 overflow-hidden p-3"
    data-test="autoobserve-live-issue-check-slot"
  >
    <span class="text-text-body text-xs font-medium">{{ title }}</span>
    <OTruncatedText
      as="p"
      :lines="2"
      class="text-text-heading text-sm"
      data-test="autoobserve-live-issue-likely"
    >
      {{ text }}
    </OTruncatedText>
    <AoConfidenceMeter v-if="band" :band="band" :reason="reason" clamp />
  </div>
</template>

<script setup lang="ts">
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { RcaBand } from "@/services/incidents";
import type { I18nText } from "@/types/i18n";
import AoConfidenceMeter from "./AoConfidenceMeter.vue";

defineProps<{
  title: I18nText;
  text: I18nText;
  band: RcaBand | null;
  reason: string | null;
}>();
</script>
