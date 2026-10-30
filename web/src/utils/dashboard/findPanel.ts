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

export interface FoundPanel {
  tab: any;
  panel: any;
  index: number;
}

/** Finds a panel by id, checking `preferredTabId` first so a panel moved to another tab is still found. */
export const findPanelById = (
  dashboard: any,
  panelId: unknown,
  preferredTabId?: unknown,
): FoundPanel | undefined => {
  const tabs: any[] = Array.isArray(dashboard?.tabs) ? dashboard.tabs : [];
  const ordered = [
    ...tabs.filter((tab) => tab?.tabId == preferredTabId),
    ...tabs.filter((tab) => tab?.tabId != preferredTabId),
  ];
  for (const tab of ordered) {
    const panels: any[] = Array.isArray(tab?.panels) ? tab.panels : [];
    const index = panels.findIndex((panel) => panel?.id == panelId);
    if (index !== -1) return { tab, panel: panels[index], index };
  }
  return undefined;
};
