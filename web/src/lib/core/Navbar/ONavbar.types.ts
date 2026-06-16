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

export interface NavItem {
  title: string;
  icon: string;
  link: string;
  exact?: boolean;
  name: string;
  display?: boolean;
  hide?: boolean;
}

export interface NavbarProps {
  linksList: NavItem[];
  manageLinks?: NavItem[];
  miniMode?: boolean;
  visible?: boolean;
  user?: Record<string, any>;
  langList?: Array<{ label: string; code: string; icon?: string }>;
  selectedLanguage?: { label: string; code: string; icon?: string };
  organizations?: any[];
  selectedOrg?: any;
  userClickedOrg?: any;
  config?: Record<string, any>;
  store?: any;
  zoBackendUrl?: string;
  slackIcon?: any;
  getBtnLogo?: string;
  isHovered?: boolean;
}

export interface NavbarEmits {
  (e: "menu-hover", routePath: string): void;
  (e: "update:selected-org", org: any): void;
  (e: "update:is-hovered", val: boolean): void;
  (e: "update-organization"): void;
  (e: "go-to-home"): void;
  (e: "go-to-about"): void;
  (e: "toggleAIChat"): void;
  (e: "open-slack"): void;
  (e: "navigateToOpenAPI", url: string): void;
  (e: "navigate-to-docs"): void;
  (e: "change-language", lang: { label: string; code: string }): void;
  (e: "open-predefined-themes"): void;
  (e: "signout"): void;
}

export interface NavbarSlots {
  default?: never;
}
