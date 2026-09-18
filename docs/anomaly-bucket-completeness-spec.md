# Anomaly detection: bucket completeness, the settle margin, and the fabricated-value defect

**Status:** sixth design wave — **FINAL before implementation.** Waves: 1 shipped margin-knob + watermark + write suppression; 2 (`[R]`) removed the watermark; 3 (`[U]`, user decision 2026-09-18) removed the scored settle margin entirely; 4 (`[D]`) absorbed gate 1 (grid origin, absence watermark, notices); 5 (`[G]`) adopted gate 2's verified §4.7 repairs and the two-grid remedy. Wave 6 (`[F]`) absorbs gate 3, which **broke no mechanism** — 3A independently re-simulated the §4.7 repairs at 100% of phases on every pinned scenario — and closes the remaining spec-text and inventory gaps so implementation can start. The certified core and the repaired mechanics are untouched.
**Repos:** `openobserve` (OSS) + `o2-enterprise` — PAIRED change, same branch name in both (`fix/anomaly-bucket-completeness`)
**Date:** 2026-09-17; revised 2026-09-18 (waves 2–6)

Markers: **[V]** first-hand (code read, live query, simulation) · **[V-sub]** gate/subagent report, anchors spot-checked · **[T]** on trust · **[C]/[R]/[U]/[D]/[G]** correction waves 1–5 · **[F]** — gate-3 closure (wave 6). Later markers supersede earlier ones.

Line numbers: pre-implementation against `o2-enterprise` @ `8b9ce5a1` / `openobserve` @ `1f0a30e086`; post-implementation against `o2-enterprise` @ `a159df99` and `openobserve` @ `f5882d9ac4` on the branch. Gate-cited numbers from other checkouts are marked where drift was observed.

---

## 0. The wave-3 decision, its scope, and its accepted risk **[U]**

**Decision (user, 2026-09-18, final):** the scored path has **no** settle margin. A bucket is judgeable once `bucket_start + interval <= now`, never before. The open trailing bucket is never judged and never written (§4.4). `O2_ANOMALY_EDGE_SETTLE_SECONDS` is deleted with the mechanism.

**Scoping assumption — overridable by the user:** scored path only. The pre-fix code SHARED one `edge_settle_seconds` between scored admission and absence's staleness bar; this design splits them: scored margin-free; `AbsencePolicy`/`DropPolicy` keep their internal 600 (`absence.rs:145,155` **[V]**; own route `edge_outlasts_allowance`, `absence.rs:1060-1077`, called `:472,:620` **[V]**). What absence DID inherit from the scored cursor — its grading start — is decoupled in §4.7.

**Accepted risk — recorded once, dated:** judgment is final (§4.2). A bucket read incomplete by a tail event (ingester restart, compactor backlog, late replay — unsampled) is scored at its partial value **permanently**; the hybrid additionally trains on it. Steady-state cost: ~0–0.8% underread on the trailing judged bucket, ~7% of runs. **[D]** Scope limit: the `default` stream's hour-scale late arrivals (2.1–3.4% of buckets >0.8% low at any margin **[V-sub]**) are outside this figure; no margin variant would help them. User decision noted 2026-09-18.

What it buys: detection on the **next run** after close (~600s latency cut fleet-wide); a deleted mechanism, knob, bridge, `/config` field.

**Grounding — parity with alert evaluation [V-sub]:** alerts evaluate margin-free (`[T − period, T]`, right edge at fire time, `align_time` default true, `handlers.rs:1521-1534`; aggregation alerts read the mid-fill trailing edge; late data silently missed). The margin made the detector stricter about recency than the engine it feeds. **The one difference, accepted:** alerts are stateless-window; the anomaly path is cursored and final. **Precedent for future recency slack, NOT shipped:** derived streams' `delay` (`components.rs:87` **[V]**) — §10.7.

---

## 1. Problem

**What a user sees:** a trained, `ready`, alert-enabled config that has never been able to fire and whose plotted values are not the stream's. Live: `k8s_events_anomaly` (`W=300`, 5m/5m) **[V]**; indistinguishable from a working config in API and UI.

**Harm 1 — cannot detect:** 144 rows/24h = 50% of buckets, zero `is_anomaly=1`, all at phase `%600==300` **[V]**. **Harm 2 — fragments:** written/true mean 0.321, median 0.289, range 0.045–0.658; 0/144 within 1% of truth **[V]**; control (`nginx`, `W=3600`): median 1.000, 286/287 >0.99 **[V]**. A real storm renders as a dip.

**Not confined to one config [R]:** the two `test` configs (1h/`W=3600`) publish a ~41s-fill trailing fragment every run (permanent; ~22/day/config) and skip one bucket per cycle: individually 262/288 and 258/288 coverage (91.0%, 89.6%) **[V]** — the predicted ~88.7% knife-edge, live.

**Scope [V]:** 11 configs — k8s hard-broken; two `test` on the knife-edge; **eight healthy** (287/288). Corrupted k8s rows: 263 (2026-09-18), ~144/day until deploy.

---

## 2. Why it happens

**Mechanism, pre-fix:** query end = wall clock; the boundary was pulled back by the margin before `bucket_is_closed` (`ts + interval <= boundary`, `:1738-1740` **[V]**); start clamped `detect_start = max(cursor, now − W)` (`:214-219` **[V]**). At `W=300`/600 the boundary sat 300s before the query began. Margin-free, a one-bucket window still holds only the open bucket at every off-grid run time (§3.6 axis 5).

**Which path runs live [R]:** only hybrid/partial-drop grid-floors `detect_start_us` (`:220-228`); frozen keeps the raw start, filtered by `ts >= score_from_us` (`:368-371,:1161`). **The fleet runs frozen**: both flags default `false` (`config.rs:1358-1370` **[V]**), no cluster sets them **[V]**.

**Why half the buckets — RESOLVED [R]:** 5m-fleet cadence 520–690s (median 590) = 2.0× configured **[V]**; at `W=300` each window holds only the open bucket; ~600s gaps skip alternates. Simulated 0.496 vs live 0.500 **[V]**. **[D]** The 2× is arithmetic: the handler re-arms `next_run = now_micros() + interval` **after** the run (`handlers.rs`, re-arm region `:1374-1379` and reschedule `:1429-1433` at `f5882d9ac4` **[V]**; gate-cited numbers drift by checkout) — gap = schedule + duration + pickup. **Re-arm fix OUT OF SCOPE per user** (§10.8).

**Silence into wrong data:** closed check ran; point written anyway (`:1201-1203` pre-impl **[V]**). Fixed by §4.4.

**Why nobody could have known:** no margin surface in OSS; UI accepted ≥1s; server checked `W>0`, `W≥schedule`; the constraint lived in an enterprise test (wave 1 **[V]**).

---

## 3. Approaches evaluated

### 3.1 Force `W == schedule` — REJECTED
The broken config already satisfies it; the `test` configs prove it fails at 1h (89.6–91.0% **[V]**).

### 3.2 Drop absence detection — REJECTED
The margin was never absence's; wave 3 is the inverse and the right way round.

### 3.3 Tighten the validator — ACCEPTED, floor corrected twice **[U]**
Wave 1 asserted `schedule+settle+histogram`; implementation "measured" `settle+histogram` on a grid-aligned clock; the margin-free floor is **`W ≥ schedule + histogram`** (§4.3).

### 3.4 Auto-derive the window — VIABLE, not chosen
Silent override contradicts the field's contract. Fallback lever (§9).

### 3.5 Watermark + ceiling — ACCEPTED [C], then REMOVED [R]. Do not reintroduce.

