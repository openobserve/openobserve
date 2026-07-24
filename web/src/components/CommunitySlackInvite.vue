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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { addCommasToNumber } from "@/utils/zincutils";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import SlackIcon from "@/components/icons/SlackIcon.vue";

const { t } = useI18n();
const store = useStore();

// ── One-time first-login invite (self-contained) ───────────────────────────
// Shown once on a Cloud user's first login, then never again for that user.
// Cloud-only — never shown on self-hosted Enterprise or open source.
// All trigger/persistence state lives here so the host layout stays clean.
const isOpen = ref(false);

// Per-user "seen" record + a pending flag that survives reloads until the user
// actually dismisses the invite (so it still appears if they leave mid-onboarding).
const seenKey = `communitySlackInviteSeen:${
  store.state.userInfo?.email ?? "anonymous"
}`;
const PENDING_KEY = "communitySlackInvitePending";

// Community Slack URL — enterprise can override it via backend config.
const slackUrl = computed(() => {
  if (config.isEnterprise == "true" && store.state.zoConfig?.custom_slack_url) {
    return store.state.zoConfig.custom_slack_url;
  }
  return "https://short.openobserve.ai/community";
});

const maybeShow = () => {
  if (
    localStorage.getItem(PENDING_KEY) === "true" &&
    localStorage.getItem(seenKey) !== "true"
  ) {
    isOpen.value = true;
  }
};

// GetStarted (full-screen onboarding) dispatches this when it completes; for
// brand-new users we wait for it so two dialogs never stack.
const onOnboardingComplete = () => maybeShow();

onMounted(() => {
  // Cloud-only: bail out entirely on Enterprise / open source so nothing is
  // captured, listened for, or shown there.
  if (config.isCloud !== "true") return;

  // `isFirstTimeLogin` is set on the new_user_login callback (Cloud only).
  // Capture it into a pending flag before GetStarted clears it.
  const isFirstLogin = localStorage.getItem("isFirstTimeLogin") === "true";

  if (isFirstLogin && localStorage.getItem(seenKey) !== "true") {
    localStorage.setItem(PENDING_KEY, "true");
  }

  if (isFirstLogin) {
    // GetStarted is taking over the screen — show the invite once it finishes.
    window.addEventListener("o2:onboarding-complete", onOnboardingComplete);
  } else {
    // Returning session with the invite still pending — show it now.
    maybeShow();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("o2:onboarding-complete", onOnboardingComplete);
});

// Real member count, sourced from the backend `/config` response
// (`zoConfig.slack_member_count`). Null until the backend exposes it — there is
// no client-side way to read it from the Slack URL (CORS + no public API).
const memberCount = computed<number | null>(() => {
  const n = Number(store.state.zoConfig?.slack_member_count);
  return Number.isFinite(n) && n > 0 ? n : null;
});

// "4,200+ members" once a count is available; floored to the nearest 100 with a
// "+" so the figure stays honest (≥ floored) and doesn't flicker by ±1. Falls
// back to the qualitative caption when no count is published.
const captionText = computed(() => {
  const n = memberCount.value;
  if (n == null) return t("communitySlackInvite.communityNote");
  const floored = n >= 100 ? Math.floor(n / 100) * 100 : n;
  const value = `${addCommasToNumber(floored)}${n >= 100 ? "+" : ""}`;
  return t("communitySlackInvite.membersCount", { count: value });
});

const benefits = computed(() => [
  t("communitySlackInvite.benefit1"),
  t("communitySlackInvite.benefit2"),
  t("communitySlackInvite.benefit3"),
]);

// Background tints for the decorative silhouette-avatar stack (brand gradient,
// dark enough for a white person glyph). Full literal classes so Tailwind emits
// them. These are placeholders — not real members.
const avatarBgClasses = [
  "bg-avatar-tint-1",
  "bg-avatar-tint-2",
  "bg-avatar-tint-3",
  "bg-avatar-tint-4",
];

// Every dismissal path (× / overlay / Escape, Maybe later, or Join Slack)
// closes the dialog and marks it seen so it never shows again for this user.
const dismiss = () => {
  isOpen.value = false;
  localStorage.setItem(seenKey, "true");
  localStorage.removeItem(PENDING_KEY);
};

const handleOpenChange = (open: boolean) => {
  if (!open) dismiss();
};

const joinSlack = () => {
  window.open(slackUrl.value, "_blank", "noopener");
  dismiss();
};
</script>

<template>
  <ODialog
    data-test="community-slack-invite-dialog"
    :open="isOpen"
    size="sm"
    :show-close="false"
    @update:open="handleOpenChange"
  >
    <div class="flex flex-col gap-4 p-2">
      <!-- Header: Slack badge, title to its right, close button on the far right -->
      <div class="flex items-start gap-3">
        <div
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-default bg-icon-chip-primary-bg"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 122.8 122.8"
            class="h-6 w-6"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
              fill="#e01e5a"
            />
            <path
              d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
              fill="#36c5f0"
            />
            <path
              d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
              fill="#2eb67d"
            />
            <path
              d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
              fill="#ecb22e"
            />
          </svg>
        </div>

        <h2
          data-test="community-slack-invite-title"
          class="flex-1 self-center"
        >
          {{ t("communitySlackInvite.title") }}
        </h2>

        <OButton
          variant="ghost"
          size="icon-sm"
          class="-mr-1 shrink-0"
          :aria-label="t('common.close')"
          data-test="community-slack-invite-close-btn"
          @click="dismiss"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>

      <p
        data-test="community-slack-invite-description"
        class="text-text-secondary"
      >
        {{ t("communitySlackInvite.description") }}
      </p>

      <!-- Benefits -->
      <ul class="flex flex-col gap-2.5">
        <li
          v-for="(benefit, index) in benefits"
          :key="index"
          :data-test="`community-slack-invite-benefit-${index}`"
          class="flex items-start gap-2.5"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="mt-0.5 h-4 w-4 shrink-0 text-accent"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span class="text-text-secondary">{{
            benefit
          }}</span>
        </li>
      </ul>

      <!-- Social proof — generic avatar stack, no fabricated counts -->
      <div
        data-test="community-slack-invite-members"
        class="flex items-center gap-3 rounded-default bg-surface-panel px-3 py-2.5"
      >
        <div class="flex items-center" aria-hidden="true">
          <span
            v-for="(bg, i) in avatarBgClasses"
            :key="i"
            :class="[
              'flex h-7 w-7 items-center justify-center rounded-full text-text-inverse ring-2 ring-surface-panel',
              bg,
              i > 0 ? '-ml-2' : '',
            ]"
          >
            <OIcon name="person" size="sm" />
          </span>
        </div>
        <small data-test="community-slack-invite-members-text">{{
          captionText
        }}</small>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-3 pt-1">
        <OButton
          data-test="community-slack-invite-join-btn"
          variant="primary"
          class="flex-1"
          @click="joinSlack"
        >
          <template #icon-left>
            <SlackIcon class="h-5 w-5" />
          </template>
          {{ t("communitySlackInvite.joinSlack") }}
        </OButton>
        <OButton
          data-test="community-slack-invite-maybe-later-btn"
          variant="outline"
          @click="dismiss"
        >
          {{ t("communitySlackInvite.maybeLater") }}
        </OButton>
      </div>
    </div>
  </ODialog>
</template>
