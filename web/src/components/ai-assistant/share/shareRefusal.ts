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

import { toAssistantError } from "@/composables/assistant";
import type { I18nKey } from "@/types/i18n";

/** What a failed share create says, and whether Retry can help: only when the server calls it retryable. */
export function shareCreateRefusal(err: unknown): { message: I18nKey; retry: boolean } {
  const error = toAssistantError(err, { phase: "mutation" });
  // The 400 for an empty chat has no code of its own, only this message (shares.rs, NO_SEQ).
  const empty = error.httpStatus === 400 && /no stored messages/i.test(error.serverMessage ?? "");
  return {
    message: empty ? "assistant.share.noStoredMessages" : "assistant.share.createFailed",
    retry: error.retryable,
  };
}
