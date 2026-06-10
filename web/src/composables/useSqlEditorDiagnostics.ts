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

/**
 * useSqlEditorDiagnostics
 *
 * Reusable composable that wires SQL syntax validation to any Monaco-backed
 * query editor (CodeQueryEditor or QueryEditor / UnifiedQueryEditor).
 *
 * Usage pattern:
 *   const { onFocus, onBlur, onQueryChange } = useSqlEditorDiagnostics({
 *     queryEditorRef,   // ref to the editor component instance
 *     sqlMode,          // Ref<boolean> — true when in SQL mode
 *     query,            // Ref<string>  — current query text
 *     streamName,       // Ref<string | undefined> — for non-SQL filter wrapping (optional)
 *     externalErrors,   // Ref<SqlErrorRange[]> — server errors written by response handlers (optional)
 *   });
 *
 * Bind in template:
 *   @focus="onFocus"
 *   @blur="onBlur"
 *   @update:query="...; onQueryChange()"
 *
 * externalErrors:
 *   Pass a reactive ref that your server response handler writes into (e.g.
 *   searchObj.data.sqlSyntaxErrorRanges). The composable watches it and
 *   forwards any ranges to the Monaco editor automatically — no extra watcher
 *   needed in the parent component.
 *
 * Future validations (e.g. semantic checks, field existence):
 *   Add them inside onBlur — all pages pick up the change automatically.
 */

import { watch, type Ref } from "vue";
import { debounce } from "lodash-es";
import {
  validateSql,
  type SqlErrorRange,
} from "@/utils/query/sqlDiagnostics";

interface Options {
  queryEditorRef: Ref<any>;
  sqlMode: Ref<boolean>;
  query: Ref<string>;
  streamName?: Ref<string | undefined>;
  /**
   * Optional reactive array written by the server response handler.
   * When provided, the composable watches it and forwards ranges to the editor,
   * replacing the per-page watcher that was previously in Index.vue / parent components.
   */
  externalErrors?: Ref<SqlErrorRange[]>;
}

export function useSqlEditorDiagnostics({
  queryEditorRef,
  sqlMode,
  query,
  streamName,
  externalErrors,
}: Options) {
  // ── Push ranges into Monaco ──────────────────────────────────────────────────
  function pushToEditor(ranges: SqlErrorRange[]) {
    const editor = queryEditorRef.value;
    if (!editor) return;
    if (ranges?.length) {
      editor.addErrorDiagnostics?.(ranges);
    } else {
      // clearErrorDiagnostics exists on QueryEditor.vue (wrapper).
      // CodeQueryEditor exposes only addErrorDiagnostics — calling it with []
      // is equivalent to clearing all markers.
      if (typeof editor.clearErrorDiagnostics === "function") {
        editor.clearErrorDiagnostics();
      } else {
        editor.addErrorDiagnostics?.([]);
      }
    }
  }

  function clearAll() {
    if (externalErrors && externalErrors.value?.length) {
      externalErrors.value = [];
    }
    pushToEditor([]);
  }

  // ── Forward externalErrors (server errors) to the editor ────────────────────
  // This replaces the per-page watcher that previously lived in Index.vue.
  if (externalErrors) {
    watch(
      externalErrors,
      (ranges) => {
        pushToEditor(ranges ?? []);
      },
      { deep: true },
    );
  }

  // ── Event handlers to bind in the template ──────────────────────────────────

  /** Bind to @focus on the query editor. */
  const onFocus = () => {
    clearAll();
  };

  /**
   * Bind to @blur on the query editor.
   * Validates the query client-side without firing a search:
   *   - SQL mode  → validates the raw SQL directly.
   *   - Non-SQL   → wraps the filter text in SELECT … FROM "stream" WHERE …
   *                 so the parser can locate the error column correctly.
   */
  const onBlur = async () => {
    // Read live content directly from the editor to bypass the v-model debounce lag
    // (user may blur within the debounce window, leaving query.value stale).
    // Fall back to the reactive prop when getValue is not available.
    const q = (queryEditorRef.value?.getValue?.() ?? query.value)?.trim();
    if (!q) {
      clearAll();
      return;
    }

    let range: SqlErrorRange | null = null;

    if (sqlMode.value) {
      range = await validateSql(q);
    } else if (streamName?.value) {
      const prefix = `select * from "${streamName.value}" WHERE `;
      range = await validateSql(prefix + q, 0, prefix.length);
    }

    const ranges = range ? [range] : [];

    // Write back to externalErrors so response-handler code stays in sync,
    // then push to editor (watcher fires too but the double-push is a no-op).
    if (externalErrors) {
      externalErrors.value = ranges;
    } else {
      pushToEditor(ranges);
    }
  };

  /** Bind to @update:query. Clears stale markers after the user starts typing. */
  const onQueryChange = debounce(() => {
    clearAll();
  }, 500);

  return { onFocus, onBlur, onQueryChange };
}
