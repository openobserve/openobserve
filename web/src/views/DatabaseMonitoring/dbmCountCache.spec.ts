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

/**
 * Every DBM page reads its sibling-tab badges THROUGH the shared cache.
 *
 * The mechanism is unit-tested in useDbmCountCache.spec.ts by calling it. The
 * defect this closes is not in the mechanism — it is that the six views are
 * separate ROUTES with no shared state, so each remount independently re-fetches
 * every badge. So the regression worth pinning is the WIRING: each page's count
 * fan-out goes through `useDbmCountCache`, and its refresh path forces past it.
 *
 * Read off the source rather than by mounting, for the reason
 * dbmRequestGuard.spec.ts gives: these views need a router, a store and a dozen
 * O2 children, and a harness that heavy fails for reasons unrelated to the
 * wiring and gets deleted the first time it does.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/**
 * Every page that paints sibling-tab badges, with the name of the function that
 * fetches them. QueryDetailPage is absent deliberately: it renders no tab bar
 * and fetches no badges, so demanding a cache read there would pin a call it
 * has no reason to make.
 */
const PAGES: [string, string][] = [
  ["ActivityPage.vue", "loadContext"],
  ["DeadlocksPage.vue", "loadContext"],
  ["BlockedQueriesPage.vue", "loadContext"],
  ["TableHealthPage.vue", "loadContext"],
  ["DatabasesPage.vue", "loadQueryCount"],
  ["QueriesPage.vue", "loadLockCounts"],
];

/** The body of a named `const x = async …` function, up to its closing `};`. */
const bodyOf = (source: string, name: string): string => {
  const body = source.split(`const ${name} = async`)[1]?.split("\n};")[0] ?? "";
  expect(body, `${name} must have a body`).not.toBe("");
  return body;
};

