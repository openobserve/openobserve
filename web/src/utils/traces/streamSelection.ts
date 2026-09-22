// Copyright 2026 OpenObserve Inc.

export interface TraceStreamSelectionItem {
  name: string;
  stats?: {
    doc_time_max?: number | string | null;
  };
}

export function resolveTraceStream(
  streams: TraceStreamSelectionItem[],
  preferredStreams: Array<string | null | undefined> = [],
): string {
  if (!streams.length) return "";

  const availableNames = new Set(streams.map((stream) => stream.name));
  const preferredStream = preferredStreams.find((stream): stream is string =>
    Boolean(stream && availableNames.has(stream)),
  );
  if (preferredStream) return preferredStream;

  if (availableNames.has("default")) return "default";

  let latestStream = streams[0];
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  let foundTimestamp = false;

  for (const stream of streams) {
    const rawTimestamp = stream.stats?.doc_time_max;
    const timestamp = rawTimestamp == null ? Number.NaN : Number(rawTimestamp);
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestStream = stream;
      latestTimestamp = timestamp;
      foundTimestamp = true;
    }
  }

  return foundTimestamp ? latestStream.name : streams[0].name;
}
