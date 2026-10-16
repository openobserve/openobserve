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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import {
  clearExemplarOverride,
  exemplarOverrideKey,
  readExemplarOverride,
  useExemplarOverride,
} from "./useExemplarOverride";

let seq = 0;
const freshKey = () => exemplarOverrideKey("org1", "dash1", `panel${++seq}`);

describe("useExemplarOverride", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("keys by org, dashboard and panel", () => {
    expect(exemplarOverrideKey("org1", "dash1", "p1")).toBe("o2.exemplars.org1.dash1.p1");
  });

  it("falls back to the saved value, then off", () => {
    const saved = ref<boolean | undefined>(undefined);
    const { effective } = useExemplarOverride(ref(freshKey()), saved);
    expect(effective.value).toBe(false);
    saved.value = true;
    expect(effective.value).toBe(true);
  });

  it("lets the session override win over the saved value and persists it", () => {
    const key = freshKey();
    const { effective, set } = useExemplarOverride(ref(key), ref(true));
    set(false);
    expect(effective.value).toBe(false);
    expect(window.sessionStorage.getItem(key)).toBe("0");
  });

  it("reads an override stored earlier in the session, as after Back", () => {
    const key = freshKey();
    window.sessionStorage.setItem(key, "1");
    const { effective } = useExemplarOverride(ref(key), ref(false));
    expect(effective.value).toBe(true);
  });

  it("shares one override between two instances of the same panel", () => {
    const key = freshKey();
    const header = useExemplarOverride(ref(key), ref(false));
    const fullscreen = useExemplarOverride(ref(key), ref(false));
    fullscreen.set(true);
    expect(header.effective.value).toBe(true);
  });

  it("falls back to the saved value when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { effective } = useExemplarOverride(ref(freshKey()), ref(true));
    expect(effective.value).toBe(true);
  });

  it("reads storage at most once per untouched key", () => {
    const key = freshKey();
    const spy = vi.spyOn(Storage.prototype, "getItem");
    readExemplarOverride(key);
    readExemplarOverride(key);
    readExemplarOverride(key);
    expect(spy.mock.calls.filter((c) => c[0] === key)).toHaveLength(1);
  });

  it("clears an override so the saved value applies again", () => {
    const key = freshKey();
    const { effective, set } = useExemplarOverride(ref(key), ref(true));
    set(false);
    clearExemplarOverride(key);
    expect(readExemplarOverride(key)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(effective.value).toBe(true);
  });
});
