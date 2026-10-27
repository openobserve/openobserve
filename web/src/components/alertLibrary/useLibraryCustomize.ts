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

import { useAlertCreation } from "@/composables/alerts/useAlertCreation";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import { useI18nTyped } from "@/types/i18n";
import { buildPrefillFromLibrary } from "@/utils/alerts/prefill/fromLibrary";

/** "Customize in editor" for a scheduled library alert, shared by the drawer and the card. */
export const useLibraryCustomize = () => {
  const { t } = useI18nTyped();
  const { loadAlertFile } = useAlertLibrary();
  const { openAlertCreation } = useAlertCreation();

  /** Resolves false, after telling the user, when the editor could not be opened. */
  const customizeInEditor = async (
    entry: AlertLibraryEntry,
    file?: AlertLibraryFile | null,
  ): Promise<boolean> => {
    const source = file ?? (await loadAlertFile(entry).catch(() => null));
    // The prefill speaks the scheduled shape only; an anomaly body would open a broken form.
    const prefillable = source !== null && source.alert_type !== "anomaly_detection";
    if (prefillable && openAlertCreation(buildPrefillFromLibrary({ entry, file: source }))) {
      return true;
    }
    toast({ variant: "error", message: t("alert_library.drawer.customizeFailed") });
    return false;
  };

  return { customizeInEditor };
};
