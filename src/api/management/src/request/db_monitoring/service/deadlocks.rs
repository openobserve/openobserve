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

//! `/deadlocks` — the canonical event read, the MySQL side stitching and the
//! raw-span fallback that covers windows the canonicalizer had not yet seen.

// The models these pull in are named only from enterprise-gated bodies, so the
// glob is genuinely unused on OSS. Keep the import (enterprise needs it) and
// silence the OSS-only lint rather than splitting it behind a cfg.
#[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
use super::{super::models::*, *};

/// The raw deadlock columns this stream can be queried for.
///
/// Candidates come from `config`'s shared [`server_vantage::RAW_DEADLOCK_FIELDS`]
/// and never from a local list: the enterprise canonicalizers that CONSUME these
/// names cannot see this crate, so a second copy here would drift silently and
/// the cross-repo contract test
/// (`every_raw_field_the_oss_read_projects_is_read_by_a_canonicalizer`) would
/// not be able to see the drift.
#[cfg(feature = "enterprise")]
fn raw_deadlock_columns_in(
    schema: &arrow_schema::Schema,
    uds_fields: &[String],
) -> HashSet<String> {
    queryable_columns(&server_vantage::RAW_DEADLOCK_FIELDS, schema, uds_fields)
}

/// Read the raw-column gate for one stream.
///
/// Propagates `Err` rather than `unwrap_or_default()`, for the reason
/// [`present_dbm_columns`] spells out at length: an empty set from a DB blip is
/// indistinguishable from "this stream has no raw deadlock columns", and both
/// then produce a confident wrong answer — here, an empty Deadlocks page over a
/// stream full of deadlocks, which is the very bug A1 exists to fix.
///
/// The stream SETTINGS read is deliberately not fatal on its own: `get_settings`
/// returns `Option` and answers `None` both for "no settings" and for a read it
/// could not serve. `None` is treated as UDS-disabled, which is the same
/// assumption every other reader in the codebase makes
/// (`get_stream_setting_defined_schema_fields` maps `None` to an empty vec), and
/// the failure mode if that assumption is ever wrong is a 400 on the page — loud
/// — rather than a silent under-report.
#[cfg(feature = "enterprise")]
async fn present_raw_deadlock_columns(
    org_id: &str,
    stream_name: &str,
) -> Result<HashSet<String>, anyhow::Error> {
    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await?;
    let settings = infra::schema::get_settings(org_id, stream_name, StreamType::Logs).await;
    let uds = infra::schema::get_stream_setting_defined_schema_fields(&settings);
    Ok(raw_deadlock_columns_in(&schema, &uds))
}

// ─── W2.3 · Activity read API ────────────────────────────────────────────────

/// The A1 raw-deadlock widening, when it is active.
///
/// Carries the SCHEMA-GATED raw column set — the output of
/// [`raw_deadlock_columns_in`], never a hardcoded list — because both halves of
/// the widening (the projection and the marker predicate) name real columns, and
/// naming an absent one fails the whole query.
///
/// A distinct type rather than a bare `HashSet` so the builder's other two
/// callers cannot pass one by accident: blocking and activity share the builder
/// and must be untouched in phase 1.
///
/// NOT `#[cfg]`-gated, unlike everything else A1 adds, because activity is an
/// OSS-owned ungated page that calls the same builder — so the parameter's type
/// has to exist in both builds. It is inert on OSS: nothing there constructs one
/// (only the enterprise deadlocks body does), so every OSS caller passes `None`
/// and the emitted SQL is byte-identical to before A1.
pub(crate) struct RawDeadlockFallback {
    /// Raw columns this stream can actually be queried for.
    pub present: HashSet<String>,
}

impl RawDeadlockFallback {
    /// The marker terms for the `WHERE`, restricted to marker columns the stream
    /// HAS.
    ///
    /// Each marker is itself a column, so an ungated term is the same 400 as an
    /// ungated projection entry — the half of the hazard that lives in the
    /// predicate. A stream that never saw a MariaDB deadlock has no
    /// `o2_maria_event` column, and naming it takes the page down.
    ///
    /// Values are the fixed `KIND_DEADLOCK` literal from `config`, not user
    /// input, so there is nothing here to escape; the column names are a
    /// compile-time whitelist for the same reason [`dbm_event_preds`] documents.
    pub(super) fn marker_terms(&self) -> Vec<String> {
        server_vantage::DEADLOCK_MARKERS
            .into_iter()
            .filter(|(col, _)| self.present.contains(*col))
            .map(|(col, val)| format!("{col} = '{val}'"))
            .collect()
    }
}

/// SQL for ANY raw-marker deadlock row inside the window.
///
/// Schema-gated exactly like the widening it guards: each marker is a COLUMN,
/// and naming one absent from the stream fails the WHOLE query with a 400 — so a
/// probe that hardcodes all four markers takes the page down on precisely the
/// deployments the fallback exists for.
///
/// `None` when the stream has no marker column at all: there is then no query to
/// run, and no raw row can exist, so the caller reads that as "no raw rows" for
/// free.
#[cfg(feature = "enterprise")]
pub(crate) fn build_raw_deadlock_presence_sql(
    stream_name: &str,
    raw: &RawDeadlockFallback,
) -> Option<String> {
    let markers = raw.marker_terms();
    if markers.is_empty() {
        return None;
    }
    Some(format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE ({})\nLIMIT 1",
        escape_ident(stream_name),
        markers.join(" OR "),
    ))
}

/// Run both boundary probes concurrently and decide whether this window needs
/// the raw widening.
///
/// Errors degrade to the SAFE direction — the pre-A1.1 always-on behaviour —
/// rather than to an error page: a failed probe means we do not know whether the
/// window is fully canonicalized, and the house rule is to show data. The cost
/// of being wrong that way is a wider read; the cost of being wrong the other
/// way is the empty page over real deadlocks that A1 exists to fix.
#[cfg(feature = "enterprise")]
async fn deadlock_window_needs_fallback(
    org_id: &str,
    user_id: Option<&str>,
    stream: &str,
    start_time: i64,
    end_time: i64,
    raw: &RawDeadlockFallback,
) -> bool {
    let Some(raw_sql) = build_raw_deadlock_presence_sql(stream, raw) else {
        // No marker column on this stream, so no raw row can exist. Nothing for
        // the widening to surface, and we did not even have to ask.
        return false;
    };
    let canonical_sql = build_earliest_canonical_sql(stream, server_vantage::KIND_DEADLOCK);
    // Two independent bounded reads — the same `tokio::join!` shape
    // `probe_collection` already uses for its pair.
    let (canonical_rows, raw_rows) = tokio::join!(
        run_events_search(org_id, user_id, stream, canonical_sql, start_time, end_time),
        run_events_search(org_id, user_id, stream, raw_sql, start_time, end_time),
    );
    let (canonical_rows, raw_rows) = match (canonical_rows, raw_rows) {
        (Ok(c), Ok(r)) => (c, r),
        (c, r) => {
            let e = c.err().or_else(|| r.err());
            log::warn!(
                "[DbMonitoring] deadlock boundary probe failed for {org_id}/{stream}, \
                 widening the read as before: {e:?}"
            );
            return true;
        }
    };
    let probe = BoundaryProbe {
        // NOT `get_i64`, deliberately: that maps an absent or unparseable value
        // to 0, and 0 is a valid-looking timestamp at the epoch. The verdict
        // does not read this field, so today that would be harmless — but it
        // would silently turn "we could not read the row" into "canonicalization
        // started in 1970" in the diagnostic below, which is the log line an
        // operator would be reading precisely when something is wrong.
        earliest_canonical: canonical_rows
            .first()
            .and_then(|r| r.get("_timestamp"))
            .and_then(Value::as_i64),
        has_raw_row: !raw_rows.is_empty(),
    };
    let needed = probe.fallback_needed(start_time);
    if needed {
        // The one question an operator asks about this feature is "why is my
        // deadlocks read wide?", and the answer is a raw row in the window. The
        // canonical boundary is logged beside it because the useful follow-up is
        // "and has this deployment started canonicalizing at all" — a `None`
        // there on a supposedly-upgraded cluster means ingest is still landing
        // on an OSS node, which is a different problem with the same symptom.
        log::debug!(
            "[DbMonitoring] deadlocks widening for {org_id}/{stream}: a raw \
             deadlock row is present in the window; earliest canonical row in \
             window = {:?}",
            probe.earliest_canonical,
        );
    }
    needed
}

/// Micro-seconds within which two MySQL single-participant entries are taken to
/// be two sides of ONE deadlock.
///
/// InnoDB writes each `*** (N) TRANSACTION:` block as its own timestamped log
/// entry; the lab measured the sides ~150 µs apart. The bound is deliberately
/// generous (2 s) because a false split is worse than a false merge here: a
/// split double-counts the deadlock AND lands the two halves in different query
/// shape groups, so the same bug reads as two unrelated half-sized ones.
///
/// That trade only holds ONCE THE SERVER IS KNOWN to be the same one — hence the
/// identity guard in [`stitch_mysql_deadlocks`]. Across two servers the window is
/// not evidence of anything, and a false merge fabricates a cycle.
#[cfg(feature = "enterprise")]
const MYSQL_SIDE_WINDOW_MICROS: i64 = 2_000_000;

/// Rebuild a [`server_vantage::DeadlockEvent`] from one stored canonical row.
///
/// Reads only the canonical `o2_dbm_*` columns — the engine-specific fields they
/// were derived from (`dl_query_1`, `my_trx_thread`) are ingest-side inputs and
/// are never re-read here.
#[cfg(feature = "enterprise")]
fn deadlock_event_from_row(row: &Value) -> server_vantage::DeadlockEvent {
    let ts = match get_i64(row, server_vantage::O2_DBM_TIMESTAMP) {
        0 => get_i64(row, "_timestamp"),
        t => t,
    };
    let opt = |k: &str| {
        let s = get_str(row, k);
        (!s.is_empty()).then_some(s)
    };
    server_vantage::DeadlockEvent {
        engine: opt(server_vantage::O2_DBM_ENGINE),
        database: opt(server_vantage::O2_DBM_DATABASE),
        instance: opt(server_vantage::O2_DBM_INSTANCE),
        timestamp: (ts != 0).then_some(ts),
        victim_pid: row
            .get(server_vantage::O2_DBM_VICTIM_PID)
            .and_then(server_vantage::as_i64_loose),
        participants: server_vantage::participants_of(row),
        raw: opt(server_vantage::O2_DBM_RAW),
        // Carries MySQL's rollback verdict from its own row into the stitch —
        // without this the sides and the verdict never meet.
        victim_side: row
            .get(server_vantage::O2_DBM_VICTIM_SIDE)
            .and_then(server_vantage::as_i64_loose),
    }
}

/// Turn ONE stored row into a [`server_vantage::DeadlockEvent`], whichever shape
/// it is in — the A1 read-time fallback's row-level branch.
///
/// **The discriminator is per-ROW, not per-stream.** A deployment that upgraded
/// OSS → enterprise mid-window has both shapes inside a single query result, so
/// there is no stream-level mode flag that could decide this.
///
/// **This is also the dedup (§4.1).** The two populations are disjoint by
/// construction: a row either has `o2_dbm_kind = 'deadlock'` or it does not, and
/// this branches on exactly that, consuming each row exactly once. There is no
/// path that emits both forms of one row — including for a row that carries BOTH
/// vocabularies, where the canonical branch wins because those fields were
/// resolved once already at ingest and re-deriving them would be strictly worse.
///
/// A raw row the canonicalizer refuses yields `None` and is DROPPED, not emitted
/// blank. That is load-bearing for Postgres, which logs a banner entry beside
/// every DETAIL entry: emitting banners would put a participant-less row on the
/// page for every PG deadlock and double the visible count.
///
/// The residual duplicate risk is double-INGESTION, not double-emission: the
/// same log line ingested by both an OSS and an enterprise node in a mixed
/// cluster is two distinct rows, and this fallback makes both visible. It
/// resolves once every node is enterprise.
#[cfg(feature = "enterprise")]
fn deadlock_event_for_row(row: &Value) -> Option<server_vantage::DeadlockEvent> {
    if get_str(row, server_vantage::O2_DBM_KIND) == server_vantage::KIND_DEADLOCK {
        return Some(deadlock_event_from_row(row));
    }
    // Not canonical — hand the raw record to the SAME canonicalizer the ingest
    // path uses, so a row read back reads exactly as it would have been written.
    let rec = row.as_object()?;
    o2_enterprise::enterprise::db_monitoring::deadlock::canonicalize_deadlock_event(rec)
}

