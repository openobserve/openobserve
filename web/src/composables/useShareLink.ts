// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, onBeforeUnmount, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import shortURLService from "@/services/short_url";
import { toast } from "@/lib/feedback/Toast/useToast";

export interface ShareLinkEvents {
  copySuccess?: (payload: { url: string; type: "short" }) => void;
  copyError?: (payload: { error: Error; type: "short" }) => void;
  shortenSuccess?: (payload: { longUrl: string; shortUrl: string }) => void;
  shortenError?: (payload: { error: unknown }) => void;
}

export interface ShareLinkOptions {
  url: () => string;
  disabled?: () => boolean;
  /** Element the "Copied" confirmation anchors to; none centres it. */
  anchor?: () => HTMLElement | undefined;
  events?: ShareLinkEvents;
}

/**
 * Shortens a URL and copies it, for a share button or a ⋯ menu item. Call it from an
 * always-mounted component: a closing menu would otherwise cancel Safari's copy poll.
 */
export function useShareLink(options: ShareLinkOptions) {
  const { t } = useI18nTyped();
  const store = useStore();

  const isLoading = ref(false);
  let pollIntervalId: number | null = null;
  let isPolling = false;

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  const isWebUrlNotConfigured = computed(() => {
    const webUrl = store.state.zoConfig?.web_url || "";
    return !webUrl || webUrl.trim() === "";
  });

  const copyShortUrl = (shortUrl: string) =>
    copyToClipboard(shortUrl, t, {
      successMessage: t("search.linkCopiedSuccessfully"),
      errorMessage: t("search.errorCopyingLink"),
      timeout: 5000,
      anchor: options.anchor?.(),
    }).then((success: boolean) => {
      if (success) {
        options.events?.copySuccess?.({ url: shortUrl, type: "short" });
      } else {
        console.error("Failed to copy short URL:", shortUrl);
        options.events?.copyError?.({ error: new Error("Copy failed"), type: "short" });
      }
    });

  const stopPolling = () => {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    isPolling = false;
  };

  // Safari only copies inside the user gesture, so the click starts a poll that copies once the URL lands.
  const startPollingForShortURL = () => {
    const MAX_ATTEMPTS = 30;
    const POLL_INTERVAL = 500;
    let attempts = 0;

    if (isPolling) {
      console.warn("Polling already in progress, skipping");
      return;
    }
    stopPolling();
    isPolling = true;

    pollIntervalId = window.setInterval(() => {
      attempts++;
      const shortURL = store.state.pendingShortURL;

      if (shortURL) {
        stopPolling();
        copyShortUrl(shortURL).finally(() => {
          store.commit("clearPendingShortURL");
          isLoading.value = false;
        });
      } else if (attempts >= MAX_ATTEMPTS) {
        console.warn("Polling timeout: Short URL not received within time limit");
        stopPolling();
        isLoading.value = false;
        store.commit("clearPendingShortURL");
        toast({
          variant: "warning",
          message: t("search.errorShorteningLink"),
          timeout: 5000,
        });
      }
    }, POLL_INTERVAL);
  };

  const failShorten = (error: unknown) => {
    if (isSafari) stopPolling();
    isLoading.value = false;
    toast({
      variant: "error",
      message: t("search.errorShorteningLink"),
      timeout: 5000,
    });
    options.events?.shortenError?.({ error });
  };

  const share = () => {
    const url = options.url();
    if (!url) {
      toast({
        variant: "warning",
        message: t("toastMessages.common.noUrlToShare"),
      });
      return;
    }

    // Shortcuts call this directly, so a button's :disabled cannot gate them.
    if (options.disabled?.() || isWebUrlNotConfigured.value) return;

    isLoading.value = true;
    if (isSafari) startPollingForShortURL();

    shortURLService
      .create(store.state.selectedOrganization.identifier, url)
      .then((res: any) => {
        if (res.status !== 200) {
          failShorten("Invalid response status");
          return;
        }
        const shortUrl = res.data.short_url;
        if (isSafari) {
          store.commit("setPendingShortURL", shortUrl);
        } else {
          copyShortUrl(shortUrl).finally(() => {
            isLoading.value = false;
          });
        }
        options.events?.shortenSuccess?.({ longUrl: url, shortUrl });
      })
      .catch((error: any) => {
        console.error("Error creating short URL:", error);
        failShorten(error);
      });
  };

  onBeforeUnmount(() => {
    stopPolling();
    store.commit("clearPendingShortURL");
  });

  return { isLoading, isWebUrlNotConfigured, share };
}

export default useShareLink;
