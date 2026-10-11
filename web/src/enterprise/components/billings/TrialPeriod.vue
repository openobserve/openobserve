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
  <div v-if="visible" class="flex flex-col gap-2">
    <OBanner
      :variant="tone"
      :icon="tone === 'warning' ? 'warning' : 'info-outline'"
      inline-actions
      dense
      data-test="trial-period-container"
      :data-tone="tone"
    >
      <span class="font-semibold">{{ t("billing.trialStrip.title") }}</span>
      <span class="mx-1">·</span>
      <template v-if="expired">
        <span class="font-semibold" data-test="trial-period-status">{{
          t("billing.trialStrip.endedOn", { date: endDate })
        }}</span>
        <span class="mx-1">·</span>
        <span>{{ t("billing.trialStrip.expiredMessage", { org: orgName }) }}</span>
      </template>
      <template v-else>
        <span class="font-semibold" data-test="trial-period-status">{{
          t("billing.trialStrip.daysLeft", { count: daysLeft }, daysLeft)
        }}</span>
        <span class="mx-1">·</span>
        <span>{{ t("billing.trialStrip.endsOn", { date: endDate }) }}</span>
      </template>
      <template #actions>
        <OButton
          v-if="currentPage !== 'billing'"
          :variant="tone === 'warning' ? 'warning' : 'outline'"
          size="xs"
          data-test="trial-period-compare-plans-btn"
          @click="redirectBilling"
          >{{ t("billing.trialStrip.comparePlans") }}</OButton
        >
        <OButton
          v-else
          :variant="tone === 'warning' ? 'warning' : 'outline'"
          size="xs"
          data-test="trial-period-contact-support-btn"
          @click="redirectContactSupport"
          >{{ t("billing.trialStrip.contactSupport") }}</OButton
        >
      </template>
    </OBanner>
    <p
      v-if="currentPage === 'usage'"
      class="text-text-secondary m-0 text-xs"
      data-test="trial-period-end-rule"
    >
      {{ t("billing.trialStrip.endRule") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import config from "@/aws-exports";
import { siteURL } from "@/constants/config";
import BillingService from "@/services/billings";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = 3;

const props = defineProps<{
  currentPage?: "billing" | "usage";
  provider?: string;
}>();

const { t, locale } = useI18nTyped();
const store = useStore();
const router = useRouter();

const expiryMicros = computed<number | undefined>(() => {
  const expiry = store.state.organizationData?.organizationSettings?.free_trial_expiry;
  if (expiry === undefined || expiry === null || expiry === "") return undefined;
  return Number(expiry);
});

const fetchedProvider = ref<string | undefined>(undefined);
const provider = computed(() => props.provider ?? fetchedProvider.value);
const visible = computed(() => expiryMicros.value !== undefined && provider.value !== "aws");

// Advanced by the boundary timer below, so the day count and the ended text change without a remount.
const now = ref(Date.now());
const remainingMs = computed(() =>
  expiryMicros.value === undefined ? 0 : expiryMicros.value / 1000 - now.value,
);
const daysLeft = computed(() => Math.max(0, Math.floor(remainingMs.value / DAY_MS)));
// Ended only once the expiry has passed; the paywall keeps its own BASE boundary (isTrialExpired).
const expired = computed(() => remainingMs.value <= 0);
const tone = computed(() => (expired.value || daysLeft.value <= WARNING_DAYS ? "warning" : "info"));
const endDate = computed(() =>
  expiryMicros.value === undefined
    ? ""
    : new Date(expiryMicros.value / 1000).toLocaleDateString(locale.value, {
        month: "short",
        day: "numeric",
      }),
);
const orgName = computed(
  () =>
    store.state.selectedOrganization?.label || store.state.selectedOrganization?.identifier || "",
);

let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleNextBoundary = () => {
  clearTimeout(boundaryTimer);
  boundaryTimer = undefined;
  if (expiryMicros.value === undefined) return;
  const remainingMs = expiryMicros.value / 1000 - Date.now();
  if (remainingMs <= 0) return;
  boundaryTimer = setTimeout(
    () => {
      now.value = Date.now();
      scheduleNextBoundary();
    },
    (remainingMs % DAY_MS) + 1,
  );
};
watch(expiryMicros, scheduleNextBoundary, { immediate: true });
onUnmounted(() => clearTimeout(boundaryTimer));

onMounted(async () => {
  if (props.provider !== undefined || config.isCloud !== "true") return;
  try {
    const res = await BillingService.list_subscription(store.state.selectedOrganization.identifier);
    fetchedProvider.value = res.data?.provider ?? "";
  } catch (e: unknown) {
    // A 401 is already handled globally (http.ts logs out), so only real failures are logged.
    if ((e as { response?: { status?: number } })?.response?.status !== 401) {
      console.error("Failed to fetch billing info:", e);
    }
  }
});

const redirectBilling = () => {
  router.push({
    name: "plans",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
};

const redirectContactSupport = () => {
  window.open(siteURL.contactSupport, "_blank");
};
</script>
