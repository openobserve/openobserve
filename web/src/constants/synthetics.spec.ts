// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import type { StepAction } from "@/types/synthetics";
import {
  ACTION_ICONS,
  ACTION_LABELS,
  RETIRED_ACTIONS,
  actionOptions,
  isRetiredAction,
} from "./synthetics";

describe("synthetics action vocabulary", () => {
  // Spec X-9 / T1-9. Upstream Playwright's recorder action model (ActionName in
  // @recorder/actions) has no hover/scroll/wait/screenshot, so the recorder has
  // never emitted one and the player has never been able to replay one. They
  // entered journeys only through this picker — and the moment an author used
  // one, replay aborted before step 1.
  it("does not offer retired actions in the step picker", () => {
    const offered = actionOptions.map((o) => o.value);
    for (const retired of RETIRED_ACTIONS) {
      expect(offered).not.toContain(retired);
    }
  });

  it("offers exactly the actions the player and probe can both execute", () => {
    expect(actionOptions.map((o) => o.value).sort()).toEqual(
      ["assert", "click", "navigate", "press", "select", "type"].sort(),
    );
  });

  // Retired actions must still RENDER: stored monitors contain them (all five
  // production monitors carry a legacy `wait`) and keep executing until
  // migrated. Dropping their label/icon would break the editor for those.
  it("still renders retired actions so existing monitors display correctly", () => {
    for (const retired of RETIRED_ACTIONS) {
      expect(ACTION_LABELS[retired]).toBeTruthy();
      expect(ACTION_ICONS[retired]).toBeTruthy();
    }
  });

  it("identifies retired actions", () => {
    expect(isRetiredAction("wait")).toBe(true);
    expect(isRetiredAction("hover")).toBe(true);
    expect(isRetiredAction("scroll")).toBe(true);
    expect(isRetiredAction("screenshot")).toBe(true);
    expect(isRetiredAction("click")).toBe(false);
    expect(isRetiredAction("navigate")).toBe(false);
  });

  it("every offered action has a label and an icon", () => {
    for (const { value } of actionOptions) {
      expect(ACTION_LABELS[value as StepAction]).toBeTruthy();
      expect(ACTION_ICONS[value as StepAction]).toBeTruthy();
    }
  });
});
