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
import { describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";

import { useReaderSession, type ReaderSessionDeps } from "./useReaderSession";

function setup(over: Partial<ReaderSessionDeps> = {}) {
  let stored = "ada@example.com";
  const deps: ReaderSessionDeps = {
    storeEmail: () => "",
    storedEmail: () => stored,
    verify: vi.fn(async () => true),
    ...over,
  };
  const scope = effectScope();
  const { email, checking } = scope.run(() => useReaderSession(deps))!;
  return { email, checking, deps, scope, setStored: (value: string) => (stored = value) };
}

describe("useReaderSession", () => {
  it("never reads stale stored user info as signed in", async () => {
    const { email, deps } = setup({ verify: vi.fn(async () => false) });
    expect(email.value).toBe("");
    await flushPromises();
    expect(deps.verify).toHaveBeenCalledTimes(1);
    expect(email.value).toBe("");
  });

  it("says it is still checking until the session probe settles, also when the probe throws", async () => {
    const alive = setup();
    expect(alive.checking.value).toBe(true);
    await flushPromises();
    expect(alive.checking.value).toBe(false);
    const broken = setup({ verify: vi.fn(async () => Promise.reject(new Error("offline"))) });
    expect(broken.checking.value).toBe(true);
    await flushPromises();
    expect(broken.checking.value).toBe(false);
    expect(broken.email.value).toBe("");
    const known = setup({ storeEmail: () => "ada@example.com" });
    expect(known.checking.value).toBe(false);
    const none = setup({ storedEmail: () => "" });
    expect(none.checking.value).toBe(false);
  });

  it("reads the stored email once the server confirms the session", async () => {
    const { email } = setup();
    expect(email.value).toBe("");
    await flushPromises();
    expect(email.value).toBe("ada@example.com");
  });

  it("signs the page out when another tab signs out", async () => {
    const { email, setStored, scope } = setup();
    await flushPromises();
    setStored("");
    window.dispatchEvent(new StorageEvent("storage"));
    expect(email.value).toBe("");
    scope.stop();
  });

  it("takes the store's user without asking the server", async () => {
    const { email, deps } = setup({ storeEmail: () => "bo@example.com" });
    await flushPromises();
    expect(email.value).toBe("bo@example.com");
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it("stops listening once its scope ends", async () => {
    const { email, setStored, scope } = setup();
    await flushPromises();
    scope.stop();
    setStored("");
    window.dispatchEvent(new StorageEvent("storage"));
    expect(email.value).toBe("ada@example.com");
  });
});
