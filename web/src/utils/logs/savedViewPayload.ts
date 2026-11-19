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

import { prepareSearchForSave } from "@/utils/logs/transientSearchKeys";

type PlainObject = Record<string, any>;

export interface SavedViewPayloadOptions {
  timezone: string;
  /** Present only in visualize mode. */
  visualizationData?: unknown;
  /** Present only in build mode; without it the restored builder loses its configuration. */
  buildData?: unknown;
}

/** A logs search object as the saved-views API stores it: a clone with runtime-only state removed. */
export function buildSavedViewPayload(
  search: PlainObject,
  options: SavedViewPayloadOptions,
): PlainObject {
  const saved = JSON.parse(JSON.stringify(search));

  delete saved.data.queryResults;
  delete saved.data.histogram;
  delete saved.data.sortedQueryResults;
  delete saved.data.stream.streamLists;
  delete saved.data.stream.functions;
  delete saved.data.streamResults;
  delete saved.data.savedViews;
  delete saved.data.transforms;

  saved.loading = false;
  saved.loadingHistogram = false;
  saved.loadingCounter = false;
  saved.loadingStream = false;
  saved.loadingSavedView = false;

  saved.data.timezone = options.timezone;

  if (saved.data.parsedQuery) delete saved.data.parsedQuery;
  if (options.visualizationData) saved.data.visualizationData = options.visualizationData;
  if (options.buildData) saved.data.buildData = options.buildData;

  // Transient hand-off to BuildQueryPage, never part of a saved view.
  delete saved.meta.savedBuildConfig;

  return prepareSearchForSave(saved, search);
}
