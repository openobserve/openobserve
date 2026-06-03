/**
 * Static content for the O2 Assistant home-tab welcome screen.
 * Keeping this colocated keeps prompts editable without touching templates.
 */

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
    iconColorClass: "tw:text-[#7B61FF]",
    iconBgClass: "tw:bg-[#7B61FF]/10",
  },
  {
    id: "incident",
    icon: "warning",
    iconColorClass: "tw:text-[#F59E0B]",
    iconBgClass: "tw:bg-[#F59E0B]/10",
  },
  {
    id: "dashboard",
    icon: "dashboard",
    iconColorClass: "tw:text-[#10B981]",
    iconBgClass: "tw:bg-[#10B981]/10",
  },
  {
    id: "alert",
    icon: "notifications",
    iconColorClass: "tw:text-[#EF4444]",
    iconBgClass: "tw:bg-[#EF4444]/10",
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
