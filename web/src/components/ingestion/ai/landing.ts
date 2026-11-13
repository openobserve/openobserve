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

import { firstSourceOption, readFirstSource } from "@/components/login/firstSourceOptions";
import { aiCategories } from "./data";

/** The category a bare AI integrations visit opens: the org's welcome pick when it names one, else the first. */
export const aiLandingCategory = (org: unknown) => {
  const slug = firstSourceOption(readFirstSource(String(org ?? "")))?.aiCategory;
  return aiCategories.find((c) => c.slug === slug) ?? aiCategories[0];
};
