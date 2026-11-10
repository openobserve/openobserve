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

import { describe, expect, it } from "vitest";
import "@/locales";
import { gt } from "@/types/i18n";
import type { AutoObserveIncidentItem, AutoObservePage } from "@/services/autoobserve";
import { pagedFindingCopy } from "./kindCopy";

const zone = { locale: "en-US", timeZone: "UTC" };
const SEEN_US = Date.UTC(2026, 10, 9, 9, 12) * 1000;
const NOW_MS = Date.UTC(2026, 10, 9, 9, 30);

const member = (n: number) => ({
  id: `f-${n}`,
  title: `ingest_${n} (logs) stopped sending data`,
  stream_type: "logs",
  stream_name: `ingest_${n}`,
  first_seen_at: SEEN_US,
  recovered_at: null,
});

const item = (
  over: { kind?: string; page?: AutoObservePage; members?: number } = {},
): AutoObserveIncidentItem => ({
  finding: {
    id: "f-1",
    kind: over.kind ?? "stream_silence",
    stream_type: "logs",
    stream_name: "ingest_a",
    first_seen_at: SEEN_US,
  },
  incident: {
    id: "inc-1",
    status: "open",
    severity: "P2",
    title: "ingest_a (logs) stopped sending data",
    created_at: SEEN_US,
  },
  investigation: { run_id: null, state: null, outcome: null, summary: null, not_run_reason: null },
  ...(over.page ? { page: over.page } : {}),
  ...(over.members
    ? { members: Array.from({ length: over.members }, (_, i) => member(i + 1)) }
    : {}),
});

const page = (outcome: AutoObservePage["outcome"], team_name: string | null = null) => ({
  outcome,
  team_id: team_name ? "team-1" : null,
  team_name,
});

const copy = (i: AutoObserveIncidentItem) => pagedFindingCopy(gt, zone, i, NOW_MS);

describe("pagedFindingCopy (W2)", () => {
  it("paged names the team, neutral", () => {
    const c = copy(item({ page: page("paged", "SRE") }));
    expect(c.page).toEqual({ tone: "neutral", text: "Paged SRE", routing: false });
  });

  it("paged without a team name still claims no specific team", () => {
    const c = copy(item({ page: page("paged") }));
    expect(c.page?.text).toBe("Paged the on-call team");
  });

  it("unrouted is amber, says why, and offers routing", () => {
    const c = copy(item({ page: page("unrouted") }));
    expect(c.page).toEqual({
      tone: "warning",
      text: "Nobody was paged: when it stopped, no on-call team owned this service and the org had no default team.",
      routing: true,
    });
    expect(c.next).toContain("Set up on-call routing so the next stop pages someone.");
  });

  it("failed is red with the one fixed reason", () => {
    const c = copy(item({ page: page("failed", "SRE") }));
    expect(c.page?.tone).toBe("error");
    expect(c.page?.text).toBe(
      "Paging failed: the on-call service did not accept the page. Open the incident to page someone by hand.",
    );
    expect(c.page?.routing).toBe(false);
  });

  it("an absent page makes no claim", () => {
    expect(copy(item()).page).toBeNull();
  });

  it("an unknown outcome makes no claim and shows no raw value", () => {
    const c = copy(item({ page: { outcome: "weird" as never, team_id: null, team_name: null } }));
    expect(c.page).toBeNull();
  });

  it("one stopped stream: why names the stream and time, next says what to check", () => {
    const c = copy(item());
    expect(c.headline).toBeNull();
    expect(c.why).toBe("No data has arrived on ingest_a (logs) since 9:12 AM.");
    expect(c.next).toBe(
      "Check the sender or collector that writes it. The incident resolves once data arrives again.",
    );
  });

  it("a few stopped streams are named in full", () => {
    const c = copy(item({ members: 3 }));
    expect(c.headline).toBe("3 streams stopped sending data");
    expect(c.why).toBe("ingest_1, ingest_2, and ingest_3 have sent no data since 9:12 AM.");
    expect(c.next).toContain("One cause is likely, such as a shared collector.");
  });

  it("many stopped streams name three and count the rest", () => {
    const c = copy(item({ members: 12, page: page("unrouted") }));
    expect(c.headline).toBe("12 streams stopped sending data");
    expect(c.why).toBe("ingest_1, ingest_2, ingest_3, and 9 more have sent no data since 9:12 AM.");
    expect(c.next).toBe(
      "One cause is likely, such as a shared collector. Set up on-call routing so the next stop pages someone.",
    );
  });

  it("a member whose stream is gone is counted, not named", () => {
    const i = item({ members: 4 });
    i.members![1] = { ...i.members![1], stream_type: null, stream_name: null };
    expect(copy(i).why).toBe(
      "ingest_1, ingest_3, ingest_4, and 1 more have sent no data since 9:12 AM.",
    );
  });

  it("a member list of one reads as a single stream", () => {
    expect(copy(item({ members: 1 })).headline).toBeNull();
  });

  it("drops and rises have their own why and next", () => {
    expect(copy(item({ kind: "stream_drop" })).why).toBe(
      "ingest_a (logs) has received much less data than usual since 9:12 AM.",
    );
    expect(copy(item({ kind: "stream_rise" })).next).toBe(
      "Check for a retry loop or a new sender writing to it.",
    );
  });

  it("an unreadable finding has no why or next", () => {
    const i = item();
    i.finding.stream_name = null;
    const c = copy(i);
    expect(c.why).toBeNull();
    expect(c.next).toBeNull();
  });

  const BACK_US = Date.UTC(2026, 10, 9, 9, 25) * 1000;
  const recovered = (i: AutoObserveIncidentItem, n: number[]) => {
    for (const k of n) i.members![k] = { ...i.members![k], recovered_at: BACK_US };
    return i;
  };
  const resolved = (i: AutoObserveIncidentItem) => {
    i.incident.status = "resolved";
    return i;
  };

  it("a resolved group says its streams came back, when, and drops the next step", () => {
    const c = copy(resolved(recovered(item({ members: 3 }), [0, 1, 2])));
    expect(c.why).toBe(
      "ingest_1, ingest_2, and ingest_3 are sending data again. They stopped at 9:12 AM. Back at 9:25 AM.",
    );
    expect(c.next).toBeNull();
  });

  it("a resolved single stream says it came back", () => {
    const i = resolved(item());
    const c = copy(i);
    expect(c.why).toBe("ingest_a (logs) is sending data again. It stopped at 9:12 AM.");
    expect(c.next).toBeNull();
  });

  it("a partly recovered group lists the stopped streams and names the ones back", () => {
    const c = copy(recovered(item({ members: 3 }), [1]));
    expect(c.why).toBe(
      "ingest_1 and ingest_3 have sent no data since 9:12 AM. Sending again: ingest_2.",
    );
    expect(c.next).toBe("One cause is likely, such as a shared collector.");
  });

  it("a resolved drop says the volume is back to usual", () => {
    const c = copy(resolved(item({ kind: "stream_drop" })));
    expect(c.why).toBe("ingest_a (logs) is back to its usual volume. It dropped at 9:12 AM.");
  });

  it("a pending page says the page is waiting on the on-call service", () => {
    expect(copy(item({ page: page("pending") })).page).toEqual({
      tone: "pending",
      text: "Paging on-call: the on-call service hasn't confirmed the page yet.",
      routing: false,
    });
  });
});
