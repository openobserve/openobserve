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

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import organizationService from "@/services/organizations";
import segment from "@/services/segment_analytics";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

// ── "Connect your first data source" prompt (self-contained) ───────────────
// Shown at the same trigger moment the Slack invite used to use (first login,
// after GetStarted finishes), then re-shown once per session until the
// account has ingested data. Cloud-only — never shown on self-hosted
// Enterprise or open source. All trigger/persistence state lives here so the
// host layout stays clean.
const isOpen = ref(false);

// sessionStorage (not localStorage): clears on tab close, which is exactly
// the "new session" boundary the spec wants — re-show every session until
// data exists, unlike the Slack popup's one-time-ever persistence.
const sessionShownKey = `connectDataSourcePromptShown:${store.state.userInfo?.email ?? "anonymous"}`;
// Survives a reload mid-onboarding, before GetStarted dispatches its
// completion event.
const PENDING_KEY = "connectDataSourcePromptPending";

let stopOrgWatch: (() => void) | null = null;

const track = (event: string, properties: Record<string, any> = {}) => {
  try {
    segment.track(event, {
      org_id: store.state.selectedOrganization?.identifier,
      ...properties,
    });
  } catch {
    // Telemetry must never break the page.
  }
};

const checkAndMaybeShow = async () => {
  if (config.isCloud !== "true") return;
  if (sessionStorage.getItem(sessionShownKey) === "true") return;

  const orgIdentifier = store.state.selectedOrganization?.identifier;
  if (!orgIdentifier) {
    // Fresh session — the default org is still resolving asynchronously.
    // Wait for it once instead of silently skipping this session.
    if (!stopOrgWatch) {
      stopOrgWatch = watch(
        () => store.state.selectedOrganization?.identifier,
        (id) => {
          if (id) checkAndMaybeShow();
        },
        { once: true },
      );
    }
    return;
  }

  try {
    // The shared isDataIngested store flag is only set behind an opt-in
    // deployment config and isn't reliably populated this early, so check
    // directly rather than trust it.
    const response = await organizationService.get_organization_summary(orgIdentifier);
    const hasData = !!response.data?.streams?.num_streams;
    if (hasData) {
      store.dispatch("setIsDataIngested", true);
      return;
    }
  } catch (error) {
    // Fail closed — this is a marketing prompt, not a navigation gate.
    console.warn("ConnectDataSourcePopup: failed to check organization summary:", error);
    return;
  }

  isOpen.value = true;
  sessionStorage.setItem(sessionShownKey, "true");
  localStorage.removeItem(PENDING_KEY);
  track("onboarding_prompt_shown");
};

// GetStarted (full-screen onboarding) dispatches this when it completes; for
// brand-new users we wait for it so two dialogs never stack.
const onOnboardingComplete = () => checkAndMaybeShow();

onMounted(() => {
  // Cloud-only: bail out entirely on Enterprise / open source so nothing is
  // captured, listened for, or shown there.
  if (config.isCloud !== "true") return;

  // `isFirstTimeLogin` is set on the new_user_login callback (Cloud only).
  const isFirstLogin = localStorage.getItem("isFirstTimeLogin") === "true";

  if (isFirstLogin) {
    localStorage.setItem(PENDING_KEY, "true");
    // GetStarted is taking over the screen — show the prompt once it finishes.
    window.addEventListener("o2:onboarding-complete", onOnboardingComplete);
  } else {
    // Returning session — a fresh opportunity to show, gated on session +
    // ingested-data checks above.
    checkAndMaybeShow();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("o2:onboarding-complete", onOnboardingComplete);
  stopOrgWatch?.();
});

const connectDataSource = () => {
  track("onboarding_prompt_connect_clicked");
  isOpen.value = false;
  router.push({
    name: "ingestion",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
};

const dismiss = () => {
  track("onboarding_prompt_dismissed");
  isOpen.value = false;
};

const handleOpenChange = (open: boolean) => {
  if (!open) dismiss();
};
</script>

<template>
  <ODialog
    data-test="connect-data-source-popup-dialog"
    :open="isOpen"
    size="sm"
    :show-close="false"
    @update:open="handleOpenChange"
  >
    <div class="flex flex-col gap-4 p-2">
      <div class="flex items-start gap-3">
        <div
          class="rounded-default bg-icon-chip-primary-bg flex h-12 w-12 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <OIcon name="database" size="md" class="text-icon-chip-primary-text" />
        </div>

        <h2 data-test="connect-data-source-popup-title" class="flex-1 self-center">
          {{ t("connectDataSourcePopup.title") }}
        </h2>
      </div>

      <p data-test="connect-data-source-popup-description" class="text-text-secondary">
        {{ t("connectDataSourcePopup.description") }}
      </p>

      <div class="flex flex-col items-center gap-3 pt-1">
        <OButton
          data-test="connect-data-source-popup-connect-btn"
          variant="primary"
          class="w-full"
          @click="connectDataSource"
        >
          {{ t("connectDataSourcePopup.connectButton") }}
        </OButton>
        <button
          type="button"
          data-test="connect-data-source-popup-dismiss-link"
          class="text-text-secondary hover:text-text-heading rounded-default cursor-pointer border-0 bg-transparent p-0 text-sm hover:underline"
          @click="dismiss"
        >
          {{ t("connectDataSourcePopup.dismissLink") }}
        </button>
      </div>
    </div>
  </ODialog>
</template>
