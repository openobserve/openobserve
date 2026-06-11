// Copyright 2026 OpenObserve Inc.
import { getSpanColorHex } from "@/utils/traces/traceColors";

const registry = new Map<string, string>();

export function getOrSetServiceColor(name: string): string {
  if (!name) return getSpanColorHex(0);
  if (!registry.has(name)) {
    registry.set(name, getSpanColorHex(registry.size));
  }
  return registry.get(name)!;
}

export function clearServiceColorRegistry(): void {
  registry.clear();
}
