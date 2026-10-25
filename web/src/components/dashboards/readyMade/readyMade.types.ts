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
import type { IconToken } from "@/lib/forms/EmojiPicker/OGlyph.types";
import type { ReadyMadeSourceId } from "@/composables/readyMade/catalog";

/** `choose` lists the banner's offers (unticked = dismissed); `import` lists every source. */
export type ReadyMadeDialogMode = "choose" | "import";

export interface ReadyMadeDialogRow {
  id: ReadyMadeSourceId;
  name: I18nText;
  glyph: IconToken;
  detected: boolean;
  /** Folder of the installed copy; an installed row has no checkbox. */
  installedIn: I18nText | null;
  contents: I18nText;
  destination: I18nText;
  defaultSelected: boolean;
}
