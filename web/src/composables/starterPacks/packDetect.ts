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

import type { StreamsByType } from "@/types/alertLibrary";
import { DETECTION_STREAMS } from "@/views/Infrastructure/kubernetes2/kubernetesQueries";

import type { PackDetectStream, StarterPack } from "./types";

export type ReadColumns = (type: string, name: string) => Promise<string[]>;

const hasFields = async (
  type: string,
  name: string,
  fields: string[],
  readColumns: ReadColumns,
): Promise<boolean> => {
  try {
    const columns = new Set((await readColumns(type, name)).map((column) => column.toLowerCase()));
    return fields.every((field) => columns.has(field.toLowerCase()));
  } catch {
    return false;
  }
};

const matchingStreams = async (
  rule: PackDetectStream,
  orgStreams: StreamsByType,
  readColumns: ReadColumns,
): Promise<string[]> => {
  const names = [...(orgStreams[rule.type]?.keys() ?? [])].filter(
    (name) => !rule.name || name === rule.name,
  );
  if (!rule.fields?.length) return names;
  const fits = await Promise.all(
    names.map((name) => hasFields(rule.type, name, rule.fields!, readColumns)),
  );
  return names.filter((_name, index) => fits[index]);
};

/** The org streams that show the pack's source is reporting; none means the pack cannot fit. */
export const detectedStreams = async (
  pack: StarterPack,
  orgStreams: StreamsByType,
  readColumns: ReadColumns,
): Promise<string[]> => {
  const metrics = orgStreams.metrics ?? new Map<string, number>();
  const found = [
    ...(pack.signals ?? []).flat().filter((name) => metrics.has(name)),
    ...(pack.detector === "kubernetes"
      ? DETECTION_STREAMS.filter((name) => metrics.has(name))
      : []),
  ];
  for (const rule of pack.detectStreams ?? []) {
    found.push(...(await matchingStreams(rule, orgStreams, readColumns)));
  }
  return [...new Set(found)];
};
