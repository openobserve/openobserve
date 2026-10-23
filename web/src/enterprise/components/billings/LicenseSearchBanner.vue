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
  <OBanner v-if="visible" bar :variant="variant" :icon="icon" data-test="license-search-banner">
    <div>
      <div v-if="isPaused || !outcome || outcome.variant !== 'success'">{{ message }}</div>
      <div v-if="outcome" data-test="license-banner-outcome" aria-live="polite">
        {{ outcome.text }}
      </div>
      <div v-if="outcome?.hint" class="mt-1 text-xs">{{ outcome.hint }}</div>
    </div>

    <template #actions>
      <div class="flex flex-wrap items-center gap-3">
        <OButton
          v-if="isPaused && licenseId"
          variant="banner-dismiss"
          size="sm"
          data-test="license-banner-copy"
          @click="copyLicenseId"
        >
          {{ t("about.copyLicenseId") }}
        </OButton>
        <OButton
          v-if="isPaused && canUpdateLicense"
          variant="banner-dismiss"
          size="sm"
          data-test="license-banner-refresh"
          :loading="refreshing"
          @click="refreshNow"
        >
          {{ t("about.refresh_now") }}
        </OButton>
        <OButton
          v-if="!isPaused || outcome?.variant === 'success'"
          variant="banner-dismiss"
          size="sm"
          data-test="license-banner-details"
          @click="openDetails"
        >
          {{ t("about.banner_details") }}
        </OButton>
        <OButton
          variant="banner-dismiss"
          size="sm"
          data-test="license-banner-dismiss"
          @click="dismiss"
        >
          {{ t("about.banner_dismiss") }}
        </OButton>
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
import { refreshMessage } from "@/utils/licenseRefresh";
import type { RefreshResult } from "@/ts/interfaces/licenseRefresh";
import { copyToClipboard } from "@/utils/clipboard";
import {
  activeSearchUnblock,
  DAY_US,
  bannerSignature,
  boundaryDelayMs,
  formatUtc,
  LICENSE_BANNER_POLL_MS,
  licenseBannerState,
  type LicenseBannerState,
  type LicenseWaiverFields,
} from "@/utils/licenseWaivers";

const DISMISS_KEY = "license_search_banner_dismissed";

const { t, locale } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { refreshLicenseLimits, reloadLicenseState } = useLicenseRefresh();
const { isMetaOrg } = useIsMetaOrg();
const refreshing = ref(false);
const refreshResult = ref<RefreshResult>();
const outcome = computed(() =>
  refreshResult.value
    ? refreshMessage(refreshResult.value.body, t, refreshResult.value.status)
    : null,
);
const refreshNow = async () => {
  if (refreshing.value || !canUpdateLicense.value || !isMetaOrg.value) return;
  refreshing.value = true;
  try {
    refreshResult.value = await refreshLicenseLimits();
  } finally {
    refreshing.value = false;
  }
};

const readDismissed = (): string | null => {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
};

const dismissedSignature = ref<string | null>(readDismissed());

const nowUs = ref(Date.now() * 1000);
// Self-hosted licences are managed from the meta org, so other orgs never fetch or poll for this.
const state = computed<LicenseBannerState>(() =>
  isMetaOrg.value ? licenseBannerState(store.state.zoConfig ?? {}, nowUs.value) : { kind: "none" },
);
const isPaused = computed(() => state.value.kind === "paused");
const visible = computed(
  () =>
    isMetaOrg.value &&
    (state.value.kind !== "none" || !!refreshResult.value) &&
    dismissedSignature.value !== bannerSignature(state.value),
);

const license = useQuery(() => ({
  ...licenseQuery(),
  enabled: state.value.kind !== "none",
}));
const licenseData = computed(
  () =>
    license.data.value as
      (LicenseWaiverFields & { license?: { license_id?: string } | null }) | undefined,
);
const licenseId = computed(() => licenseData.value?.license?.license_id ?? "");
const canUpdateLicense = computed(() => licenseData.value?.can_update_license === true);