> **Superseded [R] — kept on the record.** `scored_end_us = max(ceiling, watermark).min(query_end)`; watermark `= max(returned)` (NOT `+interval` — that admits the mid-fill bucket that set it); the cursor deliberately not an input (counterexample: `interval=60s, returned=[t0], end=t0+180s, cursor=t0+120s` admits `t0` on zero evidence, permanently). Surviving invariants for any future completeness-evidence design: (a) evidence = strictly later arrival; (b) the cursor is stranding-prevention, never completeness evidence. Removed: never took effect on the live path; fixed nothing the reduced design didn't; carried two P0 defects; made the margin dead weight.

### 3.6 The margin: three candidates, scored — and the decision **[U]**

**Origin:** user — *"we don't need the settle delay; simply have the next run check data from where we had checked until."*

| Axis | 600 | small (60) | **0 (decided)** |
|---|---|---|---|
| 1. Trailing completeness | complete (99.2–100% at close, 100% by +21s **[T]**) | complete | `φ<21s` on ~7% of 5m runs → ~0–0.8% underread on one bucket; ≪ noise floor (±40%+ variance **[V]**). §0 scope limit for hour-late streams **[D]**. |
| 2. Irreversibility | 600s insurance | ~21s+ | Judgment final (§4.2); tail-event partials permanent. The accepted cost (§0). |
| 3. Absence | — | — | Own margins, own route **[V]**; grading-start inheritance decoupled §4.7 **[D]**. |
| 4. Latency (the goal) | ~890s mean/~1290s worst | ~355/650s | **~295/590s — next run.** |
| 5. k8s at `W=300` | 1200; invalid | 660; invalid | **600; STILL invalid** — a one-bucket window judges nothing off-grid at any margin (**[V]** §4.3). Operator action mandatory under all three. |
| 6. `test` knife-edge | floor 4500; 0.699 | floor 3960 | floor 3900; 0.854 **[V]** — 0 is safest here. Still §7. |

**Decision: 0 — mechanism deleted, not defaulted** (§0).

---

## 4. Design

A bucket is judgeable iff its span has elapsed, with all grid arithmetic on the **data grid** and exactly one engine serving anomaly histograms (§4.1.1); the open bucket is never written (§4.4); the cursor parks at the open bucket's start; absence and partial-drop grade through their own watermark with a fetch that revisits held buckets (§4.7); the validator separates validity (`W ≥ schedule + histogram`) from health (`gap ≤ W − histogram` scored; §4.7's tighter absence bound) (§4.3); runs that skip say so (§4.8); legacy rows stay editable and honest (§4.5–4.6).

### 4.1 The judgment boundary is bucket completion **[U]**

```
judgeable(b)  ⟺  b + interval_us <= query_end_us
next_cursor_us(query_end_us, interval_us) = bucket_floor_us(query_end_us, interval_us)
```

`bucket_is_closed` (`:1738-1740`) is already this predicate; frozen (`:1058`) and hybrid (`:1215`) pass the run's own `query_end_us`. The `settled_query_end_us` family is deleted (§6). Steady state: run N parks at the open bucket's start; run N+1 judges it once. `W` caps only after pauses.

> **Superseded [R→U].** Wave 2's configurable ceiling. The margin's rationale (`:1744-1749`) is priced (§3.6) and accepted (§0), not refuted.

#### 4.1.1 The bucket grid: origin, the second engine, and the sweep **[D→G→F]**

**Origin defect (pre-existing):** SQL `histogram()` → `date_bin` with origin **2001-01-01T00:00:00Z** (`rewrite_histogram.rs:250-257` **[V]**): data-grid starts satisfy `b ≡ 978_307_200_000_000 (mod iv_us)`. `floor_to_bucket_us` floors to the 1970 epoch. Grids coincide iff the interval divides 978,307,200s — true of every live interval, false for 7m/11m/5h (validator-legal): cursor off the data grid, `ts ≥ cursor` strands buckets forever. Fix:

```rust
/// date_bin's origin as rewrite_histogram.rs hardcodes it; the detector's grid MUST match the SQL's.
pub(crate) const HISTOGRAM_GRID_ORIGIN_US: i64 = 978_307_200_000_000; // 2001-01-01T00:00:00Z

pub(crate) fn bucket_floor_us(ts_us: i64, interval_us: i64) -> i64 {
    if interval_us <= 0 { return ts_us; }
    HISTOGRAM_GRID_ORIGIN_US
        + (ts_us - HISTOGRAM_GRID_ORIGIN_US).div_euclid(interval_us) * interval_us
}
```

Every formula holds verbatim under `φ = (T − ORIGIN) mod iv` (derivations use only differences).

**[G] The second engine.** The tantivy fast path bins on `start_time − start_time % rounding_by` — the **epoch grid**, origin-blind (`index_optimizer/histogram.rs:106-113,:268-283` **[V]**; served via `histogram_collector.rs`); its trigger shape (one group key + `count(*)`) is the anomaly query, and `handle_tantivy_optimize` (`flight.rs:756`, call `:293` **[V]**) can split one query across engines.

**Remedy — (c): bypass now, engine fix filed (§10.10). [F] The bypass suppresses at the MODE COMPUTATION, not inside `handle_tantivy_optimize`:** gate 3B's must-fix — an early return inside `handle_tantivy_optimize` alone leaves `idx_optimize_rule` set, and `grpc/storage.rs → tantivy_search` then runs the collector, discards its results, and **removes indexed files from the DataFusion list**: silent bucket loss on every filtered anomaly query. The chosen single choke point is the follower's rule-installation guard (`flight.rs` `can_optimize` region, `:641-651` **[V]**: `index_optimizer_rule_ref.lock().take()`): when the request carries the flag, the optimizer rule is taken/never installed — killing the split, the collector run, and the file removal at once.

**[F] The flag's carrier and real footprint (§6 rows):** the flag rides **`IndexInfo`** (`src/proto/proto/cluster/plan.proto:106` **[V]**) — chosen over a new `SearchInfos` field because the super-cluster hop **copies `IndexInfo` verbatim while `SearchInfos` is rebuilt**, and a rebuilt struct can silently drop the flag on the hop (gate 3B's argument, adopted; 3C's SearchInfo-field-12 sketch rejected on that ground). Footprint (~9 files): `plan.proto` (new bool on `IndexInfo`) + the checked-in regenerated `src/proto/src/generated/cluster.rs`; `distributed_plan/node.rs` (`SearchInfos` `:69-174`, `get_search_info`/builder); `config/src/datafusion/request.rs` (`Request` `:21` + both `From` impls); `flight.rs` (the guard above); and the **set-site: OSS `execute_anomaly_query` (`src/core/src/anomaly_detection.rs:2356` **[V]**)** — wave 5 misattributed the set-site to the ENT `query_executor`, whose fixed `Fn` signature cannot carry it; corrected. **Load-bearing fact [F]:** histogram optimize modes are **never leader-supplied — followers re-derive them locally** — so leader-side suppression is a no-op; the flag must ride the request to the follower. That is *why* the proto touch is unavoidable.

**[F] UI charts (C2) — decision: accept + record.** The anomaly charts re-bucket via their own `histogram()` with no flag, so charts and detector bin on different grids for a non-dividing interval until §10.10's engine fix lands. Accepted: zero live exposure (all live intervals divide), and §10.10 cures it product-wide. Alternative — threading the flag through chart queries — named and rejected as scope growth into every chart path for a transient, zero-exposure skew.

