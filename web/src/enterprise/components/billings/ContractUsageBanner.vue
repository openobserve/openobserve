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
  <OBanner v-if="block" bar variant="error" icon="block" data-test="contract-usage-banner">
    <div>{{ message }}</div>
    <template #actions>
      <OButton
        variant="banner-dismiss"
        size="sm"
        data-test="contract-usage-banner-billing"
        @click="openBilling"
      >
        {{ t("featureLock.usageLimitBannerBilling") }}
      </OButton>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";
import { timestampToTimezoneDate } from "@/utils/zincutils";

interface ContractUsageBlock {
  meters: string[];
  until: number;
}

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

// The org config only carries a block that is being applied, so its presence is the whole test.
const block = computed<ContractUsageBlock | null>(
  () => store.state.zoConfig?.contract_usage_block ?? null,
);

const message = computed(() =>
  block.value
    ? t("featureLock.usageLimitBanner", {
        meters: block.value.meters.join(", "),
        until: `${timestampToTimezoneDate(block.value.until, "UTC", "yyyy-MM-dd HH:mm")} UTC`,
      })
    : "",
);

const openBilling = () =>
  router.push({
    name: "billings",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
</script>
