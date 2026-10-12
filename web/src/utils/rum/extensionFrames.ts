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

// Chrome frames start with "at ", Firefox and Safari frames carry "fn@url"; the first line is the message, not a frame.
const FRAME_LINE = /^\s*at\s|^[^\s@]*@/;
const FRAME_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s)]+/i;

/** Whether an error stack has at least one frame and every frame URL is a Chrome extension, so the error is not the app's. */
export function isExtensionOnlyError(stack: string | undefined): boolean {
  if (!stack) return false;
  const urls = stack
    .split("\n")
    .filter((line) => FRAME_LINE.test(line))
    .map((line) => line.match(FRAME_URL)?.[0])
    .filter((url): url is string => url !== undefined);
  return urls.length > 0 && urls.every((url) => url.startsWith("chrome-extension://"));
}
