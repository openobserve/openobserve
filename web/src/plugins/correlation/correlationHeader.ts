import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { FieldAlias, ServiceIdentityConfig, StreamInfo } from "@/services/service_streams";
import { identityConfigQuery } from "@/services/service_streams.queries";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { SERVICE_GROUP_ID } from "./correlationVersions";

export interface CandidateMenu {
  shown: string[];
  more: number;
}

export interface HeaderVersionInput {
  ambiguous: boolean;
  instanceVersion: string | null;
  serviceVersion: string;
}

const MENU_CANDIDATES = 4;

function groupOf(key: string, groups: FieldAlias[]): FieldAlias | undefined {
  return groups.find((group) => group.id === key || group.fields.includes(key));
}

function groupId(key: string, groups: FieldAlias[]): string {
  return groupOf(key, groups)?.id ?? key;
}

function placeRank(key: string, groups: FieldAlias[], location: string[]): number {
  const rank = location.indexOf(groupId(key, groups));
  return rank >= 0 ? rank : location.length;
}

function isApplied(key: string, streams: StreamInfo[], groups: FieldAlias[]): boolean {
  const fields = new Set([key, ...(groupOf(key, groups)?.fields ?? [])]);
  return streams.some((stream) =>
    Object.entries(stream.filters ?? {}).some(
      ([field, value]) => fields.has(field) && !!value && value !== SELECT_ALL_VALUE,
    ),
  );
}

/** Where a service runs, widest first: the identity sets' `distinguish_by`, in config order. */
export function locationDimensions(config: ServiceIdentityConfig | undefined): string[] {
  const ids = (config?.sets ?? []).flatMap((set) => set.distinguish_by);
  return [...new Set(ids)].filter((id) => id !== SERVICE_GROUP_ID);
}

/** The org's location dimensions, from the identity config the correlate request already cached. */
export function useLocationDimensions(org: Ref<string>, enabled?: Ref<boolean>) {
  const config = useQuery(
    computed(() => ({
      ...identityConfigQuery(org.value),
      enabled: !!org.value && (enabled?.value ?? true),
    })),
  );
  return computed(() => locationDimensions(config.data.value));
}

/** The chip keys a tab's streams were really filtered by, location first; never the service, which the title names. */
export function correlatedByKeys(
  keys: string[],
  streams: StreamInfo[],
  groups: FieldAlias[],
  location: string[] = [],
): string[] {
  return keys
    .filter((key) => groupId(key, groups) !== SERVICE_GROUP_ID)
    .filter((key) => isApplied(key, streams, groups))
    .map((key, index) => ({ key, index, rank: placeRank(key, groups, location) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.key);
}

/** A chip's name as the org's semantic group reads it, so every alias of a dimension reads the same; null without a group. */
export function correlatedByLabel(key: string, groups: FieldAlias[]): string | null {
  return groupOf(key, groups)?.display || null;
}

/** The services an ambiguous name covers, as its menu lists them: the first four and a count of the rest, or all once expanded. */
export function candidateMenu(candidates: string[], expanded = false): CandidateMenu {
  const sorted = [...new Set(candidates)].sort();
  if (expanded) return { shown: sorted, more: 0 };
  return {
    shown: sorted.slice(0, MENU_CANDIDATES),
    more: Math.max(0, sorted.length - MENU_CANDIDATES),
  };
}

/** The header's one version: what the log's own instance runs, else the service's current one; none for an ambiguous name. */
export function headerVersion(input: HeaderVersionInput): string {
  if (input.ambiguous) return "";
  return input.instanceVersion || input.serviceVersion;
}

/** True when a Correlated by chip already shows this dimension's value, under any of its aliases. */
export function repeatsChip(
  chips: readonly { key: string; value: string }[] | undefined,
  key: string,
  value: string | undefined,
  groups: FieldAlias[],
): boolean {
  const id = groupId(key, groups);
  return (
    !!value && !!chips?.some((chip) => chip.value === value && groupId(chip.key, groups) === id)
  );
}
