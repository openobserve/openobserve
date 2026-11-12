// Copyright 2026 OpenObserve Inc.

import { dump } from "js-yaml";

// Server-managed noise a reader never wants first; the object is shown as observed otherwise.
const HIDDEN_METADATA = ["managedFields"];

export function toYaml(object: { metadata: any; spec: any; status: any } & { kind?: string }) {
  const metadata = { ...object.metadata };
  for (const key of HIDDEN_METADATA) delete metadata[key];
  return dump(
    {
      ...(object.kind ? { kind: object.kind } : {}),
      metadata,
      spec: object.spec,
      status: object.status,
    },
    { lineWidth: -1, noRefs: true, skipInvalid: true },
  );
}
