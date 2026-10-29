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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fleetMock } from "./fleet.mock";

const listed = async () => {
  const pending = fleetMock.listConfigs("default");
  await vi.runAllTimersAsync();
  return (await pending).data.items;
};

describe("fleet mock configurations", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("seeds a never-published draft, a published config with draft changes and one without", async () => {
    const items = await listed();
    const states = items.map((c) => ({
      published: c.latest_version > 0,
      draft: c.draft_at !== null,
    }));
    expect(states).toContainEqual({ published: false, draft: true });
    expect(states).toContainEqual({ published: true, draft: true });
    expect(states).toContainEqual({ published: true, draft: false });
  });

  it("publishing a version clears the config's draft", async () => {
    const drafted = (await listed()).find((c) => c.latest_version > 0 && c.draft_at !== null);
    expect(drafted).toBeDefined();

    const publish = fleetMock.publishConfigVersion("default", drafted!.id, {
      yaml: "receivers: {}\n",
      message: "Publish the draft",
    });
    await vi.runAllTimersAsync();
    expect((await publish).data.version).toBe(drafted!.latest_version + 1);

    const after = (await listed()).find((c) => c.id === drafted!.id);
    expect(after).toMatchObject({ latest_version: drafted!.latest_version + 1, draft_at: null });
  });
});