/// Stitch MySQL single-participant deadlock entries into whole deadlocks.
///
/// **Why at read time.** `merge_mysql_deadlocks` has existed since the ingest
/// work but had no production caller: canonicalization runs per-record, and a
/// per-record hook cannot hold the cross-record state that stitching needs. The
/// read path is the first place that sees a whole window at once.
///
/// Correlation key is `(engine, instance, database)` — pids and transaction ids
/// are only comparable within one server, so merging across instances would
/// fabricate a deadlock between unrelated databases. Within a group, entries
/// within [`MYSQL_SIDE_WINDOW_MICROS`] of the open event join it unless they
/// repeat a transaction id already present (that is the NEXT deadlock reusing
/// the window, not another side).
///
/// **An EMPTY instance is not a group.** The shipped filelog deadlock recipes tag
/// neither instance nor database, so untagged sides would otherwise all land in
/// the single bucket `("mysql", "", "")`, fusing unrelated hosts' deadlocks into
/// one multi-participant event. The transaction-id guard does not catch this —
/// ids differ across servers, so it permits the merge.
///
/// So an untagged side is not stitched at all: it passes through as the
/// one-participant event it is, flagged `partial` on the wire. That over-reports
/// deadlock COUNT on an untagged deployment, which is the safe direction —
/// dropping it would turn a real deadlock into no deadlock, while merging it
/// invents a cycle that never happened. The fix on the collector side is to tag
/// an instance in the recipe, which restores full stitching.
///
/// Postgres events pass through untouched: the `DETAIL:` entry already carries
/// the whole wait cycle, so a PG event arrives with both sides and merging two
/// of them would invent a 4-way cycle that never happened.
#[cfg(feature = "enterprise")]
pub(crate) fn stitch_mysql_deadlocks(
    events: Vec<server_vantage::DeadlockEvent>,
) -> Vec<server_vantage::DeadlockEvent> {
    let mut passthrough: Vec<server_vantage::DeadlockEvent> = Vec::new();
    // Group key: only same-server single-participant MySQL entries can stitch.
    // (engine, instance) — the database is deliberately NOT part of the key;
    // see the comment where the key is built below.
    let mut groups: BTreeMap<(String, String), Vec<server_vantage::DeadlockEvent>> =
        BTreeMap::new();

    for ev in events {
        // MariaDB splits a deadlock the same way MySQL does (side, side, then
        // the rollback verdict alone), so it needs the identical stitch. The
        // group key includes the engine, so MariaDB and MySQL rows can never
        // merge into one another's events.
        let is_mysql = matches!(ev.engine.as_deref(), Some("mysql") | Some("mariadb"));
        // A MySQL row joins the stitch if it is a SIDE (exactly one
        // participant) or the ROLLBACK VERDICT (no participants, just
        // `victim_side`). The verdict must reach the merge — it is the only
        // record naming which side was cancelled, and dropping it here is what
        // left every MySQL participant unflagged and the "cancelled by the
        // database" panel blank.
        //
        // Anything else is already whole (Postgres DETAIL entries, or a MySQL
        // event a future collector ships pre-assembled) and passes through.
        let is_side = ev.participants.len() == 1;
        let is_verdict = ev.participants.is_empty() && ev.victim_side.is_some();
        if !is_mysql || !(is_side || is_verdict) {
            passthrough.push(ev);
            continue;
        }
        // Identity, not `unwrap_or_default()`: without an instance there is no
        // group to belong to (see the doc comment). Sides still surface, as
        // partial one-participant events.
        let Some(instance) = ev.instance.clone().filter(|s| !s.is_empty()) else {
            // A participant-LESS verdict record (`WE ROLL BACK TRANSACTION (N)`)
            // is the one thing that must NOT pass through: alone it names a side
            // number and nothing else — no pid, no statement — so it would
            // render as a content-free deadlock row and inflate the count with a
            // record that describes no event. It is only ever meaningful joined
            // to the sides, and unstitchable means it can never be joined.
            if is_side {
                passthrough.push(ev);
            }
            continue;
        };
        // The key is (engine, instance) ONLY — deliberately not the database.
        //
        // InnoDB splits one deadlock side across two records, and only ONE of
        // them names the database: the `*** (N) TRANSACTION:` block carries the
        // thread and statement with no database, while the
        // `*** (N) HOLDS THE LOCK(S)` block carries `db.table` and no
        // participant. Keying on the database therefore put the two halves of
        // the SAME side into different groups, so they could never merge: the
        // lock halves surfaced as content-free rows (participants=0) and the
        // real sides kept the null database that made the Deadlocks tab's
        // `?database=` filter useless on MySQL.
        //
        // Dropping it from the key is safe because the group is already scoped
        // to one server (engine + instance) and closed by a proximity window of
        // a couple of seconds; two deadlocks in DIFFERENT databases on the same
        // instance inside that window are still separated by
        // `merge_mysql_deadlocks`' own guard, which starts a new group as soon
        // as a transaction id repeats. The merged event takes whichever
        // database its members supply.
        let key = (ev.engine.clone().unwrap_or_default(), instance);
        groups.entry(key).or_default().push(ev);
    }

    let mut out = passthrough;
    for (_, sides) in groups {
        // `merge_mysql_deadlocks` sorts by timestamp and enforces the
        // distinct-transaction-id rule; a 3+ way pileup therefore accumulates
        // into one event, and an unmatched singleton simply stays a
        // one-participant event (flagged `partial` on the wire).
        out.extend(server_vantage::merge_mysql_deadlocks(
            sides,
            MYSQL_SIDE_WINDOW_MICROS,
        ));
    }
    // Newest first — the order the UI renders and the order the raw read used.
    out.sort_by_key(|e| std::cmp::Reverse(e.timestamp.unwrap_or(0)));
    out
}

/// Serialize one assembled deadlock into the UI-facing DTO.
///
/// `participants` is a real ARRAY here, and `query_shape` is recomputed from the
/// assembled participant set rather than read off the row: a stitched MySQL
/// event's shape must cover BOTH sides, but each stored row only ever knew its
/// own. Recomputing routes both engines through the identical
/// `DeadlockEvent::query_shape` — the sorted, deduped, victim-order-independent
/// fingerprint set — so a MySQL deadlock and a Postgres one group by the same
/// rule.
#[cfg(feature = "enterprise")]
fn deadlock_event_to_dto(ev: &server_vantage::DeadlockEvent) -> Value {
    let ts = ev.timestamp.unwrap_or(0);
    let participants: Vec<Value> = ev
        .participants
        .iter()
        .map(|p| {
            json!({
                "pid": p.pid,
                "transaction_id": p.transaction_id,
                "query": p.query,
                "query_norm": p.query_norm,
                "fingerprint": p.fingerprint,
                "application": p.app,
                "user": p.user,
                "lock_mode": p.lock_mode,
                "lock_target": p.lock_target,
                // The event's explicit victim verdict wins over the
                // per-participant flag when the log named a process.
                "victim": match ev.victim_pid {
                    Some(v) => p.pid == Some(v),
                    None => p.victim,
                },
            })
        })
        .collect();
    json!({
        // pid + timestamp is unique per event: one session cannot deadlock
        // twice at the same microsecond.
        "id": format!(
            "{ts}-{}",
            ev.victim_pid
                .or_else(|| ev.participants.first().and_then(|p| p.pid))
                .map(|p| p.to_string())
                .unwrap_or_else(|| "x".to_string())
        ),
        "timestamp": ts,
        "db_system": ev.engine.clone().unwrap_or_default(),
        "db_instance": ev.instance,
        "db_namespace": ev.database,
        "victim_pid": ev.victim_pid,
        "participant_count": ev.participants.len(),
        // A deadlock needs two sides. One side means the other never arrived
        // (MySQL entry lost, or the window cut it off) — the UI must be able to
        // say "partial" rather than render a nonsensical one-sided cycle.
        "partial": ev.participants.len() < 2,
        "query_shape": ev.query_shape(),
        "objects": objects_of(ev),
        "participants": participants,
        "raw": ev.raw,
    })
}

/// The table(s) the sides fought over, in participant order and deduped.
#[cfg(feature = "enterprise")]
fn objects_of(ev: &server_vantage::DeadlockEvent) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for p in &ev.participants {
        if let Some(t) = p.lock_target.as_deref()
            && !t.is_empty()
            && !seen.iter().any(|s| s == t)
        {
            seen.push(t.to_string());
        }
    }
    seen
}

/// Rank deadlock events by QUERY SHAPE — the sorted participant-fingerprint set.
///
/// The victim alternating between firings is the SIGNATURE of a symmetric
/// lock-ordering bug (proof Demo 2), so the grouping key must be victim-order
/// independent or one bug would split into two rows that each look half as bad.
///
/// Takes ASSEMBLED events, not stored rows. The stored `o2_dbm_query_shape`
/// column is written per record, so on MySQL — where each record is one SIDE —
/// it holds a single participant's fingerprint. Grouping on it put the two
/// halves of one MySQL deadlock in different rows while Postgres, whose record
/// already carries both sides, grouped correctly. Recomputing from the stitched
/// event via `DeadlockEvent::query_shape` makes the key the sorted, deduped
/// fingerprint SET on both engines.
#[cfg(feature = "enterprise")]
pub(crate) fn rank_deadlock_shapes(events: &[server_vantage::DeadlockEvent]) -> Vec<Value> {
    let mut groups: BTreeMap<String, (i64, i64, BTreeSet<String>, Vec<String>)> = BTreeMap::new();
    for ev in events {
        let Some(shape) = ev.query_shape() else {
            // Participants whose SQL failed to normalize have no fingerprint,
            // so there is no shape to rank them under.
            continue;
        };
        let ts = ev.timestamp.unwrap_or(0);
        let entry = groups
            .entry(shape)
            .or_insert_with(|| (0, 0, BTreeSet::new(), Vec::new()));
        entry.0 += 1;
        entry.1 = entry.1.max(ts);
        for p in &ev.participants {
            if let Some(fp) = p.fingerprint.clone() {
                entry.2.insert(fp);
            }
            if let Some(q) = p.query_norm.clone().or_else(|| p.query.clone())
                && entry.3.len() < 4
                && !entry.3.contains(&q)
            {
                entry.3.push(q);
            }
        }
    }
    let mut out: Vec<Value> = groups
        .into_iter()
        .map(|(shape, (count, last_seen, fps, queries))| {
            json!({
                "query_shape": shape,
                "count": count,
                "last_seen": last_seen,
                "fingerprints": fps.into_iter().collect::<Vec<_>>(),
                "queries": queries,
            })
        })
        .collect();
    out.sort_by(|a, b| {
        get_i64(b, "count")
            .cmp(&get_i64(a, "count"))
            .then(get_i64(b, "last_seen").cmp(&get_i64(a, "last_seen")))
    });
    out
}

// ─── Collection diagnostics: "nothing happened" vs "nothing is watching" ─────
//
// An empty Deadlocks or Blocked tab has two OPPOSITE meanings and the operator
// cannot tell them apart from the absence itself. "No deadlocks" shown while the
// filelog receiver is misconfigured is not a neutral blank — it is an active
// lie, and it is a lie told exactly on the day it matters. The competitor study
// found no product in the category that draws this line at all.
//
// The ONLY honest way to draw it is from evidence in the data. We never assert
// "collection is healthy" from configuration, from the endpoint answering, or
// from the stream merely existing — all three are true in the broken case. We
// assert it from RECORDS: the server-vantage stream is one stream shared by
// every recipe and by the raw log tail, so records of ANY kind in or near the
// window prove the pipe from that database to us is carrying traffic. If a
// deadlock had happened it would have travelled the same pipe.
//
// The corollary is the load-bearing half: NO records of any kind means we have
// no evidence anyone is watching, so we must NOT claim healthy silence.

/// Does this assembled event match the free-text term?
///
/// Matches over the fields a reader would search by: the statements, the
/// applications and users on each side, and the lock targets. Case-insensitive
/// substring — the term is a needle from the incident, not a pattern language.
#[cfg(feature = "enterprise")]
fn deadlock_matches_search(ev: &server_vantage::DeadlockEvent, needle_lower: &str) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    let hit = |s: &Option<String>| {
        s.as_deref()
            .is_some_and(|v| v.to_lowercase().contains(needle_lower))
    };
    ev.participants.iter().any(|p| {
        hit(&p.query)
            || hit(&p.query_norm)
            || hit(&p.app)
            || hit(&p.user)
            || hit(&p.lock_target)
            || hit(&p.fingerprint)
    }) || hit(&ev.database)
        || hit(&ev.instance)
}

/// The deadlocks badge member — only the count-bearing fields the tab strip
/// consumes: `total` (post-stitch, post-filter — the same count the tab
/// renders), `truncated` and `stream`; shape ranking, the DTO serialization
/// and the probe reads are enrichment it never consumes. A callable, like
/// [`server_metrics_envelope`], so the shape is tested for real instead of
/// scraped out of the handler's source text.
#[cfg(feature = "enterprise")]
pub(crate) fn deadlocks_badge_envelope(total: usize, truncated: bool, stream: &str) -> Value {
    json!({
        "total": total,
        "truncated": truncated,
        "stream": stream,
    })
}

