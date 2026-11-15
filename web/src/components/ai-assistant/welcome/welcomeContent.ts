/**
 * Static content for the assistant home-tab welcome screen.
 */

import type { I18nKey } from "@/types/i18n";

export interface CapabilityCard {
  /** i18n key — under aiAssistant.capabilities.<id>.{title,description,prompt} */
  id: "query" | "incident" | "dashboard" | "alert";
  /** OIcon registry name */
  icon: string;
  /** Tailwind text color class for the icon (token-based) */
  iconColorClass: string;
  /** Tailwind tinted background class for the icon chip */
  iconBgClass: string;
}

export const CAPABILITY_CARDS: CapabilityCard[] = [
  {
    id: "query",
    icon: "edit",
    iconColorClass: "text-ai-accent",
    iconBgClass: "bg-ai-accent/10",
  },
  {
    id: "incident",
    icon: "warning",
    iconColorClass: "text-status-warning-text",
    iconBgClass: "bg-status-warning-bg",
  },
  {
    id: "dashboard",
    icon: "dashboard",
    iconColorClass: "text-status-success-text",
    iconBgClass: "bg-status-success-bg",
  },
  {
    id: "alert",
    icon: "notifications",
    iconColorClass: "text-status-error-text",
    iconBgClass: "bg-status-error-bg",
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
