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
import { provide, type InjectionKey, type Ref } from "vue";

/** Provided by a page that mounts a first-event bar; its snippets call it after every copy. */
export const FIRST_EVENT_SNIPPET_COPIED: InjectionKey<() => void> =
  Symbol("firstEventSnippetCopied");

/** Lets every snippet under the page restart the bar's fast cadence and 60-minute budget; returns the hook for copies the page handles itself. */
export const provideSnippetCopied = (
  bar: Ref<{ start: (reason: "copy") => void } | null | undefined>,
): (() => void) => {
  const copied = () => bar.value?.start("copy");
  provide(FIRST_EVENT_SNIPPET_COPIED, copied);
  return copied;
};
