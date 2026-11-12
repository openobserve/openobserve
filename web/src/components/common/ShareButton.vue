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
  <div v-if="hasMenu" class="inline-flex items-stretch">
    <OButton
      ref="buttonRef"
      :data-test="dataTest"
      :aria-label="t('search.shareLink')"
      :class="buttonClass"
      class="rounded-e-none!"
      :variant="variant"
      :size="size"
      :loading="isLoading"
      :disabled="disabled || !url || isWebUrlNotConfigured"
      :focusable-unavailable="isWebUrlNotConfigured || (disabled && !!tooltip)"
      @click="handleShareClick(kinds[0])"
      icon-left="share"
    >
      <template #unavailable-reason>{{
        isWebUrlNotConfigured ? t("search.webUrlNotConfigured") : tooltip
      }}</template>
      <span v-if="showLabel" class="ms-1">{{ t("search.shareLink") }}</span>
      <OTooltip
        v-if="!isWebUrlNotConfigured"
        :content="kindTitle(kinds[0])"
        :shortcut="shortcut || undefined"
        :shortcut-id="shortcutId || undefined"
      />
    </OButton>
    <ODropdown align="end">
      <template #trigger>
        <OButton
          :data-test="`${dataTest}-kinds`"
          :variant="variant"
          size="icon-xs-sq"
          class="h-auto! rounded-s-none! border-s-0!"
          icon-left="arrow-drop-down"
          :aria-label="t('dateTime.shareOptions')"
          :disabled="disabled || !url || isWebUrlNotConfigured"
        />
      </template>
      <ODropdownItem
        v-for="kind in menuKinds"
        :key="kind"
        :data-test="`share-button-copy-${kind}`"
        @select="handleShareClick(kind)"
      >
        <div class="flex min-w-0 flex-col">
          <span>{{ kindTitle(kind) }}</span>
          <span class="text-text-secondary text-xs tabular-nums">{{ kindHint(kind) }}</span>
        </div>
        <template #icon-right>
          <OIcon
            v-if="kind === kinds[0]"
            data-test="share-button-default-check"
            name="check"
            size="sm"
            class="text-text-secondary ms-auto shrink-0"
          />
        </template>
      </ODropdownItem>
      <template v-if="rangeContext">
        <ODropdownSeparator />
        <ODropdownItem
          data-test="share-button-copy-with-range"
          @select="handleShareClick(kinds[0], true)"
        >
          {{ t("dateTime.shareCopyWithRange") }}
        </ODropdownItem>
      </template>
    </ODropdown>
  </div>
  <OButton
    v-else
    ref="buttonRef"
    :data-test="dataTest"
    :aria-label="t('search.shareLink')"
    :class="buttonClass"
    :variant="variant"
    :size="size"
    :loading="isLoading"
    :disabled="disabled || !url || isWebUrlNotConfigured"
    :focusable-unavailable="isWebUrlNotConfigured || (disabled && !!tooltip)"
    @click="handleShareClick(kinds[0])"
    icon-left="share"
  >
    <template #unavailable-reason>{{
      isWebUrlNotConfigured ? t("search.webUrlNotConfigured") : tooltip
    }}</template>
    <span v-if="showLabel" class="ms-1">{{ t("search.shareLink") }}</span>
    <OTooltip v-if="isWebUrlNotConfigured">
      <template #content
        ><OIcon name="warning" size="sm" class="me-1" />{{
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
import { raw, type I18nText, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonVariant, ButtonSize } from "@/lib/core/Button/OButton.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import shortURLService from "@/services/short_url";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { linkWithRangeText, shareTimeKinds, type ShareTimeKind } from "@/utils/shareTimeRange";

export default defineComponent({
  name: "ShareButton",
  components: { OButton, OIcon, OTooltip, ODropdown, ODropdownItem, ODropdownSeparator },
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
      type: String as unknown as PropType<I18nText>,
      default: raw(""),
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
    /** The same link holding the range as a live period; empty when the range is fixed. */
    liveUrl: {
      type: String,
      default: "",
    },
    /** Which kind a plain click copies, and the menu lists first and checks. */
    defaultKind: {
      type: String as PropType<ShareTimeKind>,
      default: "fixed",
    },
    /** The resolved window a fixed link holds, with its zone; named in the menu and the toast. */
    fixedLabel: {
      type: String,
      default: "",
    },
    /** The live period's name, named in the menu and the toast. */
    liveLabel: {
      type: String,
      default: "",
    },
    /** The fixed window as the copied line names it, e.g. in UTC; empty uses `fixedLabel`. */
    fixedCopyLabel: {
      type: String,
      default: "",
    },
    /** `{page} · {stream or dashboard}`; when set the menu offers to copy the link with a line naming the range. */
    rangeContext: {
      type: String,
      default: "",
    },
  },
  emits: ["copy:success", "copy:error", "shorten:success", "shorten:error"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();

    const isLoading = ref(false);
    const kinds = computed(() => shareTimeKinds(props.defaultKind, !!props.liveUrl));
    const hasMenu = computed(() => kinds.value.length > 1 || !!props.rangeContext);
    // Fixed always reads second, so the menu order stays put whichever kind the page defaults to.
    const menuKinds = computed<ShareTimeKind[]>(() =>
      kinds.value.includes("live") ? ["live", "fixed"] : ["fixed"],
    );
    const kindTitle = (kind: ShareTimeKind) =>
      kind === "fixed" ? t("dateTime.shareCopyFixed") : t("dateTime.shareCopyLive");
    const kindHint = (kind: ShareTimeKind) =>
      kind === "fixed"
        ? props.fixedLabel
        : props.liveLabel
          ? t("dateTime.shareLiveHint", { name: props.liveLabel })
          : "";
    const kindRange = (kind: ShareTimeKind) =>
      kind === "fixed" ? props.fixedCopyLabel || props.fixedLabel : props.liveLabel;
    // The toast names the kind only when the caller said which window the link holds.
    const copiedMessage = (kind: ShareTimeKind) => {
      if (kind === "live" && props.liveLabel) {
        return t("dateTime.linkCopiedLive", { name: props.liveLabel });
      }
      if (kind === "fixed" && props.fixedLabel) {
        return t("dateTime.linkCopiedFixed", { range: props.fixedLabel });
      }
      return t("search.linkCopiedSuccessfully");
    };
    const clipboardText = (shortUrl: string, kind: ShareTimeKind, withRange: boolean) =>
      withRange
        ? linkWithRangeText({
            url: shortUrl,
            context: props.rangeContext,
            range: kindRange(kind),
            kind: kind === "fixed" ? t("dateTime.shareKindFixed") : t("dateTime.shareKindLive"),
          })
        : shortUrl;
    let copyingKind: ShareTimeKind = "fixed";
    let copyingWithRange = false;
    const buttonRef = ref<{ $el: HTMLElement } | null>(null);
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
          copyToClipboard(clipboardText(shortURL, copyingKind, copyingWithRange), t, {
            successMessage: copiedMessage(copyingKind),
            errorMessage: t("search.errorCopyingLink"),
            timeout: 5000,
            anchor: buttonRef.value?.$el,
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
     * Handler for share button click. Also the entry point for copy-URL keyboard
     * shortcuts, which call it through a template ref — keep it exposed.
     * Safari: Uses polling mechanism to maintain user gesture context
     * Chrome/Firefox: Copies directly in API response
     */
    const handleShareClick = (kind: ShareTimeKind = kinds.value[0], withRange = false) => {
      const longUrl = kind === "live" && props.liveUrl ? props.liveUrl : props.url;
      copyingKind = kind;
      copyingWithRange = withRange && !!props.rangeContext;
      if (!longUrl) {
        toast({
          variant: "warning",
          message: t("toastMessages.common.noUrlToShare"),
        });
        return;
      }

      // Shortcuts call this directly, so the button's :disabled cannot gate them.
      if (props.disabled || isWebUrlNotConfigured.value) return;

      // Start loading and fetch short URL
      isLoading.value = true;

      // Safari: Start polling for short URL (non-blocking)
      if (isSafari) {
        startPollingForShortURL();
      }

      // Fetch short URL via API
      shortURLService
        .create(store.state.selectedOrganization.identifier, longUrl)
        .then((res: any) => {
          if (res.status === 200) {
            const shortUrl = res.data.short_url;

            if (isSafari) {
              // Safari: Store the short URL - polling will pick it up and copy
              store.commit("setPendingShortURL", shortUrl);
            } else {
              // Chrome/Firefox: Copy directly here
              copyToClipboard(clipboardText(shortUrl, kind, copyingWithRange), t, {
                successMessage: copiedMessage(kind),
                errorMessage: t("search.errorCopyingLink"),
                timeout: 5000,
                anchor: buttonRef.value?.$el,
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
              longUrl,
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
      raw,
      t,
      isLoading,
      buttonRef,
      isWebUrlNotConfigured,
      handleShareClick,
      kinds,
      hasMenu,
      menuKinds,
      kindTitle,
      kindHint,
    };
  },
});
</script>
