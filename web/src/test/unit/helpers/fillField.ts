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

import { flushPromises } from "@vue/test-utils";

/** Fills a field the way autofill, dictation or Playwright's fill() does: focus, then inserted text, with no key or pointer event. */
export const fillField = async (dataTest: string, value: string): Promise<void> => {
  const host = document.body.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);
  if (!host) throw new Error(`No field with data-test "${dataTest}"`);
  const field =
    host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement
      ? host
      : host.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (!field) throw new Error(`No input inside "${dataTest}"`);
  field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText" }));
  field.value = value;
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  await flushPromises();
};
