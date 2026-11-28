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

import type { SecretPickerItem } from "@/services/secrets";
import { refNames } from "@/views/Secrets/secretRefs";

export const missingManage = (
  headerValues: (string | undefined)[],
  usable: SecretPickerItem[],
): string[] => {
  const byName = new Map(
    usable.filter((item) => item.kind === "secret").map((item) => [item.name, item]),
  );
  return [...refNames(headerValues).secrets].filter((name) => {
    const item = byName.get(name);
    return !item || item.rights?.manage === false;
  });
};
