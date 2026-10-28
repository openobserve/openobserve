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

import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { formatEditorDraftTime } from "@/utils/drafts/editorDraftStore";

/** A host's own tooltip text for its draft: "{label} · unsaved draft from {date}", undated when no time is known. */
export const useDraftLabel = () => {
  const { t, locale } = useI18nTyped();
  const store = useStore();
  return (label: I18nText, savedAt: number | null): I18nText =>
    savedAt === null
      ? t("common.editorDraft.newDot", { label })
      : t("common.editorDraft.newDotDated", {
          label,
          date: formatEditorDraftTime(savedAt, locale.value, store.state.timezone || undefined),
        });
};