describe("DBM pages fetch their tab badges through the shared cache", () => {
  it.each(PAGES)("%s imports the count cache", (page) => {
    const source = read(page);
    expect(source).toContain('from "@/composables/dbm/useDbmCountCache"');
    expect(source).toMatch(/useDbmCountCache\("[a-z]+"\)/);
  });

  /**
   * Every page must claim its OWN scope. The pages return different payload
   * shapes — Table health also carries `blockingSamples` for the
   * high-impact-blocker rule — so two pages sharing a scope share an entry, and
   * whichever loads first decides what the other receives. That shipped once:
   * landing on Deadlocks and switching to Table health handed it a payload with
   * no `blockingSamples`, and `chainsFromSamples` threw `samples is not
   * iterable` out of a Vue computed.
   *
   * Asserted across the whole set rather than per page, because the defect is a
   * COLLISION — no single page can be inspected and found guilty of it.
   */
  it("gives every page a scope no other page uses", () => {
    const scopes = PAGES.map(([page]) => {
      const found = read(page).match(/useDbmCountCache\("([a-z]+)"\)/);
      expect(found, `${page} must name a cache scope`).not.toBeNull();
      return found![1];
    });

    expect(new Set(scopes).size, `two pages share a cache scope: ${scopes.join(", ")}`).toBe(
      PAGES.length,
    );
  });

  /**
   * The fan-out itself must be INSIDE the cache read, not beside it. A page that
   * called the cache and then fetched anyway would satisfy an import assertion
   * while still firing every request.
   */
  it.each(PAGES)("%s issues its badge fetches inside the cached read", (page, loader) => {
    const body = bodyOf(read(page), loader);
    expect(body, `${loader} must read through the cache`).toMatch(/countCache\.read\(/);

    const at = body.indexOf("countCache.read(");
    const beforeCache = body.slice(0, at);
    expect(
      beforeCache,
      `${loader} fetches before it consults the cache, so the cache saves nothing`,
    ).not.toMatch(/dbMonitoringService\.get/);
  });

  /**
   * REQUIREMENT 1: keyed on the WINDOW the reader chose, not on a resolved
   * timestamp. `useDbmScope.refresh()` re-pins the anchor at the top of every
   * `load()`, so a key built from `current.startTime` would differ on every
   * load and the cache would never hit — it would look correct and do nothing.
   */
  it.each(PAGES)("%s keys the cached read on the range, not on live bounds", (page, loader) => {
    const body = bodyOf(read(page), loader);
    const call = body.slice(body.indexOf("countCache.read("));
    const args = call.slice(0, call.indexOf("\n  );") + 1);
    expect(args, `${loader} must key on range.value`).toMatch(/range\.value/);
    expect(
      args.split("() =>")[0],
      `${loader} keys the cache on a re-pinned timestamp, which can never hit`,
    ).not.toMatch(/current\.value\.(start|end)Time/);
  });

  /**
   * REQUIREMENT 2: the request-sequence guard survives. The cached read resolves
   * through the same await as a live fetch, so the same staleness check must
   * still gate every write.
   */
  it.each(PAGES)("%s still discards a superseded cached read", (page, loader) => {
    const body = bodyOf(read(page), loader);
    expect(body, `${loader} must still carry a token`).toMatch(
      /requestSeq\.(current|begin)\(\)|token: number/,
    );
    expect(body, `${loader} must discard a superseded response`).toContain(
      "requestSeq.isStale(token)",
    );
    // The staleness check must come AFTER the read resolves — checking before
    // the await would pass a source scan while guarding nothing. `indexOf` on
    // an absent call returns -1 and would make this pass vacuously, so the
    // presence of the read is asserted first rather than assumed.
    const at = body.indexOf("countCache.read(");
    expect(at, `${loader} must read through the cache`).toBeGreaterThan(-1);
    expect(body.indexOf("requestSeq.isStale(token)")).toBeGreaterThan(at);
  });

  /**
   * REQUIREMENT 3: an explicit refresh must reach the network. The refresh
   * button and the load it triggers are the reader saying the numbers may have
   * moved — the one case where same-window-means-same-data does not hold.
   */
  it.each(PAGES)("%s can force past the cache", (page, loader) => {
    const body = bodyOf(read(page), loader);
    expect(
      body,
      `${loader} never passes force, so a refresh button would serve the cached numbers`,
    ).toMatch(/force/);
  });

  /** The force flag has to be the CALLER's choice, or nothing can refresh. */
  it.each(PAGES)("%s takes the force decision from its caller", (page, loader) => {
    // Up to the arrow, so a parameter's own default (`= requestSeq.current()`)
    // does not truncate the signature the way splitting on `)` did.
    const signature = read(page).split(`const ${loader} = async`)[1]?.split("=>")[0] ?? "";
    expect(signature, `${loader} must have a signature`).not.toBe("");
    expect(
      signature,
      `${loader} hard-codes its force flag, so either nothing refreshes or nothing caches`,
    ).toMatch(/force/);
  });

  /**
   * REQUIREMENT 4, as a spec rather than a guard.
   *
   * `Promise.allSettled` NEVER rejects — it resolves with rejected slots inside.
   * So the cache, which only declines to store on a rejection, would happily
   * store a fan-out in which every badge failed, and serve those blanks to
   * every later tab switch on that window. A failed count must be forgotten,
   * so the page must refuse to cache a fan-out that was not fully fulfilled.
   */
  it.each(PAGES)("%s does not let the cache keep a failed badge", (page, loader) => {
    const body = bodyOf(read(page), loader);
    expect(
      body,
      `${loader} caches whatever allSettled returned, so a failed count is ` +
        `remembered as a blank badge for the whole window`,
    ).toMatch(/every\(|some\(|rejected/);
  });
});

/**
 * Behaviour the pages ALREADY have, which routing the fetches through a cache
 * must not quietly take away.
 *
 * These are regression guards, not specs — they were green before the cache
 * existed and are expected to be. They live in their own block so the
 * new-behaviour suite above can be verified RED honestly: mixed in, their
 * passing would have masked whether the cache tests fail for real.
 */
describe("caching the badges does not cost the pages their existing honesty", () => {
  /**
   * REQUIREMENT 4: a failed count must not be cached, and must not be cached as
   * zero. The pages already use `Promise.allSettled` so one dead endpoint blanks
   * ONE badge — that must survive, because `allSettled` never rejects and would
   * otherwise store the rejected slots as cached values.
   */
  it.each(PAGES)("%s still settles each badge independently", (page, loader) => {
    const body = bodyOf(read(page), loader);
    expect(body, `${loader} must keep per-badge failure isolation`).toContain("Promise.allSettled");
    expect(body, `${loader} must still blank a badge it could not read`).toMatch(
      /status === "fulfilled"/,
    );
  });

  /**
   * REQUIREMENT 5: the truncation flag survives the cache. The badge renders
   * `65+` from `countClaim(total, truncated)`; a page that cached a bare number
   * would drop the `+` on every hit after the first, and the number would still
   * look right — which is why this is pinned rather than eyeballed.
   */
  const CAPPED: [string, string][] = [
    ["getDeadlocks", "deadlockCount"],
    ["getBlocking", "blockedCount"],
  ];

  /**
   * Asserts the REQUIREMENT — the badge is fed a claim built from the server's
   * `truncated` — rather than the shape that requirement used to take.
   *
   * An earlier version demanded `countClaim(` in the `countVar.value =`
   * statement itself. That is where it lived before the cache, but the cache
   * correctly moves the claim INSIDE the cached value (that is precisely what
   * keeps the flag alive across a hit), leaving the assignment a plain read of
   * an already-built claim. Pinning the old position failed code that had
   * become more correct, which is how a test starts training people to edit it.
   */
  it.each(PAGES)("%s carries the cap through the cache", (page, loader) => {
    const body = bodyOf(read(page), loader);
    for (const [fetcher, countVar] of CAPPED) {
      if (!body.includes(`dbMonitoringService.${fetcher}(`)) continue;

      // The claim must be built from the server's cap somewhere in the loader…
      const claim = new RegExp(`${countVar}[\\s\\S]{0,300}?countClaim\\(([\\s\\S]{0,300}?)\\)`);
      const built = claim.exec(body);
      expect(
        built,
        `${page} never builds a countClaim for ${countVar}, so a capped read ` +
          `prints as a total`,
      ).not.toBeNull();
      expect(
        built?.[1],
        `${page} builds ${countVar}'s claim without the server's cap, so every ` +
          `count claims to be complete`,
      ).toMatch(/\.truncated/);

      // …and that claim, not a bare number, is what reaches the badge.
      const assign = body.indexOf(`${countVar}.value =`);
      expect(assign, `${loader} fetches ${fetcher} but never assigns ${countVar}`).toBeGreaterThan(
        -1,
      );
      const stmt = body.slice(assign, body.indexOf(";", assign) + 1);
      expect(
        stmt,
        `${page} assigns ${countVar} something other than the claim it built, so ` +
          `the "+" is dropped on a cache hit`,
      ).toMatch(new RegExp(`${countVar}\\.value = (badges\\.${countVar}|[\\s\\S]*countClaim\\()`));
    }
  });
});
