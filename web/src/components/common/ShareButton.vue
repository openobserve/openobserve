<!-- Copyright 2023 OpenObserve Inc.

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
  <q-btn
    :data-test="dataTest"
    :class="buttonClass"
    :size="buttonSize"
    :loading="isLoading"
    :disable="disabled || !url"
    icon="share"
    @click="handleShareClick"
  >
    <span v-if="showLabel" class="q-ml-xs">{{ t("search.shareLink") }}</span>
    <q-tooltip v-if="tooltip || !showLabel">
      {{ tooltip || t("search.shareLink") }}
    </q-tooltip>
  </q-btn>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar, copyToClipboard } from "quasar";
import shortURLService from "@/services/short_url";

export default defineComponent({
  name: "ShareButton",
  props: {
    // The long URL to be copied and shortened
    url: {
      type: String,
      required: true,
    },
    // Custom CSS classes for the button
    buttonClass: {
      type: String,
      default: "q-mr-xs download-logs-btn q-px-sm element-box-shadow el-border",
    },
    // Button size (Quasar sizes: xs, sm, md, lg, xl)
    buttonSize: {
      type: String,
      default: "xs",
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
    const $q = useQuasar();

    const isLoading = ref(false);
    let pollIntervalId: number | null = null;

    /**
     * Polling mechanism to check store for short URL without blocking main thread
     * Runs in a separate execution context via setInterval
     * Includes safeguards against infinite loops
     */
    const startPollingForShortURL = () => {
      const MAX_ATTEMPTS = 30; // Max 30 attempts (15 seconds with 500ms interval)
      const POLL_INTERVAL = 500; // Check every 500ms
      let attempts = 0;

      // Clear any existing polling interval
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }

      // Start polling in a separate execution context (non-blocking)
      pollIntervalId = window.setInterval(() => {
        attempts++;

        // Check if short URL is available in store
        const shortURL = store.state.pendingShortURL;

        if (shortURL) {
          // Short URL is ready! Copy it to clipboard
          copyToClipboard(shortURL)
            .then(() => {
              $q.notify({
                type: "positive",
                message: t("search.linkCopiedSuccessfully"),
                timeout: 5000,
              });
              emit("copy:success", { url: shortURL, type: "short" });
            })
            .catch((error) => {
              console.error("Failed to copy short URL:", error);
              $q.notify({
                type: "negative",
                message: t("search.errorCopyingLink"),
                timeout: 5000,
              });
              emit("copy:error", { error, type: "short" });
            })
            .finally(() => {
              // Clean up: clear store and stop polling
              store.commit("clearPendingShortURL");
              if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
              }
              isLoading.value = false;
            });
        } else if (attempts >= MAX_ATTEMPTS) {
          // Timeout: Stop polling after max attempts
          console.warn(
            "Polling timeout: Short URL not received within time limit"
          );
          if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
          }
          isLoading.value = false;
          store.commit("clearPendingShortURL");
          // Don't show error - user already has long URL copied
        }
      }, POLL_INTERVAL);
    };

    /**
     * Non-async handler for share button click
     * Copies long URL immediately (synchronous), then fetches short URL
     * This ensures Safari compatibility by maintaining user gesture context
     */
    const handleShareClick = () => {
      if (!props.url) {
        $q.notify({
          type: "warning",
          message: "No URL to share",
          timeout: 3000,
        });
        return;
      }

      // STEP 1: Copy long URL immediately (SYNCHRONOUS - works in Safari)
      copyToClipboard(props.url)
        .then(() => {
          $q.notify({
            type: "positive",
            message: t("search.linkCopiedSuccessfully"),
            timeout: 5000,
          });
          emit("copy:success", { url: props.url, type: "long" });

          // STEP 2: Start loading and fetch short URL
          isLoading.value = true;

          // STEP 3: Start polling for short URL (non-blocking)
          startPollingForShortURL();

          // STEP 4: Fetch short URL via API (non-async in this function)
          shortURLService
            .create(store.state.selectedOrganization.identifier, props.url)
            .then((res: any) => {
              if (res.status == 200) {
                // Store the short URL - polling will pick it up
                store.commit("setPendingShortURL", res.data.short_url);
                emit("shorten:success", {
                  longUrl: props.url,
                  shortUrl: res.data.short_url,
                });
              } else {
                // Failed to get short URL, stop polling
                if (pollIntervalId) {
                  clearInterval(pollIntervalId);
                  pollIntervalId = null;
                }
                isLoading.value = false;
                emit("shorten:error", { error: "Invalid response status" });
              }
            })
            .catch((error: any) => {
              console.error("Error creating short URL:", error);
              // Failed to get short URL, stop polling
              if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
              }
              isLoading.value = false;
              $q.notify({
                type: "negative",
                message: t("search.errorShorteningLink"),
                timeout: 5000,
              });
              emit("shorten:error", { error });
            });
        })
        .catch((error: any) => {
          console.error("Failed to copy long URL:", error);
          $q.notify({
            type: "negative",
            message: t("search.errorCopyingLink"),
            timeout: 5000,
          });
          emit("copy:error", { error, type: "long" });
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
      handleShareClick,
    };
  },
});
</script>

<style scoped>
/* Add any custom styles here if needed */
</style>
