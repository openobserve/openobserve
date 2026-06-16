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

export type NavGroup = 'observe' | 'analyze' | 'manage' | 'admin';

export interface NavItem {
  title: string;
  icon: string;
  link: string;
  exact?: boolean;
  name: string;
  display?: boolean;
  hide?: boolean;
  group?: NavGroup;
}

export interface NavbarProps {
  linksList: NavItem[];
  miniMode?: boolean;
  visible?: boolean;
  logoSrc?: string;
  orgName?: string;
  orgOptions?: Array<{ label: string; identifier: string }>;
  userName?: string;
  userEmail?: string;
  isAiEnabled?: boolean;
  isAiChatActive?: boolean;
  theme?: string;
}

export interface NavbarEmits {
  (e: "menu-hover", routePath: string): void;
  (e: "go-to-home"): void;
  (e: "update:org", identifier: string): void;
  (e: "toggle-ai-chat"): void;
  (e: "open-slack"): void;
  (e: "open-help"): void;
  (e: "open-predefined-themes"): void;
  (e: "signout"): void;
}

export interface NavbarSlots {
  default?: never;
}