const variant = computed(() => {
  if (state.value.kind === "paused") return "error";
  if (outcome.value) return outcome.value.variant;
  return state.value.kind === "restored" && state.value.endsSoon ? "warning" : "success";
});
const icon = computed(() => {
  if (state.value.kind === "paused") return "error";
  if (outcome.value)
    return outcome.value.variant === "success"
      ? "check-circle"
      : outcome.value.variant === "info"
        ? "info"
        : "warning";
  return state.value.kind === "restored" && state.value.endsSoon ? "schedule" : "check-circle";
});

const pausedMessage = computed(() => {
  const id = licenseId.value;
  if (!id) return t("about.banner_paused_no_id");
  const d = licenseData.value?.decision;
  if (d?.blocks?.includes("usage_over_limit")) {
    return t("about.banner_paused_usage", {
      exceeded: d.exceeded_days,
      allowed: d.allowed_days,
      licenseId: id,
    });
  }
  return t("about.banner_paused_other", { licenseId: id });
});

const restoredMessage = computed(() => {
  const s = state.value;
  if (s.kind !== "restored") return "";
  const until = formatUtc(s.untilUs, locale.value, true);
  if (s.endsSoon) return t("about.banner_ends_soon", { until });
  const note = activeSearchUnblock(licenseData.value?.waivers, nowUs.value)?.note;
  return note
    ? t("about.banner_restored_with_note", { until, note })
    : t("about.banner_restored", { until });
});

const message = computed(() => (isPaused.value ? pausedMessage.value : restoredMessage.value));

const dismiss = () => {
  refreshResult.value = undefined;
  const signature = bannerSignature(state.value);
  dismissedSignature.value = signature;
  try {
    sessionStorage.setItem(DISMISS_KEY, signature);
  } catch {
    // Storage is unavailable, so the dismissal lasts only until the page reloads.
  }
};

const copyLicenseId = () => copyToClipboard(licenseId.value, t);

const openDetails = () =>
  router.push({
    name: "license",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });

let pollTimer: ReturnType<typeof setInterval> | undefined;

const stopPolling = () => {
  if (pollTimer !== undefined) clearInterval(pollTimer);
  pollTimer = undefined;
};

watch(
  isPaused,
  (paused) => {
    stopPolling();
    if (paused) pollTimer = setInterval(reloadLicenseState, LICENSE_BANNER_POLL_MS);
  },
  { immediate: true },
);

let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

const clearBoundaryTimer = () => {
  if (boundaryTimer !== undefined) clearTimeout(boundaryTimer);
  boundaryTimer = undefined;
};

const waiverUntilUs = (): number | null => {
  if (!isMetaOrg.value) return null;
  const zo = store.state.zoConfig;
  const until = zo?.license_waiver_until;
  return zo?.license_search_allowed === true && typeof until === "number" ? until : null;
};

const armBoundaryTimer = () => {
  clearBoundaryTimer();
  nowUs.value = Date.now() * 1000;
  const until = waiverUntilUs();
  if (until === null) return;
  const next = [until - DAY_US, until].find((b) => b > nowUs.value);
  if (next === undefined) return;
  boundaryTimer = setTimeout(onBoundary, boundaryDelayMs(next, nowUs.value));
};

function onBoundary() {
  const until = waiverUntilUs();
  const expired = until !== null && until <= Date.now() * 1000;
  armBoundaryTimer();
  if (expired) reloadLicenseState();
}

watch([() => store.state.zoConfig, isMetaOrg], armBoundaryTimer, { immediate: true });

// The layout serves each org's /config from a session cache, so its licence fields can be stale.
watch(
  () => store.state.selectedOrganization?.identifier,
  (org, prev) => {
    if (prev && org !== prev) {
      refreshResult.value = undefined;
      if (isMetaOrg.value) reloadLicenseState();
    }
  },
);

onBeforeUnmount(() => {
  stopPolling();
  clearBoundaryTimer();
});
</script>
