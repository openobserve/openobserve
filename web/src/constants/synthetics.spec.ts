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

import { describe, expect, it } from "vitest";
import type { StepAction } from "@/types/synthetics";
import type { I18nKey, TranslateFn } from "@/types/i18n";
import {
  ACTION_ICONS,
  ACTION_LABEL_KEYS,
  RETIRED_ACTIONS,
  actionOptions,
  isRetiredAction,
} from "./synthetics";

// Identity stub: these assertions are about the action vocabulary, not the wording.
const tStub = ((key: I18nKey) => key) as unknown as TranslateFn;

describe("synthetics action vocabulary", () => {
  // Spec X-9 / T1-9. Upstream Playwright's recorder action model has no
  // scroll/wait/screenshot, so the recorder has never emitted one and the player
  // has never been able to replay one. They entered journeys only through this
  // picker — and the moment an author used one, replay aborted before step 1.
  //
  // `hover` used to be on that list. Playwright 1.56 added a hover action to the
  // recorder model, reachable from the action picker, so it is now captured,
  // stored and executed like any other — see V2_STEP_ACTIONS in synthetics.rs.
  it("does not offer retired actions in the step picker", () => {
    const offered = actionOptions(tStub).map((o) => o.value);
    for (const retired of RETIRED_ACTIONS) {
      expect(offered).not.toContain(retired);
    }
  });

  // The picker offers the version-2 vocabulary, which is exactly Playwright's
  // recorder action model minus what a monitor cannot use. `check`/`uncheck`
  // joined it when the recorder stopped collapsing a checkbox interaction to a
  // click (X-9.3), and `upload` when a file input stopped being surfaced as a
  // `type` step.
  it("offers exactly the actions the player and probe can both execute", () => {
    expect(
      actionOptions(tStub)
        .map((o) => o.value)
        .sort(),
    ).toEqual(
      [
        "assert",
        "check",
        "click",
        "hover",
        "navigate",
        "press",
        "select",
        "type",
        "uncheck",
        "upload",
      ].sort(),
    );
  });

  // Retired actions must still RENDER: stored monitors contain them (all five
  // production monitors carry a legacy `wait`) and keep executing until
  // migrated. Dropping their label/icon would break the editor for those.
  it("still renders retired actions so existing monitors display correctly", () => {
    for (const retired of RETIRED_ACTIONS) {
      expect(ACTION_LABEL_KEYS[retired]).toBeTruthy();
      expect(ACTION_ICONS[retired]).toBeTruthy();
    }
  });

  it("identifies retired actions", () => {
    expect(isRetiredAction("wait")).toBe(true);
    expect(isRetiredAction("scroll")).toBe(true);
    expect(isRetiredAction("screenshot")).toBe(true);
    expect(isRetiredAction("click")).toBe(false);
    expect(isRetiredAction("navigate")).toBe(false);
    // Un-retired in 1.56, when upstream gave the recorder a hover action.
    expect(isRetiredAction("hover")).toBe(false);
  });

  it("every offered action has a label and an icon", () => {
    for (const { value } of actionOptions(tStub)) {
      expect(ACTION_LABEL_KEYS[value as StepAction]).toBeTruthy();
      expect(ACTION_ICONS[value as StepAction]).toBeTruthy();
    }
  });
});
