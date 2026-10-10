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

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeDrawerForQuery,
  drawerCloseExemptions,
  failPendingPageNavigation,
  nextJobRequestId,
  notePageCancelled,
  notePageLoad,
  notePageRequest,
  notePageRetry,
  notifyHitsComplete,
  onHitsComplete,
  resetRowSelection,
  setPageNavFailureHandler,
  type RowNavSearchObj,
} from "@/composables/useLogs/logsRowNav";

const makeSearchObj = (): RowNavSearchObj => ({
  meta: {
    showDetailTab: true,
    resultGrid: {
      navigation: { currentRowIndex: 4, selectionActive: true, pendingPageSelection: null },
    },
  },
  data: { resultGrid: { pageRequest: null, pageLoad: null } },
});

describe("logsRowNav drawer-close rule and crossing signals (4a §3.2.2, §3.2.7)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a pagination query keeps the drawer open only while a crossing is pending", () => {
    const obj = makeSearchObj();
    closeDrawerForQuery(obj, true);
    expect(obj.meta.showDetailTab).toBe(false);

    obj.meta.showDetailTab = true;
    obj.meta.resultGrid!.navigation!.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: null,
    };
    closeDrawerForQuery(obj, true);
    expect(obj.meta.showDetailTab).toBe(true);
    closeDrawerForQuery(obj, false);
    expect(obj.meta.showDetailTab).toBe(false);
  });

  it("another origin can exempt itself without touching the 4a entry", () => {
    const obj = makeSearchObj();
    const permalink = () => true;
    drawerCloseExemptions.push(permalink);
    try {
      closeDrawerForQuery(obj, false);
      expect(obj.meta.showDetailTab).toBe(true);
    } finally {
      drawerCloseExemptions.splice(drawerCloseExemptions.indexOf(permalink), 1);
    }
  });

  it("resetRowSelection drops the anchor, the highlight and a pending crossing", () => {
    const obj = makeSearchObj();
    obj.meta.resultGrid!.navigation!.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: "t1",
    };
    resetRowSelection(obj);
    expect(obj.meta.resultGrid!.navigation).toEqual({
      currentRowIndex: null,
      selectionActive: false,
      pendingPageSelection: null,
    });
  });

  it("binds a crossing to its request and records the request's own outcome", () => {
    const obj = makeSearchObj();
    obj.meta.resultGrid!.navigation!.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: null,
    };
    notePageRequest(obj, "t1");
    expect(obj.meta.resultGrid!.navigation!.pendingPageSelection?.requestId).toBe("t1");
    notePageLoad(obj, "t1", "error");
    expect(obj.data.resultGrid!.pageLoad).toEqual({ requestId: "t1", ok: false, reason: "error" });
  });

  it("marks only the bound request cancelled when its generation is torn down", () => {
    const obj = makeSearchObj();
    notePageRequest(obj, "t1");
    notePageCancelled(obj, "other");
    expect(obj.data.resultGrid!.pageLoad).toBeNull();
    notePageCancelled(obj, "t1");
    expect(obj.data.resultGrid!.pageLoad).toEqual({
      requestId: "t1",
      ok: false,
      reason: "cancelled",
    });
  });

  it("a cancel after completion does not overwrite the completion", () => {
    const obj = makeSearchObj();
    notePageRequest(obj, "t1");
    notePageLoad(obj, "t1", "done");
    notePageCancelled(obj, "t1");
    expect(obj.data.resultGrid!.pageLoad?.reason).toBe("done");
  });

  it("a retry rebinds the crossing to the new request", () => {
    const obj = makeSearchObj();
    obj.meta.resultGrid!.navigation!.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: "t1",
    };
    notePageRetry(obj, "t1");
    notePageRequest(obj, "t2");
    expect(obj.meta.resultGrid!.navigation!.pendingPageSelection?.requestId).toBe("t2");
  });

  it("hands a failed crossing to the drawer's handler, or clears it when none is installed", () => {
    const obj = makeSearchObj();
    obj.meta.resultGrid!.navigation!.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: null,
    };
    const handler = vi.fn();
    const dispose = setPageNavFailureHandler(handler);
    failPendingPageNavigation(obj, { quiet: true });
    expect(handler).toHaveBeenCalledWith({ quiet: true });

    dispose();
    failPendingPageNavigation(obj);
    expect(obj.meta.resultGrid!.navigation!.pendingPageSelection).toBeNull();
    expect(obj.meta.showDetailTab).toBe(false);
  });

  it("a stale disposer never removes a newer handler", () => {
    const obj = makeSearchObj();
    obj.meta.resultGrid!.navigation!.pendingPageSelection = {
      page: 2,
      position: "first",
      requestId: null,
    };
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = setPageNavFailureHandler(first);
    const disposeSecond = setPageNavFailureHandler(second);
    disposeFirst();
    failPendingPageNavigation(obj);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    disposeSecond();
  });

  it("does nothing when no crossing is pending", () => {
    const obj = makeSearchObj();
    const handler = vi.fn();
    const dispose = setPageNavFailureHandler(handler);
    failPendingPageNavigation(obj);
    expect(handler).not.toHaveBeenCalled();
    expect(obj.meta.showDetailTab).toBe(true);
    dispose();
  });

  it("tolerates a partial searchObj inside a search callback", () => {
    const partial = { meta: { showDetailTab: false }, data: {} } as RowNavSearchObj;
    expect(() => {
      notePageRequest(partial, "t1");
      notePageLoad(partial, "t1", "done");
      notePageCancelled(partial, "t1");
      resetRowSelection(partial);
      failPendingPageNavigation(partial);
      closeDrawerForQuery(partial, true);
    }).not.toThrow();
  });

  it("notifies hits-complete listeners and isolates a failing one", () => {
    const seen = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stopBad = onHitsComplete(() => {
      throw new Error("listener");
    });
    const stop = onHitsComplete(seen);
    notifyHitsComplete({ traceId: "t1", type: "search" });
    expect(seen).toHaveBeenCalledWith({ traceId: "t1", type: "search" });
    stop();
    stopBad();
    notifyHitsComplete({ traceId: "t2", type: "search" });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("job page requests get distinct ids", () => {
    expect(nextJobRequestId()).not.toBe(nextJobRequestId());
  });
});
