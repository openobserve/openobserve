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
    class="px-page-edge text-status-warning-text bg-status-warning-bg flex items-center gap-2 py-2 text-xs"
    data-test="logs-missing-stream-banner"
  >
    <OIcon name="warning" size="sm" />
    <span>{{ message }}</span>
    <OButton
      v-if="noFtsStreams.length"
      variant="ghost-warning"
      size="chip"
      data-test="logs-no-fts-configure-btn"
      @click="openSettings"
    >
      {{ t("search.freeTextSetField") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";

const props = defineProps<{
  message: string;
  noFtsStreams: string[];
}>();

const { t } = useI18nTyped();
const router = useRouter();

// Routes only; the stream settings dialog owns the write.
const openSettings = () => {
  const stream = props.noFtsStreams[0];
  if (stream) router.push(`/streams?dialog=${stream}`);
};
</script>