/// The full deadlocks response envelope — pure shape assembly (no I/O), same
/// extraction rationale as [`server_metrics_envelope`]: the contract keys are
/// asserted on real JSON instead of scraped out of the handler's source text.
#[cfg(feature = "enterprise")]
pub(crate) fn deadlocks_envelope(
    hits: &[Value],
    shapes: &[Value],
    truncated: bool,
    stream: &str,
    probe: &CollectionProbe,
) -> Value {
    json!({
        "hits": hits,
        "query_shapes": shapes,
        // EVENT count (post-stitch), which is what the tab badge means by
        // "how many deadlocks happened".
        "total": hits.len(),
        // The RAW READ hit its cap, so events older than the oldest returned one
        // exist. Measured on rows, because that is what was capped.
        "truncated": truncated,
        "stream": stream,
        // ── collection diagnostics (empty state) ──────────────────────────
        // Empty AND no evidence of life: name the missing prerequisite rather
        // than reporting healthy silence.
        "not_collecting": hits.is_empty() && probe.not_collecting(),
        // Log lines the tail carried that were not deadlocks — "we looked at N
        // lines and none was a deadlock".
        "log_lines_seen": probe.log_lines_seen(),
        // The most recent deadlock BEFORE this window, so an empty window can
        // still say "the last one was 3 days ago".
        "last_seen_before": probe.last_seen_before,
        // HONESTY: this is a MySQL server variable
        // (`SET GLOBAL innodb_print_all_deadlocks`). It is not present in any
        // telemetry we receive — with it OFF the engine simply writes nothing,
        // so its absence is indistinguishable from "no deadlocks happened".
        // Detecting it would mean fabricating a fact, so we return `null` =
        // UNKNOWN and the UI phrases it as a checklist item to verify rather
        // than as something we observed.
        "innodb_print_all_deadlocks": Value::Null,
        "freshness": event_freshness(probe),
    })
}

/// The deadlocks endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`]. The stream permission check stays INSIDE the
/// body, so a badges caller is held to exactly the auth this endpoint
/// enforces.
///
/// `badge_mode` (the badges fan-in) returns [`deadlocks_badge_envelope`] —
/// computed by this same assembly, so agreement with the tab holds — and
/// skips the enrichment nothing on the strip reads. `prologue` shares the
/// fan-in's one (auth, schema) prologue when it covers this body's stream.
#[cfg(feature = "enterprise")]
pub(crate) async fn read_deadlocks_body(
    org_id: &str,
    user_id: &str,
    q: &DeadlocksQuery,
    badge_mode: bool,
    prologue: Option<&DbmServerPrologue>,
) -> Result<Value, HttpResponse> {
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    let shared_prologue = prologue.filter(|p| p.stream == stream);
    // Server-vantage events live in a LOGS stream (`_o2_dbm_server` by default),
    // not a trace stream — the permission is checked against the type actually
    // read, or the check would consult the wrong OFGA object. A shared
    // prologue already verified exactly this check for this stream.
    if shared_prologue.is_none()
        && !can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Server),
        )
        .await
    {
        return Err(unauthorized_response());
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    // Rows are read at the RAW-RECORD limit, then stitched. On MySQL that means
    // the event count after stitching is lower than the row count — which is
    // the point: the cap bounds the scan, not the answer.
    // A failed schema read is reported, never absorbed: an empty set here would
    // emit events with no engine, no participants and no victim, and the probe
    // would be skipped because `hits` is non-empty — content-free rows with no
    // diagnostic. See `present_dbm_columns`.
    let present = match shared_prologue {
        Some(p) => p.present.clone(),
        None => match present_dbm_columns(org_id, stream).await {
            Ok(present) => present,
            Err(e) => {
                log::error!(
                    "[DbMonitoring] deadlocks schema read failed for {org_id}/{stream}: {e}"
                );
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
    };
    let preds = dbm_event_preds(
        q.system.as_deref(),
        q.instance.as_deref(),
        q.database(),
        &present,
    );
    // A1 · the read-time fallback over OSS-ingested rows.
    //
    // An Open Source build stores a deadlock log line VERBATIM and canonicalizes
    // nothing, so an enterprise build reading that history finds no
    // `o2_dbm_kind = 'deadlock'` row and renders an empty page over real
    // deadlocks — measured on a real stream, 239 deadlock rows and 0 visible.
    // With the fallback on, the read ALSO projects the raw vendor columns and
    // canonicalizes those rows here, through the same enterprise canonicalizers
    // the ingest path uses.
    //
    // A failed raw-schema read degrades to `None` rather than failing the
    // request, and that asymmetry with `present` above is deliberate: `present`
    // failing means the CANONICAL path would emit content-free rows, which is a
    // false verdict and must be a 500. The raw gate failing means only that the
    // fallback cannot run — the canonical path is still correct and complete, so
    // the honest answer is today's answer, not an error page. The operator sees
    // the reason in the log.
    //
    // A1.1 · and it is TRANSITIONAL, not permanent. The widening applies only to
    // a window that predates the point at which this deployment started
    // canonicalizing — after that, the canonical fast path only, with no marker
    // terms, no raw projection and no per-row dispatch. That makes it
    // self-limiting: as the pre-upgrade window ages out of retention the
    // fallback stops doing any work, with no operator action and no date to set.
    // See `BoundaryProbe`.
    let raw_fallback = match present_raw_deadlock_columns(org_id, stream).await {
        Ok(present) => {
            let candidate = RawDeadlockFallback { present };
            if deadlock_window_needs_fallback(
                org_id,
                Some(user_id),
                stream,
                start_time,
                end_time,
                &candidate,
            )
            .await
            {
                Some(candidate)
            } else {
                None
            }
        }
        Err(e) => {
            log::warn!(
                "[DbMonitoring] deadlocks raw-column read failed for {org_id}/{stream}, \
                 serving canonical rows only: {e}"
            );
            None
        }
    };

    // SCOPE FILTERS MUST NOT REACH THE RAW ROWS' SQL.
    //
    // `dbm_event_preds` names `o2_dbm_engine`/`o2_dbm_instance`/
    // `o2_dbm_database`, and a raw row has NONE of them — measured, 0 non-null
    // of 137. Appending those predicates to the widened `WHERE` therefore
    // silently drops EVERY raw row, so the page would look correct with no
    // filter and mysteriously under-report with one. The alternative,
    // reproducing `detect_engine`/`detect_instance`'s multi-alias fallbacks in
    // SQL, duplicates logic that will drift.
    //
    // So when the fallback is active the scope narrowing moves to Rust, applied
    // to the assembled events of BOTH shapes — the canonicalizer populates the
    // same three fields on a raw-derived event, so one filter serves both. The
    // free-text `search` filter already worked this way.
    let scope = ScopeNarrowing::new(q);
    let sql_preds = if raw_fallback.is_some() { "" } else { &preds };
    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_DEADLOCK,
        sql_preds,
        limit,
        &DbmProjection {
            present: &present,
            raw: raw_fallback.as_ref().map(RawProjection::Deadlock),
        },
    );
    let rows =
        match run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time).await {
            Ok(rows) => rows,
            Err(e) => {
                log::error!("[DbMonitoring] deadlocks read failed for {org_id}/{stream}: {e}");
                return Err(MetaHttpResponse::internal_error(e));
            }
        };
    let row_count = rows.len();

    // Per-ROW branch: canonical rows keep the canonical reader, raw rows go to
    // the enterprise canonicalizer, and a raw row it refuses (the PG banner) is
    // dropped rather than emitted blank. Each row is consumed exactly once —
    // that is the dedup, and it is why no deadlock can appear twice.
    let events: Vec<server_vantage::DeadlockEvent> =
        rows.iter().filter_map(deadlock_event_for_row).collect();
    // GAP 2: MySQL logs one entry per transaction side. Without this the tab
    // shows ~2 rows per real deadlock AND splits the sides into different shape
    // groups, so the same bug reads as two unrelated half-sized ones.
    //
    // Unchanged by A1: the stitcher is shape-agnostic, keying on canonical
    // `engine`/`participants`/`victim_side`, which is exactly what the
    // canonicalizer's output provides. The hardest part of the fallback —
    // cross-record assembly — was therefore paid for already by the canonical
    // read path, and the fallback inherits it for free.
    let events = stitch_mysql_deadlocks(events);

    // Scope narrowing, in Rust and AFTER assembly, when the fallback moved it
    // off the SQL. A no-op when the fallback is inactive, because then the SQL
    // predicates already applied and every surviving event matches — but running
    // it unconditionally would be a second, differently-implemented filter on
    // the same request, so it runs exactly where the SQL one did not.
    let events: Vec<server_vantage::DeadlockEvent> = if raw_fallback.is_some() {
        events.into_iter().filter(|e| scope.matches(e)).collect()
    } else {
        events
    };

    let needle = q.search.as_deref().unwrap_or("").trim().to_lowercase();
    let events: Vec<server_vantage::DeadlockEvent> = events
        .into_iter()
        .filter(|e| deadlock_matches_search(e, &needle))
        .collect();

    if badge_mode {
        return Ok(deadlocks_badge_envelope(
            events.len(),
            row_count >= limit,
            stream,
        ));
    }

    // Shapes are ranked over the SAME assembled, filtered set the rows come
    // from, so the ranking and the table can never disagree.
    let shapes = rank_deadlock_shapes(&events);
    let hits: Vec<Value> = events.iter().map(deadlock_event_to_dto).collect();

    // Only diagnose an EMPTY tab. A tab with rows is self-evidently collecting,
    // and the probe is two extra reads that would buy nothing there.
    let probe = if hits.is_empty() {
        probe_collection(
            org_id,
            Some(user_id),
            stream,
            server_vantage::KIND_DEADLOCK,
            start_time,
            end_time,
            &preds,
        )
        .await
    } else {
        CollectionProbe::default()
    };

    Ok(deadlocks_envelope(
        &hits,
        &shapes,
        row_count >= limit,
        stream,
        &probe,
    ))
}

#[cfg(test)]
mod tests {
    // Used only by enterprise-gated tests below; unused on an OSS build.
    #[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
    use serde_json::json;

    use super::{super::testutil::*, *};

    /// The raw-fallback opts for a stream whose queryable raw columns are
    /// exactly these. Members are checked against the shared vocabulary, so a
    /// test cannot invent a column the projection would never legitimately name.
    #[cfg(feature = "enterprise")]
    fn raw_cols(present: &[&str]) -> RawDeadlockFallback {
        for f in present {
            assert!(
                server_vantage::RAW_DEADLOCK_FIELDS.contains(f),
                "{f} is not a RAW_DEADLOCK_FIELDS member — the fixture is testing a \
                 column the gate could never return"
            );
        }
        RawDeadlockFallback {
            present: present.iter().map(|f| f.to_string()).collect(),
        }
    }

