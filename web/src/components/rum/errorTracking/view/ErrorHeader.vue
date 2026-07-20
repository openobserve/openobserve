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
      <OPageHeader
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
              class="hover:text-button-primary"
              @click="copyErrorId(error.error_id)"
          /></span>
        </template>
        <template #actions>
          <span>{{ error.timestamp }}</span>
        </template>
      </OPageHeader>
      <div class="flex items-center flex-nowrap my-1">
        <div
          data-test="error-header-error-type"
          class="text-2xl font-bold"
        >{{ error.type }}</div>
      </div>
      <div class="text-base pt-1 flex items-center">
        <div
          v-if="error.error_handling === 'unhandled'"
          data-test="error-header-unhandled-badge"
          :class="
            error.error_handling === 'unhandled'
              ? 'text-status-error-text border border-status-negative rounded-default text-sm px-1 mr-2'
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
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";

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
