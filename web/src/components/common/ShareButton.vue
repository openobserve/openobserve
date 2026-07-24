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
  <OButton
    :data-test="dataTest"
    :class="buttonClass"
    :variant="variant"
    :size="size"
    :loading="isLoading"
    :disabled="disabled || !url || isWebUrlNotConfigured"
    @click="handleShareClick"
    icon-left="share"
  >
    <span v-if="showLabel" class="ml-1">{{ t("search.shareLink") }}</span>
    <OTooltip v-if="isWebUrlNotConfigured">
      <template #content
        ><OIcon name="warning" size="sm" class="mr-1" />{{
          t("search.webUrlNotConfigured")
        }}</template
      >
    </OTooltip>
    <OTooltip
      v-else-if="tooltip || !showLabel"
      :content="tooltip || t('search.shareLink')"
      :shortcut="shortcut || undefined"
      :shortcut-id="shortcutId || undefined"
    />
  </OButton>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeUnmount, computed, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonVariant, ButtonSize } from "@/lib/core/Button/OButton.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import shortURLService from "@/services/short_url";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "ShareButton",
  components: { OButton, OIcon, OTooltip },
  props: {
    // The long URL to be copied and shortened
    url: {
      type: String,
      required: true,
    },
    // Custom CSS classes for the button (legacy — for non-dashboard callers)
    buttonClass: {
      type: String,
      default: "",
    },
    // OButton variant
    variant: {
      type: String as PropType<ButtonVariant>,
      default: "outline",
    },
    // OButton size
    size: {
      type: String as PropType<ButtonSize>,
      default: "icon-xs",
    },
    // Show "Share" label text next to icon
    showLabel: {
      type: Boolean,
      default: false,
    },
    // Custom tooltip text
    tooltip: {
      type: String,
      default: "",
    },
    // Optional keyboard-shortcut hint shown in the tooltip (raw key, e.g. "ctrl+shift+c")
    shortcut: {
      type: String,
      default: "",
    },
    // Registry shortcut id — resolves the hint key from shortcutRegistry.ts so a
    // key change there updates this tooltip too. Prefer this over `shortcut`.
    shortcutId: {
      type: String,
      default: "",
    },
    // Disable the button
    disabled: {
      type: Boolean,
      default: false,
    },
    // Data test attribute for testing
    dataTest: {
      type: String,
      default: "share-link-btn",
    },
  },
  emits: ["copy:success", "copy:error", "shorten:success", "shorten:error"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const isLoading = ref(false);
    let pollIntervalId: number | null = null;
    let isPolling = false; // Flag to prevent multiple polling instances

    // Detect if browser is Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    // Check if web_url is configured
    const isWebUrlNotConfigured = computed(() => {
      const webUrl = store.state.zoConfig?.web_url || "";
      return !webUrl || webUrl.trim() === "";
    });

    /**
     * Polling mechanism to check store for short URL without blocking main thread
     * Runs in a separate execution context via setInterval
     * Includes safeguards against infinite loops and race conditions
     */
    const startPollingForShortURL = () => {
      const MAX_ATTEMPTS = 30; // Max 30 attempts (15 seconds with 500ms interval)
      const POLL_INTERVAL = 500; // Check every 500ms
      let attempts = 0;

      // Prevent multiple polling instances
      if (isPolling) {
        console.warn("Polling already in progress, skipping");
        return;
      }

      // Clear any existing polling interval (safety check)
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }

      isPolling = true;

      // Start polling in a separate execution context (non-blocking)
      pollIntervalId = window.setInterval(() => {
        attempts++;

        // Check if short URL is available in store
        const shortURL = store.state.pendingShortURL;

        if (shortURL) {
          // CRITICAL: Stop polling IMMEDIATELY before async operations
          if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
          }
          isPolling = false;

          // Short URL is ready! Copy it to clipboard
          copyToClipboard(shortURL, {
            successMessage: t("search.linkCopiedSuccessfully"),
            errorMessage: t("search.errorCopyingLink"),
            timeout: 5000,
          })
            .then((success: boolean) => {
              if (success) {
                emit("copy:success", { url: shortURL, type: "short" });
              } else {
                console.error("Failed to copy short URL:", shortURL);
                emit("copy:error", { error: new Error("Copy failed"), type: "short" });
              }
            })
            .finally(() => {
              // Clean up: clear store
              store.commit("clearPendingShortURL");
              isLoading.value = false;
            });
        } else if (attempts >= MAX_ATTEMPTS) {
          // Timeout: Stop polling after max attempts
          console.warn("Polling timeout: Short URL not received within time limit");
          if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
          }
          isPolling = false;
          isLoading.value = false;
          store.commit("clearPendingShortURL");

          // Show timeout notification
          toast({
            variant: "warning",
            message: t("search.errorShorteningLink"),
            timeout: 5000,
          });
        }
      }, POLL_INTERVAL);
    };

    /**
     * Handler for share button click
     * Safari: Uses polling mechanism to maintain user gesture context
     * Chrome/Firefox: Copies directly in API response
     */
    const handleShareClick = () => {
      if (!props.url) {
        toast({
          variant: "warning",
          message: "No URL to share",
        });
        return;
      }

      // Start loading and fetch short URL
      isLoading.value = true;

      // Safari: Start polling for short URL (non-blocking)
      if (isSafari) {
        startPollingForShortURL();
      }

      // Fetch short URL via API
      shortURLService
        .create(store.state.selectedOrganization.identifier, props.url)
        .then((res: any) => {
          if (res.status === 200) {
            const shortUrl = res.data.short_url;

            if (isSafari) {
              // Safari: Store the short URL - polling will pick it up and copy
              store.commit("setPendingShortURL", shortUrl);
            } else {
              // Chrome/Firefox: Copy directly here
              copyToClipboard(shortUrl, {
                successMessage: t("search.linkCopiedSuccessfully"),
                errorMessage: t("search.errorCopyingLink"),
                timeout: 5000,
              })
                .then((success: boolean) => {
                  if (success) {
                    emit("copy:success", { url: shortUrl, type: "short" });
                  } else {
                    console.error("Failed to copy short URL:", shortUrl);
                    emit("copy:error", { error: new Error("Copy failed"), type: "short" });
                  }
                })
                .finally(() => {
                  isLoading.value = false;
                });
            }

            emit("shorten:success", {
              longUrl: props.url,
              shortUrl: shortUrl,
            });
          } else {
            // Failed to get short URL
            if (isSafari && pollIntervalId) {
              clearInterval(pollIntervalId);
              pollIntervalId = null;
              isPolling = false;
            }
            isLoading.value = false;
            toast({
              variant: "error",
              message: t("search.errorShorteningLink"),
              timeout: 5000,
            });
            emit("shorten:error", { error: "Invalid response status" });
          }
        })
        .catch((error: any) => {
          console.error("Error creating short URL:", error);
          // Failed to get short URL
          if (isSafari && pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
            isPolling = false;
          }
          isLoading.value = false;
          toast({
            variant: "error",
            message: t("search.errorShorteningLink"),
            timeout: 5000,
          });
          emit("shorten:error", { error });
        });
    };

    // Clean up polling interval when component is unmounted
    onBeforeUnmount(() => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      // Clear pending short URL from store
      store.commit("clearPendingShortURL");
    });

    return {
      t,
      isLoading,
      isWebUrlNotConfigured,
      handleShareClick,
    };
  },
});
</script>
