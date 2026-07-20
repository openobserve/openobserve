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
  <div>
    <div>
      <AppPageHeader
        :back="{ onClick: () => router.back(), dataTest: 'back-button' }"
      >
        <template #title>
          <span class="font-bold">{{ t("rum.eventID") }}:</span>
          <span
            data-test="error-id"
            :title="error.error_id"
            class="pl-1 cursor-pointer"
            >{{ error.error_id }}
            <OIcon
              size="xs"
              name="content-copy"
              class="hover:text-[var(--o2-primary-btn-bg)]"
              @click="copyErrorId(error.error_id)"
          /></span>
        </template>
        <template #actions>
          <span>{{ error.timestamp }}</span>
        </template>
      </AppPageHeader>
      <div class="flex items-center flex-nowrap my-1">
        <div
          data-test="error-header-error-type"
          class="text-[22px] font-bold"
        >{{ error.type }}</div>
      </div>
      <div class="text-base pt-1 flex items-center">
        <div
          v-if="error.error_handling === 'unhandled'"
          data-test="error-header-unhandled-badge"
          :class="
            error.error_handling === 'unhandled'
              ? 'text-red-6 border border-[rgb(246,68,68)] rounded text-sm px-1 mr-2'
              : ''
          "
        >
          {{ error.error_handling }}
        </div>
        {{ error.error_message }}
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { defineProps } from "vue";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";

const { t } = useI18n();
const router = useRouter();
const props = defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const copyErrorId = (id: string) => {
  copyToClipboard(id, {
    successMessage: t("rum.copiedToClipboard"),
    timeout: 1500,
  });
};
</script>
