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

import { computed } from "vue";
import { useStore } from "vuex";

export type EditorSuggestMode = "automatic" | "typing" | "off";

const MODES: readonly EditorSuggestMode[] = ["automatic", "typing", "off"];

/** Only an older server omits the field; the server refuses to start on an unknown value. */
export const resolveEditorSuggestMode = (raw: unknown): EditorSuggestMode => {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (MODES as readonly string[]).includes(value) ? (value as EditorSuggestMode) : "automatic";
};

export function useEditorSuggestMode() {
  const store = useStore();
  const mode = computed(() =>
    resolveEditorSuggestMode(store?.state?.zoConfig?.editor_suggest_mode),
  );
  return { mode };
}

export default useEditorSuggestMode;