**[G→F] Custom SQL, swept and enforced by AST:** custom-SQL configs supply their own `histogram(...)`, so both write paths validate via a **sqlparser AST walk** — substring checks are provably defeated by nesting, comments, and IANA-name arguments **[V-sub]**. Rules: **(i)** no timezone/origin argument to `histogram()`; **(ii)** no calendar units (months/years — no fixed stride); **(iii)** the SQL's interval must equal `config.histogram_interval` by **semantic µs equality** (`"300s"` == `"5m"`), not string equality; **(iv) [F]** the argless `histogram(_timestamp)` form is rejected — its interval is injected from the request at query time, a guaranteed desync with the config's grid arithmetic. Request-level `Query.timezone` is out of scope: the anomaly path builds its own request and never sets it. **Grandfathering decision [F]: the changed-fields skip extends to `custom_sql`** — a stored violating row stays editable for unrelated fields; an edit touching `custom_sql` is held to the rules (a hard cut would strand rows exactly like the D4 class this spec fixed elsewhere). Live exposure: 0 of 11 configs use custom SQL **[V]**.

**Sweep (all routed through `bucket_floor_us`):**

| Site | Finding | Action |
|---|---|---|
| `absence.rs:749-758` `expected_grid` | Epoch floor; comment asserts the falsehood ("histogram() emits epoch-aligned buckets" **[V]**) | Route + **flip the comment**. |
| `absence.rs:685-696` `build_slot_value_profile` | Epoch re-floor before `hour_of_week_slot` | Slot from the bucket's own timestamp; flooring via `bucket_floor_us`. |
| `coverage.rs:138-144` `snap_to_grid` | **[F]** Its input is a returned (data-grid) timestamp, not wall clock — this is the *defensive identity* class (rule clause 3), not grid-defining as wave 5 said | Route through `bucket_floor_us` as a defensive identity; comment fixed. |
| **[F]** `coverage.rs:106-108` `census_from_points` comment | Says "off the epoch-aligned grid" **[V]** | Flip to data-grid wording. |
| **[F]** `absence.rs:1916-1925` test `an_unaligned_window_matches_epoch_aligned_returned_buckets` | Its assertion `b % interval == 0` **pins the exact falsehood this spec flips** **[V]** | Re-point to `(b − ORIGIN) % interval == 0`; extend with a 7m case; rename accordingly. |
| **[F]** `servability.rs:101` | `div_euclid(bucket_width_us)` as a **partition key** — origin-invariant (only equality of quotients matters) **[V]** | No change; one-line comment stating why it is exempt. |
| **[F]** `servability.rs:139-143` `hour_of_week_slot` | Hour-grid mapping, a distinct convention (hour-of-week, epoch-anchored weekday offset) **[V]** | No change; exempt — it maps to a calendar slot, not to the bucket grid. |

**[F] The repo rule, three clauses:** (1) arithmetic that MAPS a wall-clock instant onto a bucket boundary is grid-defining → `bucket_floor_us`; (2) OFFSETTING an existing data-grid value by whole intervals, or differencing two data-grid values, is exempt; (3) flooring a value **already on the data grid** is a defensive identity — do it via `bucket_floor_us` so the identity is enforced rather than assumed.

**[G→F] N14 provenance:** expected values from a **real `date_bin` evaluation**, or a checked-in literal with provenance (producing query + date; never regenerate from the constant). Cases: a **pre-2001, OFF-GRID** timestamp (**[F]** an on-grid pre-2001 point cannot distinguish `div_euclid` from `%` — the remainder is zero either way); 60s (dividing); **420s — load-bearing for tz-shift detection** (**[F]** a +05:00-shifted origin happens to sit on the 5h grid, so the 5h case alone would pass a tz-broken origin); 5h.

**Autopsies #3 (wave 4) and context:** the harness's `MONDAY_00_US` matched the implementation's wrong grid — a harness sharing the implementation's constants can only confirm it against itself.

### 4.2 Judgment is final — and the guard sits where the write happens **[U→G]**

**Frozen:** sub-cursor buckets are shingle context only (`:1161`, `:229-252` **[V]**). **Hybrid:** `entry.last` ratchets **[V]**. First judgment is forever.

**[G] The D10 guard at the apply:** the super-cluster rewind lands in `patch_all_fields` (`infra/table/anomaly_detection/config.rs:267` **[V]**; cursor is `Scope::Replicated` `:626`), which the wave-4 guard on `update_detection_timestamp` never sees. The guard lives at the apply (and the local write): persist `max(stored, incoming)` for `last_processed_timestamp`. The same apply stomps `last_error` (`:266`) — accepted; next run re-settles the notice.

**[G→F] Config-edit semantics, one designed behavior with its files named:** a `histogram_interval` change resets `last_processed_timestamp` AND `graded_until` to `None` (grid redefined; mirrors the hybrid `stale_interval` discard, `detector.rs:1295-1312` doc **[V]**). **[F]** The reset lives in **OSS `update_config`** — the `histogram_interval` branch at `src/core/src/anomaly_detection.rs:786-789` **[V]**, beside its `retryable_change` accounting, **before** the ENT broadcast so the `None` rides the same ConfigUpdate that replicates the edit. **[F] The region-local `graded_until` hole, closed with both belts:** the watermark sidecar has no replication channel, so a remote region's blob survives the edit. Decision — **both** defenses (trivial cost): **(a)** the v1 payload embeds the interval — `"1:{interval_us}:{graded_until_us}"` — and a reader whose current interval mismatches **discards** the value (the `stale_interval` precedent applied to the blob); **(b)** every read is floored through `bucket_floor_us` with the current interval. **Edit-vs-in-flight bound [F]:** a run in flight across the edit can resurrect `None → Some` once; the exposure is ≤ one grading span and is additionally bounded by (a)/(b) — recorded, accepted.

### 4.3 The validator floor and the health bounds **[U→D→F]**

1. **Validity floor (hard error): `W ≥ schedule + histogram`** — below it the config cannot work at ANY cadence. A validity minimum only, never health: gaps exceed the schedule deterministically (§2).
2. **Health bounds (recommendation), now two [F]:** **scored** — no bucket loss iff every run gap `G ≤ W − histogram` (exact, both directions). **Absence exactly-once** — the §4.7 watermark can lag the run by up to its hold: `L = absence allowance + histogram` (~900s at 5m), so absence containment needs **`G ≤ W − L`** (the wave-5 proviso `G ≤ W − iv` was false at its own bound — a gap of exactly `W − iv` silently lost held buckets with no notice possible, since `now − W < cursor` there **[V-sub]** gate 3A). Recommended sizing: `W ≥ 2×(schedule + histogram)`, **plus the allowance (600) where absence is enabled**; the fleet-standard 3600 satisfies every live bound with margin. Retracted phrasings stay retracted (924s/1903s live gaps **[V-sub]**).

Derivation (grid per §4.1.1): `φ = (T − ORIGIN) mod iv`; admission `W ≥ φ + iv`; coverage `W ≥ G + φ`; `schedule ≥ histogram` enforced ⇒ floor `schedule + histogram`. Legacy `S < iv` rows: binding form `2·iv` **[D]**.

Simulation **[V]**: floor → 1.000 worst-phase at every tested (S,iv); `W=S` → 0.000–0.917; `W=iv` admits only at φ=0. k8s: `W=300` → 0 judged; 600 → 0.489; 990 → 1.000; 3600 → 1.000. Gate-1 replay ≤0.005; **gate-3A re-simulated the §4.7 repairs at 100% of phases on every pinned scenario** — core and repairs certified (§9).

