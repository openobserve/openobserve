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
      <div class="tw:pt-2 tw:pb-1 tw:flex tw:justify-start">
        <div
          data-test="back-button"
          class="tw:flex tw:justify-center tw:items-center tw:mr-3 tw:cursor-pointer hover:tw:text-[var(--o2-primary-btn-bg)]"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="router.back()"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
        <span class="tw:font-bold">{{ t("rum.eventID") }}:</span>
        <span
          data-test="error-id"
          :title="error.error_id"
          class="tw:pl-1 tw:cursor-pointer"
          >{{ error.error_id }}
          <OIcon
            size="xs"
            name="content-copy"
            class="hover:tw:text-[var(--o2-primary-btn-bg)]"
            @click="copyErrorId(error.error_id)"
        /></span>
        <span class="tw:ml-4">{{ error.timestamp }}</span>
      </div>
      <div class="tw:flex tw:items-center tw:flex-nowrap tw:my-1">
        <div class="error_type tw:font-bold">{{ error.type }}</div>
      </div>
      <div class="error_message tw:pt-1 tw:flex tw:items-center">
        <div
          v-if="error.error_handling === 'unhandled'"
          :class="
            error.error_handling === 'unhandled'
              ? 'unhandled_error text-red-6 tw:px-1 tw:mr-2'
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
    successMessage: "Copied to clipboard",
    timeout: 1500,
  });
};
</script>

<style lang="scss">
.error_type {
  font-size: 22px;
}

.error_description {
  font-size: 18px;
}

.error_message {
  font-size: 16px;
}
.error_symbol {
  width: 12px;
  height: 12px;
  background-color: rgb(251, 119, 119);
  border-radius: 50%;
}
.error_time {
  font-size: 16px;
}

.unhandled_error {
  border: 1px solid rgb(246, 68, 68);
  border-radius: 4px;
  font-size: 14px;
}
</style>
