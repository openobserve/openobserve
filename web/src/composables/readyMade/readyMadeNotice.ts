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

import type { I18nText } from "@/types/i18n";

export interface ReadyMadeAutoAddNotice {
  org: string;
  id: string;
  folderId: string;
  message: I18nText;
}

// Keyed by the route object, which only a navigation replaces: a card remounted by a layout switch keeps its notice, a new visit starts without one.
const noticesByVisit = new WeakMap<object, Map<string, ReadyMadeAutoAddNotice>>();

export function recallReadyMadeNotice(visit: object, key: string): ReadyMadeAutoAddNotice | null {
  return noticesByVisit.get(visit)?.get(key) ?? null;
}

export function storeReadyMadeNotice(
  visit: object,
  key: string,
  notice: ReadyMadeAutoAddNotice | null,
): void {
  const notices = noticesByVisit.get(visit) ?? new Map<string, ReadyMadeAutoAddNotice>();
  if (notice) notices.set(key, notice);
  else notices.delete(key);
  noticesByVisit.set(visit, notices);
}