**Runtime skip notice** (§4.8): at run start, `now − W > cursor` proves the clamp cut buckets — emitted when the fetch is data-bearing. **[F]** The watermark's own behind-window state has its distinct notice (§4.7) — the two conditions are proven by different arithmetic and neither substitutes for the other.

### 4.4 Write suppression — kept

Frozen `filter_map` (`:1070-1077`), hybrid `Option`/`continue` (`:1246-1250`) **[V]**; suppresses exactly the open trailing bucket. N9 kept, re-pointed.

### 4.5 Legacy rows: grandfathering, tolerance, one grammar **[R→G]**

**Server grandfathering:** `validated_detection_window` (`:1888-1913` **[V]**) skips when none of the governing fields changed; **[F]** the skip-set extends to `custom_sql` (§4.1.1). **Tolerance (D9):** only the comparison needing the unparsable value is skipped — `W > 0` unconditional; `W ≥ schedule` skipped only on unparsable schedule; floor only on unparsable interval. Distinct by design from the run path's `unwrap_or(0)`. **One grammar:** validator `parse_interval` (`:2270-2292` **[V]**) widens to `s/m/h/d`; the form's `parseInterval` (`useAlertForm.ts:2833-2848` **[V]** — maps `"90s"` to 90 *minutes* today) and the schema's `intervalSeconds` widen with it; `"1d"` renders; the legacy warning's minimum uses correct parses. **Client grandfathering (D4):** `storedRawTriple` captured once from the fetch response (never `props.config` — live-mutated by the write-back watch `:901-925` **[V]**); untouched fields round-trip **verbatim**; suppression = raw equality; **dirty check = value comparison against initial parsed form state** (edit-and-revert is clean), never touched-flags. Unparsable stored values → no floor computation → warning-free tolerance. Pinned: byte-identical description-only edit; below-floor window edit rejected; edit-and-revert byte-identical.

### 4.6 One floor, stated everywhere — no server dependency **[U]**

`schedule + histogram` computed locally on every surface. Dual-channel conditions (log + notice) share one message constant.

### 4.7 Absence and partial-drop: the grading watermark, as repaired and certified **[D→G→F]**

**The P0 (wave 4):** absence grades only to `absence_window_end_us` (**[F]** which lives in `detector.rs:1832-1848` **[V]**, not `absence.rs` — attribution corrected) and defers the newer region to a second look that `cursor = floor(now)` destroyed; partial-drop broke with it.

> **Superseded [G] — wave 4's mechanism.** It failed its own pins (D1 detected in 49% of phases at observed cadence, 3% near-nominal; D2 0/295; total-outage regression): the fetch never revisited the held bucket ("a bookmark into a book the reader no longer opens"); the watermark stored mid-bucket wall-clock values; the hold keyed on `EdgeSettling` alone while 1–2-bucket trailing gaps classify `BelowMinimumRun`.

**The repaired mechanism — gate-2's three fixes, independently re-simulated by gate 3A at 100% of phases on every pinned scenario:**

- **(R1)** fetch start = `max(now − W, min(cursor, graded_until))`. **[F]** Implemented via the **context-start channel** — the same widen-the-fetch-without-moving-the-cursor device as the shingle `context_start_us` (`detector.rs:232-250` **[V]**) — **never by moving `score_from_us`** (the certified scored filter). Its `min()` composes with the hybrid path's `:226` grid floor: the floor applies after the `min`, and both land on the same data grid. Absence input reads the full fetched window.
- **(R2)** every `graded_until` assignment floored through `bucket_floor_us`.
- **(R3)** the hold keys on ANY undecided trailing run — **[F] from BOTH classifiers, named:** `assess_absence`'s missing-bucket runs and empty windows, **and `assess_partial_drop`'s returned-but-low trailing runs** (a forming drop is a low-value run, not a missing one; the absence-only prose measured 0/300 on D2 — the pinned test was right, the sentence was wrong).

Grading span = `[graded_until, hold_point)`, `hold_point = bucket_floor_us(min(absence_window_end, start of first undecided trailing run — either classifier))`; analysis reads the full fetched window; emission is span-gated; then `graded_until := hold_point`. Partial-drop needs no separate mechanism because of the analysis/emission split.

**Persistence — decided, with wave-6 closures:**

