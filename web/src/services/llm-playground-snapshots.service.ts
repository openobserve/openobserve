// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Playground snapshots — the only Playground endpoint that stores anything.
 *
 * Sharing writes the bench by value and hands back a short-link id. The stored
 * payload is kept verbatim, so the server neither owns nor validates most of
 * its shape; it only reads `columns` and `rows` to enforce the workbench limits
 * and to diff a snapshot against its parent.
 */

import http from "@/services/http";

export interface PlaygroundSnapshot {
  id: string;
  payload: unknown;
  /** The snapshot this one was forked from. Lineage is a weak reference — the
   *  parent may already have been purged. */
  parentSnapshotId: string | null;
  createdBy: string;
  createdAt: number;
}

const base = (org: string) => `/api/${org}/playground/snapshots`;

function normalize(d: any): PlaygroundSnapshot {
  return {
    id: String(d?.id ?? ""),
    payload: d?.payload ?? null,
    parentSnapshotId: d?.parentSnapshotId ?? d?.parent_snapshot_id ?? null,
    createdBy: d?.createdBy ?? d?.created_by ?? "",
    createdAt: Number(d?.createdAt ?? d?.created_at ?? 0),
  };
}

const llmPlaygroundSnapshotsService = {
  /** The request body rejects unknown fields, so nothing else may be sent. */
  async share(
    orgId: string,
    payload: unknown,
    parentSnapshotId: string | null = null,
  ): Promise<PlaygroundSnapshot> {
    const res = await http().post(base(orgId), {
      payload,
      ...(parentSnapshotId ? { parentSnapshotId } : {}),
    });
    return normalize(res.data);
  },

  async get(orgId: string, snapshotId: string): Promise<PlaygroundSnapshot> {
    const res = await http().get(`${base(orgId)}/${snapshotId}`);
    return normalize(res.data);
  },
};

export default llmPlaygroundSnapshotsService;
