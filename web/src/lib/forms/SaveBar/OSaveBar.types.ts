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

import type { OFormInstance } from "../Form/useOForm";

export type SaveBarContentSize = "sm" | "md" | "lg" | "xl" | "full";

export type SaveBarMode = "edit" | "create";

export interface SaveBarProps {
  /** `"create"` is for a new record: Save works on an untouched form and Cancel replaces Discard. */
  mode?: SaveBarMode;
  /** Replaces "Save" on the primary button, such as "Continue" on a step. */
  saveLabel?: string;
  /** Disables the primary for a reason the form does not know, such as a step with nothing chosen. */
  saveDisabled?: boolean;
  /** `false` makes the primary a plain button that emits `save` without submitting the form. */
  submit?: boolean;
  /** Replaces `<dataTest>-cancel` (create mode). */
  cancelDataTest?: string;
  /** Source of the counts and of submit; defaults to the enclosing `OForm`. */
  form?: OFormInstance;
  /** Overrides the derived count (fields that differ from the saved values) for pages with state outside the form. */
  changeCount?: number;
  /** Overrides the derived count of fields printing an error (a coupled group prints one). */
  errorCount?: number;
  /** `false` while the saved values are still loading: no counts, Save disabled. */
  loaded?: boolean;
  /** Defaults to the form's `isSubmitting`. */
  saving?: boolean;
  /** The bar's contents end at this width, the same scale as `OPageLayout`'s `contentSize`. */
  contentSize?: SaveBarContentSize;
  /** Parts get `-status`, `-fix`, `-discard` and `-save`. */
  dataTest?: string;
  /** Replaces `<dataTest>-save`, for a page whose Save button already has a selector. */
  saveDataTest?: string;
  /** Replaces `<dataTest>-discard`. */
  discardDataTest?: string;
  /** The `<form>`'s id when the bar renders outside it, so Enter in a field still reaches Save. */
  formId?: string;
}

export interface SaveBarEmits {
  /** A valid submit has run; pages normally use the form's `onSubmit` instead. */
  (e: "save"): void;
  /** The form has been reset to its last saved values. */
  (e: "discard"): void;
  /** Create mode: the user gave up the new record; the page decides whether to ask first. */
  (e: "cancel"): void;
}

export interface SaveBarSlots {
  /** Page actions that are not values, before the status. */
  start?: () => unknown;
  /** Buttons before Cancel or Discard, such as a step's Back. */
  actions?: () => unknown;
}
