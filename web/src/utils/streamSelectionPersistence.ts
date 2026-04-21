type StoreWithPersistFlag = {
  state?: {
    zoConfig?: {
      persist_last_selected_stream?: boolean;
    };
  };
};

export const STREAM_SELECTION_STORAGE_KEYS = {
  logs: "o2_last_stream_logs",
  metrics: "o2_last_stream_metrics",
  traces: "o2_last_stream_traces",
} as const;

export const isStreamSelectionPersistenceEnabled = (store: StoreWithPersistFlag) =>
  store?.state?.zoConfig?.persist_last_selected_stream === true;

export const getPersistedStreamSelection = (
  store: StoreWithPersistFlag,
  key: string,
) => {
  if (!isStreamSelectionPersistenceEnabled(store)) {
    return null;
  }
  return localStorage.getItem(key);
};

export const setPersistedStreamSelection = (
  store: StoreWithPersistFlag,
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
