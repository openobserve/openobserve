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

import config from "@/aws-exports";
import segment from "@/services/segment_analytics";
import { useReo } from "@/services/reodotdev_analytics";
import type { PaletteItemType, PaletteScope } from "./types";

export type PaletteOpenSource = "shortcut" | "header" | "help";

export interface PaletteSelectEvent {
  type: PaletteItemType;
  position: number;
  queryLength: number;
  scopes: PaletteScope[];
}

const OPEN_EVENT = "Command Palette Open";
const SELECT_EVENT = "Command Palette Select";

/** Both analytics sinks, cloud only, never the query text or the user. Created inside a component setup. */
export function usePaletteTelemetry(store: { state: any }) {
  const { track } = useReo();
  // Reo guards itself on analytics + cloud; the segment SDK does not, so mirror that gate here.
  const sendSegment = (event: string, payload: Record<string, unknown>) => {
    if (config.enableAnalytics == "true" && config.isCloud == "true") segment.track(event, payload);
  };

  // Org only: no email or query text ever leaves the browser for the palette.
  const context = () => ({ user_org: store.state.selectedOrganization?.identifier });

  const trackOpen = (source: PaletteOpenSource): void => {
    const payload = { source, ...context() };
    track(OPEN_EVENT, payload);
    sendSegment(OPEN_EVENT, payload);
  };

  const trackSelect = (event: PaletteSelectEvent): void => {
    const payload = {
      type: event.type,
      position: event.position,
      query_length: event.queryLength,
      scopes: event.scopes.join(","),
      ...context(),
    };
    track(SELECT_EVENT, payload);
    sendSegment(SELECT_EVENT, payload);
  };

  return { trackOpen, trackSelect };
}
