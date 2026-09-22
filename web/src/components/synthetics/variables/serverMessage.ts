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

import { raw, type I18nText } from "@/types/i18n";

/** The server's `message` on a failed request, written to be shown verbatim. */
export function serverMessage(error: unknown): I18nText | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) return undefined;
  const { response } = error as { response?: { data?: { message?: unknown } } };
  const message = response?.data?.message;
  return typeof message === "string" && message ? raw(message) : undefined;
}
