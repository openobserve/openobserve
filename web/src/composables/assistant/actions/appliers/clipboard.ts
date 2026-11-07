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

import { registerApplier, type Applier } from "../registry";
import type { AssistantAction } from "../types";

/** Copy: the clipboard, or `failed` so the control shows the text to copy by hand. */
export const clipboardApplier: Applier<Extract<AssistantAction, { kind: "copy" }>> = async (
  _sid,
  action,
  env,
) => ((await env.copy(action.text)) ? { ok: true } : { ok: false, reason: "failed" });

export function registerClipboardAppliers(): void {
  registerApplier("copy", clipboardApplier);
}
