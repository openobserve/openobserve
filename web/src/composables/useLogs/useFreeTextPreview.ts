//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { onScopeDispose, watch } from "vue";
import {
  buildFilterContext,
  freeTextDecorations,
  planStreamsFilter,
  type FreeTextDecorations,
  type FreeTextSearchObj,
  type FreeTextZoConfig,
} from "./freeTextSearch";

type PreviewSearchObj = FreeTextSearchObj & {
  data: { freeTextDecorations?: FreeTextDecorations | null };
};

export function useFreeTextPreview(
  searchObj: PreviewSearchObj,
  config: () => FreeTextZoConfig | null | undefined,
  readEditor: () => string,
  t: (key: string, params?: Record<string, unknown>) => string,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const update = (raw: string) => {
    cancel();
    const ctx = buildFilterContext(searchObj, config());
    const plan = planStreamsFilter(raw.trim(), searchObj.data.stream.selectedStream, ctx);
    if (searchObj.meta.sqlMode || plan.kind !== "freeText") {
      searchObj.data.freeTextDecorations = null;
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      const preview = { ...searchObj, data: { ...searchObj.data, query: raw } };
      const context = buildFilterContext(searchObj, config());
      searchObj.data.freeTextDecorations = freeTextDecorations(preview, context, t);
    }, 150);
  };
  watch(
    () => ({
      query: searchObj.data.query,
      sqlMode: searchObj.meta.sqlMode,
      context: buildFilterContext(searchObj, config()),
    }),
    (value, previous) => {
      const editor = readEditor();
      const queryChanged = value.query !== previous?.query;
      update(queryChanged && editor.trim() !== value.query.trim() ? value.query : editor);
    },
    { deep: true, immediate: true },
  );
  onScopeDispose(cancel);
  return () => update(readEditor());
}