    /// The raw gate must be built from the SHARED vocabulary, not a local copy.
    ///
    /// `RAW_DEADLOCK_FIELDS` lives in `config` precisely so the enterprise
    /// canonicalizers and this projection cannot drift; a second literal list
    /// here would defeat that and the cross-repo contract test could not see it.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_present_raw_deadlock_columns_gates_the_shared_vocabulary() {
        let schema = schema_of(&[
            "_timestamp",
            "o2_pg_event",
            "dl_waiter_pid",
            "an_unrelated_field",
        ]);
        let got = raw_deadlock_columns_in(&schema, &[]);
        assert_eq!(
            got,
            ["o2_pg_event", "dl_waiter_pid"]
                .into_iter()
                .map(str::to_string)
                .collect::<HashSet<String>>()
        );
        // Every candidate it considers comes from the shared array.
        for f in &got {
            assert!(
                server_vantage::RAW_DEADLOCK_FIELDS.contains(&f.as_str()),
                "{f} is not a RAW_DEADLOCK_FIELDS member — the gate is using a local list"
            );
        }
    }

    /// EDGE CASE (a) — an org that has ONLY raw rows.
    ///
    /// No canonical deadlock row exists anywhere in the window, so nothing tells
    /// us canonicalization had started. The fallback must cover the WHOLE range
    /// or A1 regresses to the empty page it exists to fix.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_keeps_the_fallback_on_for_an_all_raw_window() {
        let probe = BoundaryProbe {
            earliest_canonical: None,
            has_raw_row: true,
        };
        assert!(
            probe.fallback_needed(1_000),
            "a window with raw rows and no canonical row is exactly the A1 case"
        );
    }

    /// EDGE CASE (b) — an org that has ONLY canonical rows.
    ///
    /// Canonicalization covers the window from its first instant and there is no
    /// raw row to miss, so the fallback must be INERT: no widening at all. This
    /// is the entire point of A1.1 — steady-state reads pay nothing.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_turns_the_fallback_off_for_an_all_canonical_window() {
        let probe = BoundaryProbe {
            earliest_canonical: Some(1_000),
            has_raw_row: false,
        };
        assert!(
            !probe.fallback_needed(1_000),
            "canonicalization covering the window start with no raw row present \
             means the fast path is complete"
        );
    }

    /// THE FINDING: the boundary TIMESTAMP cannot move the verdict, in either
    /// direction, at any position relative to the window.
    ///
    /// Sweeping the earliest canonical row across every interesting position —
    /// before the window, exactly at its start, one microsecond after, deep
    /// inside, and absent altogether — while holding `has_raw_row` fixed must
    /// not change the answer once. If it does, the mechanism has acquired a
    /// timestamp-comparison bug of the kind that hides raw rows under
    /// interleaving.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_boundary_timestamp_never_changes_the_verdict() {
        let start = 1_000;
        let positions = [None, Some(500), Some(1_000), Some(1_001), Some(5_000)];
        for has_raw_row in [true, false] {
            for earliest_canonical in positions {
                let probe = BoundaryProbe {
                    earliest_canonical,
                    has_raw_row,
                };
                assert_eq!(
                    probe.fallback_needed(start),
                    has_raw_row,
                    "the verdict must be exactly `has_raw_row`, but a canonical \
                     row at {earliest_canonical:?} changed it — with raw rows \
                     present that HIDES them (A1 reintroduced), and with none \
                     present it widens a read that can surface nothing"
                );
            }
        }
    }

    /// A window that STRADDLES the boundary is served with the fallback on for
    /// the WHOLE window, never split into a raw half and a canonical half.
    ///
    /// Splitting would re-derive the stitch groups across the seam, and
    /// `merge_mysql_deadlocks` groups by 2 s proximity — so a MySQL deadlock
    /// whose sides straddle the boundary would be torn into two half-sized
    /// deadlocks. That is precisely the bug GAP 2 exists to prevent.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_does_not_split_a_straddling_window() {
        let probe = BoundaryProbe {
            earliest_canonical: Some(5_000),
            has_raw_row: true,
        };
        assert!(probe.fallback_needed(1_000));
    }

    /// INTERLEAVING — the reason the OFF verdict needs BOTH conditions.
    ///
    /// A cluster can run mixed builds or be downgraded, so raw rows can appear
    /// AFTER canonical ones. Then canonicalization covers the window start and a
    /// boundary-only test would say OFF — hiding the interleaved raw rows. The
    /// verdict therefore also requires that the window contain no raw row.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_stays_on_when_raw_rows_interleave_after_canonical_ones() {
        let probe = BoundaryProbe {
            earliest_canonical: Some(500),
            has_raw_row: true,
        };
        assert!(
            probe.fallback_needed(1_000),
            "canonicalization predates the window, but a raw row inside it would \
             be invisible to the canonical-only fast path"
        );
    }

    /// An EMPTY window — no rows of either shape — must not pay for a widening
    /// that has nothing to find, but must also not claim coverage it cannot
    /// prove. There is nothing to show either way, so the cheap verdict is the
    /// honest one.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_is_inert_on_a_window_with_neither_shape() {
        let probe = BoundaryProbe {
            earliest_canonical: None,
            has_raw_row: false,
        };
        assert!(
            !probe.fallback_needed(1_000),
            "no raw row in the window means the widening cannot surface anything"
        );
    }

    /// The whole win, asserted rather than inspected: with the boundary
    /// resolving to OFF the emitted SQL is BYTE-IDENTICAL to a read that never
    /// had a fallback — no marker terms, no raw projection.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_fallback_off_emits_byte_identical_sql_to_no_fallback() {
        let with_none = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            " AND o2_dbm_engine = 'mysql'",
            50,
            &proj(&all_cols(), None),
        );
        // What the deadlocks caller now passes when the boundary says the window
        // is fully canonicalized.
        let boundary_off: Option<&RawDeadlockFallback> = None;
        let steady_state = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            " AND o2_dbm_engine = 'mysql'",
            50,
            &proj(&all_cols(), boundary_off),
        );
        assert_eq!(with_none, steady_state);

        // Checked as whole IDENTIFIERS, not substrings: several raw names are
        // substrings of canonical ones the fast path legitimately projects
        // (`database` inside `o2_dbm_database`), so a `contains` check reports a
        // widening that is not there.
        let named: HashSet<&str> = steady_state
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .collect();
        for (col, _) in server_vantage::DEADLOCK_MARKERS {
            assert!(
                !named.contains(col),
                "a steady-state read must not name the raw marker {col}:\n{steady_state}"
            );
        }
        for f in server_vantage::RAW_DEADLOCK_FIELDS {
            assert!(
                !named.contains(f),
                "a steady-state read must not project the raw column {f}:\n{steady_state}"
            );
        }
    }

    /// The probe SQL asks the cheapest question that answers the boundary:
    /// the EARLIEST canonical row in the window, one row.
    ///
    /// Ordered ASCENDING — the mirror of `build_last_seen_sql`, which is DESC
    /// because it wants the latest. Getting this backwards returns the newest
    /// canonical row, which is always inside the window and would answer "yes,
    /// covered" for every window that has ever seen a canonical row.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_earliest_canonical_probe_sql_is_a_single_ascending_row() {
        let sql = build_earliest_canonical_sql("_o2_dbm_server", "deadlock");
        assert!(sql.contains("ORDER BY _timestamp ASC"), "{sql}");
        assert!(sql.contains("LIMIT 1"), "{sql}");
        assert!(sql.contains("o2_dbm_kind = 'deadlock'"), "{sql}");
        // The window bound is no longer an inline predicate — it rides the
        // search request payload, so there is nothing to assert here for it.
    }

    /// The raw probe is schema-gated exactly like the widening it guards.
    ///
    /// Each marker is a column, and naming an absent one fails the WHOLE query —
    /// so a probe that hardcodes all four markers 400s on the very deployments
    /// the fallback exists for. With NO marker column present there is no query
    /// to run at all.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_raw_presence_probe_names_only_marker_columns_the_stream_has() {
        let raw = raw_cols(&["o2_pg_event"]);
        let sql = build_raw_deadlock_presence_sql("_o2_dbm_server", &raw)
            .expect("one marker present means one probe");
        assert!(sql.contains("o2_pg_event = 'deadlock'"), "{sql}");
        assert!(!sql.contains("o2_my_event"), "{sql}");
        assert!(!sql.contains("o2_recipe"), "{sql}");
        assert!(sql.contains("LIMIT 1"), "{sql}");

        let none = raw_cols(&[]);
        assert!(
            build_raw_deadlock_presence_sql("_o2_dbm_server", &none).is_none(),
            "with no marker column there is nothing to probe for"
        );
    }

    /// The whole fallback in one assertion: BOTH shapes in ONE query.
    ///
    /// No UNION and no second query — deadlocks projects columns and folds in
    /// Rust rather than aggregating in SQL, so one widened `WHERE` plus a
    /// widened projection covers canonical and raw rows together. Verified live:
    /// a single `OR`-ed predicate returned all 239 raw rows on a stream with 0
    /// canonical ones.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_matches_both_the_canonical_and_the_raw_shape() {
        let raw = raw_cols(&["o2_pg_event", "o2_my_event", "o2_maria_event", "dl_query_1"]);
        let sql = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&all_cols(), Some(&raw)),
        );

        assert!(
            sql.contains(
                "(o2_dbm_kind = 'deadlock' OR o2_pg_event = 'deadlock' OR \
                          o2_my_event = 'deadlock' OR o2_maria_event = 'deadlock')"
            ),
            "the canonical predicate must be OR-ed with the markers, not replaced:\n{sql}"
        );
        assert!(
            sql.contains("dl_query_1"),
            "the raw columns must be projected too, or the canonicalizer gets nothing to read"
        );
        assert!(!sql.contains("UNION"), "one query, not two");
    }

    /// THE §1.3 REGRESSION TEST — the one that would have caught the 400.
    ///
    /// On a real OSS-ingested stream all 9 MSSQL raw columns and 3 MariaDB ones
    /// are ABSENT from the merged schema, and naming an absent column fails the
    /// WHOLE query with `unknown field 'x'` — a 400 on the entire Deadlocks
    /// page, not a null column. A hardcoded raw projection is the obvious
    /// implementation and it breaks the page on most deployments.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_never_names_a_raw_column_absent_from_the_stream() {
        // Exactly the rig's shape: pg present, the three maria lock columns and
        // every mssql column absent.
        let raw = raw_cols(&[
            "o2_pg_event",
            "o2_my_event",
            "dl_waiter_pid",
            "dl_query_1",
            "my_trx_side",
        ]);
        let sql = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&all_cols(), Some(&raw)),
        );

        for absent in [
            "maria_lock_mode",
            "maria_lock_table",
            "maria_lock_index",
            "mssql_spid",
            "mssql_is_victim",
            "mssql_query",
        ] {
            assert!(
                !sql.contains(absent),
                "{absent} is absent from this stream — naming it 400s the WHOLE page:\n{sql}"
            );
        }
        assert!(
            sql.contains("dl_waiter_pid"),
            "present raw columns still project"
        );
    }

    /// The mssql arm's own presence hazard: PARTIAL presence, measured live.
    ///
    /// Adding mssql to the vocabulary did not remove the hazard, it added a new
    /// instance of it that the all-absent test above cannot see. On the rig — a
    /// stream with real SQL Server deadlocks flowing — 8 of the 9 mssql columns
    /// materialized and `mssql_query` did NOT, because the shred emits it as an
    /// empty string and the collector drops empty attributes. So the realistic
    /// mssql deployment is not "all present" or "all absent"; it is 8-of-9, and
    /// naming the ninth 400s the whole Deadlocks page.
    ///
    /// This is the test that proves the mssql names are CANDIDATES intersected
    /// with the schema, not a projection hardcoded alongside the new arm.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_projects_mssql_partially_when_only_some_columns_exist() {
        // Exactly the rig's post-DSN-fix shape.
        let raw = raw_cols(&[
            "o2_recipe",
            "mssql_spid",
            "mssql_is_victim",
            "mssql_app",
            "mssql_user",
            "mssql_lock_mode",
            "mssql_lock_target",
            "mssql_db",
        ]);
        let sql = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&all_cols(), Some(&raw)),
        );

        assert!(
            !sql.contains("mssql_query"),
            "mssql_query is absent on a stream that HAS live mssql deadlocks — \
             naming it 400s the whole page:\n{sql}"
        );
        for present in ["mssql_spid", "mssql_is_victim", "mssql_lock_target"] {
            assert!(
                sql.contains(present),
                "{present} is present and must still project:\n{sql}"
            );
        }
        assert!(
            sql.contains("o2_recipe = 'mssql_deadlock'"),
            "the mssql marker is a RECIPE TAG — comparing it to 'deadlock' would \
             match zero rows while looking correct:\n{sql}"
        );
    }

    /// The MARKER columns are columns too, so the widened predicate is gated on
    /// presence exactly like the projection.
    ///
    /// A stream that never saw a MariaDB deadlock has no `o2_maria_event`
    /// column, and naming it in the `WHERE` fails the page just as naming it in
    /// the `SELECT` would. This is the half of the hazard that lives in the
    /// predicate rather than the projection, and it is easy to miss because the
    /// projection half is the one the design calls out.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_only_predicates_on_marker_columns_the_stream_has() {
        let raw = raw_cols(&["o2_my_event", "my_trx_side"]);
        let sql = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&all_cols(), Some(&raw)),
        );

        assert!(sql.contains("o2_my_event = 'deadlock'"));
        assert!(
            !sql.contains("o2_pg_event"),
            "an absent marker column in the WHERE fails the page as surely as one in \
             the SELECT:\n{sql}"
        );
        assert!(!sql.contains("o2_maria_event"));
    }

    /// A stream with NO raw columns at all must fall back to today's exact
    /// query, not to a malformed `OR ()`.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_with_no_raw_markers_present_is_the_unwidened_query() {
        let none = raw_cols(&[]);
        let widened = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&all_cols(), Some(&none)),
        );
        let today = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&all_cols(), None),
        );
        assert_eq!(
            widened, today,
            "with no marker column present there is nothing to OR, and an empty \
             disjunction must not become `OR ()`"
        );
    }

    /// THE FAST-PATH CONTRACT: fallback off ⇒ byte-identical SQL to today.
    ///
    /// When the boundary probe answers NO (the window is fully canonicalized),
    /// the read must take the fast path for real: a "no" that still emits the
    /// wider query buys nothing, so it must reach all the way to the emitted
    /// bytes — expressed here as the `None` opts the fast path passes.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_probe_no_restores_byte_identical_sql() {
        let preds = dbm_event_preds(Some("mysql"), Some("db-1"), Some("shop"), &all_cols());
        let off = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            &preds,
            50,
            &proj(&all_cols(), None),
        );
        // `WHERE`, not `AND`: the kind predicate LEADS the clause, because the
        // `_timestamp` bound rides the request payload rather than the SQL.
        let expected_kind = format!("WHERE {} = 'deadlock'", server_vantage::O2_DBM_KIND);
        assert!(
            off.contains(&expected_kind),
            "with the fallback off the predicate is the bare canonical one:\n{off}"
        );
        assert!(
            !off.contains(" OR "),
            "nothing is OR-ed when it is off:\n{off}"
        );
        // Assert on the PROJECTED COLUMN LIST, not on substrings of the whole
        // statement: several raw names (`database`, `instance`, `body`) are
        // substrings of canonical column names, so a `contains` over the SQL
        // text reports a false positive that has nothing to do with the
        // fallback.
        let projected: HashSet<&str> = off["SELECT ".len()..off.find(" FROM ").unwrap()]
            .split(", ")
            .collect();
        for raw in server_vantage::RAW_DEADLOCK_FIELDS {
            assert!(
                !projected.contains(raw),
                "raw column {raw} must not be projected with the fallback off:\n{off}"
            );
        }
        // ...and the guarantee that makes the fast path real: turning the
        // fallback ON over the SAME stream must produce a DIFFERENT query, so
        // "off" is demonstrably doing something.
        let on = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            &preds,
            50,
            &proj(
                &all_cols(),
                Some(&raw_cols(&["o2_my_event", "my_trx_side"])),
            ),
        );
        assert_ne!(
            on, off,
            "if on and off emit the same SQL, the knob is inert"
        );
    }

    /// ACTIVITY must stay untouched — and exactly TWO callers may widen.
    ///
    /// This began as phase 1's tripwire asserting exactly ONE widened call site.
    /// Phase 2a makes it two: `build_dbm_events_sql` is shared by deadlocks,
    /// blocking and activity, and blocking now carries its own raw fallback. The
    /// assertion is UPDATED rather than deleted, because what it guards is
    /// unchanged — a caller acquiring a raw projection it has no reader for.
    ///
    /// Activity is the one that must never widen: it is an OSS-owned, ungated
    /// page, so a raw projection there is cost with no reader on every build.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_fallback_does_not_reach_the_blocking_or_activity_callers() {
        let src = dbm_prod_source();
        // Only the real code — the test module below calls the builder many
        // times and matching those would make this vacuous.
        let code = src;

        // Every call site, discovered rather than listed: a NEW caller added
        // without a raw argument is exactly the drift this must catch.
        let sites: Vec<&str> = code
            .match_indices("build_dbm_events_sql(")
            // ...minus the definition itself, which is `fn build_dbm_events_sql(`.
            .filter(|(i, _)| !code[..*i].ends_with("fn "))
            .map(|(i, _)| {
                let rest = &code[i..];
                &rest[..rest.find(");").expect("call site is closed") + 2]
            })
            .collect();
        assert_eq!(
            sites.len(),
            3,
            "expected the deadlocks / blocking / activity call sites; found \
             {} — the extractor is broken, or a caller was added without \
             deciding what it passes for the raw opts",
            sites.len()
        );

        // Exactly TWO may be widened — deadlocks (phase 1) and blocking (2a).
        let widened: Vec<&&str> = sites.iter().filter(|s| !s.contains("raw: None")).collect();
        assert_eq!(
            widened.len(),
            2,
            "exactly TWO callers — deadlocks and blocking — may pass the raw opts; \
             activity must keep passing `raw: None`. Widened: {widened:?}"
        );
        for kind in ["KIND_DEADLOCK", "KIND_BLOCKING"] {
            assert!(
                widened.iter().any(|s| s.contains(kind)),
                "the {kind} caller must be one of the widened two, found {widened:?}"
            );
        }

        // Activity is the one that must NEVER widen.
        let activity = sites
            .iter()
            .find(|s| s.contains("KIND_ACTIVITY"))
            .expect("no KIND_ACTIVITY call site");
        assert!(
            activity.contains("raw: None"),
            "the activity caller must pass `raw: None` — it is an OSS-owned ungated \
             page, so a raw projection there is cost with no reader on every \
             build:\n{activity}"
        );
    }

    /// A CANONICAL row must still go through the canonical reader, unchanged.
    ///
    /// The fallback must not become the only path — the canonical reader is the
    /// one that has been correct all along, and rerouting its rows through the
    /// canonicalizer would re-derive fields from vendor columns that are not
    /// even projected on such a row.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_canonical_row_still_uses_the_canonical_reader() {
        let row = json!({
            "_timestamp": 1_786_166_303_139_783i64,
            server_vantage::O2_DBM_KIND: "deadlock",
            server_vantage::O2_DBM_ENGINE: "mysql",
            server_vantage::O2_DBM_INSTANCE: "db-1",
            server_vantage::O2_DBM_VICTIM_SIDE: 2,
        });
        let ev = deadlock_event_for_row(&row).expect("a canonical row yields an event");
        assert_eq!(ev.engine.as_deref(), Some("mysql"));
        assert_eq!(ev.instance.as_deref(), Some("db-1"));
        assert_eq!(ev.victim_side, Some(2), "read off the canonical column");
    }

    /// A RAW row — the whole point — must reach the enterprise canonicalizer.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_raw_row_is_canonicalized_at_read_time() {
        let row = json!({
            "_timestamp": 1_786_166_303_139_783i64,
            "o2_my_event": "deadlock",
            "my_trx_side": "1",
            "my_trx_id": "4589",
            "my_trx_thread": "89",
            "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
            "server_address": "db-7.internal:3306",
        });
        let ev = deadlock_event_for_row(&row).expect("a raw row must canonicalize at read time");
        assert_eq!(ev.engine.as_deref(), Some("mysql"));
        assert_eq!(
            ev.instance.as_deref(),
            Some("db-7.internal"),
            "the instance must be derived, or the event never stitches and never \
             matches ?instance="
        );
        assert_eq!(ev.participants.len(), 1);
        assert_eq!(ev.participants[0].pid, Some(89));
        assert_eq!(ev.participants[0].side, Some(1));
    }

    /// DEDUP (§4.1): a row is used EXACTLY ONCE.
    ///
    /// The two populations are disjoint at the row level — a row either carries
    /// `o2_dbm_kind = 'deadlock'` or it does not. A row carrying BOTH the
    /// canonical column and its original raw columns (an enterprise-ingested row
    /// whose raw fields the strip left in place) must therefore take the
    /// canonical branch only, and never be emitted twice.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_row_with_both_shapes_is_used_exactly_once_canonically() {
        let both = json!({
            "_timestamp": 1_786_166_303_139_783i64,
            // canonical
            server_vantage::O2_DBM_KIND: "deadlock",
            server_vantage::O2_DBM_ENGINE: "mariadb",
            server_vantage::O2_DBM_INSTANCE: "db-canon",
            // ...and the raw marker plus vendor fields still on the same row
            "o2_maria_event": "deadlock",
            "maria_trx_side": "1",
            "maria_trx_thread": "14",
            "server_address": "db-raw.internal:3306",
        });
        let ev = deadlock_event_for_row(&both).expect("event");
        assert_eq!(
            ev.instance.as_deref(),
            Some("db-canon"),
            "the CANONICAL branch owns a row that has both shapes — taking the raw \
             branch would re-derive fields the canonical path already resolved"
        );

        // ...and over a batch, one row in is one event out.
        let batch = vec![
            both,
            json!({
                "_timestamp": 1_786_166_303_139_900i64,
                "o2_pg_event": "deadlock",
                "dl_waiter_pid": "1071", "dl_waiter2_pid": "1072",
                "dl_query_1": "UPDATE a SET x = 1", "dl_query_2": "UPDATE b SET y = 2",
            }),
        ];
        let events: Vec<_> = batch.iter().filter_map(deadlock_event_for_row).collect();
        assert_eq!(events.len(), 2, "two rows, two events — never four");
    }

    /// A raw row the canonicalizer refuses (the PG banner) is DROPPED, not
    /// emitted as a content-free event.
    ///
    /// Postgres logs a banner and a DETAIL entry per deadlock. Emitting the
    /// banner would put a participant-less row on the page for every PG
    /// deadlock, doubling the visible count against 19 real events.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_an_unparsable_raw_row_is_dropped_not_emitted_blank() {
        let banner = json!({
            "_timestamp": 1_786_843_262_880_000i64,
            "o2_pg_event": "deadlock",
            "pg_pid": "1071",
            "o2_deadlock_raw": "deadlock detected",
        });
        assert!(
            deadlock_event_for_row(&banner).is_none(),
            "a banner is not a deadlock — emitting it doubles the PG count"
        );
        // A row with no marker at all is likewise nobody's event.
        assert!(deadlock_event_for_row(&json!({"_timestamp": 1i64, "body": "hi"})).is_none());
    }

    /// THE CROSS-RECORD ASSEMBLY the fallback inherits for free: raw MySQL
    /// side + side + verdict must stitch into ONE event with the victim flagged.
    ///
    /// This is the case the design calls the hardest in principle and already
    /// solved in practice — `stitch_mysql_deadlocks` is shape-agnostic, keying
    /// on canonical `engine`/`participants`/`victim_side`, which is exactly what
    /// the canonicalizer's output provides. Pinned here because "it should just
    /// work" is precisely the claim that needs a test.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_raw_mysql_sides_and_verdict_stitch_into_one_flagged_event() {
        let rows = vec![
            json!({
                "_timestamp": 1_786_166_303_139_783i64, "o2_my_event": "deadlock",
                "my_trx_side": "1", "my_trx_id": "4589", "my_trx_thread": "89",
                "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
                "server_address": "db-7:3306",
            }),
            json!({
                "_timestamp": 1_786_166_303_139_834i64, "o2_my_event": "deadlock",
                "my_trx_side": "2", "my_trx_id": "4678", "my_trx_thread": "82",
                "my_trx_query": "UPDATE accounts SET balance = balance + 1 WHERE id = 12",
                "server_address": "db-7:3306",
            }),
            // The verdict rides its OWN record — the one whose loss left every
            // MySQL participant unflagged and the "cancelled by the database"
            // panel blank.
            json!({
                "_timestamp": 1_786_166_303_139_966i64, "o2_my_event": "deadlock",
                "my_victim_side": "2", "server_address": "db-7:3306",
            }),
        ];
        let events: Vec<_> = rows.iter().filter_map(deadlock_event_for_row).collect();
        assert_eq!(events.len(), 3, "three raw records before the stitch");

        let stitched = stitch_mysql_deadlocks(events);
        assert_eq!(
            stitched.len(),
            1,
            "three records are ONE deadlock — without the stitch the tab shows a \
             deadlock per side and splits the sides into different shape groups"
        );
        let ev = &stitched[0];
        assert_eq!(ev.participants.len(), 2);
        let victim: Vec<i64> = ev
            .participants
            .iter()
            .filter(|p| p.victim)
            .filter_map(|p| p.pid)
            .collect();
        assert_eq!(
            victim,
            vec![82],
            "the verdict names side 2, so thread 82 is the victim — resolved in the \
             stitcher's deferred post-pass, not on any single record"
        );
        assert_eq!(ev.victim_pid, Some(82));
    }

    /// The REAL InnoDB shape: lock detail arrives on its own record, and must
    /// reach the side it describes.
    ///
    /// MySQL and MariaDB split one deadlock side across TWO timestamped entries
    /// — `*** (N) TRANSACTION:` carries the thread and statement, while
    /// `*** (N) HOLDS THE LOCK(S):` carries the locked object, the lock mode and
    /// the DATABASE. `line_start_pattern` splits on the timestamp, so the two
    /// can never share a record: a participant record carries no database and a
    /// database record carries no participant. Without stitching them, every
    /// deadlock has `objects: []`, null lock_mode/lock_target and a null
    /// database — and since `my_db` is the ONLY MySQL source in
    /// `detect_database`, the Deadlocks tab's `?database=` filter cannot work on
    /// MySQL or MariaDB at all.
    ///
    /// Three things have to hold together, and each broke the other two when it
    /// was got wrong:
    ///   * the lock record must be EMITTED (not dropped for having no side),
    ///   * it must GROUP with its side (so the group key cannot include the database — only one of
    ///     the two records has one), and
    ///   * it must not count toward the repeated-transaction-id guard (it deliberately shares its
    ///     side's trx id, which otherwise reads as a second deadlock and splits every side into its
    ///     own fragment).
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_innodb_lock_records_fold_into_the_side_they_describe() {
        let rows = vec![
            json!({
                "_timestamp": 1_786_166_303_139_783i64, "o2_my_event": "deadlock",
                "my_trx_side": "1", "my_trx_id": "4589", "my_trx_thread": "89",
                "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
                "server_address": "db-7:3306",
            }),
            // Side 1's lock detail — its own record, no thread, no statement.
            json!({
                "_timestamp": 1_786_166_303_139_801i64, "o2_my_event": "deadlock",
                "my_lock_side": "1", "my_lock_trx_id": "4589",
                "my_db": "dbmlab", "my_lock_table": "`dbmlab`.`accounts`",
                "my_lock_index": "PRIMARY", "my_lock_mode": "lock_mode X",
                "server_address": "db-7:3306",
            }),
            json!({
                "_timestamp": 1_786_166_303_139_834i64, "o2_my_event": "deadlock",
                "my_trx_side": "2", "my_trx_id": "4678", "my_trx_thread": "82",
                "my_trx_query": "UPDATE accounts SET balance = balance + 1 WHERE id = 12",
                "server_address": "db-7:3306",
            }),
            json!({
                "_timestamp": 1_786_166_303_139_850i64, "o2_my_event": "deadlock",
                "my_lock_side": "2", "my_lock_trx_id": "4678",
                "my_db": "dbmlab", "my_lock_table": "`dbmlab`.`accounts`",
                "my_lock_index": "PRIMARY", "my_lock_mode": "lock_mode X",
                "server_address": "db-7:3306",
            }),
            json!({
                "_timestamp": 1_786_166_303_139_966i64, "o2_my_event": "deadlock",
                "my_victim_side": "2", "server_address": "db-7:3306",
            }),
        ];
        let events: Vec<_> = rows.iter().filter_map(deadlock_event_for_row).collect();
        assert_eq!(events.len(), 5, "five raw records before the stitch");

        let stitched = stitch_mysql_deadlocks(events);
        assert_eq!(
            stitched.len(),
            1,
            "five records are ONE deadlock — a lock record left ungrouped surfaces \
             as a content-free row and inflates the Deadlocks count"
        );
        let ev = &stitched[0];
        assert_eq!(
            ev.participants.len(),
            2,
            "TWO sides — the lock records describe existing sides and must fold \
             into them, never arrive as extra participants"
        );
        assert_eq!(
            ev.database.as_deref(),
            Some("dbmlab"),
            "the database reaches the event from the lock record — this is what \
             the Deadlocks tab's ?database= filter reads"
        );
        for p in &ev.participants {
            assert!(
                p.pid.is_some() && p.query.is_some(),
                "every surviving participant is a real side, not a lock fragment"
            );
            assert_eq!(
                p.lock_mode.as_deref(),
                Some("lock_mode X"),
                "side {:?} lost its lock mode in the fold",
                p.side
            );
            assert!(
                p.lock_target.is_some(),
                "side {:?} lost its locked object in the fold",
                p.side
            );
        }
        // The verdict still lands: folding must not disturb victim resolution.
        assert_eq!(ev.victim_pid, Some(82));
    }

    /// A raw PG DETAIL row is self-contained: ONE event, both participants, and
    /// the stitcher must leave it alone.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_raw_pg_detail_row_yields_one_two_participant_event_unstitched() {
        let rows = vec![
            // banner — dropped
            json!({
                "_timestamp": 1_786_843_262_880_000i64, "o2_pg_event": "deadlock",
                "pg_pid": "1071", "o2_deadlock_raw": "deadlock detected",
            }),
            // DETAIL — the whole wait cycle
            json!({
                "_timestamp": 1_786_843_262_880_000i64, "o2_pg_event": "deadlock",
                "deadlock_victim_pid": "1071",
                "dl_waiter_pid": "1071", "dl_waiter2_pid": "1072",
                "dl_query_1": "UPDATE accounts SET balance = balance - 1 WHERE id = 2",
                "dl_query_2": "UPDATE accounts SET balance = balance - 1 WHERE id = 1",
                "pg_db": "dbmlab",
            }),
        ];
        let events: Vec<_> = rows.iter().filter_map(deadlock_event_for_row).collect();
        assert_eq!(events.len(), 1, "the banner is dropped, the DETAIL is kept");

        let stitched = stitch_mysql_deadlocks(events);
        assert_eq!(stitched.len(), 1);
        assert_eq!(
            stitched[0].participants.len(),
            2,
            "PG carries the whole cycle on one entry — merging two of them would \
             invent a 4-way cycle"
        );
        assert_eq!(stitched[0].engine.as_deref(), Some("postgresql"));
    }

    /// A raw-derived event must SURVIVE a scope filter that matches it.
    ///
    /// This is the gap the design flags: raw rows have no `o2_dbm_*` scope
    /// column at all (measured, 0 non-null of 137), so pushing `?system=` to SQL
    /// drops every one of them — the page looks right with no filter and
    /// under-reports with one. Narrowing in Rust, after canonicalization, uses
    /// the engine the canonicalizer derived.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_scope_narrowing_keeps_raw_events_that_match() {
        let ev = deadlock_event_for_row(&json!({
            "_timestamp": 1i64, "o2_my_event": "deadlock",
            "my_trx_side": "1", "my_trx_thread": "89", "my_trx_query": "SELECT 1",
            "server_address": "db-7.internal:3306", "my_db": "shop",
        }))
        .expect("event");

        let by_engine = ScopeNarrowing {
            system: Some("mysql".into()),
            instance: None,
            database: None,
        };
        assert!(
            by_engine.matches(&ev),
            "the engine was DERIVED by the canonicalizer, so ?system=mysql must \
             still find this event"
        );
        assert!(
            ScopeNarrowing {
                system: None,
                instance: Some("db-7.internal".into()),
                database: None
            }
            .matches(&ev),
            "the instance is port-stripped by detect_instance and must match that form"
        );
        assert!(
            ScopeNarrowing {
                system: None,
                instance: None,
                database: Some("shop".into())
            }
            .matches(&ev)
        );
    }

    /// ...and it must EXCLUDE what does not match, or the filter is decorative.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_scope_narrowing_excludes_events_that_do_not_match() {
        let ev = deadlock_event_for_row(&json!({
            "_timestamp": 1i64, "o2_my_event": "deadlock",
            "my_trx_side": "1", "my_trx_thread": "89", "my_trx_query": "SELECT 1",
            "server_address": "db-7.internal:3306", "my_db": "shop",
        }))
        .expect("event");

        for narrowing in [
            ScopeNarrowing {
                system: Some("postgresql".into()),
                instance: None,
                database: None,
            },
            ScopeNarrowing {
                system: None,
                instance: Some("other-host".into()),
                database: None,
            },
            ScopeNarrowing {
                system: None,
                instance: None,
                database: Some("billing".into()),
            },
        ] {
            assert!(
                !narrowing.matches(&ev),
                "a non-matching scope must exclude the event, or ?system= does nothing"
            );
        }
    }

    /// An event whose field is UNKNOWN is excluded by a filter on that field.
    ///
    /// House rule (`plan_row_to_dto`): an absent field defaults to the WEAKER
    /// claim. "We do not know which engine this is" is not evidence that it is
    /// the one asked for — and the SQL predicate it replaces would likewise not
    /// match a NULL column, so this keeps the filtered and unfiltered paths
    /// answering the same question.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_scope_narrowing_excludes_an_event_with_an_unknown_field() {
        let untagged = deadlock_event_for_row(&json!({
            "_timestamp": 1i64, "o2_my_event": "deadlock",
            "my_trx_side": "1", "my_trx_thread": "89", "my_trx_query": "SELECT 1",
        }))
        .expect("event");
        assert!(untagged.instance.is_none(), "the recipe tagged no instance");

        assert!(
            !ScopeNarrowing {
                system: None,
                instance: Some("db-7".into()),
                database: None
            }
            .matches(&untagged),
            "unknown is not a match — `AND o2_dbm_instance = 'db-7'` would not \
             match a NULL either"
        );
        // ...but a filter on a field it DOES have still works.
        assert!(
            ScopeNarrowing {
                system: Some("mysql".into()),
                instance: None,
                database: None
            }
            .matches(&untagged)
        );
    }

    /// NO filter means no narrowing — every event survives.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_an_empty_scope_narrowing_keeps_everything() {
        let ev = deadlock_event_for_row(&json!({
            "_timestamp": 1i64, "o2_my_event": "deadlock",
            "my_trx_side": "1", "my_trx_thread": "89", "my_trx_query": "SELECT 1",
        }))
        .expect("event");
        assert!(
            ScopeNarrowing {
                system: None,
                instance: None,
                database: None
            }
            .matches(&ev)
        );
        // An EMPTY STRING is not a filter either — the SQL side already treats
        // it that way (`dbm_event_preds` filters on `!s.is_empty()`), and the two
        // must agree or the same request narrows differently depending on which
        // path serves it.
        assert!(
            ScopeNarrowing {
                system: Some(String::new()),
                instance: Some(String::new()),
                database: Some(String::new()),
            }
            .matches(&ev)
        );
    }

    /// The Rust narrowing and the SQL predicate must answer the SAME question.
    ///
    /// The canonical path keeps its SQL predicates when the fallback is off, and
    /// moves to the Rust filter when it is on. If the two disagree, the same
    /// request returns different rows depending on the fallback — so the
    /// narrowing is checked against a canonical event built the way a
    /// SQL-filtered row would be.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_rust_narrowing_agrees_with_the_sql_predicate_on_canonical_events() {
        let canonical = deadlock_event_for_row(&json!({
            "_timestamp": 1i64,
            server_vantage::O2_DBM_KIND: "deadlock",
            server_vantage::O2_DBM_ENGINE: "postgresql",
            server_vantage::O2_DBM_INSTANCE: "db-1",
            server_vantage::O2_DBM_DATABASE: "dbmlab",
        }))
        .expect("event");

        // The SQL form of the same three filters, for the record.
        let preds = dbm_event_preds(
            Some("postgresql"),
            Some("db-1"),
            Some("dbmlab"),
            &all_cols(),
        );
        assert!(preds.contains("o2_dbm_engine = 'postgresql'"));

        assert!(
            ScopeNarrowing {
                system: Some("postgresql".into()),
                instance: Some("db-1".into()),
                database: Some("dbmlab".into()),
            }
            .matches(&canonical),
            "what the SQL predicate would have kept, the Rust narrowing must keep"
        );
        assert!(
            !ScopeNarrowing {
                system: Some("mysql".into()),
                instance: None,
                database: None
            }
            .matches(&canonical),
            "and what it would have dropped, the Rust narrowing must drop"
        );
    }

    /// THE A1.1 REGRESSION GUARD: the deadlocks read must CONSULT the boundary,
    /// not merely have one available.
    ///
    /// This is the A1.1 analogue of the scope-predicate guard below, and it was
    /// written because the corresponding mutation **survived**: replacing the
    /// whole boundary branch with a bare `Some(RawDeadlockFallback { present })`
    /// restores the always-on behaviour this change exists to remove, and every
    /// one of the nine behavioural tests above still passes — because they all
    /// exercise the pure decision function, and the pure function is still
    /// perfect. The defect lives in the WIRING, so the guard has to.
    ///
    /// What always-on costs, and why it is worth a structural test: every
    /// deadlocks read on a fully-canonicalized deployment widens its projection
    /// by up to ~50 raw columns, ORs four marker terms into the `WHERE`, moves
    /// the scope filters out of SQL so they stop narrowing before the `LIMIT`,
    /// and dispatches every row through the canonicalizer. Silently — nothing
    /// errors, the page is correct, and it stays that way forever.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_deadlocks_read_consults_the_boundary_before_widening() {
        let src = dbm_prod_source();
        let code = src;

        let body_at = code
            .find("async fn read_deadlocks_body")
            .or_else(|| code.find("fn read_deadlocks_body"))
            .expect("the deadlocks body must exist");
        let body = &code[body_at..];
        let body = &body[..body.find("\n}\n").unwrap_or(body.len())];

        // The binding that decides whether the widening happens at all.
        let bind_at = body
            .find("let raw_fallback =")
            .expect("`raw_fallback` must be bound in the deadlocks body");
        let bind = &body[bind_at..];
        let bind = &bind[..bind.find("\n    };").map(|i| i + 6).unwrap_or(bind.len())];

        assert!(
            bind.contains("deadlock_window_needs_fallback("),
            "`raw_fallback` must be gated on the boundary probe — without it the \
             fallback is always-on again, which is the state A1.1 exists to \
             end:\n{bind}"
        );
        // ...and the gate must be able to answer NO. A call whose result is
        // discarded reads as wired but is not.
        assert!(
            bind.contains("None"),
            "the boundary gate must have a `None` arm, or it can never turn the \
             widening off and the probe is pure cost:\n{bind}"
        );
    }

    /// THE §4.3 REGRESSION GUARD: scope predicates must NOT reach the SQL while
    /// the fallback is active.
    ///
    /// This is the single most dangerous mutation in A1 and the one every
    /// behavioural test above misses. `dbm_event_preds` names
    /// `o2_dbm_engine`/`o2_dbm_instance`/`o2_dbm_database`, and a RAW row has
    /// none of them — measured, 0 non-null of 137. So appending them to the
    /// widened `WHERE` silently drops EVERY raw row: the page looks correct with
    /// no filter and under-reports with one, which is the worst shape a bug can
    /// take because nothing errors and the wrong answer is plausible.
    ///
    /// Pinned STRUCTURALLY, in the spirit of
    /// `test_no_caller_swallows_a_schema_read_error`, because the failure lives
    /// in the handler's wiring rather than in any pure function: reverting
    /// `sql_preds` to `&preds` passes every other test in this file while
    /// restoring the bug exactly. Verified by doing precisely that.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_scope_predicates_never_reach_the_sql_while_the_fallback_is_active() {
        let src = dbm_prod_source();
        let code = src;

        // The deadlocks call site, discovered from its kind argument.
        let at = code
            .find("build_dbm_events_sql(\n        stream,\n        server_vantage::KIND_DEADLOCK,")
            .expect("the deadlocks call site must exist");
        let site = &code[at..at + code[at..].find(");").expect("closed") + 2];

        assert!(
            !site.contains("&preds,"),
            "the deadlocks read must NOT pass the raw scope predicates straight \
             through — with the fallback active they name canonical columns a raw \
             row does not have, and every raw row is silently dropped:\n{site}"
        );
        assert!(
            site.contains("sql_preds,"),
            "it must pass the fallback-aware predicate string:\n{site}"
        );

        // ...and that string must actually be emptied when the fallback is on.
        // Asserted on the binding rather than on a substring of the file, so a
        // renamed-but-still-wrong version cannot pass.
        let bind = code
            .find("let sql_preds =")
            .map(|i| &code[i..i + code[i..].find(';').expect("statement ends") + 1])
            .expect("sql_preds must be bound");
        assert!(
            bind.contains("raw_fallback.is_some()") && bind.contains("\"\""),
            "`sql_preds` must be EMPTY when the fallback is active — that is what \
             moves the narrowing to Rust:\n{bind}"
        );

        // The other half of the same contract: having removed the SQL narrowing,
        // the handler MUST apply the Rust one, or the filter silently stops
        // working altogether.
        let body_at = code
            .find("async fn read_deadlocks_body")
            .or_else(|| code.find("fn read_deadlocks_body"))
            .expect("the deadlocks body must exist");
        let body = &code[body_at..];
        let body = &body[..body.find("\n}\n").unwrap_or(body.len())];
        assert!(
            body.contains("scope.matches("),
            "with the SQL predicates removed the handler must narrow in Rust, or \
             ?system= / ?instance= / ?database= stop filtering entirely"
        );
        assert!(
            body.contains("raw_fallback.is_some()"),
            "the Rust narrowing runs exactly where the SQL one did not"
        );
    }

    /// WHY the error must not be flattened, half one: BLOCKING.
    ///
    /// With an empty column set the projection drops both pid columns, and
    /// `BlockingSample::from_record` requires both — so every row is filtered
    /// out, `hits` is empty, the liveness probe runs and the page reports
    /// `not_collecting: true`. That tells the operator their collector is broken
    /// when only a schema read blipped, which is exactly the false alarm the
    /// design note above `LIVENESS_PROBE_MICROS` says must never be raised.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_empty_columns_would_silently_drop_every_blocking_row() {
        let sql = build_dbm_events_sql(
            "_o2_dbm_server",
            "blocking",
            "",
            50,
            &proj(&HashSet::new(), None),
        );
        assert!(!sql.contains(server_vantage::O2_DBM_BLOCKED_PID));
        assert!(!sql.contains(server_vantage::O2_DBM_BLOCKING_PID));

        // What such a projection returns per row, and what the reader makes of
        // it: nothing at all — hence the false `not_collecting`.
        let row = json!({ "_timestamp": 1_000_000 });
        assert!(
            server_vantage::BlockingSample::from_record(&row).is_none(),
            "a pid-less row cannot become a sample, so hits would be empty"
        );
    }

    /// WHY the error must not be flattened, half two: DEADLOCKS.
    ///
    /// Deadlocks has no from_record guard, so the same projection yields events
    /// with no engine, no participants and no victim. Worse than blocking's
    /// false alarm: `hits` is non-empty, so the probe is SKIPPED and the tab
    /// renders content-free rows with no diagnostic at all.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_empty_columns_would_yield_content_free_deadlock_events() {
        let sql = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&HashSet::new(), None),
        );
        assert!(!sql.contains(server_vantage::O2_DBM_PARTICIPANTS));

        let ev = deadlock_event_from_row(&json!({ "_timestamp": 1_000_000 }));
        assert!(ev.engine.is_none());
        assert!(ev.participants.is_empty());
        assert!(ev.victim_pid.is_none());
        // Non-empty `hits` is what suppresses the probe, so this row would reach
        // the UI with no diagnostic beside it.
        let dto = deadlock_event_to_dto(&ev);
        assert_eq!(dto["participant_count"], json!(0));
        assert_eq!(dto["db_system"], json!(""));
    }

    /// NEVER `SELECT *` on a server-vantage stream.
    ///
    /// The recipes export alongside ordinary log lines, so the stream's schema
    /// is the union of every field those lines ever carried — 195 columns on a
    /// real deployment against 21 the readers touch. `SELECT *` makes the
    /// columnar engine fetch all of them per row, and that read dominated the
    /// Deadlocks page (8-18 s). This asserts the projection stays explicit and
    /// stays in lockstep with what `from_record` deserializes.
    #[test]
    fn test_build_dbm_events_sql_projects_only_canonical_columns() {
        let sql = build_dbm_events_sql(
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&all_cols(), None),
        );
        assert!(!sql.contains("SELECT *"), "must not select every column");
        assert!(sql.starts_with("SELECT _timestamp, "));
        for field in server_vantage::ALL_DBM_FIELDS {
            assert!(sql.contains(field), "projection is missing {field}");
        }
    }

    /// Every user-supplied value on these endpoints is escaped — a stream name
    /// or filter value can never break out of its literal/identifier.
    #[test]
    fn test_dbm_events_sql_injection_is_escaped() {
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), None, None, &all_cols());
        assert!(preds.contains("'pg'' OR ''1''=''1'"));
        assert!(!preds.contains("OR '1'='1'"));

        let sql = build_dbm_events_sql("ev\"il", "blocking", &preds, 10, &proj(&all_cols(), None));
        assert!(sql.contains("\"ev\"\"il\""), "stream identifier escaped");
    }

    #[test]
    fn test_dbm_event_preds_only_whitelisted_columns() {
        let preds = dbm_event_preds(Some("postgresql"), Some("db1"), Some("dbmlab"), &all_cols());
        assert_eq!(
            preds,
            "\n    AND o2_dbm_engine = 'postgresql'\n    AND o2_dbm_instance = 'db1'\n    AND o2_dbm_database = 'dbmlab'"
        );
        assert_eq!(dbm_event_preds(None, None, None, &all_cols()), "");
        // Empty strings are not filters.
        assert_eq!(dbm_event_preds(Some(""), None, None, &all_cols()), "");
    }

    /// N5: the instance predicate is presence-gated on the stream schema.
    ///
    /// A stream whose rows never carried `o2_dbm_instance` (the
    /// statement/explain filelog feeds predate the instance stamp) must treat
    /// `?instance=` as matching — a single-instance stream — rather than
    /// silently matching nothing. Engine/database predicates are NOT gated:
    /// every canonicalizer stamps them, so their absence genuinely means "no
    /// such rows".
    #[test]
    fn test_dbm_event_preds_instance_filter_is_presence_gated() {
        let mut present = all_cols();
        present.remove(server_vantage::O2_DBM_INSTANCE);
        let preds = dbm_event_preds(Some("postgresql"), Some("db1"), Some("dbmlab"), &present);
        assert_eq!(
            preds, "\n    AND o2_dbm_engine = 'postgresql'\n    AND o2_dbm_database = 'dbmlab'",
            "with the column absent from the schema the instance predicate must \
             be skipped, and the other two must survive untouched"
        );
        // And with the column present, the filter is real — the gate must not
        // decay into never filtering.
        let gated = dbm_event_preds(None, Some("db1"), None, &all_cols());
        assert_eq!(gated, "\n    AND o2_dbm_instance = 'db1'");
    }

    /// A stored Postgres row: one record already carrying the whole cycle.
    #[cfg(feature = "enterprise")]
    fn pg_row(ts: i64, victim: i64, parts: Value) -> Value {
        json!({
            "_timestamp": ts,
            "o2_dbm_kind": "deadlock",
            "o2_dbm_engine": "postgresql",
            "o2_dbm_instance": "pg1",
            "o2_dbm_database": "dbmlab",
            "o2_dbm_victim_pid": victim,
            // The canonical write path stores this as a JSON STRING.
            "o2_dbm_participants": parts.to_string(),
        })
    }

    /// A stored MySQL row: ONE transaction side, as InnoDB logs it.
    #[cfg(feature = "enterprise")]
    fn my_row(ts: i64, thread: i64, trx: &str, fp: &str, victim: bool) -> Value {
        json!({
            "_timestamp": ts,
            "o2_dbm_kind": "deadlock",
            "o2_dbm_engine": "mysql",
            "o2_dbm_instance": "my1",
            "o2_dbm_database": "dbmlab",
            "o2_dbm_victim_pid": if victim { json!(thread) } else { Value::Null },
            "o2_dbm_participants": json!([{
                "pid": thread,
                "transaction_id": trx,
                "fingerprint": fp,
                "query_norm": format!("UPDATE t{fp} SET c = ? WHERE id = ?"),
                "victim": victim,
            }])
            .to_string(),
        })
    }

    #[cfg(feature = "enterprise")]
    fn events_of(rows: &[Value]) -> Vec<server_vantage::DeadlockEvent> {
        stitch_mysql_deadlocks(rows.iter().map(deadlock_event_from_row).collect())
    }

    /// The participants column round-trips out of its JSON-string storage form.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_event_from_row_parses_string_participants() {
        let row = pg_row(
            300,
            11,
            json!([{"pid": 11, "fingerprint": "aaa"}, {"pid": 22, "fingerprint": "bbb"}]),
        );
        let ev = deadlock_event_from_row(&row);
        assert_eq!(ev.participants.len(), 2);
        assert_eq!(ev.engine.as_deref(), Some("postgresql"));
        assert_eq!(ev.instance.as_deref(), Some("pg1"));
        assert_eq!(ev.database.as_deref(), Some("dbmlab"));
        assert_eq!(ev.victim_pid, Some(11));
        assert_eq!(ev.timestamp, Some(300));
    }

    /// The shape ranking answers "which query shape deadlocks most". The victim
    /// alternating between firings must NOT split one bug into two rows.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_rank_deadlock_shapes_groups_and_ranks() {
        let rows = vec![
            pg_row(
                300,
                11,
                json!([
                    {"pid": 11, "fingerprint": "aaa", "query_norm": "UPDATE accounts SET balance = ? WHERE id = ?"},
                    {"pid": 22, "fingerprint": "bbb", "query_norm": "UPDATE inventory SET qty = ? WHERE id = ?"},
                ]),
            ),
            // Same pair, victim swapped — must group with the row above.
            pg_row(
                200,
                22,
                json!([{"pid": 22, "fingerprint": "bbb"}, {"pid": 11, "fingerprint": "aaa"}]),
            ),
            pg_row(100, 33, json!([{"pid": 33, "fingerprint": "ccc"}])),
        ];
        let ranked = rank_deadlock_shapes(&events_of(&rows));
        assert_eq!(ranked.len(), 2, "two distinct shapes");
        assert_eq!(get_str(&ranked[0], "query_shape"), "aaa+bbb");
        assert_eq!(get_i64(&ranked[0], "count"), 2, "both firings grouped");
        assert_eq!(get_i64(&ranked[0], "last_seen"), 300);
        assert_eq!(get_i64(&ranked[1], "count"), 1);

        // Fingerprints are deduped across firings — they are the join keys the UI
        // uses to pivot into the query view.
        let fps = ranked[0]["fingerprints"].as_array().unwrap();
        assert_eq!(fps.len(), 2);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_rank_deadlock_shapes_skips_shapeless_rows() {
        // A deadlock whose participants had unparseable SQL has no fingerprint,
        // so no shape, and must not create a phantom empty-key group.
        let rows = vec![pg_row(1, 0, json!([{"pid": 9}]))];
        assert!(rank_deadlock_shapes(&events_of(&rows)).is_empty());
    }

    /// The headline case: two InnoDB entries ~150 µs apart are ONE deadlock.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_mysql_merges_two_sides() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_150, 42, "trxB", "bbb", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 1, "two sides collapse to one deadlock");
        assert_eq!(events[0].participants.len(), 2);
        // The victim verdict survives the merge regardless of arrival order.
        assert_eq!(events[0].victim_pid, Some(42));
    }

    /// Postgres records already carry both sides. Merging two of them would
    /// invent a four-way cycle that never happened.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_leaves_postgres_untouched() {
        let rows = vec![
            pg_row(
                1_000_000,
                11,
                json!([{"pid": 11, "fingerprint": "aaa"}, {"pid": 22, "fingerprint": "bbb"}]),
            ),
            // Well inside the MySQL window — must still stay two events.
            pg_row(
                1_000_150,
                33,
                json!([{"pid": 33, "fingerprint": "ccc"}, {"pid": 44, "fingerprint": "ddd"}]),
            ),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 2, "PG events never merge with each other");
        assert!(events.iter().all(|e| e.participants.len() == 2));
    }

    /// A mixed window must not cross engines: a PG event and a MySQL side that
    /// happen to share a microsecond are unrelated.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_never_merges_across_engines() {
        let rows = vec![
            pg_row(
                1_000_000,
                11,
                json!([{"pid": 11, "fingerprint": "aaa"}, {"pid": 22, "fingerprint": "bbb"}]),
            ),
            my_row(1_000_000, 41, "trxA", "ccc", false),
            my_row(1_000_100, 42, "trxB", "ddd", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 2, "one PG event + one stitched MySQL event");
        let mysql: Vec<_> = events
            .iter()
            .filter(|e| e.engine.as_deref() == Some("mysql"))
            .collect();
        assert_eq!(mysql.len(), 1);
        assert_eq!(mysql[0].participants.len(), 2);
    }

    /// pids and transaction ids are only comparable within one server, so two
    /// sides logged by DIFFERENT instances are not one deadlock.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_never_merges_across_instances() {
        let mut a = my_row(1_000_000, 41, "trxA", "aaa", false);
        let b = my_row(1_000_100, 42, "trxB", "bbb", true);
        a["o2_dbm_instance"] = json!("my2");
        let events = events_of(&[a, b]);
        assert_eq!(events.len(), 2, "different instances stay separate");
    }

    /// The UNTAGGED shape, which is what the shipped recipes actually emit.
    ///
    /// `test_stitch_never_merges_across_instances` above hardcodes distinct
    /// instances, so it only ever proved the guard works when identity is
    /// KNOWN — and identity is exactly what production lacks: the filelog
    /// deadlock recipes tag neither instance nor database. Grouping on
    /// `unwrap_or_default()` collapsed every MySQL host into `("mysql","","")`,
    /// so two hosts each with their own two-sided deadlock inside the 2 s window
    /// fused into ONE 4-participant event describing no real lock cycle.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_never_merges_untagged_rows_from_two_servers() {
        // Two hosts, two independent two-sided deadlocks, all four entries
        // within the window and none tagged — the production shape.
        let rows: Vec<Value> = [
            (1_000_000, 41, "trxA1", "aaa", false),
            (1_000_100, 42, "trxA2", "bbb", true),
            (1_000_200, 71, "trxB1", "ccc", false),
            (1_000_300, 72, "trxB2", "ddd", true),
        ]
        .into_iter()
        .map(|(ts, pid, trx, fp, victim)| {
            let mut row = my_row(ts, pid, trx, fp, victim);
            row["o2_dbm_instance"] = Value::Null;
            row["o2_dbm_database"] = Value::Null;
            row
        })
        .collect();

        let events = events_of(&rows);
        // Every entry survives as its own partial event. Over-reporting the
        // COUNT is the safe direction; fabricating a cycle is not.
        assert_eq!(
            events.len(),
            4,
            "untagged sides must not fuse — got {:?}",
            events
                .iter()
                .map(|e| e.participants.len())
                .collect::<Vec<_>>()
        );
        assert!(
            events.iter().all(|e| e.participants.len() == 1),
            "no event may claim participants from another server"
        );
        // The specific fabrication this guards: a 4-participant event whose
        // shape (`aaa+bbb+ccc+ddd`) matches no lock-ordering bug that exists.
        assert!(
            !events
                .iter()
                .any(|e| e.query_shape().as_deref() == Some("aaa+bbb+ccc+ddd")),
            "cross-server shape must never reach rank_deadlock_shapes"
        );
    }

    /// A side that cannot be stitched must still REACH the caller: dropping it
    /// would turn a real deadlock into no deadlock at all. It arrives as the
    /// one-participant event it is, flagged `partial`, exactly as an unmatched
    /// tagged singleton does.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_keeps_untagged_side_as_partial_event() {
        let mut row = my_row(1_000_000, 41, "trxA", "aaa", true);
        row["o2_dbm_instance"] = Value::Null;
        let events = events_of(&[row]);
        assert_eq!(events.len(), 1, "an untagged side is never dropped");
        let dto = deadlock_event_to_dto(&events[0]);
        assert_eq!(dto["partial"], json!(true));
        assert_eq!(dto["participant_count"], json!(1));
    }

    /// The one untagged record that must NOT surface: the participant-less
    /// `WE ROLL BACK TRANSACTION (N)` verdict. It carries a side number and
    /// nothing else — no pid, no statement — so alone it would render a
    /// content-free deadlock row and inflate the count with a non-event. It is
    /// only meaningful joined to its sides, and untagged means it never can be.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_drops_untagged_participantless_verdict() {
        let verdict = json!({
            "_timestamp": 1_000_000,
            "o2_dbm_kind": "deadlock",
            "o2_dbm_engine": "mysql",
            "o2_dbm_victim_side": 2,
            "o2_dbm_participants": json!([]).to_string(),
        });
        assert!(events_of(&[verdict]).is_empty());
    }

    /// The guard must not cost the TAGGED deployment its stitch — tagging an
    /// instance in the recipe is the documented fix, so it has to work.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_still_merges_when_instance_is_tagged() {
        let events = events_of(&[
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_150, 42, "trxB", "bbb", true),
        ]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].participants.len(), 2);
        assert_eq!(events[0].instance.as_deref(), Some("my1"));
    }

    /// Sides far apart in time are two different deadlocks that each lost a half.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_leaves_far_apart_sides_separate() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            // 3 s > the 2 s window.
            my_row(4_000_000, 42, "trxB", "bbb", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|e| e.participants.len() == 1));
    }

    /// An unmatched singleton is returned as-is and flagged `partial`, not
    /// dropped: "a deadlock happened and we only caught one side" is true and
    /// useful, while silently discarding it under-reports the incident.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_keeps_unmatched_singleton_flagged_partial() {
        let events = events_of(&[my_row(1_000_000, 41, "trxA", "aaa", true)]);
        assert_eq!(events.len(), 1);
        let dto = deadlock_event_to_dto(&events[0]);
        assert_eq!(dto["partial"], json!(true));
        assert_eq!(dto["participant_count"], json!(1));
    }

    /// A 3-way pileup: InnoDB can log three transactions in one cycle. All
    /// three sides belong to ONE deadlock, not one-and-a-half.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_handles_three_way_pileup() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", false),
            my_row(1_000_200, 43, "trxC", "ccc", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].participants.len(), 3);
        assert_eq!(events[0].victim_pid, Some(43));
    }

    /// A repeated transaction id inside the window is the NEXT deadlock reusing
    /// a hot pair, not a third side of the open one.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_repeated_transaction_id_starts_new_event() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", true),
            // Same trxA again, still inside the window.
            my_row(1_000_200, 41, "trxA", "aaa", false),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 2, "the repeat opens a second deadlock");
        let sizes: Vec<usize> = events.iter().map(|e| e.participants.len()).collect();
        assert!(sizes.contains(&2) && sizes.contains(&1));
    }

    /// Identical timestamps must not blow up or drop a side — a tie is just a
    /// tie, and the two entries are still two sides of one deadlock.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_stitch_identical_timestamps_tie() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_000, 42, "trxB", "bbb", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].participants.len(), 2);
    }

    /// GAP 2's grouping half: a stitched MySQL deadlock and the equivalent
    /// Postgres one must land under the SAME shape key. Before stitching, the
    /// MySQL sides carried one fingerprint each and grouped as two half-sized
    /// bugs while Postgres grouped as one.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_shape_grouping_is_engine_consistent() {
        let pg = events_of(&[pg_row(
            2_000_000,
            11,
            json!([{"pid": 11, "fingerprint": "aaa"}, {"pid": 22, "fingerprint": "bbb"}]),
        )]);
        let my = events_of(&[
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", true),
        ]);
        assert_eq!(pg[0].query_shape(), my[0].query_shape());
        assert_eq!(pg[0].query_shape().as_deref(), Some("aaa+bbb"));

        // And the shape is victim-order independent on the MySQL side too:
        // swapping which side lost must not change the key.
        let my_swapped = events_of(&[
            my_row(1_000_000, 41, "trxA", "bbb", true),
            my_row(1_000_100, 42, "trxB", "aaa", false),
        ]);
        assert_eq!(my_swapped[0].query_shape(), my[0].query_shape());
    }

    /// Stitched MySQL events rank as ONE firing, not two.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_rank_shapes_counts_stitched_mysql_once() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", true),
            my_row(5_000_000, 43, "trxC", "aaa", false),
            my_row(5_000_100, 44, "trxD", "bbb", true),
        ];
        let ranked = rank_deadlock_shapes(&events_of(&rows));
        assert_eq!(ranked.len(), 1, "one shape");
        assert_eq!(
            get_i64(&ranked[0], "count"),
            2,
            "two deadlocks, not four sides"
        );
    }

    /// The DTO is the contract: no `o2_dbm_` prefixes anywhere, `participants`
    /// is a real ARRAY, and the field names match what the UI service declares.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_dto_shape() {
        let events = events_of(&[pg_row(
            300,
            22,
            json!([
                {"pid": 11, "fingerprint": "aaa", "query": "UPDATE a SET x = 1",
                 "app": "checkout", "user": "svc", "lock_mode": "ShareLock",
                 "lock_target": "accounts", "transaction_id": "1430"},
                {"pid": 22, "fingerprint": "bbb", "query": "UPDATE b SET y = 2",
                 "lock_target": "inventory"},
            ]),
        )]);
        let dto = deadlock_event_to_dto(&events[0]);

        // No storage-layer names leak.
        let obj = dto.as_object().unwrap();
        assert!(
            obj.keys().all(|k| !k.starts_with("o2_dbm_")),
            "DTO leaked a storage column name: {:?}",
            obj.keys().collect::<Vec<_>>()
        );

        assert_eq!(dto["timestamp"], json!(300));
        assert_eq!(dto["db_system"], json!("postgresql"));
        assert_eq!(dto["db_instance"], json!("pg1"));
        assert_eq!(dto["db_namespace"], json!("dbmlab"));
        assert_eq!(dto["victim_pid"], json!(22));
        assert_eq!(dto["participant_count"], json!(2));
        assert_eq!(dto["partial"], json!(false));
        assert_eq!(dto["query_shape"], json!("aaa+bbb"));
        assert_eq!(dto["objects"], json!(["accounts", "inventory"]));
        assert_eq!(dto["id"], json!("300-22"));

        // participants is an ARRAY, not a JSON string.
        let ps = dto["participants"].as_array().expect("array, not a string");
        assert_eq!(ps.len(), 2);
        assert_eq!(ps[0]["pid"], json!(11));
        assert_eq!(ps[0]["application"], json!("checkout"));
        assert_eq!(ps[0]["user"], json!("svc"));
        assert_eq!(ps[0]["lock_mode"], json!("ShareLock"));
        assert_eq!(ps[0]["lock_target"], json!("accounts"));
        assert_eq!(ps[0]["transaction_id"], json!("1430"));
        assert_eq!(ps[0]["fingerprint"], json!("aaa"));
        // The event's victim_pid decides, not the per-participant flag.
        assert_eq!(ps[0]["victim"], json!(false));
        assert_eq!(ps[1]["victim"], json!(true));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_search_matches_and_is_case_insensitive() {
        let events = events_of(&[pg_row(
            300,
            11,
            json!([
                {"pid": 11, "fingerprint": "aaa", "query": "UPDATE accounts SET balance = 1",
                 "app": "checkout", "lock_target": "accounts"},
                {"pid": 22, "fingerprint": "bbb", "query": "UPDATE inventory SET qty = 2"},
            ]),
        )]);
        let ev = &events[0];
        assert!(deadlock_matches_search(ev, ""), "empty term matches all");
        assert!(deadlock_matches_search(ev, "inventory"), "statement text");
        assert!(deadlock_matches_search(ev, "checkout"), "application");
        assert!(deadlock_matches_search(ev, "accounts"), "lock target");
        assert!(deadlock_matches_search(ev, "aaa"), "fingerprint");
        assert!(deadlock_matches_search(ev, "dbmlab"), "database");
        assert!(!deadlock_matches_search(ev, "shipping"));
    }

    /// Search runs AFTER stitching, so a term matching only ONE MySQL side
    /// still returns the whole two-sided deadlock rather than half of it.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_search_runs_after_stitching() {
        let events = events_of(&[
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", true),
        ]);
        assert_eq!(events.len(), 1);
        // "taaa" appears only in the FIRST side's statement text.
        assert!(deadlock_matches_search(&events[0], "taaa"));
        assert_eq!(events[0].participants.len(), 2, "both sides retained");
    }

    /// `namespace` is the spelling the rollup endpoints use; both must reach
    /// the same filter or the UI's one vocabulary silently drops the filter.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_database_param_accepts_namespace_alias() {
        let q: DeadlocksQuery =
            serde_json::from_value(json!({"namespace": "dbmlab"})).expect("deserializes");
        assert_eq!(q.database(), Some("dbmlab"));

        let q: DeadlocksQuery =
            serde_json::from_value(json!({"database": "explicit"})).expect("deserializes");
        assert_eq!(q.database(), Some("explicit"));

        // Empty is not a filter.
        let q: DeadlocksQuery = serde_json::from_value(json!({"namespace": ""})).unwrap();
        assert_eq!(q.database(), None);

        let b: BlockingQuery = serde_json::from_value(json!({"namespace": "dbmlab"})).unwrap();
        assert_eq!(b.database(), Some("dbmlab"));
    }
}
