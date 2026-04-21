export const STREAM_SELECTION_STORAGE_KEYS = {
  logs: "o2_last_stream_logs",
  metrics: "o2_last_stream_metrics",
  traces: "o2_last_stream_traces",
} as const;

export const isStreamSelectionPersistenceEnabled = (store: any) =>
  store?.state?.zoConfig?.persist_last_selected_stream === true;

export const getPersistedStreamSelection = (store: any, key: string) => {
  if (!isStreamSelectionPersistenceEnabled(store)) {
    return null;
  }
  return localStorage.getItem(key);
};

export const setPersistedStreamSelection = (
  store: any,
  key: string,
  value?: string | null,
) => {
  if (!isStreamSelectionPersistenceEnabled(store)) {
    return;
  }
  if (!value) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, value);
};
