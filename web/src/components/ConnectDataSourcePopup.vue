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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import organizationService from "@/services/organizations";
import segment from "@/services/segment_analytics";
import {
  connectDataPopupSettled,
  connectDataPromptSessionKey,
  getCommunitySlackUrl,
  markSlackInviteOffered,
  markSlackInviteResolved,
  shouldOfferSlackInvite,
} from "@/utils/slackCommunityInvite";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import SlackIcon from "@/components/icons/SlackIcon.vue";

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

const userEmail = store.state.userInfo?.email ?? "anonymous";

// sessionStorage (not localStorage): clears on tab close, which is exactly
// the "new session" boundary the spec wants — re-show every session until
// data exists, unlike the Slack popup's one-time-ever persistence.
const sessionShownKey = connectDataPromptSessionKey(userEmail);
// Survives a reload mid-onboarding, before GetStarted dispatches its
// completion event.
const PENDING_KEY = "connectDataSourcePromptPending";

// Rides along on this popup; CommunitySlackInvite.vue owns the day-2 follow-up if unclicked.
const showSlackInviteButton = ref(false);
const slackUrl = computed(() => getCommunitySlackUrl(store.state.zoConfig?.custom_slack_url));

let stopOrgWatch: (() => void) | null = null;

const track = (event: string, properties: Record<string, any> = {}) => {
  try {
    // RudderStack is never identify()'d in this app; org_id alone is enough to correlate events.
    segment.track(event, {
      org_id: store.state.selectedOrganization?.identifier,
      ...properties,
    });
  } catch {
    // Telemetry must never break the page.
  }
};

const checkAndMaybeShow = async () => {
  // Held false until this session's open/no-open decision is final — CommunitySlackInvite
  // waits on this so the two popups never end up open at the same time.
  connectDataPopupSettled.value = false;

  if (config.isCloud !== "true") {
    connectDataPopupSettled.value = true;
    return;
  }
  if (sessionStorage.getItem(sessionShownKey) === "true") {
    connectDataPopupSettled.value = true;
    return;
  }
  // Already known true elsewhere (MainLayout, useStreams, ...) — skip the summary call.
  if (store.state.organizationData.isDataIngested) {
    // This popup won't open, so this is the account's day-1 touchpoint — starts the Slack day-2 clock silently.
    markSlackInviteOffered(userEmail);
    connectDataPopupSettled.value = true;
    return;
  }

  const orgIdentifier = store.state.selectedOrganization?.identifier;
  if (!orgIdentifier) {
    // Fresh session — the default org is still resolving asynchronously.
    // Wait for it once instead of silently skipping this session. Stays
    // unsettled until the watcher re-invokes this.
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
      // Don't also claim the session key here — CommunitySlackInvite reads it to know this popup already had its say this session.
      store.dispatch("setIsDataIngested", true);
      markSlackInviteOffered(userEmail);
      return;
    }
  } catch (error) {
    // Fail closed — this is a marketing prompt, not a navigation gate.
    console.warn("ConnectDataSourcePopup: failed to check organization summary:", error);
    return;
  } finally {
    connectDataPopupSettled.value = true;
  }

  // Read before marking, so the button renders on the same open that starts the clock.
  showSlackInviteButton.value = shouldOfferSlackInvite(userEmail);
  markSlackInviteOffered(userEmail);

  isOpen.value = true;
  sessionStorage.setItem(sessionShownKey, "true");
  localStorage.removeItem(PENDING_KEY);
  track("onboarding_prompt_shown");
  if (showSlackInviteButton.value) {
    track("community_slack_prompt_shown", { source: "connect_data_popup" });
  }
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

// Doesn't close this popup — connecting data stays the primary ask even if the user also joins Slack.
const joinSlackFromPopup = () => {
  window.open(slackUrl.value, "_blank", "noopener");
  markSlackInviteResolved(userEmail);
  showSlackInviteButton.value = false;
  track("community_slack_prompt_joined", { source: "connect_data_popup" });
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

      <OButton
        data-test="connect-data-source-popup-connect-btn"
        variant="primary"
        class="w-full"
        @click="connectDataSource"
      >
        {{ t("connectDataSourcePopup.connectButton") }}
      </OButton>

      <OButton
        v-if="showSlackInviteButton"
        data-test="connect-data-source-popup-slack-link"
        variant="ghost-subtle"
        size="sm"
        class="self-center"
        @click="joinSlackFromPopup"
      >
        <template #icon-left>
          <SlackIcon class="h-3.5 w-3.5" />
        </template>
        {{ t("connectDataSourcePopup.slackLink") }}
      </OButton>
    </div>
  </ODialog>
</template>
