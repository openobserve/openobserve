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

import { onBeforeUnmount, onMounted, readonly, ref, shallowRef } from "vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { isSlackOAuthCallbackMessage } from "@/utils/slackOAuth";

export const SLACK_OAUTH_POPUP_NAME = "openobserve-slack-oauth";
const POPUP_FEATURES = "popup,width=720,height=760,resizable=yes,scrollbars=yes";
const POPUP_WATCH_INTERVAL_MS = 500;
const POPUP_CLOSE_GRACE_MS = 1_000;

export type SlackOAuthPopupToast =
  "popupBlocked" | "startFailed" | "authorizationDenied" | "exchangeFailed" | "popupClosed";

export interface SlackOAuthCallback {
  code: string;
  state: string;
}

export interface UseSlackOAuthPopupOptions<T> {
  /** Resolves the URL the popup opens: install/start, install-url or connection/start. */
  start: () => Promise<string>;
  /** Redeems the callback: install/exchange, or connection/confirm with `oidc_code`/`oidc_state`. */
  exchange: (callback: SlackOAuthCallback) => Promise<T>;
  onSuccess: (result: T) => void;
  messages?: Partial<Record<SlackOAuthPopupToast, () => I18nText>>;
}

export function useSlackOAuthPopup<T>(options: UseSlackOAuthPopupOptions<T>) {
  const { t } = useI18nTyped();

  const connecting = ref(false);
  const oauthWindow = shallowRef<Window | null>(null);
  let popupWatcher: number | undefined;
  let popupCloseGraceTimer: number | undefined;

  const defaultMessages: Record<SlackOAuthPopupToast, () => I18nText> = {
    popupBlocked: () =>
      t("alert_destinations.slackOAuth.popupBlocked", { product: raw("OpenObserve") }),
    startFailed: () => t("alert_destinations.slackOAuth.startFailed"),
    authorizationDenied: () => t("alert_destinations.slackOAuth.authorizationDenied"),
    exchangeFailed: () => t("alert_destinations.slackOAuth.exchangeFailed"),
    popupClosed: () => t("alert_destinations.slackOAuth.popupClosed"),
  };

  const message = (kind: SlackOAuthPopupToast): I18nText =>
    (options.messages?.[kind] ?? defaultMessages[kind])();

  const stopPopupWatcher = (): void => {
    if (popupWatcher !== undefined) {
      window.clearInterval(popupWatcher);
      popupWatcher = undefined;
    }
  };

  const release = (close: boolean): void => {
    stopPopupWatcher();
    if (popupCloseGraceTimer !== undefined) {
      window.clearTimeout(popupCloseGraceTimer);
      popupCloseGraceTimer = undefined;
    }
    if (close && oauthWindow.value && !oauthWindow.value.closed) oauthWindow.value.close();
    oauthWindow.value = null;
    connecting.value = false;
  };

  const handleOAuthMessage = async (event: MessageEvent<unknown>): Promise<void> => {
    if (
      event.origin !== window.location.origin ||
      event.source !== oauthWindow.value ||
      !isSlackOAuthCallbackMessage(event.data)
    ) {
      return;
    }

    const callback = event.data;
    release(true);
    if ("error" in callback) {
      toast({ variant: "error", message: message("authorizationDenied") });
      return;
    }

    connecting.value = true;
    try {
      const result = await options.exchange({ code: callback.code, state: callback.state });
      options.onSuccess(result);
    } catch {
      toast({ variant: "error", message: message("exchangeFailed") });
    } finally {
      connecting.value = false;
    }
  };

  const watchPopup = (popup: Window): void => {
    stopPopupWatcher();
    popupWatcher = window.setInterval(() => {
      if (oauthWindow.value !== popup || !popup.closed) return;
      stopPopupWatcher();
      if (popupCloseGraceTimer !== undefined) return;
      popupCloseGraceTimer = window.setTimeout(() => {
        popupCloseGraceTimer = undefined;
        if (oauthWindow.value !== popup) return;
        oauthWindow.value = null;
        connecting.value = false;
        toast({ variant: "warning", message: message("popupClosed") });
      }, POPUP_CLOSE_GRACE_MS);
    }, POPUP_WATCH_INTERVAL_MS);
  };

  // window.open must run before the first await, or the browser treats it as an unrequested popup.
  const open = async (): Promise<void> => {
    if (connecting.value) return;
    const popup = window.open("", SLACK_OAUTH_POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      toast({ variant: "error", message: message("popupBlocked") });
      return;
    }

    connecting.value = true;
    oauthWindow.value = popup;
    watchPopup(popup);
    try {
      const url = await options.start();
      if (oauthWindow.value !== popup || popup.closed) return;
      popup.location.href = String(url);
      popup.focus();
    } catch {
      release(true);
      toast({ variant: "error", message: message("startFailed") });
    }
  };

  onMounted(() => {
    window.addEventListener("message", handleOAuthMessage);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("message", handleOAuthMessage);
    release(true);
  });

  return { connecting: readonly(connecting), open, release };
}
