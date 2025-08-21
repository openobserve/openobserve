// Shared utilities for Panel Data Loader

export const PANEL_DATA_LOADER_DEBOUNCE_TIME = 50;

export const adjustTimestampByTimeRangeGap = (
  timestamp: number,
  timeRangeGapSeconds: number,
) => {
  return timestamp - timeRangeGapSeconds * 1000;
};

export const waitForTimeout = (signal: AbortSignal) => {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(resolve, PANEL_DATA_LOADER_DEBOUNCE_TIME);

    signal.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(new Error("Aborted waiting for loading"));
    });
  });
};

export const callWithAbortController = async <T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const result = fn();

    signal.addEventListener("abort", () => {
      reject();
    });

    result
      .then((res) => {
        resolve(res);
      })
      .catch((error) => {
        reject(error);
      });
  });
};

export const areArraysEqual = (array1: any[], array2: any[]) => {
  if (array1?.length !== array2?.length) {
    return false;
  }

  const sortedArray1 = array1?.slice()?.sort();
  const sortedArray2 = array2?.slice()?.sort();

  for (let i = 0; i < sortedArray1?.length; i++) {
    if (sortedArray1[i] !== sortedArray2[i]) {
      return false;
    }
  }

  return true;
};
