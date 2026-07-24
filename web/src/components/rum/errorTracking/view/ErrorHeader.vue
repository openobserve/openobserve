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
      <OPageHeader :back="{ onClick: () => router.back(), dataTest: 'back-button' }">
        <template #title>
          <span class="font-bold">{{ t("rum.eventID") }}:</span>
          <span data-test="error-id" :title="error.error_id" class="cursor-pointer pl-1"
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
      <div class="my-1 flex flex-nowrap items-center">
        <div data-test="error-header-error-type" class="text-2xl font-bold">{{ error.type }}</div>
      </div>
      <div class="flex items-center pt-1 text-base">
        <div
          v-if="error.error_handling === 'unhandled'"
          data-test="error-header-unhandled-badge"
          :class="
            error.error_handling === 'unhandled'
              ? 'text-status-error-text border-status-negative rounded-default mr-2 border px-1 text-sm'
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
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";

const { t } = useI18n();
const router = useRouter();
defineProps({
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
