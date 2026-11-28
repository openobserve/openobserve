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

import { beforeEach, describe, expect, it } from "vitest";

import {
  adoptPendingDismissal,
  clearPendingDismissal,
  digestDismissed,
  dismissDigest,
  joinTitles,
  packQuestion,
  packStarter,
  PACK_DIGEST_CHIP_ID,
  PENDING_DIGEST,
  resetDigestDismissalsForTests,
  starterWelcomeMode,
} from "./starterWelcome";

describe("starterWelcomeMode", () => {
  it("is starter only when the Home offer would show", () => {
    expect(starterWelcomeMode({ visible: true, showSection: true, loading: false })).toBe(
      "starter",
    );
    expect(starterWelcomeMode({ visible: true, showSection: false, loading: true })).toBe(
      "loading",
    );
    expect(starterWelcomeMode({ visible: true, showSection: false, loading: false })).toBe("none");
    expect(starterWelcomeMode({ visible: false, showSection: true, loading: true })).toBe("none");
  });

  it("asks an admin when packs fit but the user cannot set them up", () => {
    const state = { visible: true, showSection: false, loading: false, askAdmin: true };
    expect(starterWelcomeMode(state)).toBe("askAdmin");
    expect(starterWelcomeMode({ ...state, visible: false })).toBe("none");
  });
});

describe("joinTitles", () => {
  it("reads the titles as one list", () => {
    expect(String(joinTitles(["Kubernetes"]))).toBe("Kubernetes");
    expect(String(joinTitles(["Kubernetes", "NGINX"]))).toBe("Kubernetes and NGINX");
  });
});

describe("packStarter", () => {
  it("stages the pack question with the digest chip", () => {
    const starter = packStarter("Starter packs for your data: Kubernetes");
    expect(starter.kind).toBe("pack");
    expect(starter.prompt).toBe("Which starter packs fit my data, and what will each one create?");
    expect(starter.prompt).toBe(packQuestion());
    expect(starter.chips).toHaveLength(1);
    expect(starter.chips[0]).toMatchObject({
      id: PACK_DIGEST_CHIP_ID,
      kind: "pasted_text",
      data: "Starter packs for your data: Kubernetes",
    });
    expect(String(starter.chips[0].label)).toBe("Starter packs for your data");
    expect(String(starter.chips[0].short)).toBe("Starter packs");
  });
});

describe("digest dismissal", () => {
  beforeEach(() => resetDigestDismissalsForTests());

  it("keeps a removal to the chat it was made in", () => {
    dismissDigest("a");
    expect(digestDismissed("a")).toBe(true);
    expect(digestDismissed("b")).toBe(false);
  });

  it("moves a removal made before the chat existed to the chat that then starts", () => {
    dismissDigest(PENDING_DIGEST);
    adoptPendingDismissal("a");
    expect(digestDismissed("a")).toBe(true);
    expect(digestDismissed(PENDING_DIGEST)).toBe(false);
    adoptPendingDismissal("b");
    expect(digestDismissed("b")).toBe(false);
  });

  it("drops a removal that never got a chat", () => {
    dismissDigest(PENDING_DIGEST);
    clearPendingDismissal();
    expect(digestDismissed(PENDING_DIGEST)).toBe(false);
  });
});
