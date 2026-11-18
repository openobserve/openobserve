/**
 * Static content for the O2 Assistant home-tab welcome screen.
 */

import type { I18nKey } from "@/types/i18n";

/** A card that opens a page instead of asking the assistant, worded as the Overview's card for that page. */
export interface CapabilityCardPage {
  route: "addAlert";
  titleKey: I18nKey;
  descriptionKey: I18nKey;
  /** License feature the page needs; while it is locked the card asks the assistant. */
  feature: string;
}

export interface CapabilityCard {
  /** i18n key — under aiAssistant.capabilities.<id>.{title,description,prompt} */
  id: "query" | "incident" | "dashboard" | "alert";
  /** OIcon registry name */
  icon: string;
  /** Tailwind text color class for the icon (token-based) */
  iconColorClass: string;
  /** Tailwind tinted background class for the icon chip */
  iconBgClass: string;
  page?: CapabilityCardPage;
}

export const CAPABILITY_CARDS: CapabilityCard[] = [
  {
    id: "query",
    icon: "edit",
    iconColorClass: "text-[#7B61FF]",
    iconBgClass: "bg-[#7B61FF]/10",
  },
  {
    id: "incident",
    icon: "warning",
    iconColorClass: "text-[#F59E0B]",
    iconBgClass: "bg-[#F59E0B]/10",
  },
  {
    id: "dashboard",
    icon: "dashboard",
    iconColorClass: "text-[#10B981]",
    iconBgClass: "bg-[#10B981]/10",
  },
  {
    id: "alert",
    icon: "notifications",
    iconColorClass: "text-[#EF4444]",
    iconBgClass: "bg-[#EF4444]/10",
    page: {
      route: "addAlert",
      titleKey: "overview.notMonitoredAlert",
      descriptionKey: "overview.notMonitoredAlertDesc",
      feature: "alerts",
    },
  },
];

export interface PromptSuggestion {
  /** i18n key — under aiAssistant.suggestions.<id> */
  id: string;
  /** OIcon name */
  icon: string;
}

export const PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  { id: "vrlParseJson", icon: "code" },
  { id: "regexRedact", icon: "code" },
  { id: "mapStreamSchema", icon: "data-object" },
  { id: "promqlCpu", icon: "trending-up" },
  { id: "datadogToO2", icon: "swap-horiz" },
  { id: "lastAlertFired", icon: "history" },
];
