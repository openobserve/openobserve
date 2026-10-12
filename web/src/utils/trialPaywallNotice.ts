// Copyright 2026 OpenObserve Inc.

import i18n from "@/locales";
import { raw } from "@/types/i18n";
import { toast, type DismissFn } from "@/lib/feedback/Toast/useToast";

interface BlockedRoute {
  name?: unknown;
  meta?: { titleKey?: string };
}

let activeDismiss: DismissFn | null = null;
let activeMessage: string | null = null;

const translate = (key: string, params?: Record<string, unknown>): string =>
  params ? i18n.global.t(key as never, params as never) : i18n.global.t(key as never);

const pageTitle = (route: BlockedRoute): string | null => {
  const key = route.meta?.titleKey;
  if (!key) return null;
  const title = translate(key);
  return title && title !== key ? title : null;
};

export function notifyTrialBlocked(route: BlockedRoute): void {
  const page = pageTitle(route);
  const message = page
    ? translate("menu.trialPageNeedsPlanToast", { page })
    : translate("menu.trialChoosePlanToast", { product: "OpenObserve" });
  // One trial toast at a time: a different page replaces the visible one instead of stacking.
  if (activeDismiss && activeMessage !== message) activeDismiss();
  activeMessage = message;
  activeDismiss = toast({
    variant: "info",
    title: raw(translate("menu.trialEndedTitle")),
    message: raw(message),
  });
}
