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
  <OBanner
    data-test="rca-blocked-banner"
    variant="error-soft"
    icon="block"
    role="alert"
    inline-actions
  >
    <p class="text-banner-error-soft-text m-0 text-sm font-semibold">
      {{ t("alerts.incidents.rcaBlocked") }}
    </p>
    <p data-test="rca-blocked-reason" class="text-banner-error-soft-text m-0 mt-0.5 text-sm">
      {{ refusal.reason }}
    </p>
    <template #actions>
      <OButton
        v-if="refusal.remedy === 'plans'"
        data-test="rca-plans-btn"
        variant="primary"
        size="sm"
        @click="openPlans"
      >
        {{ t("billing.plansLabel") }}
      </OButton>
      <OButton
        v-else-if="refusal.remedy === 'contact'"
        data-test="rca-contact-btn"
        variant="primary"
        size="sm"
        @click="contactSales"
      >
        {{ t("billing.contactLabel") }}
      </OButton>
      <OButton
        data-test="rca-blocked-retry-btn"
        variant="outline"
        size="sm"
        :loading="retrying"
        @click="$emit('retry')"
      >
        <OIcon name="refresh" size="sm" class="me-1" />
        {{ t("alerts.incidents.rcaRetry") }}
      </OButton>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { siteURL } from "@/constants/config";
import { useI18nTyped } from "@/types/i18n";
import type { RcaRefusal } from "@/composables/useIncidentRca";

withDefaults(defineProps<{ refusal: RcaRefusal; retrying?: boolean }>(), { retrying: false });

defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

// Plans is where an org subscribes or turns on paid AI usage.
const openPlans = () =>
  void router.push({
    name: "plans",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
const contactSales = () => window.open(siteURL.contactSales, "_blank");
</script>
