// Copyright 2026 OpenObserve Inc.
import { getServiceColorHex } from "@/utils/traces/traceColors";

const registry = new Map<string, string>();

export function getOrSetServiceColor(name: string): string {
  if (!name) return getServiceColorHex("");
  if (!registry.has(name)) {
    registry.set(name, getServiceColorHex(name));
  }
  return registry.get(name)!;
}

export function clearServiceColorRegistry(): void {
  registry.clear();
}
