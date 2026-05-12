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
  icon: any;
  link: string;
  exact?: boolean;
  name: string;
  display?: boolean;
  hide?: boolean;
}

export interface NavbarProps {
  linksList: NavItem[];
  miniMode?: boolean;
  visible?: boolean;
}

export interface NavbarEmits {
  (e: "menu-hover", routePath: string): void;
}

export interface NavbarSlots {
  default?: never;
}