- **Blob:** separate versioned sidecar key; **[F]** payload `"1:{interval_us}:{graded_until_us}"` (the interval embedded — §4.2's replication-hole defense); reader discards on interval mismatch and floors on read. Old nodes never read the key (no mixed-window parse risk); anchor blob untouched. Single writer per key — anchor: delivered-alert path; watermark: commit path — no CAS. Cross-region last-write-wins fails safe (stale → re-grade, deduped).
- **Ordering:** post-commit, in `commit_run`, **[F] cursor-first — pinned**: a cursor-write failure must leave the watermark unadvanced (`a_cursor_write_failure_leaves_the_watermark_unadvanced`) — the watermark-first mutant converts a cursor failure into a lost absence alert and survives every detection pin (gate 3A's surviving mutant #2).
- **[F] Missing-key resolution: `graded_until := cursor`** — the pre-watermark semantic (absence historically graded from the scored window). The wave-5 "window start" fallback was **circular**: the window start is itself defined by `graded_until`.
- **[F] Crash-window claim, downgraded to the truth:** a crash between the cursor write and the watermark put destroys BOTH dedup layers — `ABSENCE_EPISODES` is process-local and the anchor blob is written post-delivery — so the retry delivers **one duplicate onset alert**: bounded, fail-safe direction, accepted. Only the *soft* failure (blob put fails, process lives) is episode-deduped, as wave 5 claimed for both.

**N15 [G→F], with the corrected proviso:**

> `graded_until` is always a data-grid boundary (R2). Per region it never decreases and never passes the first ungraded bucket or the start of an undecided trailing run — either classifier (R3). Each run's emission span is fetched (R1). Every bucket is graded exactly once per region sequence **provided run gaps stay `≤ W − L`, where `L` is the watermark's maximum hold lag (absence allowance + one interval; ~900s at 5m)** — not `W − iv`, which is false at its own bound. Crash-retries and cross-region races re-grade a bounded span; the hard-crash window can deliver one duplicate onset (above); a skip is impossible **except** in the behind-window state, which is noticed and bounded, below.

**[F] The behind-window state — decided: advance with recorded skip + notice.** When `graded_until < bucket_floor_us(now − W)` at run start, the held span is **unfetchable forever** (the W-cap below), so holding would convert a bounded loss into a permanent stall with repeated silent loss. The run: (a) emits the **absence-skip notice** (class `window_skip`, its own message constant; **unconditional** — the loss is arithmetic-proven, unlike the scored skip's data-bearing gate, and a genuinely quiet stream does not enter this state: a persistent trailing gap eventually classifies as decided-absent and grades); (b) advances `graded_until` to `bucket_floor_us(now − W)`, recording the skipped span in the notice; (c) grades normally. This closes gate 3A's counterexample (gap = `W − iv` exactly: silent loss, `now − W < cursor`, no scored notice possible).

**[F] The W-cap is a pinned COST invariant (N18):** the fetch span never exceeds `W`. Gate 3A's surviving mutant #1 — unbounded fetch — passes every detection pin because more data only improves detection; the pin is cost and stability, and the test asserts the constructed query span, not a detection outcome. Related, recorded: in the W-clamp regime the head bucket of the fetch is partially covered and reads low to the drop judge — a pre-existing class, unchanged by this design (one sentence, so it is not re-found). And the unfloored-`graded_until` mutant is caught **only** by the state-assertion test (no scenario detects it — both grids agree at live intervals); the mandated test stays, with that reason recorded.

**Behavioural bounds [G]:** intermittent gaps may fire +1 onset per intermittence (solid outages improve) — accepted. Drops have no episode machinery: the revived drop path re-fires per cooldown while a drop persists — accepted (default-off, cooldown-paced; §10.9).

**Autopsy #4 [G]:** wave 4's pins passed against a broken fetch because the absence harnesses hand-build windows. §8 mandates a test driving the REAL `detect_uncommitted` construction end-to-end, plus the unfloored-watermark and persist-ordering mutants.

### 4.8 The notice lifecycle, end to end **[D→G→F]**

Machinery: `persist_detection_notice` / `notice_write_needed` / `next_notice_value` / `is_detection_notice` (`scheduler.rs:1669-1729` **[V]**).

- **Classes, one slot:** floor, skip, hybrid — the detector's determination returns at most ONE (floor > skip > hybrid); `next_notice_value` keeps only its Failed rule. **[F]** The skip class carries two message constants (scored skip; absence behind-window skip) under one `window_skip` class.
- **Emit:** at run start, before the empty-judged return. Hybrid recomputed only on scoring runs (model unloadable on the quiet path); quiet runs preserve a standing hybrid notice.
- **Skip conditions:** scored — `now − W > cursor` AND data-bearing fetch. **[F]** Recorded plainly: a stream *recovering* from an outage fires the scored skip notice once on its first data-bearing run — correct under the "skipped span plausibly contained data" framing (the span covered the outage tail; whether data landed there is unknowable post-hoc), one-shot, self-clearing. Absence behind-window — unconditional (§4.7).
- **Rate limit:** notices constant-text, emitted every qualifying run; persistence self-limits via `notice_write_needed` equality **[V]**; the once/hour throttle governs **logging only**, state process-local (`config_id → last_logged_at`, `ABSENCE_EPISODES` precedent).
- **Surface — `notice_class`:** the config API response carries `notice_class` (`"window_floor" | "window_skip" | "hybrid_fallback" | null`); the UI keys on it, never prefix-matching ENT strings. **[F] The three OSS serialization sites, named:** `model_to_api_json` (`:270` **[V]**, the list path — `add_effective_shingle_size` `:286` is the enrichment precedent) **and** the two direct `serde_json::to_value` paths that bypass it — detail (`:663-670`) and create/update (`:1002-1005`) **[V]** — a pre-existing list/detail enrichment asymmetry, noted so the field lands on all three. The classify function lives ENT-side in `scheduler.rs` beside the registry, exposed for the OSS response assembly.
- **Charts-branch collision:** the badge is a separate element keyed off `notice_class`, never a synthetic status (`feat/anomaly-charts-redesign` @ `7f0251601c`, `showAnomalyStatus` `AlertList.vue:378,:1342` **[V]**); merge conflict expected and recorded (§7).
- **Clear:** floor — first run with `W ≥` floor; skip — first qualifying-condition-free run; hybrid — first scoring run without the condition. **[F]** For completeness, the OTHER `last_error` writers are the training lifecycle's — `apply_status_transition` (ENT `scheduler.rs:1780+` **[V]**, `Set(None)` on Active/Training transitions) and `reset_for_retrain` (ENT `detector.rs:1582+` **[V]**) — both self-healing with respect to notices (a stomped notice re-emits next run); listed so they are not re-found as a gap.

---

## 5. ~~Making `edge_settle_seconds` configurable~~ — REMOVED **[U]**

> **Superseded [U].** Wave 1's part 1 in full — env var, `configured_*` helpers, methods, `settled_query_end_with`, OSS bridge, `/config` exposure — deleted (§6). Absence call sites revert to `::default()`. Two "settled" semantics remain, both absence-side, untouched. The operator migration note lives in §7 item 6.

---

## 6. Files touched **[U→G→F]**

**PAIRED CHANGE**, same branch both repos. OSS PR needs `e2e`; `ready-for-ci` when wanted. **[F] Implementability statement: every mechanism in §4 now has its implementing files named in this section — nothing in §4 lacks a §6 row.**

### `o2-enterprise` (from `a159df99`)

| Item | Action |
|---|---|
| `detector.rs` `scored_end_us` (`:1783-1830`), `scored_boundary_us` (`:857-872`) | Delete (wave 2). |
| `detector.rs` `settled_query_end_us`/`_with`/`configured_*` (`:1744-1782`) | Delete — the margin mechanism. |
| `detector.rs` `edge_settle_seconds()` + `absence_policy()`/`drop_policy()` (`:833-855`); `TestHooks.edge_settle_seconds` (`:178`) + fixture wiring | Delete; call sites to `::default()`; hook is dead code under `-D warnings`. |
| `detector.rs:1058`, `:1215` | Completeness check reads the run's own `query_end_us`. |
| `detector.rs` `next_cursor_us`/`floor_to_bucket_us` (`:1990-2001`) | `bucket_floor_us` on `HISTOGRAM_GRID_ORIGIN_US`; doc comments rewritten. |
| `detector.rs` `detect_uncommitted` (`:214-250`) | **R1 via the context-start channel** (shingle precedent `:232-250`): fetch widened to `max(now − W, min(cursor, graded_until))`; `score_from_us` untouched; hybrid `:226` floor composes after the `min`. Absence input = full fetched window. **[F]** N18: the constructed span never exceeds `W`. |
| `detector.rs`/`absence.rs` grading watermark | §4.7: R2 flooring; R3 hold from **both** classifiers (`assess_absence` AND `assess_partial_drop` **[F]**); sidecar key `"1:{interval_us}:{graded_until_us}"` **[F]**; post-commit cursor-first persist in `commit_run` **[F]**; missing key → `graded_until := cursor` **[F]**; behind-window advance + notice **[F]**. |
| `detector.rs:618-623` | Stale `absence_input` doc rewritten. |
| `detector.rs` `update_detection_timestamp` (`:1557-1571`) | Monotonic guard for `Some→Some`; permits the §4.2 `None` reset. |
| `absence.rs:749-758`, `:685-696`; `coverage.rs:138-144`, **[F]** `:106-108` | §4.1.1 sweep; comments flipped; `snap_to_grid` reclassified defensive-identity. |
| **[F]** `absence.rs:1916-1925` | The `b % interval == 0` test re-pointed to `(b − ORIGIN) % interval == 0`, +7m case, renamed. |
| **[F]** `servability.rs:101`, `:139-143` | No change; exemption comments (partition key origin-invariant; hour-of-week is a calendar convention). |
| `detector.rs` notice determination | Run start, pre-empty-return; single slot; hybrid preserved on quiet runs; scored-skip data-bearing gate; absence behind-window skip **[F]**; log-throttle map. |
| `scheduler.rs` (`:1669-1729`) | Registry, Failed-only `next_notice_value`, clears; **[F]** the `notice_class` classify fn lives here, exposed to OSS response assembly; notice unit tests (`:3120-3146`, `:3454-3462` **[V]**) re-pointed. |
| `types.rs:243` | Stale cursor comment updated. |
| `common/config.rs` env var (`:1411-1422`) | Delete. |
| N9 write suppression | Keep. |

Enterprise tests — delete (waves 2–5 lists): twelve watermark tests; `the_cursor_never_passes_an_unsettled_bucket`; N8 pair; `the_frozen_path_defers_a_closed_but_unsettled_bucket`; `a_bucket_inside_the_settle_margin_is_judged_on_the_next_run`; the `+SETTLE_US` cursor assertions; the `:4260`-area constant use. **Keep unchanged** (certified): the five released tests — **[F]** including `a_run_that_judges_no_buckets_still_advances_the_cursor`, a *pure-arithmetic* test of `next_cursor_us` whose name must NOT be "corrected" against §4.8's empty-run cursor hold: the hold is a control-flow property of `detect_in_window_uncommitted`, the test pins the arithmetic — both are true. SETTLE_US-padded behaviour tests: kept with windows re-pointed (padding dropped), per the wave-5 classification rule (gate census: seven strict-padding **[V-sub]**).
`tests/anomaly_cursor_window.rs`: mirrors deleted; wall-clock judging; off-grid phase parameter; date_bin-origin constants + 7m case; wave-3 renames. `anomaly_absence_episode.rs`/`anomaly_absence_real.rs`: model the shipped cursor/window-end pair; ≥1 test drives the REAL `detect_uncommitted` construction end-to-end; §4.7 scenario tests + **[F]** `a_cursor_write_failure_leaves_the_watermark_unadvanced`, the behind-window notice test, the N18 span assertion.

### `openobserve` (from `f5882d9ac4`)

| Item | Action |
|---|---|
| `anomaly_detection.rs` `edge_settle_seconds()` | Delete. |
| `validate_settle_headroom` → `validate_coverage_floor`; `validate_detection_window` | Floor `W ≥ schedule + histogram`; §4.5 tolerance; messages per §4.6. |
| `parse_interval` (`:2270-2292`) | Widen to `s/m/h/d`. |
| **[F]** Custom-SQL validation | §4.1.1's four AST-walk rules (sqlparser; semantic µs equality; argless form rejected); grandfathering skip-set extended to `custom_sql`. |
| **[F]** `anomaly_detection.rs` `update_config` (`:786-789`) | Interval-edit reset of cursor + `graded_until` to `None`, beside `retryable_change`, before the ENT broadcast. |
| **[F]** `notice_class` serialization | `model_to_api_json` (`:270`) + the detail (`:663-670`) and create/update (`:1002-1005`) `serde_json::to_value` paths — all three. |
| **[F]** Bypass flag plumbing (~9 files) | `src/proto/proto/cluster/plan.proto` (`IndexInfo` `:106`, new bool) + regenerated `src/proto/src/generated/cluster.rs` (checked in); `distributed_plan/node.rs` (`SearchInfos` `:69-174`); `config/src/datafusion/request.rs` (`Request` `:21` + both `From` impls); `flight.rs` — the guard at the rule-installation site (`:641-651`), NOT an early return inside `handle_tantivy_optimize` (§4.1.1 must-fix); set-site `execute_anomaly_query` (`:2356`). ENT `query_executor` row from wave 5 corrected: its fixed `Fn` signature cannot carry the flag. |
| `super_cluster_queue/src/anomaly_detection.rs` + `infra/.../config.rs` `patch_all_fields` (`:267`) | Monotonic cursor guard at the apply; `last_error` stomp accepted. |
| `status/mod.rs` settle exposure (3 sites) | Delete. |
| `handlers.rs` re-arm | **No change** (out of scope per user) — listed so nobody "fixes" it here. |
| `schema.ts`, `useAlertForm.ts`, `AnomalyDetectionConfig.vue` | §4.5 in full; form parsers widened. |
| `AlertList.vue`, `AddAlert.vue` | Badge keyed off `notice_class`; separate element; charts-branch conflict recorded. |
| `en-US.json` | Floor strings; legacy warning; badge strings; **[F]** both skip-message constants. |
| OSS tests | Delete/rewrite the four margin-premise validator tests (`:3316,:3337,:3363,:3383`); `AnomalyDetectionConfig.spec.ts:1126-1156,:1212` rewritten. |
| Pre-push | prettier + full-glob eslint; vitest for touched specs. |

Both write paths share the validators **[V-sub]**; certified converging. Enterprise verification via the `Cargo.toml.openobserve` swap; never commit it.

---

## 7. Migration **[U→G→F]**

**Numbers rule [D]:** every observed-cadence figure is measure-at-migration-time (test-config gaps drifted 3710–3986 → 3710–4713s; "≥4300 → 1.000" retracted; 7800 stands, safe to 7500).

**`k8s_events_anomaly`** — mandatory under every candidate: at `W=300` it writes nothing, loudly (floor notice + badge from the first quiet run). Raise to ≥600; in practice **3600**. Acceptance: 288/288 **data-bearing** buckets.

**The two `test` configs** — below floor (3900), grandfathered, warned. ~0.85 coverage at unchanged `W`; recommendation **7800**.

**Grid transition [G]:** the epoch→2001 hand-off is a no-op for all 11 live configs (every live interval divides 978,307,200s **[V]**); a hypothetical non-dividing legacy row self-heals: first run re-floors the cursor at most one interval earlier — bounded re-read, deduped.

**Mixed-version rollout** — no atomic cutover assumed; accepted one-time artifacts: (1) duplicate re-writes ≤ `ceil(600/iv)` buckets; (2) 1–3 stranded fragment rows per active config — the cleanup sweep covers **every** config's deploy-window trailing fragments; (3) contradictory fragment/full pairs vs pre-wave-1 prod — prefer later `created_at`; (4) cooldown-anchoring transients; (5) the watermark key is invisible to old nodes — first new-node run re-grades a bounded span, never skips; anchor blob format untouched; (6) any wave-1-era deployment that set `O2_ANOMALY_EDGE_SETTLE_SECONDS` silently reverts absence's allowance to 600 on deletion — release note (none known live **[V]**); (7) the badge conflicts with `feat/anomaly-charts-redesign`'s status cell — expected, one-element re-apply; **(8) [F]** old FOLLOWERS ignore the unknown proto flag — the fast path still serves anomaly queries from them during the rollout window (harmless at live intervals; the §10.10 retirement gate is fleet-deployed followers for the same reason).

**Corrupted rows:** 263 k8s rows (re-measure, then delete, scoped by name AND range) + the sweep. Recommend, not authorize. **Model state:** k8s never admitted — clean **[V]**; `test` configs frozen — no hybrid state.

---

## 8. Test plan **[U→G→F]**

### Released tests — certified surviving unchanged

`a_run_that_judges_no_buckets_still_advances_the_cursor` (pure arithmetic — see §6 note), `the_cursor_never_passes_an_unjudged_bucket` (tight at margin 0), `an_unparsable_cadence_leaves_the_cursor_on_wall_clock`, `the_completeness_rule_is_shared_by_both_scoring_paths`, `the_bucket_left_open_by_one_run_is_re_read_by_the_next`.

### Invariants

| # | Invariant | Status |
|---|---|---|
| N1–N3, N5, N6, N8 | Watermark-/margin-specific | Dead (waves 2–3). **[F]** (N4 removed from this dead list — it is alive below; the wave-5 table listed it both dead and alive.) |
| N4 | Admitted bucket never re-judged | Alive: `an_open_bucket_is_admitted_exactly_once_when_complete`. |
| N7 | Floor boundary-exact; rejects both dead formulas' minima | Kept. |
| N9 | Open bucket never published; once, whole, when complete | Kept, re-pointed. |
| N10 | Off-grid harness floor exactness + 7m non-dividing case on the true date_bin grid | Kept. |
| N11 / N12 | Client raw-equality grandfathering, value-based dirty check / tolerance never skips `W>0` | Kept. |
| N13 | Complete bucket judged by the FIRST run past its end | Kept — catches any reintroduced pullback. |
| N14 | `bucket_floor_us` fixed-point on the data grid; provenance-locked expected values; **[F]** pre-2001 case OFF-GRID; 420s case load-bearing for tz shift | Amended. |
| N15 | §4.7's restatement with the corrected proviso `G ≤ W − L` and the noticed behind-window state | **[F]** Amended. |
| N16a / N16b | Skip notices: scored (data-bearing gate; recovery one-shot recorded) and absence behind-window (unconditional); log-only throttle; quiet runs preserve hybrid | **[F]** Amended. |
| N17 | Interval edit resets cursor + `graded_until` (OSS `update_config` + blob interval-tag + floor-on-read); guard blocks every other rewind incl. the replicated apply | **[F]** Amended. |
| **N18 [F]** | The fetch span never exceeds `W` — a COST invariant, asserted on the constructed query span (unbounded fetch passes every detection pin; that is the point) | New. |

### Scenario tests (pins)

`a_two_bucket_outage_bracketed_by_partials_is_detected` (100% of phases — the certified bar), `an_interior_three_bucket_drop_fires_when_schedule_equals_interval`, `an_edge_settling_deferral_is_graded_by_a_later_run`, `a_below_minimum_trailing_gap_holds_the_watermark`, **[F]** `a_forming_drop_holds_the_watermark` (R3's second classifier), `an_undelivered_absence_onset_survives_through_the_held_watermark`, **[F]** `a_cursor_write_failure_leaves_the_watermark_unadvanced`, `a_total_outage_still_fires_absence`, **[F]** `a_watermark_behind_the_window_advances_with_a_notice`, `a_seven_minute_interval_config_reaches_full_coverage`, and ≥1 test driving the REAL `detect_uncommitted` construction end-to-end (autopsy #4).

### End-to-end (margin-0, off-grid clock)

1. `W=300`, 600s gaps → zero points, cursor advances, floor notice on the quiet path, badge via `notice_class`.
2. `W=600`, 300s gaps → every bucket judged exactly once, full value, first run past close.
3. `W=300` → validator rejects; forced legacy row → zero admissions; description-only edit saves byte-identical.
4. `W=3600`, measured gaps → 288/288 data-bearing; no skip notice.
5. 7m-histogram config at its floor → full coverage — proving both the flooring AND the bypass (the flag riding `IndexInfo` to the follower, the rule taken at `:641-651`).

### Mutation testing — required

| Mutant | Caught by |
|---|---|
| floor → `schedule` / any settle form | N7 / N10 |
| re-add a pullback | N13 |
| `bucket_floor_us` → epoch; `div_euclid` → `%` | N14 (off-grid pre-2001) / e2e 5 |
| fetch start → `max(cursor, now − W)` (drop R1) | end-to-end D1 — hand-built windows cannot catch it |
| `graded_until` unfloored (drop R2) | the state-assertion test ONLY (recorded why: scenarios can't see it at dividing intervals) |
| hold keys on one classifier (drop half of R3) | D2 scenario + `a_forming_drop_holds_the_watermark` |
| watermark persisted pre-commit / **[F]** watermark-first ordering | undelivered-onset test / `a_cursor_write_failure_…` |
| **[F]** fetch unbounded (drop the W-cap) | N18's span assertion ONLY (recorded why: detection pins reward it) |
| **[F]** behind-window: hold instead of advance, or advance without notice | `a_watermark_behind_the_window_advances_with_a_notice` |
| guard skips the replicated apply | N17 two-writer rewind test |
| notice emit after the empty-judged return; registry narrowed; precedence outside the detector; skip without the data-bearing gate | N16a/b |
| **[F]** bypass as an in-`handle_tantivy_optimize` early return (rule left installed) | e2e 5 with a filter clause — the collector-discard variant loses buckets |
| restore the unconditional point push | N9 |
| grandfathering / tolerance / raw-equality / dirty-check / custom-sql-AST mutants | N11 / N12 / §4.1.1 validator tests |
| resurrect watermark/cursor-floor/eager formula | Tombstone — resurrect wave-2 property tests from `a159df99` first. |

Gates: `cargo fmt --all`; OSS three-lint clippy; **[T]** ENT CI plain `-D warnings`; vitest on touched web specs.

### Live verification

1. k8s post-raise: control-profile ratios; 288/288 data-bearing; row `created_at` within one gap of bucket end.
2. Deploy→raise: zero k8s rows; floor notice visible as a badge.
3. `test` configs: no new trailing fragments; ≥0.85 coverage; scored skip notice present.
4. Fleet, one week: absence-alert rate unchanged; no bucket graded twice; no drop re-fire storm.
5. Any non-dividing-interval config: full coverage AND histogram rows matching a direct DataFusion query.

---

## 9. Rollout and risk

### Certified — keep unchanged **[D→G→F]**

Gate 1: the margin-free scored core (six replay scenarios ≤0.005), the five released tests, the empty-window cursor hold, deletion coherence, shared validators, OSS/ENT compile coupling. Gate 2: the §4.7 repairs (295/295, per-repair ablations). **[F] Gate 3: the repairs independently re-simulated at 100% of phases on every pinned scenario — no mechanism broken; wave 6 is text and inventory closure only.**

### Evidence posture

Settle-time evidence (**[T]**) is the steady-state cost bound (§3.6), §0-scoped. No margin returns without §10.3's measurement.

### Staging

- **Phase A** — margin removal + grid origin & bypass + write suppression + repaired watermark + validator/UI + notices (§4, §6). One coherent change, ON, no flag; N13–N18 pin it.
- **Phase B** — migration (§7).

### Residual risks

| Risk | Severity | Mitigation |
|---|---|---|
| Tail-event partial judged permanently | Accepted (§0) | Recorded; hour-late streams out of the 0–0.8% claim. |
| Reintroduction from an old spec copy | High | Superseded blocks; N13; tombstone. |
| Gap beyond the health bounds | Medium | Both bounds stated (`W − iv` scored, `W − L` absence); skip + behind-window notices catch it live. |
| Hard-crash duplicate onset | Low, accepted | One delivered duplicate, fail-safe (§4.7); soft failures episode-deduped. |
| Absence over-fire on intermittent gaps / drop per-cooldown re-fires | Low, accepted | Bounds recorded (§4.7, §10.9). |
| Watermark blob unavailable / interval-mismatched | Low | Discard → `graded_until := cursor`; re-grade, deduped; never a skip. |
| Index fast path re-enabled for anomaly | Medium | e2e 5 (+filter variant) pins the rule-taken guard. |
| Charts-branch merge conflict | Known, planned | Separate `notice_class`-keyed element; §7 item 7. |
| Old followers serving the fast path mid-rollout | Low, transient | §7 item 8; harmless at live intervals; §10.10 gate = fleet-deployed followers. |
| Mixed-version artifacts | Low, one-time | §7 enumerates; sweep. |

---

## 10. Open questions

**1. ~~Alternation~~** — resolved (§2). **2. Grandfathering tightness** — open product call. **3. Settle-time under degradation** — required before any margin returns. **4. Scheduler cadence** — §10.8. **5. D6 duplicates** — pre-existing, OUT OF SCOPE. **6. Absence/drop margins** — §0 assumption; extending removal to them is a new design. **7. Per-config recency slack** — derived streams' `delay` if ever needed.

**8. The scheduler re-arm** — known cause of the ~2× overrun; out of scope per user; the design is correct under overrun.

**9. Cooldown vs absence onset [G]:** the loss path is a cooldown-suppressed onset consuming the episode; `abandon_run` rolls back only on dispatch-failed. Correct starting point: a suppressed onset must not advance the episode. Drops per-cooldown re-fire: accepted (§4.7).

**10. The index-optimizer origin bug — filed separately [G→F]:** epoch-grid binning disagrees with date_bin for every non-dividing interval, product-wide. OSS-only PR. **[F] The filed issue must carry:** the reproduction (fast-path vs DataFusion divergence at a non-dividing interval), the origin constant and its `rewrite_histogram.rs` source, and the divisor criterion (intervals dividing 978,307,200s are accidentally safe). **Retirement gate for this PR's bypass flag: the engine fix deployed to the FLEET'S FOLLOWERS, not merged** — followers re-derive modes locally (§4.1.1), so a merged-but-undeployed fix leaves old followers binning on the epoch grid.

---

## Appendix A: verification ledger

**Live (2026-09-18) [V]:** fleet listing (eight healthy of 11); per-config rows/buckets (D6 ratio); k8s phase lock; `test` per-id coverage; per-run reconstruction; run-gap distributions (drifted by gate time → measure-at-migration); fragment count 263; introspect env empty.

**Simulation [V]:** shipped predicates, off-grid, 1s phases; margin-600/0 sweeps; live cross-checks (0.496/0.500; 0.929/0.896–0.910; 0.854); remedy sweeps. Gate 1 replay ≤0.005. Gate 2B failure/repair (49%/3% detection, D2 0/295 → 295/295). **[F]** Gate 3A: independent re-simulation of R1–R3 at 100% of phases on every pinned scenario; two surviving mutants adjudicated as pin-class gaps (W-cap cost; watermark-first ordering), both pinned in §8.

**Code, first-hand [V]:** waves 3–5 ledgers, plus wave 6: `execute_anomaly_query` (`:2356`); `update_config`'s `histogram_interval` branch (`:786-789`); `model_to_api_json`/`add_effective_shingle_size` (`:270,:286`) and the two direct `to_value` paths (`:663-670,:1002-1005`); the `flight.rs` rule-installation guard (`:641-651`); `IndexInfo` (`plan.proto:106`) and the generated `cluster.rs`; `SearchInfos` (`node.rs:69-174`); `Request` (`request.rs:21`); `servability.rs:101,:139-143`; the `b % interval == 0` test (`absence.rs:1916-1925`); the `census_from_points` comment (`coverage.rs:106-108`); the `stale_interval` doc (`detector.rs:1295-1312`); `reset_for_retrain` (ENT `detector.rs:1582`); `apply_status_transition` (ENT `scheduler.rs:1780`); **[F]** `absence_window_end_us` correctly attributed to `detector.rs:1832-1848`.

**From gate reports [V-sub], anchors spot-checked:** gate 2's numbers; gate 3A's phase-complete certification and mutant adjudications; 3B's collector-discard trace (`grpc/storage.rs → tantivy_search`) and the leader/follower mode-derivation fact; 3C's footprint census (~8–10 files) and serialization-site inventory.

**Carried [T]:** settle-time measurements; storm-renders-as-dip; ENT CI `-D warnings`.

## Appendix B: corrections history

**Wave 1 [C]:** cursor floor a defect; eager watermark formula; validator "corrected" into its own defect; signatures kept; flag removed for property tests.

**Wave 2 [R]:** watermark removed; floor restored with derivation + off-grid sim; grid-aligned-clock autopsy; client grandfathering; tolerance; one-minimum; D6 out of scope; D7 corrected live; alternation closed.

**Wave 3 [U]:** scored margin dropped entirely; boundary = completion; floor `schedule + histogram`; three-candidate evaluation, decision 0; accepted risk dated; released tests survive; parity grounding; margin removal rescues k8s in NEITHER harm.

**Wave 4 [D]:** grid-origin P0; absence watermark + analysis/emission split; validity-vs-health reframe; runtime skip notice; notice lifecycle; raw-triple suppression; inventory completion; mixed-version artifacts; autopsy #3.

**Wave 5 [G]:** §4.7 replaced with gate-2's verified repairs (R1–R3) + persistence decisions; two-grid reality (bypass + filed engine bug); guard relocated to the replicated apply; interval-edit reset; quiet-run hybrid exclusion; data-bearing skip gate; `notice_class`; charts collision; autopsy #4.

**Wave 6 [F]** (gate 3 on `43df0777e5` — no mechanism broken; closure only): **N15's proviso corrected** to `G ≤ W − L` (L = allowance + interval; the wave-5 `W − iv` bound was false at its own boundary) and the **behind-window state decided: advance with recorded skip + unconditional notice** (holding an unfetchable span is a permanent silent stall; the counterexample gap `= W − iv` is now noticed). **R3's prose spans both classifiers** — `assess_partial_drop`'s low-value trailing runs named beside `assess_absence`'s (the absence-only sentence measured 0/300 on D2; the pinned test was right, the prose wrong). **Crash-window claim downgraded**: a hard crash between cursor write and blob put delivers one duplicate onset (both dedup layers die with the process); only soft failures are episode-deduped. **Two orderings pinned**: cursor-first in `commit_run` (watermark-first survives every detection pin while converting cursor failure into a lost alert); missing-key = `graded_until := cursor` (the "window start" fallback was circular). **W-cap pinned as a cost invariant** (N18 — unbounded fetch improves detection, so only a span assertion catches it); the W-clamp head-bucket-reads-low class and the unfloored-mutant's state-test-only catch recorded. **Bypass must-fix**: suppression moved to the rule-installation guard (`flight.rs:641-651`) — an in-function early return leaves the collector running and discarding indexed files. **Carrier decided: `IndexInfo`** (verbatim on the super-cluster hop; `SearchInfos` is rebuilt and can drop it), with the ~9-file footprint named and the set-site corrected to OSS `execute_anomaly_query` (the ENT executor's `Fn` signature cannot carry it); the leader-never-supplies-modes fact recorded as why the proto touch is unavoidable. **UI-chart decision: accept + record** (zero live exposure; §10.10 cures product-wide; flag-threading rejected as scope growth). **Custom SQL**: AST walk mandated; semantic µs equality; argless form rejected; `Query.timezone` scoped out; **grandfathering extended to `custom_sql`**. **Repo rule clause 3** (defensive identity); `snap_to_grid` reclassified; `servability.rs` exemptions; the `b % interval == 0` test re-pointed; `census_from_points` comment flipped. **N14**: pre-2001 case must be off-grid; 420s is the tz-shift detector. **§10.10**: issue contents mandated; retirement gate = fleet-deployed followers. **Interval-edit closure**: OSS `update_config` named; the region-local `graded_until` hole closed with both belts (interval-tagged payload + floor-on-read); in-flight bound recorded. **`notice_class` closure**: all three OSS serialization sites named (list-path enrichment + the two bypassing `to_value` paths, asymmetry noted); ENT classify in `scheduler.rs`. One-sentencers: recovery-run one-shot skip notice; R1 via the context-start channel with the hybrid-floor composition; training-lifecycle `last_error` writers listed; ledger cosmetics (N4 no longer dead-and-alive; `absence_window_end_us` in `detector.rs`; re-arm anchors marked checkout-drifting; the pure-arithmetic test's name protected; healthy-config count eight).

**Corrections to review/coordination claims:** (waves 2–5 entries stand). **(wave 6)** the gate-3 digest verified clean at every spot-checked anchor; two notes: the digest's `apply_status_transition`/`reset_for_retrain` line numbers are from its own checkout (functions live at ENT `scheduler.rs:1780` / ENT `detector.rs:1582` here — regions, not exact lines, are cited accordingly); and 3C's "~8–10 files" flag footprint resolves to ~9 in this checkout, enumerated in §6, with the ENT set-site misattribution (introduced in wave 5) fixed rather than re-counted.
