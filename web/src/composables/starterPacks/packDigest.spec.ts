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
import { ref } from "vue";

import { createPreview } from "@/components/O2AIChat.content";
import { fakeFlow } from "@/components/starterPacks/starterPackTestFlow";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

import {
  buildPackDigest,
  digestPackIds,
  DIGEST_MAX_CHARS,
  PACK_DIGEST_NAME,
  type DigestItem,
} from "./packDigest";
import { packById } from "./usePackCatalog";
import type { StarterPack } from "./types";

loadCatalogFixture();

const RULE =
  "Recommend only these packs. Do not create these items yourself; the user sets them up with the Set up button.";

const itemOf = (id: string, streams: string[] = [], over: Record<string, unknown> = {}) => {
  const pack = packById(id)!;
  return {
    pack,
    title: pack.title,
    matcher: { streams: ref(streams) },
    flow: fakeFlow({
      pack,
      dashboardCount: ref(null),
      alertCount: ref(null),
      viewCount: ref(null),
      ...over,
    }),
  } as unknown as DigestItem;
};

// Mirrors what the composer sends: RichTextInput writes this block for a context chip.
const sentMessage = (question: string, digest: string) =>
  `${question} \n\n--- ${PACK_DIGEST_NAME}  ---\n${digest}\n--- end ---`;

describe("buildPackDigest", () => {
  it("starts with the pack titles, so the sent block's 60-character preview leads with them", () => {
    const digest = buildPackDigest([itemOf("kubernetes"), itemOf("hosts"), itemOf("postgresql")]);
    const first = digest.split("\n")[0];
    expect(first).toBe("Starter packs for your data: Kubernetes, Hosts, PostgreSQL");
    expect(createPreview(digest, 60).startsWith(first)).toBe(true);
  });

  it("lists each pack's id, streams, dashboards, alert summaries and saved views", () => {
    const digest = buildPackDigest([itemOf("kubernetes", ["k8s_events", "k8s_metrics"])]);
    const kubernetes = packById("kubernetes") as StarterPack;
    expect(digest).toContain("Pack: Kubernetes (id: kubernetes)");
    expect(digest).toContain("Matched streams: k8s_events, k8s_metrics");
    expect(digest).toContain(
      `Dashboards: ${kubernetes.dashboards[0].title} (${kubernetes.dashboards[0].summary})`,
    );
    expect(digest).toContain(kubernetes.alertSummaries![kubernetes.alerts[0]]);
    expect(digest).toContain(`Saved views: ${kubernetes.savedViews[0].name}`);
    expect(digest.endsWith(RULE)).toBe(true);
  });

  it("leaves counts out until the preview has counted, then names them", () => {
    expect(buildPackDigest([itemOf("hosts")])).not.toContain("Creates:");
    const counted = itemOf("hosts", [], {
      dashboardCount: ref(1),
      alertCount: ref(4),
      viewCount: ref(0),
    });
    expect(buildPackDigest([counted])).toContain("Creates: 1 dashboard, 4 alerts, 0 saved views");
  });

  it("keeps at most three packs", () => {
    const digest = buildPackDigest(
      ["kubernetes", "hosts", "postgresql", "docker"].map((id) => itemOf(id)),
    );
    expect(digest.split("\n")[0]).toBe(
      "Starter packs for your data: Kubernetes, Hosts, PostgreSQL",
    );
    expect(digest).not.toContain("id: docker");
  });

  it("stays within about 2,000 characters and keeps every pack's id when the details are long", () => {
    const streams = Array.from({ length: 400 }, (_, n) => `stream_with_a_long_name_${n}`);
    const ids = ["kubernetes", "aws-cloudwatch", "argocd"];
    const items = ids.map((id) => {
      const item = itemOf(id, streams);
      const long = "x".repeat(900);
      const pack: StarterPack = {
        ...item.pack,
        dashboards: [{ id: "d", title: long, summary: long }],
        alerts: ["a1", "a2"],
        alertSummaries: { a1: long, a2: long },
      };
      return { ...item, pack };
    });
    const digest = buildPackDigest(items);
    expect(digest.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(digest.split("\n")[0]).toBe(
      "Starter packs for your data: Kubernetes, AWS CloudWatch, Argo CD",
    );
    expect(digest.endsWith(RULE)).toBe(true);
    expect(digestPackIds(sentMessage("Which packs fit?", digest))).toEqual(ids);
  });
});

describe("digestPackIds", () => {
  it("reads the pack ids back from a sent message, in digest order", () => {
    const digest = buildPackDigest([itemOf("hosts"), itemOf("kubernetes")]);
    expect(digestPackIds(sentMessage("Which packs fit?", digest))).toEqual(["hosts", "kubernetes"]);
  });

  it("finds nothing in a message without the block", () => {
    expect(digestPackIds("Pack: Kubernetes (id: kubernetes)")).toEqual([]);
    expect(digestPackIds("--- Log Entry ---\nPack: X (id: x)\n--- end ---")).toEqual([]);
  });
});
