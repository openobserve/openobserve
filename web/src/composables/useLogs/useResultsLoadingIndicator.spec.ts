//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive, ref } from "vue";
import {
  MIB_IN_BYTES,
  RESULTS_LOADER_DELAY_MS,
  formatScannedSize,
  scanSizeMibToBytes,
  useDelayedFlag,
  useResultsLoadingIndicator,
} from "./useResultsLoadingIndicator";

describe("scanSizeMibToBytes", () => {
  it("converts MiB to bytes with a 1024 * 1024 factor", () => {
    expect(MIB_IN_BYTES).toBe(1_048_576);
    expect(scanSizeMibToBytes(1)).toBe(1_048_576);
    expect(scanSizeMibToBytes(0.5)).toBe(524_288);
    expect(scanSizeMibToBytes(1024)).toBe(1_073_741_824);
  });

  it("returns 0 for missing, negative or non-numeric sizes", () => {
    expect(scanSizeMibToBytes(undefined)).toBe(0);
    expect(scanSizeMibToBytes(null)).toBe(0);
    expect(scanSizeMibToBytes(-3)).toBe(0);
    expect(scanSizeMibToBytes("abc")).toBe(0);
  });
});

describe("formatScannedSize", () => {
  it("formats a MiB scan size in binary byte units", () => {
    expect(formatScannedSize(1)).toBe("1.00 MB");
    expect(formatScannedSize(1536)).toBe("1.50 GB");
    expect(formatScannedSize(0.5)).toBe("512.00 KB");
  });

  it("returns null when nothing has been scanned", () => {
    expect(formatScannedSize(0)).toBeNull();
    expect(formatScannedSize(undefined)).toBeNull();
  });
});

describe("useDelayedFlag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = (source: ReturnType<typeof ref<boolean>>) => {
    const scope = effectScope();
    const flag = scope.run(() => useDelayedFlag(() => !!source.value))!;
    return { flag, scope };
  };

  it("stays off for a query that settles inside the delay", async () => {
    const loading = ref(false);
    const { flag, scope } = run(loading);
    loading.value = true;
    await nextTick();
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS - 1);
    expect(flag.value).toBe(false);
    loading.value = false;
    await nextTick();
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS);
    expect(flag.value).toBe(false);
    scope.stop();
  });

  it("turns on once the source has stayed true for the delay", async () => {
    const loading = ref(false);
    const { flag, scope } = run(loading);
    loading.value = true;
    await nextTick();
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS);
    expect(flag.value).toBe(true);
    scope.stop();
  });

  it("turns off at once when the source turns off", async () => {
    const loading = ref(true);
    const { flag, scope } = run(loading);
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS);
    expect(flag.value).toBe(true);
    loading.value = false;
    await nextTick();
    expect(flag.value).toBe(false);
    scope.stop();
  });

  it("drops a pending timer when its scope is disposed", async () => {
    const loading = ref(true);
    const { flag, scope } = run(loading);
    scope.stop();
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS);
    expect(flag.value).toBe(false);
  });
});

describe("useResultsLoadingIndicator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const searchObj = reactive({
      loading: false,
      data: { queryResults: { scan_size: 300 } as { scan_size?: number } | null },
    });
    const scope = effectScope();
    const indicator = scope.run(() => useResultsLoadingIndicator(searchObj))!;
    return { searchObj, scope, ...indicator };
  };

  it("shows the size scanned by a fresh run once the delay has passed", async () => {
    const { searchObj, scope, showLoader, scannedSize } = setup();
    searchObj.loading = true;
    await nextTick();
    searchObj.data.queryResults = {};
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS);
    expect(showLoader.value).toBe(true);
    expect(scannedSize.value).toBeNull();
    searchObj.data.queryResults = { scan_size: 1024 };
    expect(scannedSize.value).toBe("1.00 GB");
    scope.stop();
  });

  it("hides the scanned size before the delay and after the run", async () => {
    const { searchObj, scope, scannedSize } = setup();
    searchObj.loading = true;
    await nextTick();
    searchObj.data.queryResults = { scan_size: 10 };
    expect(scannedSize.value).toBeNull();
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS);
    expect(scannedSize.value).toBe("10.00 MB");
    searchObj.loading = false;
    await nextTick();
    expect(scannedSize.value).toBeNull();
    scope.stop();
  });

  it("keeps the scanned size up while the given busy source outlasts loading", async () => {
    const searchObj = reactive({
      loading: false,
      data: { queryResults: { scan_size: 300 } as { scan_size?: number } | null },
    });
    const busy = ref(false);
    const scope = effectScope();
    const { showLoader, scannedSize } = scope.run(() =>
      useResultsLoadingIndicator(searchObj, () => searchObj.loading || busy.value),
    )!;
    searchObj.loading = true;
    busy.value = true;
    await nextTick();
    searchObj.data.queryResults = { scan_size: 10 };
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS);
    expect(scannedSize.value).toBe("10.00 MB");
    searchObj.loading = false;
    await nextTick();
    expect(showLoader.value).toBe(true);
    expect(scannedSize.value).toBe("10.00 MB");
    busy.value = false;
    await nextTick();
    expect(showLoader.value).toBe(false);
    expect(scannedSize.value).toBeNull();
    scope.stop();
  });

  it("never shows the previous run's size while a page load mutates results in place", async () => {
    const { searchObj, scope, showLoader, scannedSize } = setup();
    searchObj.loading = true;
    await nextTick();
    vi.advanceTimersByTime(RESULTS_LOADER_DELAY_MS);
    expect(showLoader.value).toBe(true);
    expect(scannedSize.value).toBeNull();
    searchObj.data.queryResults!.scan_size = 20;
    expect(scannedSize.value).toBeNull();
    scope.stop();
  });
});
