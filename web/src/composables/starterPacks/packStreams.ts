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

import type { PackRepair, StarterPack } from "./types";

export interface PackStream {
  name: string;
  /** Stream type; empty when only a dashboard names it. */
  type: string;
  /** The signal this stream spells, keyed by its first spelling; a source sends only some spellings. */
  signal?: string;
}

export interface PackStreamSources {
  /** Flavours the install or preview matched; none means the library's own streams. */
  flavourIds?: string[];
  /** Library ids of the alerts the install made or the preview plans; absent means all. */
  alertIds?: string[];
  /** Streams the installed alerts read, which a repair may have moved. */
  alertStreams?: PackStream[];
  /** Streams the pack's dashboards query. */
  dashboardStreams?: string[];
  repairs?: PackRepair[];
}

const flavourStreams = (pack: StarterPack, flavourIds: string[], alertIds?: string[]) => {
  const wanted = (id: string) => !alertIds || alertIds.includes(id);
  const matched = (pack.flavours ?? []).filter(({ id }) => flavourIds.includes(id));
  if (matched.length) {
    return matched.flatMap(({ alerts }) =>
      Object.entries(alerts)
        .filter(([id]) => wanted(id))
        .flatMap(([, { streams }]) => streams.map((name) => ({ name, type: "metrics" }))),
    );
  }
  return (pack.bundledAlerts ?? [])
    .filter(({ entry }) => wanted(entry.id))
    .flatMap(({ entry }) =>
      (entry.required_streams.length ? entry.required_streams : [entry.stream]).map((name) => ({
        name,
        type: entry.stream_type,
      })),
    );
};

const viewStreams = (pack: StarterPack): PackStream[] =>
  pack.savedViews.flatMap(({ search }) => {
    const stream = search?.data?.stream;
    const names: string[] = stream?.selectedStream ?? [];
    return names.map((name) => ({ name, type: String(stream?.streamType ?? "logs") }));
  });

const repaired = (stream: PackStream, repairs: PackRepair[]): PackStream[] => {
  const repair = repairs.find(({ from }) => from === stream.name);
  if (!repair) return [stream];
  return [repair.to, ...(repair.also ?? [])].map((name) => ({ ...stream, name }));
};

/** Every stream a pack reads, from its definition rather than its alert rows, so a pack with no alerts still has health. */
export const packStreams = (pack: StarterPack, sources: PackStreamSources = {}): PackStream[] => {
  const all: PackStream[] = [
    ...flavourStreams(pack, sources.flavourIds ?? [], sources.alertIds),
    ...(sources.alertStreams ?? []),
    ...(pack.roles ?? []).map(({ stream }) => ({ name: stream, type: "logs" })),
    ...viewStreams(pack),
    ...(pack.signals ?? []).flatMap((spellings) =>
      spellings.map((name) => ({ name, type: "metrics", signal: spellings[0] })),
    ),
    ...(sources.dashboardStreams ?? []).map((name) => ({ name, type: "" })),
  ].flatMap((stream) => repaired(stream, sources.repairs ?? []));
  const byName = new Map<string, PackStream>();
  for (const stream of all) {
    const known = byName.get(stream.name);
    // A typed or non-signal mention says more than an untyped dashboard one or an optional signal.
    if (!known) byName.set(stream.name, stream);
    else
      byName.set(stream.name, {
        name: stream.name,
        type: known.type || stream.type,
        ...(known.signal && stream.signal ? { signal: known.signal } : {}),
      });
  }
  return [...byName.values()];
};
