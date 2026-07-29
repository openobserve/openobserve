// Copyright 2026 OpenObserve Inc.
import { toast } from "@/lib/feedback/Toast/useToast";
import type { ToastOptions } from "@/lib/feedback/Toast/OToast.types";
import type { I18nText, TranslateFn } from "@/types/i18n";

type NotificationOptions = Pick<ToastOptions, "timeout" | "position">;

const useNotifications = () => {
  const showErrorNotification = (message: I18nText, options?: NotificationOptions) => {
    return toast({ variant: "error", message, ...options });
  };

  // `t` injected: useNotifications() is called directly by specs outside any
  // component, so it cannot obtain a translator itself.
  const showConfictErrorNotificationWithRefreshBtn = (
    message: I18nText,
    t: TranslateFn,
    options?: NotificationOptions,
  ) => {
    return toast({
      variant: "error",
      message,
      timeout: 0,
      action: {
        label: t("toastMessages.composables.refresh"),
        handler: () => window.location.reload(),
      },
      ...options,
    });
  };

  const showAliasErrorForVisualization = (message: I18nText, options?: NotificationOptions) => {
    return toast({ variant: "error", message, timeout: 0, ...options });
  };

  const showPositiveNotification = (message: I18nText, options?: NotificationOptions) => {
    return toast({ variant: "success", message, timeout: 5000, ...options });
  };

  const showInfoNotification = (message: I18nText, options?: NotificationOptions) => {
    return toast({ variant: "info", message, timeout: 5000, ...options });
  };

  return {
    showErrorNotification,
    showPositiveNotification,
    showInfoNotification,
    showConfictErrorNotificationWithRefreshBtn,
    showAliasErrorForVisualization,
  };
};

export default useNotifications;
