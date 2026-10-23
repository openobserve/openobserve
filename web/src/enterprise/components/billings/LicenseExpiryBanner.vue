<template>
  <OBanner v-if="visible" bar variant="warning" icon="schedule" data-test="license-expiry-banner">
    <div>
      <div>{{ message }}</div>
      <div v-if="outcome" data-test="license-expiry-outcome" aria-live="polite">
        {{ outcome.text }}
      </div>
      <div v-if="outcome?.hint" class="mt-1 text-xs">{{ outcome.hint }}</div>
    </div>
    <template #actions>
      <div class="flex flex-wrap items-center gap-3">
        <OButton
          v-if="expiry.kind === 'expiring' && expiry.online && canUpdate"
          variant="banner-dismiss"
          size="sm"
          :loading="refreshing"
          data-test="license-expiry-refresh"
          @click="refreshNow"
          >{{ t("about.refresh_now") }}</OButton
        >
        <OButton
          variant="banner-dismiss"
          size="sm"
          data-test="license-expiry-details"
          @click="openDetails"
          >{{ t("about.banner_details") }}</OButton
        >
        <OButton
          variant="banner-dismiss"
          size="sm"
          data-test="license-expiry-dismiss"
          @click="dismiss"
          >{{ t("about.banner_dismiss") }}</OButton
        >
      </div>
    </template>
  </OBanner>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { useLicenseRefresh } from "@/composables/useLicenseRefresh";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { licenseQuery } from "@/services/license_server.queries";
import { useI18nTyped } from "@/types/i18n";
import type { RefreshResult } from "@/ts/interfaces/licenseRefresh";
import { refreshMessage } from "@/utils/licenseRefresh";
import { boundaryDelayMs, DAY_US, issuedOn, licenseExpiryState } from "@/utils/licenseWaivers";

const DISMISS_KEY = "license_expiry_banner_dismissed";
const { t, locale } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { isMetaOrg } = useIsMetaOrg();
const { refreshLicenseLimits } = useLicenseRefresh();
const nowUs = ref(Date.now() * 1000);
const refreshing = ref(false);
const result = ref<RefreshResult>();
const withinWindow = computed(
  () =>
    isMetaOrg.value &&
    licenseExpiryState(store.state.zoConfig ?? {}, undefined, nowUs.value).kind === "expiring",
);
const license = useQuery(() => ({ ...licenseQuery(), enabled: withinWindow.value }));
const data = computed(
  () =>
    license.data.value as
      { license?: { environment_type?: string }; can_update_license?: boolean } | undefined,
);
const expiry = computed(() =>
  licenseExpiryState(
    isMetaOrg.value ? (store.state.zoConfig ?? {}) : {},
    data.value?.license?.environment_type,
    nowUs.value,
  ),
);
const canUpdate = computed(() => data.value?.can_update_license === true);
const signature = computed(() =>
  expiry.value.kind === "expiring" ? `${expiry.value.untilUs}:${expiry.value.online}` : "none",
);
const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
};
const dismissed = ref(readDismissed());
const outcome = computed(() =>
  result.value ? refreshMessage(result.value.body, t, result.value.status) : null,
);
const visible = computed(
  () =>
    isMetaOrg.value &&
    !!data.value &&
    expiry.value.kind === "expiring" &&
    dismissed.value !== signature.value,
);
const message = computed(() => {
  const state = expiry.value;
  if (state.kind !== "expiring") return "";
  const date = issuedOn(state.untilUs, locale.value);
  return !state.online
    ? t("about.expiry_airgapped", { date })
    : canUpdate.value
      ? t("about.expiry_online", { date })
      : t("about.expiry_viewer", { date });
});
const dismiss = () => {
  dismissed.value = signature.value;
  try {
    sessionStorage.setItem(DISMISS_KEY, signature.value);
  } catch {
    // Storage may be disabled, so this dismissal lasts only for the mounted view.
  }
};
const openDetails = () =>
  router.push({
    name: "license",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
const refreshNow = async () => {
  if (
    !canUpdate.value ||
    refreshing.value ||
    !isMetaOrg.value ||
    expiry.value.kind !== "expiring" ||
    !expiry.value.online
  )
    return;
  refreshing.value = true;
  try {
    result.value = await refreshLicenseLimits();
  } finally {
    refreshing.value = false;
  }
};
let timer: ReturnType<typeof setTimeout> | undefined;
const armBoundary = () => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  nowUs.value = Date.now() * 1000;
  const until = store.state.zoConfig?.license_expiry;
  if (!isMetaOrg.value || typeof until !== "number" || !Number.isFinite(until)) return;
  const next = [until - 30 * DAY_US, until].find((at) => at > nowUs.value);
  if (next !== undefined) timer = setTimeout(armBoundary, boundaryDelayMs(next, nowUs.value));
};
watch([() => store.state.zoConfig?.license_expiry, isMetaOrg], armBoundary, { immediate: true });
watch(
  () => store.state.selectedOrganization?.identifier,
  () => {
    result.value = undefined;
  },
);
onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer);
});
</script>
