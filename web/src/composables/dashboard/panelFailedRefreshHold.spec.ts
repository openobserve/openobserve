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

import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, reactive } from "vue";
import { mount } from "@vue/test-utils";
import {
  PANEL_FAILED_REFRESH_HOLD,
  useFailedRefreshHold,
  type FailedRefreshHoldHooks,
  type PanelFailedRefreshHold,
} from "./panelFailedRefreshHold";

const makeState = () =>
  reactive({
    data: [] as any,
    loading: false,
    errorDetail: { message: "", code: "" as string | number },
    metadata: { queries: [] as any[] },
    resultMetaData: [] as any,
    annotations: [] as any,
  });

type State = ReturnType<typeof makeState>;

let wrapper: any = null;
let hooks: FailedRefreshHoldHooks;
let source = "A";
let panel: { id: string; builtFrom?: string } = { id: "panel-1" };

const setup = (host: PanelFailedRefreshHold | null) => {
  const state = makeState();
  const Panel = defineComponent({
    setup() {
      hooks = useFailedRefreshHold(state, () => panel);
      return () => h("div");
    },
  });
  wrapper = mount(Panel, {
    global: { provide: host ? { [PANEL_FAILED_REFRESH_HOLD as symbol]: host } : {} },
  });
  return state;
};

// A host that, like the Traces page, keeps only a result of the source on screen now.
const sameSourceHost = () => {
  const hold = vi.fn((_id: string, from: string) => from === source);
  return { host: { source: () => source, hold }, hold };
};

// The loader's order: scheduled, started, loading on, chunks written into state.data, then the error, then loading off.
const start = (state: State) => {
  hooks.loadScheduled();
  hooks.loadStarted();
  state.loading = true;
  state.errorDetail = { message: "", code: "" };
};
const draw = (state: State, hits: any[]) => {
  start(state);
  state.data = [hits];
  state.metadata = { queries: [{ query: "q" }] };
  state.loading = false;
};
const failRefresh = (state: State, partial: any[] = []) => {
  start(state);
  state.data[0] = partial;
  state.errorDetail = { message: "Search failed", code: 500 };
  state.loading = false;
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  source = "A";
  panel = { id: "panel-1" };
});

describe("useFailedRefreshHold", () => {
  it("does nothing without a host, so a failed refresh shows its error as before", () => {
    const state = setup(null);
    draw(state, [{ n: 1 }]);
    failRefresh(state);

    expect(state.errorDetail.message).toBe("Search failed");
    expect(state.data).toEqual([[]]);
  });

  it("keeps the drawn result and hides the error when the host holds it", () => {
    const { host, hold } = sameSourceHost();
    const state = setup(host);
    draw(state, [{ n: 1 }]);
    failRefresh(state, [{ partial: true }]);

    expect(hold).toHaveBeenCalledWith("panel-1", "A");
    expect(state.errorDetail.message).toBe("");
    expect(state.data).toEqual([[{ n: 1 }]]);
    expect(state.metadata).toEqual({ queries: [{ query: "q" }] });
  });

  it("shows the error when the host declines", () => {
    const state = setup({ source: () => "A", hold: () => false });
    draw(state, [{ n: 1 }]);
    failRefresh(state);

    expect(state.errorDetail.message).toBe("Search failed");
  });

  it("shows the error with nothing drawn before, without asking the host", () => {
    const { host, hold } = sameSourceHost();
    const state = setup(host);
    failRefresh(state);

    expect(hold).not.toHaveBeenCalled();
    expect(state.errorDetail.message).toBe("Search failed");
  });

  it("keeps a chart restored from the panel cache on its first failed refresh", () => {
    const { host, hold } = sameSourceHost();
    const state = setup(host);
    hooks.loadScheduled();
    state.data = [[{ value: 42 }]];
    hooks.loadRestored();
    failRefresh(state);

    expect(hold).toHaveBeenCalledWith("panel-1", "A");
    expect(state.errorDetail.message).toBe("");
    expect(state.data).toEqual([[{ value: 42 }]]);
  });

  it("never keeps a cache-restored chart under another source", () => {
    const { host, hold } = sameSourceHost();
    const state = setup(host);
    hooks.loadScheduled();
    state.data = [[{ stream: "A" }]];
    hooks.loadRestored();
    source = "B";
    failRefresh(state);

    expect(hold).toHaveBeenCalledWith("panel-1", "A");
    expect(state.errorDetail.message).toBe("Search failed");
  });

  it("keeps the same drawn result through a second failed refresh", () => {
    const { host } = sameSourceHost();
    const state = setup(host);
    draw(state, [{ n: 1 }]);
    failRefresh(state);
    failRefresh(state);

    expect(state.errorDetail.message).toBe("");
    expect(state.data).toEqual([[{ n: 1 }]]);
  });

  it("never restores A's chart under B when B's re-run starts while its first load still runs", () => {
    const { host, hold } = sameSourceHost();
    const state = setup(host);
    draw(state, [{ stream: "A" }]);

    source = "B";
    start(state);
    // The rows of B land here while this panel still loads; then B is re-run and fails.
    start(state);
    state.errorDetail = { message: "Search failed", code: 500 };
    state.loading = false;

    expect(hold).toHaveBeenCalledWith("panel-1", "A");
    expect(state.errorDetail.message).toBe("Search failed");
  });

  it("never counts a superseded load's end as a drawn result of its source", () => {
    const { host, hold } = sameSourceHost();
    const state = setup(host);
    draw(state, [{ stream: "A" }]);

    source = "B";
    start(state);
    hooks.loadScheduled();
    // The superseded load stops without an answer while A's rows are still on screen.
    state.loading = false;
    hooks.loadStarted();
    state.loading = true;
    state.errorDetail = { message: "Search failed", code: 500 };
    state.loading = false;

    expect(hold).toHaveBeenCalledWith("panel-1", "A");
    expect(state.errorDetail.message).toBe("Search failed");
  });

  it("keeps B's own chart once B has drawn, after a switch back from A", () => {
    const { host, hold } = sameSourceHost();
    const state = setup(host);
    draw(state, [{ stream: "A" }]);
    source = "B";
    draw(state, [{ stream: "B" }]);
    failRefresh(state);

    expect(hold).toHaveBeenLastCalledWith("panel-1", "B");
    expect(state.errorDetail.message).toBe("");
    expect(state.data).toEqual([[{ stream: "B" }]]);
  });

  it("names a drawn result by the request that ran, not by what the page staged after it was scheduled", () => {
    const hold = vi.fn((_id: string, from: string) => from === source);
    const state = setup({ source: (built) => built.builtFrom, hold });
    panel = { id: "panel-1", builtFrom: "A" };

    hooks.loadScheduled();
    source = "B";
    hooks.loadStarted();
    state.loading = true;
    state.data = [[{ query: "A" }]];
    state.loading = false;

    panel = { id: "panel-1", builtFrom: "B" };
    failRefresh(state);

    expect(hold).toHaveBeenCalledWith("panel-1", "A");
    expect(state.errorDetail.message).toBe("Search failed");
  });

  it("keeps nothing after a failure it showed", () => {
    const hold = vi.fn((_id: string, from: string) => from === source && source !== "A");
    const state = setup({ source: () => source, hold });
    draw(state, [{ stream: "A" }]);
    failRefresh(state);
    expect(state.errorDetail.message).toBe("Search failed");

    hold.mockClear();
    failRefresh(state);
    expect(hold).not.toHaveBeenCalled();
    expect(state.errorDetail.message).toBe("Search failed");
  });
});
