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
    class="bg-surface-base absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 text-center"
    data-test="dashboard-playlist-holding"
  >
    <OSpinner size="lg" />
    <p
      v-if="eyebrow"
      class="text-text-secondary text-lg font-medium"
      data-test="dashboard-playlist-holding-eyebrow"
    >
      {{ eyebrow }}
    </p>
    <p
      v-if="title"
      class="text-text-heading text-3xl font-semibold"
      data-test="dashboard-playlist-holding-title"
    >
      {{ title }}
    </p>
    <p
      class="text-text-secondary text-xl tabular-nums"
      data-test="dashboard-playlist-holding-label"
    >
      {{ label }}
    </p>
    <p v-if="note" class="text-text-secondary text-lg" data-test="dashboard-playlist-holding-note">
      {{ note }}
    </p>
  </div>
</template>

<script setup lang="ts">
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { I18nText } from "@/types/i18n";

withDefaults(
  defineProps<{
    label: I18nText;
    title?: string | null;
    note?: I18nText | null;
    /** "Starting" or "Loading", above the name. */
    eyebrow?: I18nText | null;
  }>(),
  { title: null, note: null, eyebrow: null },
);
</script>
