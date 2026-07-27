// Copyright 2026 OpenObserve Inc.
import { toast } from "@/lib/feedback/Toast/useToast";
import type { ToastOptions } from "@/lib/feedback/Toast/OToast.types";

type NotificationOptions = Pick<ToastOptions, "timeout" | "position">;

const useNotifications = () => {
  const showErrorNotification = (message: string, options?: NotificationOptions) => {
    return toast({ variant: "error", message, ...options });
  };

  const showConfictErrorNotificationWithRefreshBtn = (
    message: string,
    options?: NotificationOptions,
  ) => {
    return toast({
      variant: "error",
      message,
      timeout: 0,
      action: {
        label: "Refresh",
        handler: () => window.location.reload(),
      },
      ...options,
    });
  };

  const showAliasErrorForVisualization = (message: string, options?: NotificationOptions) => {
    return toast({ variant: "error", message, timeout: 0, ...options });
  };

  const showPositiveNotification = (message: string, options?: NotificationOptions) => {
    return toast({ variant: "success", message, timeout: 5000, ...options });
  };

  const showInfoNotification = (message: string, options?: NotificationOptions) => {
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
