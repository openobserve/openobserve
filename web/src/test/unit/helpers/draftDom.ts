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

/** The element with this data-test anywhere in the document, teleported dialogs included. */
export const byTest = (id: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);

/** The element with data-test `id` inside the element with data-test `container`. */
export const inDialog = (container: string, id: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(`[data-test="${container}"] [data-test="${id}"]`);

export const leaveButton = (id: string): HTMLElement | null =>
  inDialog("editor-draft-leave-dialog", id);

export const restoreButton = (id: string): HTMLElement | null =>
  inDialog("editor-draft-restore-dialog", id);

const mustClick = (element: HTMLElement | null, what: string): void => {
  if (!element) throw new Error(`Nothing to click: no element with data-test ${what}`);
  element.click();
};

/** Clicks the element with this data-test, and fails the test when it is not rendered. */
export const click = (id: string): void => mustClick(byTest(id), `"${id}"`);

/** Clicks `id` inside `container`, and fails the test when it is not rendered. */
export const clickIn = (container: string, id: string): void =>
  mustClick(inDialog(container, id), `"${id}" in "${container}"`);

/** Clicks a button of the editor leave dialog, and fails the test when it is not open. */
export const clickLeave = (id: string): void => clickIn("editor-draft-leave-dialog", id);

/** Clicks a button of the editor restore dialog, and fails the test when it is not open. */
export const clickRestore = (id: string): void => clickIn("editor-draft-restore-dialog", id);

/** Presses Escape where the keyboard focus is, as a user would. */
export const pressEscape = (): void => {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
};
