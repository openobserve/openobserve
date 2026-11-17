// Copyright 2026 OpenObserve Inc.

// Which OCSF classes a stream carries, read from the data rather than the schema.

import { runSql } from "./useSecurityStreamPlans";
import { quoteIdent } from "@/utils/security/sql";

/** The OCSF class uids a stream carries over the window, most frequent first. */
export async function ocsfClassesIn(
  orgId: string,
  stream: string,
  column: string,
  startUs: number,
  endUs: number,
): Promise<number[]> {
  return (await ocsfClassCounts(orgId, stream, column, startUs, endUs)).map((c) => c.uid);
}

/** Rows per OCSF class uid over the window, most frequent first. */
export async function ocsfClassCounts(
  orgId: string,
  stream: string,
  column: string,
  startUs: number,
  endUs: number,
): Promise<{ uid: number; n: number }[]> {
  const col = quoteIdent(column);
  const { hits } = await runSql(
    orgId,
    `SELECT ${col} AS zo_class, COUNT(*) AS zo_n FROM ${quoteIdent(stream)} ` +
      `WHERE ${col} IS NOT NULL GROUP BY zo_class ORDER BY zo_n DESC LIMIT 50`,
    startUs,
    endUs,
  );
  return hits
    .map((h) => ({ uid: Number(h.zo_class), n: Number(h.zo_n) || 0 }))
    .filter((c) => Number.isInteger(c.uid) && c.uid > 0);
}
