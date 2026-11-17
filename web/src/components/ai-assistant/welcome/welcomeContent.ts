/**
 * Static content for the assistant home-tab welcome screen.
 */

import type { I18nKey } from "@/types/i18n";

type HomeCardId = "query" | "incident" | "dashboard" | "alert";
type InvestigateCardId = "whyAlertFired" | "investigateIncident" | "errorSpike" | "slowService";

export interface CapabilityCard {
  id: string;
  title: I18nKey;
  description: I18nKey;
  prompt: I18nKey;
  /** OIcon registry name */
  icon: string;
  /** Tailwind text color class for the icon (token-based) */
  iconColorClass: string;
  /** Tailwind tinted background class for the icon chip */
  iconBgClass: string;
}

const homeText = (id: HomeCardId) => ({
  id,
  title: `aiAssistant.capabilities.${id}.title` as const,
  description: `aiAssistant.capabilities.${id}.description` as const,
  prompt: `aiAssistant.capabilities.${id}.prompt` as const,
});

const investigateText = (id: InvestigateCardId) => ({
  id,
  title: `autobotInvestigate.cards.${id}.title` as const,
  description: `autobotInvestigate.cards.${id}.description` as const,
  prompt: `autobotInvestigate.cards.${id}.prompt` as const,
});

export const CAPABILITY_CARDS: CapabilityCard[] = [
  {
    ...homeText("query"),
    icon: "edit",
    iconColorClass: "text-ai-accent",
    iconBgClass: "bg-ai-accent/10",
  },
  {
    ...homeText("incident"),
    icon: "warning",
    iconColorClass: "text-status-warning-text",
    iconBgClass: "bg-status-warning-bg",
  },
  {
    ...homeText("dashboard"),
    icon: "dashboard",
    iconColorClass: "text-status-success-text",
    iconBgClass: "bg-status-success-bg",
  },
  {
    ...homeText("alert"),
    icon: "notifications",
    iconColorClass: "text-status-error-text",
    iconBgClass: "bg-status-error-bg",
  },
];

/** The investigate page's starters, in place of Home's. */
export const INVESTIGATE_CARDS: CapabilityCard[] = [
  {
    ...investigateText("whyAlertFired"),
    icon: "notifications-active",
    iconColorClass: "text-status-error-text",
    iconBgClass: "bg-status-error-bg",
  },
  {
    ...investigateText("investigateIncident"),
    icon: "warning",
    iconColorClass: "text-status-warning-text",
    iconBgClass: "bg-status-warning-bg",
  },
  {
    ...investigateText("errorSpike"),
    icon: "trending-up",
    iconColorClass: "text-ai-accent",
    iconBgClass: "bg-ai-accent/10",
  },
  {
    ...investigateText("slowService"),
    icon: "speed",
    iconColorClass: "text-status-success-text",
    iconBgClass: "bg-status-success-bg",
  },
];

export interface PromptSuggestion {
  /** i18n key — under aiAssistant.suggestions.<id>, unless `key` names another */
  id: string;
  key?: I18nKey;
  /** OIcon name */
  icon: string;
}

export const PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  { id: "vrlParseJson", icon: "code" },
  { id: "regexRedact", icon: "code" },
  { id: "mapStreamSchema", icon: "data-object" },
  { id: "promqlCpu", icon: "trending-up" },
  { id: "otherToolToO2", key: "assistant.welcome.starter.otherToolToO2", icon: "swap-horiz" },
  { id: "lastAlertFired", icon: "history" },
];
