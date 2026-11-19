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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

export type StarterWelcomeMode = "none" | "loading" | "starter";

/** A chip the welcome puts in the composer. */
export interface WelcomeContext {
  name: string;
  text: string;
}

export interface WelcomeSuggestion {
  id: string;
  icon: string;
  text: I18nText;
}

/** Packs show only for an onboarding org with a match; anything unanswered keeps today's welcome. */
export const starterWelcomeMode = (state: {
  visible: boolean;
  showSection: boolean;
  loading: boolean;
}): StarterWelcomeMode => {
  if (!state.visible) return "none";
  if (state.showSection) return "starter";
  return state.loading ? "loading" : "none";
};

export const joinTitles = (t: TranslateFn, titles: string[]): I18nText => {
  if (titles.length < 2) return raw(titles[0] ?? "");
  return raw(`${titles.slice(0, -1).join(", ")} ${t("common.and")} ${titles[titles.length - 1]}`);
};

/** With one pack, both pack chips name it, so no chip ever reads a missing name. */
export const starterSuggestions = (t: TranslateFn, titles: string[]): WelcomeSuggestion[] => {
  const top = raw(titles[0] ?? "");
  const second = raw(titles[1] ?? titles[0] ?? "");
  return [
    { id: "whichPacks", icon: "package-2", text: t("aiAssistant.starterSuggestions.whichPacks") },
    {
      id: "setUpPack",
      icon: "rocket-launch",
      text: t("aiAssistant.starterSuggestions.setUpPack", { pack: top }),
    },
    {
      id: "whatInPack",
      icon: "inventory-2",
      text: t("aiAssistant.starterSuggestions.whatInPack", { pack: second }),
    },
    {
      id: "mapStreamSchema",
      icon: "data-object",
      text: t("aiAssistant.suggestions.mapStreamSchema"),
    },
    {
      id: "errorsLastHour",
      icon: "error-outline",
      text: t("aiAssistant.starterSuggestions.errorsLastHour"),
    },
    { id: "datadogToO2", icon: "swap-horiz", text: t("aiAssistant.suggestions.datadogToO2") },
  ];
};
