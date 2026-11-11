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

use std::collections::{BTreeMap, BTreeSet};

use config::meta::service_identity::{ServiceKey, VersionImage};
use infra::table::{
    entity::{
        service_version_verdict_metrics::Model as MetricRow, service_version_verdicts::Model,
    },
    service_version_verdicts as table,
};
use o2_enterprise::enterprise::{
    agent_signals::compare::{CiKind, MetricDelta},
    service_identity::{
        compare::{ArmInput, ArmWindow, Coverage, WindowRules},
        deploys::Transition,
        not_serving::{self, NotServingDecision, PreviousCheck},
        verdict::{
            self, ActiveEvaluation, BaselineCandidate, BaselineInput, BaselineRule,
            BaselineSelection, CapDecision, Evaluation, EvaluationInput, Metric, MetricEvaluation,
            Needs, State, Verdict,
        },
    },
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};

use super::{
    api::{self, Aggregate, Selection},
    deploys::{self, Ring},
    processor::Ownership,
};

const DAY: i64 = 86_400_000_000;
const ALGO_VERSION: i32 = 2;

static CAPPED: std::sync::LazyLock<prometheus::IntCounterVec> = std::sync::LazyLock::new(|| {
    prometheus::register_int_counter_vec!(
        "zo_service_verdicts_capped_total",
        "Evaluations capped by the design section 7.6.4 org limit",
        &["org"]
    )
    .expect("verdict cap metric")
});

struct Arms {
    traces: Aggregate,
    rum: Aggregate,
    window: ArmWindow,
    streams: BTreeSet<String>,
}

#[derive(Clone, Copy)]
struct ArmReach {
    window: ArmWindow,
    local: bool,
}

/// The rollup reads behind one arm: its traces and RUM selections over one scope and window.
struct ArmSpec {
    services: BTreeSet<String>,
    place: String,
    version: String,
    image: Option<String>,
    traces: BTreeSet<String>,
    rum: BTreeSet<String>,
    streams: BTreeSet<String>,
    reach: ArmReach,
    cluster: String,
}

impl ArmSpec {
    fn new(
        service: &str,
        cluster: &str,
        version: &VersionImage,
        place: &str,
        reach: ArmReach,
        summaries: &[config::meta::service_identity::WhereSummaryRecord],
    ) -> Self {
        let traces: BTreeSet<String> = summaries
            .iter()
            .filter(|row| {
                row.service_name == service && row.where_key == place && row.signal == "traces"
            })
            .map(|row| row.source_stream.clone())
            .collect();
        let mut streams: BTreeSet<String> =
            traces.iter().map(|name| format!("traces/{name}")).collect();
        let rum = if summaries
            .iter()
            .any(|row| row.service_name == service && row.where_key == place && row.signal == "rum")
        {
            streams.insert("logs/_rumdata".into());
            BTreeSet::from(["_rumdata".into()])
        } else {
            BTreeSet::new()
        };
        Self {
            services: BTreeSet::from([service.to_string()]),
            place: place.into(),
            version: version.version.clone(),
            image: version.image.clone(),
            traces,
            rum,
            streams,
            reach,
            cluster: cluster.into(),
        }
    }

    fn selection(&self, signal: &'static str) -> Selection<'_> {
        Selection {
            services: &self.services,
            place: &self.place,
            version: &self.version,
            image: self.image.as_deref(),
            signal,
            streams: if signal == "traces" {
                &self.traces
            } else {
                &self.rum
            },
            window: self.reach.window,
            local: self.reach.local,
            cluster: Some(&self.cluster),
            detail_from: None,
        }
    }
}

/// The places of the same env a deploy may fall back to for a baseline.
struct FallbackSpec {
    services: BTreeSet<String>,
    signal: &'static str,
    local: bool,
    descriptors: Vec<(String, String, BTreeSet<String>, ArmWindow)>,
}

impl FallbackSpec {
    fn selections(&self) -> Vec<Selection<'_>> {
        self.descriptors
            .iter()
            .map(|(place, region, streams, window)| Selection {
                services: &self.services,
                place,
                version: "",
                image: None,
                signal: self.signal,
                streams,
                window: *window,
                local: self.local,
                cluster: Some(region),
                detail_from: None,
            })
            .collect()
    }
}

/// A deploy's own arms, read before its baseline is chosen.
struct Prepared {
    start: i64,
    prior: Option<Evaluation>,
    env: String,
    a: Arms,
    previous: Option<Arms>,
}

/// Everything a verdict needs before the not-serving check.
struct Judged {
    prepared: Prepared,
    signal: &'static str,
    baseline: BaselineSelection,
    fanout_complete: bool,
    b: Arms,
}

type Work = (Transition, Option<Model>, bool);

pub(super) fn resolved_env(
    row: &config::meta::service_identity::WhereSummaryRecord,
    identity: &config::meta::service_identity::OrgIdentity,
) -> String {
    use config::meta::service_identity::WhereKind;
    use o2_enterprise::enterprise::service_identity::infer::{self, InferredEnv, WhereIdentity};
    infer::resolve_env(
        identity,
        &row.service_name,
        &WhereIdentity {
            where_key: row.where_key.clone(),
            where_kind: if row.where_key.starts_with("k8s:") {
                WhereKind::K8s
            } else if row.where_key.starts_with("env:") {
                WhereKind::Env
            } else {
                WhereKind::Default
            },
            k8s_cluster: row.k8s_cluster.clone(),
            k8s_namespace: row.k8s_namespace.clone(),
        },
        InferredEnv {
            env: row.env.clone(),
            env_source: row.env_source,
            env_source_value: row.env_source_value.clone(),
            applied_override: None,
        },
    )
    .env
}

/// The from-version's newest deploy verdict a rollback is judged against, frozen or not.
pub(super) async fn from_verdict<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org: &str,
    transition: &Transition,
) -> anyhow::Result<Option<Evaluation>> {
    if transition.kind != o2_enterprise::enterprise::service_identity::deploys::Kind::Rollback {
        return Ok(None);
    }
    let history = infra::table::service_version_deploys::history(
        conn,
        org,
        &transition.scope_key,
        Some(&transition.cluster),
        1000,
    )
    .await?;
    for row in history.iter().filter(|row| {
        row.at < transition.at && Some(&row.to_version) == transition.from_version.as_ref()
    }) {
        if let Some(key) = &row.verdict_key
            && let Some(row) = table::get(conn, org, key).await?
        {
            return Ok(Some(restore(
                &row,
                &table::metric_rows(conn, org, key).await?,
            )?));
        }
    }
    Ok(None)
}

/// A live check; `once` judges a picked baseline in one shot, with no debounce history.
pub(super) fn preview(
    input: EvaluationInput<'_>,
    once: bool,
) -> anyhow::Result<(Model, Vec<MetricRow>)> {
    let (transition, now, not_serving) = (input.transition, input.now, input.not_serving.clone());
    let evaluation = if once {
        verdict::evaluate_once(&input)
    } else {
        live(input)
    };
    stored_rows(transition, &evaluation, &not_serving, None, now)
}

/// The stored evaluation a live check continues from, as the next tick would restore it.
pub(super) async fn restored(org: &str, row: &Model) -> anyhow::Result<Evaluation> {
    let children =
        table::metric_rows(infra::db::get_orm_client_rw().await, org, &row.verdict_key).await?;
    restore(row, &children)
}

/// Evaluates every deploy needing a verdict; with `due`, a stored one only if its scope is due.
pub(super) async fn evaluate(
    org: &str,
    ring: &Ring,
    due: Option<&BTreeSet<String>>,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    let conn = infra::db::get_orm_client_rw().await;
    let region = config::get_cluster_name();
    let pending =
        infra::table::service_version_deploys::pending_verdicts(conn, org, &region, 1000).await?;
    let mut work: BTreeMap<String, Work> = BTreeMap::new();
    for deploy in pending {
        let transition = deploys::transition(&deploy)?;
        work.insert(
            transition.deploy_key.clone(),
            (transition, None, deploy.source_streams_overflow),
        );
    }
    let existing = infra::table::entity::service_version_verdicts::Entity::find()
        .filter(infra::table::entity::service_version_verdicts::Column::OrgId.eq(org))
        .filter(infra::table::entity::service_version_verdicts::Column::Cluster.eq(&region))
        .filter(
            sea_orm::Condition::any()
                .add(infra::table::entity::service_version_verdicts::Column::State.eq("evaluating"))
                .add(infra::table::entity::service_version_verdicts::Column::RecheckedAt.is_null())
                .add(
                    infra::table::entity::service_version_verdicts::Column::Verdict
                        .eq("not_serving"),
                ),
        )
        .all(conn)
        .await?;
    for stored in existing {
        if stored.last_evaluated_at == ring.end {
            continue;
        }
        if stored.last_evaluated_at > ring.end {
            continue;
        }
        if stored.state == "frozen"
            && stored.verdict != "not_serving"
            && ring.end - stored.eval_start < DAY
        {
            continue;
        }
        if waits(&stored, due, ring.end) {
            work.remove(&stored.deploy_key);
            continue;
        }
        if let Some(deploy) =
            infra::table::service_version_deploys::get(conn, org, &stored.deploy_key).await?
        {
            work.insert(
                deploy.deploy_key.clone(),
                (
                    deploys::transition(&deploy)?,
                    Some(stored),
                    deploy.source_streams_overflow,
                ),
            );
        }
    }
    let items: Vec<Work> = work.into_values().collect();
    let judged = judge_many(org, ring, &items, None).await?;
    for (item, judged) in items.iter().zip(judged) {
        ownership.check().await?;
        if let Some(key) = &item.0.verdict_key
            && let Some(current) = table::get(conn, org, key).await?
            && current.last_evaluated_at >= ring.end
        {
            continue;
        }
        conclude(org, ring, item, judged, ownership).await?;
    }
    Ok(())
}

pub(super) async fn emit_pending(
    org: &str,
    ring: &Ring,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    use infra::table::entity::{
        service_version_deploys as deploys, service_version_verdicts as verdicts,
    };
    let conn = infra::db::get_orm_client_rw().await;
    let region = config::get_cluster_name();
    for row in deploys::Entity::find()
        .filter(deploys::Column::OrgId.eq(org))
        .filter(deploys::Column::Cluster.eq(&region))
        .filter(deploys::Column::CreatedAt.eq(ring.end))
        .filter(deploys::Column::Kind.ne("pre_existing"))
        .all(conn)
        .await?
    {
        emit(
            org,
            ring,
            serde_json::to_value(row)?,
            "deploy_detected",
            ownership,
        )
        .await?;
    }
    for row in verdicts::Entity::find()
        .filter(verdicts::Column::OrgId.eq(org))
        .filter(verdicts::Column::Cluster.eq(&region))
        .filter(verdicts::Column::LastEvaluatedAt.eq(ring.end))
        .all(conn)
        .await?
    {
        emit_changes(org, ring, &row, ownership).await?;
    }
    Ok(())
}

pub(super) async fn emit(
    org: &str,
    ring: &Ring,
    mut row: serde_json::Value,
    event: &str,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    let deploy = row["deploy_key"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("event deploy key missing"))?;
    let key =
        config::meta::service_identity::version_key(org, deploy, event, &ring.end.to_string());
    if ring.events.iter().any(|row| row["event_key"] == key) {
        return Ok(());
    }
    row["event_key"] = serde_json::json!(key);
    row["generation"] = serde_json::json!(ownership.generation);
    row["written_at"] = serde_json::json!(config::utils::time::now_micros());
    row["event"] = serde_json::json!(event);
    row["_timestamp"] = serde_json::json!(ring.end);
    row["service"] = row["service_name"].clone();
    if row["version"].is_null() {
        row["version"] = row["to_version"].clone();
    }
    if row["deploy_kind"].is_null() {
        row["deploy_kind"] = row["kind"].clone();
    }
    row["previous_verdict"] = ring
        .events
        .iter()
        .filter(|previous| {
            previous["deploy_key"] == row["deploy_key"] && previous["event"] == "verdict_changed"
        })
        .max_by_key(|previous| previous["_timestamp"].as_i64())
        .map_or(serde_json::Value::Null, |previous| {
            previous["verdict"].clone()
        });
    super::aggregator::write(org, vec![row.clone()], ownership).await?;
    super::deploys::remember_event(org, ring.end, &row);
    Ok(())
}

/// Reads every deploy's arms and baseline in batched rollup reads, in the order given.
async fn judge_many(
    org: &str,
    ring: &Ring,
    items: &[Work],
    resumed_at: Option<i64>,
) -> anyhow::Result<Vec<Judged>> {
    let summaries = db::service_identity::get_cached_summaries(org).await?;
    let prepared = prepare(org, ring, items, resumed_at, &summaries).await?;
    let baselines = choose_baselines(org, ring, items, &prepared, &summaries).await?;
    let specs: Vec<_> = items
        .iter()
        .zip(&prepared)
        .zip(&baselines)
        .map(|(((transition, ..), prepared), (baseline, _))| {
            let cluster = baseline
                .cluster
                .clone()
                .unwrap_or_else(|| transition.cluster.clone());
            ArmSpec::new(
                &transition.service_name,
                &cluster,
                &baseline.identity().unwrap_or_default(),
                baseline
                    .where_key
                    .as_deref()
                    .unwrap_or(&transition.where_key),
                ArmReach {
                    window: baseline.window.unwrap_or(prepared.a.window),
                    local: cluster == transition.cluster,
                },
                &summaries,
            )
        })
        .collect();
    let b_arms = arms_many(org, &specs).await?;
    Ok(prepared
        .into_iter()
        .zip(baselines)
        .zip(b_arms)
        .map(|((prepared, (baseline, fanout_complete)), b)| Judged {
            signal: primary_signal(&prepared.a),
            prepared,
            baseline,
            fanout_complete,
            b,
        })
        .collect())
}

async fn prepare(
    org: &str,
    ring: &Ring,
    items: &[Work],
    resumed_at: Option<i64>,
    summaries: &[config::meta::service_identity::WhereSummaryRecord],
) -> anyhow::Result<Vec<Prepared>> {
    let conn = infra::db::get_orm_client_rw().await;
    let identity = db::service_identity::get_cached_overrides(org).await;
    let mut specs = Vec::new();
    let mut heads = Vec::new();
    for (transition, stored, _) in items {
        let previous_metrics = if let Some(row) = stored {
            table::metric_rows(conn, org, &row.verdict_key).await?
        } else {
            vec![]
        };
        let prior = stored
            .as_ref()
            .map(|row| restore(row, &previous_metrics))
            .transpose()?;
        let start =
            resumed_at.unwrap_or_else(|| prior.as_ref().map_or(transition.at, |p| p.eval_start));
        let window = super::api::evaluation_window(start, ring.end, DAY);
        let env = summaries
            .iter()
            .filter(|row| {
                row.service_name == transition.service_name && row.where_key == transition.where_key
            })
            .max_by_key(|row| row.last_seen)
            .map(|row| resolved_env(row, &identity))
            .unwrap_or_default();
        let reach = |window| ArmReach {
            window,
            local: true,
        };
        specs.push(ArmSpec::new(
            &transition.service_name,
            &transition.cluster,
            &transition.to_identity(),
            &transition.where_key,
            reach(window),
            summaries,
        ));
        if let Some(version) = transition.from_identity() {
            specs.push(ArmSpec::new(
                &transition.service_name,
                &transition.cluster,
                &version,
                &transition.where_key,
                reach(previous_window(transition, window)),
                summaries,
            ));
        }
        heads.push((start, prior, env));
    }
    let mut arms = arms_many(org, &specs).await?.into_iter();
    let mut prepared = Vec::with_capacity(items.len());
    for ((transition, ..), (start, prior, env)) in items.iter().zip(heads) {
        let a = arms.next().ok_or_else(|| anyhow::anyhow!("arm missing"))?;
        let previous = match transition.from_version {
            Some(_) => Some(arms.next().ok_or_else(|| anyhow::anyhow!("arm missing"))?),
            None => None,
        };
        prepared.push(Prepared {
            start,
            prior,
            env,
            a,
            previous,
        });
    }
    Ok(prepared)
}

/// The baseline of each deploy, with the same-env fallbacks read for all deploys that need them.
async fn choose_baselines(
    org: &str,
    ring: &Ring,
    items: &[Work],
    prepared: &[Prepared],
    summaries: &[config::meta::service_identity::WhereSummaryRecord],
) -> anyhow::Result<Vec<(BaselineSelection, bool)>> {
    let mut candidates: Vec<_> = items
        .iter()
        .zip(prepared)
        .map(|((transition, ..), prepared)| own_candidates(transition, prepared))
        .collect();
    let mut fanout: Vec<bool> = items
        .iter()
        .map(|(_, stored, _)| {
            stored
                .as_ref()
                .is_some_and(|row| row.baseline_fanout_complete)
        })
        .collect();
    let mut baselines: Vec<_> = (0..items.len())
        .map(|i| select(&items[i], &prepared[i], ring, &candidates[i], fanout[i]))
        .collect();
    let wanted: Vec<_> = (0..items.len())
        .filter(|i| baselines[*i].rule == BaselineRule::None)
        .collect();
    for (i, more) in wanted
        .iter()
        .zip(fallback_for(org, items, prepared, &wanted, summaries, true).await?)
    {
        candidates[*i].extend(more);
        baselines[*i] = select(&items[*i], &prepared[*i], ring, &candidates[*i], false);
    }
    let wanted: Vec<_> = (0..items.len())
        .filter(|i| baselines[*i].request_fanout && !fanout[*i])
        .collect();
    for (i, more) in wanted
        .iter()
        .zip(fallback_for(org, items, prepared, &wanted, summaries, false).await?)
    {
        candidates[*i].extend(more);
        fanout[*i] = true;
        baselines[*i] = select(&items[*i], &prepared[*i], ring, &candidates[*i], true);
    }
    Ok(baselines.into_iter().zip(fanout).collect())
}

fn select(
    item: &Work,
    prepared: &Prepared,
    ring: &Ring,
    candidates: &[BaselineCandidate],
    fanout_complete: bool,
) -> BaselineSelection {
    select_baseline(&BaselineInput {
        transition: &item.0,
        signal: primary_signal(&prepared.a),
        env: &prepared.env,
        eval_start: prepared.start,
        window_end: prepared.a.window.end,
        scope_requests: primary(&prepared.a).total,
        candidates,
        previous: prepared.prior.as_ref().map(|p| &p.baseline),
        fanout_complete,
        rules: WindowRules {
            window: ring.interval,
            max_span: DAY,
            retention_start: ring.end - 400 * DAY,
        },
    })
}

/// The deploy's own volumes per version, then the version it replaced over the window before it.
fn own_candidates(transition: &Transition, prepared: &Prepared) -> Vec<BaselineCandidate> {
    let signal = primary_signal(&prepared.a);
    let data = primary(&prepared.a);
    let window = prepared.a.window;
    let mut candidates = Vec::new();
    for (version, (requests, latest_requests)) in &data.volumes {
        candidates.push(BaselineCandidate {
            service: transition.service_name.clone(),
            signal: signal.into(),
            version: version.version.clone(),
            image: version.image.clone(),
            where_key: transition.where_key.clone(),
            env: prepared.env.clone(),
            cluster: transition.cluster.clone(),
            window,
            requests: *requests,
            latest_requests: *latest_requests,
            latest_total: data.volumes.values().map(|(_, latest)| latest).sum(),
            deploy_at: transition.at,
        });
    }
    if let (Some(version), Some(previous)) = (transition.from_identity(), &prepared.previous) {
        candidates.push(BaselineCandidate {
            service: transition.service_name.clone(),
            signal: signal.into(),
            version: version.version,
            image: version.image,
            where_key: transition.where_key.clone(),
            env: prepared.env.clone(),
            cluster: transition.cluster.clone(),
            window: previous_window(transition, window),
            requests: if signal == "traces" {
                previous.traces.traces.requests
            } else {
                previous.rum.rum.views
            },
            latest_requests: 0,
            latest_total: 0,
            deploy_at: transition.at,
        });
    }
    candidates
}

fn primary_signal(a: &Arms) -> &'static str {
    if a.traces.total > 0 { "traces" } else { "rum" }
}

fn primary(a: &Arms) -> &Aggregate {
    if a.traces.total > 0 {
        &a.traces
    } else {
        &a.rum
    }
}

fn previous_window(transition: &Transition, window: ArmWindow) -> ArmWindow {
    ArmWindow {
        start: transition.at - window.span(),
        end: transition.at,
        coverage: Coverage::Ok,
    }
}

/// Judges one deploy from its batched reads: the not-serving check, the verdict and its admission.
async fn conclude(
    org: &str,
    ring: &Ring,
    item: &Work,
    judged: Judged,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    // A loop, not recursion: a self-containing future cannot be proved Send for the jobs runner.
    let mut judged = judged;
    while let Some(again) = conclude_once(org, ring, item, judged, ownership).await? {
        judged = again;
    }
    Ok(())
}

/// One pass of `conclude`; a recovered not-serving check returns the re-judged reads to rerun.
async fn conclude_once(
    org: &str,
    ring: &Ring,
    item: &Work,
    judged: Judged,
    ownership: &Ownership<'_>,
) -> anyhow::Result<Option<Judged>> {
    let (transition, stored, overflow) = (&item.0, item.1.as_ref(), item.2);
    let conn = infra::db::get_orm_client_rw().await;
    let Judged {
        prepared:
            Prepared {
                start,
                prior,
                env,
                a,
                ..
            },
        signal,
        baseline,
        fanout_complete,
        b,
    } = judged;
    let env = env.as_str();
    let traces_basis = api::DetailBasis::of(&a.traces, &b.traces);
    let rum_basis = api::DetailBasis::of(&a.rum, &b.rum);
    let key = ServiceKey::of(&transition.service_name);
    let windows = ring.windows(&key, &transition.where_key);
    let latest = &windows[windows.len().saturating_sub(2)..];
    let ns = not_serving::check(&not_serving::NotServingInput {
        service: key.as_str().to_string(),
        where_key: transition.where_key.clone(),
        // K8s presence knows the version text only, never the image.
        version: transition.to_version.clone(),
        now: ring.end,
        presence_windows: ring.presence.clone(),
        span_pods: ring.pods.clone(),
        agreement_matches: deploys::agreement(ring, &key, &transition.where_key).0,
        agreement_total: deploys::agreement(ring, &key, &transition.where_key).1,
        serving: transition
            .serving_versions
            .iter()
            .map(|r| r.version.clone())
            .collect(),
        version_requests: std::array::from_fn(|i| {
            latest[i]
                .counts
                .get(&transition.to_identity())
                .copied()
                .unwrap_or(0)
        }),
        baseline_mean: if b.window.span() > 0 {
            (if signal == "traces" {
                b.traces.traces.requests
            } else {
                b.rum.rum.views
            }) as f64
                / (b.window.span() / ring.interval).max(1) as f64
                * expected_share(transition, &baseline)
        } else {
            0.0
        },
        baseline_count: if signal == "traces" {
            b.traces.traces.requests
        } else {
            b.rum.rum.views
        },
        evaluating: true,
        window_starts: [latest[0].start, latest[1].start],
        window_us: ring.interval,
        previous: stored.map_or_else(PreviousCheck::default, |row| PreviousCheck {
            consecutive_drop: row.ns_consecutive_drop as u32,
            not_serving_since: row.ns_not_serving_since,
            first_requests_at: row.ns_first_requests_at,
        }),
    });
    if let Some(recovered) = ns.eval_start.filter(|at| *at > start) {
        let again = Box::pin(judge_many(
            org,
            ring,
            std::slice::from_ref(item),
            Some(recovered),
        ))
        .await?
        .pop()
        .ok_or_else(|| anyhow::anyhow!("recovered evaluation missing"))?;
        return Ok(Some(again));
    }
    let from_frozen = from_verdict(infra::db::get_orm_client_rw().await, org, transition).await?;
    let mut evaluation = verdict::evaluate(&EvaluationInput {
        transition,
        baseline,
        traces: Some((
            ArmInput {
                window: a.window,
                data: Some(a.traces.traces.clone()),
            },
            ArmInput {
                window: b.window,
                data: Some(b.traces.traces.clone()),
            },
        )),
        rum: Some((
            ArmInput {
                window: a.window,
                data: Some(rum_basis.rum(&a.rum)),
            },
            ArmInput {
                window: b.window,
                data: Some(rum_basis.rum(&b.rum)),
            },
        )),
        endpoints_new: traces_basis.endpoints(&a.traces),
        endpoints_base: traces_basis.endpoints(&b.traces),
        new_windows: ((ring.end - start) / ring.interval).max(0) as u32,
        eval_start: start,
        now: ring.end,
        env,
        not_serving: ns.clone(),
        prior: prior.as_ref(),
        from_frozen: from_frozen.as_ref(),
    });
    let mut eviction = None;
    if needs_admission(evaluation.state, stored) {
        let active_rows = infra::table::entity::service_version_verdicts::Entity::find()
            .filter(infra::table::entity::service_version_verdicts::Column::OrgId.eq(org))
            .filter(infra::table::entity::service_version_verdicts::Column::State.eq("evaluating"))
            .order_by_asc(infra::table::entity::service_version_verdicts::Column::VerdictKey)
            .all(conn)
            .await?;
        let active = &active_rows;
        let active: Vec<_> = active
            .iter()
            .map(|row| ActiveEvaluation {
                key: row.verdict_key.clone(),
                priority: row.eval_priority,
                baseline_requests: row.n_base.max(0) as u64,
                eval_start: row.eval_start,
                insufficient: row.verdict == "insufficient",
            })
            .collect();
        match verdict::cap(&active, evaluation.priority, ring.end) {
            CapDecision::Admit => {}
            CapDecision::Capped => {
                cap(&mut evaluation, ring.end);
                CAPPED.with_label_values(&[org]).inc();
            }
            CapDecision::Evict(key) => {
                CAPPED.with_label_values(&[org]).inc();
                if let Some(mut evicted) = table::get(conn, org, &key).await? {
                    if evicted.cluster != transition.cluster {
                        cap(&mut evaluation, ring.end);
                    } else {
                        evicted.state = "frozen".into();
                        evicted.verdict = "insufficient".into();
                        evicted.reason = Some("capped".into());
                        evicted.reason_code = "capped".into();
                        evicted.frozen_at = Some(ring.end);
                        evicted.last_evaluated_at = ring.end;
                        evicted.updated_at = ring.end;
                        let mut metrics = table::metric_rows(conn, org, &key).await?;
                        for metric in &mut metrics {
                            metric.updated_at = ring.end;
                        }
                        eviction = Some((evicted, metrics));
                    }
                }
            }
        }
    }
    let (mut row, metrics) = stored_rows(transition, &evaluation, &ns, stored, ring.end)?;
    let mut sources: BTreeSet<String> = serde_json::from_str(&row.source_streams)?;
    sources.extend(a.streams.iter().chain(&b.streams).cloned());
    if let Some(previous) = stored {
        sources.extend(serde_json::from_str::<Vec<String>>(
            &previous.source_streams,
        )?);
    }
    row.source_streams = serde_json::to_string(&sources)?;
    row.source_streams_overflow |= overflow;
    row.baseline_fanout_complete = fanout_complete;
    judged_windows(&mut row, stored, a.window, b.window);
    persist(org, row, metrics, eviction, ownership).await?;
    Ok(None)
}

/// One more check on the prior; it never ranks below the prior before a stored tick confirms it.
fn live(input: EvaluationInput<'_>) -> Evaluation {
    // Freezing and the daily recheck belong to the stored tick; a live check keeps the debounce.
    let prior = input.prior.map(|prior| Evaluation {
        state: State::Evaluating,
        frozen_at: None,
        recheck_verdict: None,
        rechecked_at: None,
        ..prior.clone()
    });
    let evaluation = verdict::evaluate(&EvaluationInput {
        prior: prior.as_ref(),
        ..input
    });
    match prior {
        Some(prior) if severity(evaluation.verdict) < severity(prior.verdict) => prior,
        _ => evaluation,
    }
}

// A live check has no not-serving input, so it can never confirm a change away from not_serving.
fn severity(verdict: Verdict) -> u8 {
    match verdict {
        Verdict::Insufficient => 0,
        Verdict::Ok => 1,
        Verdict::Watch => 2,
        Verdict::Regressed => 3,
        Verdict::NotServing => 4,
    }
}

fn needs_admission(state: State, stored: Option<&Model>) -> bool {
    state == State::Evaluating && stored.is_none_or(|row| row.state != "evaluating")
}

fn select_baseline(input: &BaselineInput<'_>) -> BaselineSelection {
    let mut selected = input
        .previous
        .filter(|baseline| {
            baseline.version.is_some()
                && baseline
                    .cluster
                    .as_deref()
                    .is_some_and(|region| region != input.transition.cluster)
        })
        .cloned()
        .unwrap_or_else(|| verdict::baseline(input));
    if selected.version.is_some() {
        let a =
            super::api::evaluation_window(input.eval_start, input.window_end, input.rules.max_span);
        let available_start = input
            .candidates
            .iter()
            .filter(|c| {
                Some(c.identity()) == selected.identity()
                    && Some(&c.where_key) == selected.where_key.as_ref()
                    && Some(&c.cluster) == selected.cluster.as_ref()
            })
            .map(|c| c.window.start)
            .min()
            .unwrap_or(input.rules.retention_start);
        selected.window = Some(super::api::baseline_window(
            a,
            matches!(
                selected.rule,
                BaselineRule::Canary | BaselineRule::EnvFallback
            ),
            input.transition.at,
            available_start.max(input.rules.retention_start),
        ));
    }
    selected
}

async fn persist(
    org: &str,
    row: Model,
    metrics: Vec<MetricRow>,
    eviction: Option<(Model, Vec<MetricRow>)>,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    let conn = infra::db::get_orm_client_rw().await;
    let key = row.verdict_key.clone();
    ownership.check().await?;
    let evicted_key = eviction.as_ref().map(|(row, _)| row.verdict_key.clone());
    table::put_admitted_fenced(conn, ownership.generation, row, metrics, eviction).await?;
    if let Some(evicted_key) = evicted_key {
        publish_persisted(org, &evicted_key).await?;
    }
    publish_persisted(org, &key).await
}

async fn publish_persisted(org: &str, key: &str) -> anyhow::Result<()> {
    let conn = infra::db::get_orm_client_rw().await;
    let row = table::get(conn, org, key)
        .await?
        .ok_or_else(|| anyhow::anyhow!("persisted verdict missing"))?;
    let metrics = table::metric_rows(conn, org, &row.verdict_key).await?;
    db::service_identity_sync::publish_chunked(
        vec![serde_json::to_value(&row)?],
        524_288,
        |rows| config::meta::service_identity::ServiceIdentityMessage::VerdictPut {
            org_id: org.into(),
            rows,
            metrics: metrics
                .iter()
                .map(|row| db::service_identity_sync::verdict_metric_for_wire(org, row))
                .collect::<Result<_, _>>()
                .expect("metric serialization"),
        },
    )
    .await;
    Ok(())
}

async fn arms_many(org: &str, specs: &[ArmSpec]) -> anyhow::Result<Vec<Arms>> {
    let selections: Vec<_> = specs
        .iter()
        .flat_map(|spec| [spec.selection("traces"), spec.selection("rum")])
        .collect();
    let mut aggregates = api::aggregate_grouped(org, &selections).await?.into_iter();
    Ok(specs
        .iter()
        .map(|spec| Arms {
            traces: aggregates.next().unwrap_or_default(),
            rum: aggregates.next().unwrap_or_default(),
            window: spec.reach.window,
            streams: spec.streams.clone(),
        })
        .collect())
}

// A frozen verdict's recheck never moves the windows its headline was judged on.
fn judged_windows(row: &mut Model, stored: Option<&Model>, a: ArmWindow, b: ArmWindow) {
    if let Some(frozen) = stored.filter(|s| s.state == "frozen" && s.verdict == row.verdict) {
        row.window_end = frozen.window_end;
        row.baseline_start = frozen.baseline_start;
        row.baseline_end = frozen.baseline_end;
        return;
    }
    row.window_end = a.end;
    (row.baseline_start, row.baseline_end) = if row.baseline_version.is_some() {
        (Some(b.start), Some(b.end))
    } else {
        (None, None)
    };
}

fn cap(evaluation: &mut Evaluation, now: i64) {
    evaluation.state = State::Frozen;
    evaluation.verdict = Verdict::Insufficient;
    evaluation.reason_code = "capped";
    evaluation.frozen_at = Some(now);
}

fn stored_rows(
    transition: &Transition,
    evaluation: &Evaluation,
    ns: &NotServingDecision,
    previous: Option<&Model>,
    now: i64,
) -> anyhow::Result<(Model, Vec<MetricRow>)> {
    let key = transition
        .verdict_key
        .clone()
        .ok_or_else(|| anyhow::anyhow!("missing verdict key"))?;
    let metrics: Vec<_> = evaluation
        .metrics
        .iter()
        .map(|metric| MetricRow {
            verdict_key: key.clone(),
            metric: metric_name(metric.metric).into(),
            new_value: Some(metric.delta.a),
            base_value: Some(metric.delta.b),
            delta: Some(metric.delta.delta),
            lo: Some(metric.delta.lo),
            hi: Some(metric.delta.hi),
            ci_kind: match metric.delta.ci_kind {
                CiKind::Variance => "variance",
                CiKind::SketchBand => "sketch_band",
                CiKind::HistogramBand => "histogram_band",
            }
            .into(),
            badge: if metric.delta.insufficient {
                "insufficient"
            } else if metric.significant {
                "worse"
            } else if metric.watch {
                "possible"
            } else {
                "same"
            }
            .into(),
            n_new: metric.n_new as i64,
            n_base: metric.n_base as i64,
            updated_at: now,
            ..Default::default()
        })
        .collect();
    let headline = evaluation
        .headline
        .and_then(|metric| metrics.iter().find(|m| m.metric == metric_name(metric)));
    let mut streams: BTreeSet<_> = transition.source_streams.iter().cloned().collect();
    streams.extend(ns.source_streams.iter().cloned());
    let row = Model {
        verdict_key: key,
        deploy_key: transition.deploy_key.clone(),
        deploy_kind: serde_json::to_value(transition.kind)?
            .as_str()
            .unwrap_or_default()
            .into(),
        rollback_outcome: evaluation.rollback_outcome.map(str::to_string),
        scope_key: transition.scope_key.clone(),
        version_key: transition.to_version_key.clone(),
        org_id: transition.org_id.clone(),
        service_name: transition.service_name.clone(),
        where_key: transition.where_key.clone(),
        version: transition.to_version.clone(),
        image: transition.to_image.clone(),
        cluster: transition.cluster.clone(),
        verdict: verdict_name(evaluation.verdict).into(),
        state: if evaluation.state == State::Frozen {
            "frozen"
        } else {
            "evaluating"
        }
        .into(),
        reason: (evaluation.verdict == Verdict::Insufficient
            || evaluation.verdict == Verdict::NotServing)
            .then(|| evaluation.reason_code.into()),
        signal: evaluation.signal.into(),
        baseline_version: evaluation.baseline.version.clone(),
        baseline_image: evaluation.baseline.image.clone(),
        baseline_rule: rule_name(evaluation.baseline.rule).into(),
        baseline_where_key: evaluation.baseline.where_key.clone(),
        baseline_env: evaluation.baseline.env.clone(),
        baseline_cluster: evaluation.baseline.cluster.clone(),
        baseline_fanout_complete: previous.is_some_and(|p| p.baseline_fanout_complete),
        source_streams: serde_json::to_string(&streams)?,
        source_streams_overflow: previous.is_some_and(|p| p.source_streams_overflow),
        eval_priority: evaluation.priority,
        baseline_traffic_share: evaluation.baseline.traffic_share,
        eval_start: evaluation.eval_start,
        window_end: now,
        baseline_start: None,
        baseline_end: None,
        checks_done: evaluation.checks_done as i32,
        consecutive_regressed: evaluation.consecutive_regressed as i32,
        traces_consecutive_regressed: evaluation
            .section_consecutive_regressed
            .get("traces")
            .copied()
            .unwrap_or(0) as i32,
        rum_consecutive_regressed: evaluation
            .section_consecutive_regressed
            .get("rum")
            .copied()
            .unwrap_or(0) as i32,
        n_new: headline.map_or(0, |m| m.n_new),
        n_base: headline.map_or(0, |m| m.n_base),
        headline_metric: headline.map(|m| m.metric.clone()),
        headline_new: headline.and_then(|m| m.new_value),
        headline_base: headline.and_then(|m| m.base_value),
        headline_lo: headline.and_then(|m| m.lo),
        headline_hi: headline.and_then(|m| m.hi),
        headline_ci_kind: headline.map(|m| m.ci_kind.clone()),
        recheck_verdict: evaluation.recheck_verdict.map(|v| verdict_name(v).into()),
        rechecked_at: evaluation.rechecked_at,
        algo_version: ALGO_VERSION,
        first_evaluated_at: previous.map_or(now, |p| p.first_evaluated_at),
        last_evaluated_at: now,
        frozen_at: evaluation.frozen_at,
        created_at: previous.map_or(now, |p| p.created_at),
        updated_at: now,
        baseline_rule_initial: rule_name(evaluation.baseline.initial_rule).into(),
        baseline_switched_at: evaluation.baseline.switched_at,
        baseline_switch_reason: evaluation.baseline.switch_reason.map(str::to_string),
        baseline_version_initial: evaluation.baseline.initial_version.clone(),
        baseline_image_initial: evaluation.baseline.initial_image.clone(),
        reason_code: evaluation.reason_code.into(),
        needs_metric: evaluation
            .needs
            .as_ref()
            .map(|n| metric_name(n.metric).into()),
        needs_have: evaluation.needs.as_ref().map(|n| n.have as i64),
        needs_need: evaluation.needs.as_ref().map(|n| n.need as i64),
        ns_consecutive_drop: ns.consecutive_drop as i32,
        ns_not_serving_since: ns.not_serving_since,
        ns_first_requests_at: ns.eval_start,
        ..Default::default()
    };
    Ok((row, metrics))
}

/// A clean scope's stored verdict waits for a time threshold unless a regression awaits confirming.
fn waits(stored: &Model, due: Option<&BTreeSet<String>>, end: i64) -> bool {
    due.is_some_and(|due| !due.contains(&stored.scope_key))
        && stored.reason_code != "debounce_pending"
        && !verdict::time_due(
            stored.eval_start,
            stored.ns_not_serving_since,
            stored.last_evaluated_at,
            end,
        )
}

/// A canary is expected to carry only its entry share of the concurrent baseline's requests.
fn expected_share(transition: &Transition, baseline: &BaselineSelection) -> f64 {
    if baseline.rule == BaselineRule::Canary {
        transition.share_at_entry.clamp(0.0, 1.0)
    } else {
        1.0
    }
}

fn restore(row: &Model, children: &[MetricRow]) -> anyhow::Result<Evaluation> {
    let baseline = BaselineSelection {
        rule: parse_rule(&row.baseline_rule)?,
        version: row.baseline_version.clone(),
        image: row.baseline_image.clone(),
        where_key: row.baseline_where_key.clone(),
        env: row.baseline_env.clone(),
        cluster: row.baseline_cluster.clone(),
        window: None,
        traffic_share: row.baseline_traffic_share,
        request_fanout: false,
        switched_at: row.baseline_switched_at,
        switch_reason: row
            .baseline_switch_reason
            .as_deref()
            .map(static_code)
            .transpose()?,
        initial_rule: parse_rule(&row.baseline_rule_initial)?,
        initial_version: row.baseline_version_initial.clone(),
        initial_image: row.baseline_image_initial.clone(),
    };
    let metrics = children
        .iter()
        .map(|child| {
            Ok(MetricEvaluation {
                metric: parse_metric(&child.metric)?,
                signal: if matches!(child.metric.as_str(), "error_rate" | "p50" | "p95") {
                    "traces"
                } else {
                    "rum"
                },
                delta: MetricDelta {
                    a: child.new_value.unwrap_or(0.0),
                    b: child.base_value.unwrap_or(0.0),
                    delta: child.delta.unwrap_or(0.0),
                    lo: child.lo.unwrap_or(0.0),
                    hi: child.hi.unwrap_or(0.0),
                    straddles_zero: child.lo.unwrap_or(0.0) <= 0.0
                        && child.hi.unwrap_or(0.0) >= 0.0,
                    insufficient: child.badge == "insufficient",
                    ci_kind: match child.ci_kind.as_str() {
                        "sketch_band" => CiKind::SketchBand,
                        "histogram_band" => CiKind::HistogramBand,
                        _ => CiKind::Variance,
                    },
                },
                n_new: child.n_new.max(0) as u64,
                n_base: child.n_base.max(0) as u64,
                significant: child.badge == "worse",
                watch: child.badge == "possible",
                within_good: child.badge == "same",
            })
        })
        .collect::<anyhow::Result<_>>()?;
    Ok(Evaluation {
        verdict: parse_verdict(&row.verdict)?,
        state: if row.state == "frozen" {
            State::Frozen
        } else {
            State::Evaluating
        },
        reason_code: static_code(&row.reason_code)?,
        baseline,
        metrics,
        headline: row
            .headline_metric
            .as_deref()
            .map(parse_metric)
            .transpose()?,
        signal: if row.signal == "traces" {
            "traces"
        } else {
            "rum"
        },
        needs: row
            .needs_metric
            .as_deref()
            .map(|metric| {
                Ok::<_, anyhow::Error>(Needs {
                    metric: parse_metric(metric)?,
                    have: row.needs_have.unwrap_or(0).max(0) as u64,
                    need: row.needs_need.unwrap_or(0).max(0) as u64,
                })
            })
            .transpose()?,
        checks_done: row.checks_done as u32,
        consecutive_regressed: row.consecutive_regressed as u32,
        section_consecutive_regressed: BTreeMap::from([
            ("traces", row.traces_consecutive_regressed as u32),
            ("rum", row.rum_consecutive_regressed as u32),
        ]),
        eval_start: row.eval_start,
        frozen_at: row.frozen_at,
        recheck_verdict: row
            .recheck_verdict
            .as_deref()
            .map(parse_verdict)
            .transpose()?,
        rechecked_at: row.rechecked_at,
        priority: row.eval_priority,
        rollback_outcome: row
            .rollback_outcome
            .as_deref()
            .map(static_code)
            .transpose()?,
    })
}

fn metric_name(metric: Metric) -> &'static str {
    match metric {
        Metric::ErrorRate => "error_rate",
        Metric::P50 => "p50",
        Metric::P95 => "p95",
        Metric::ErrorViewRate => "error_view_rate",
        Metric::Lcp => "lcp_p75",
        Metric::Inp => "inp_p75",
        Metric::Cls => "cls_p75",
        Metric::NewErrorTypes => "new_error_types",
    }
}

fn parse_metric(value: &str) -> anyhow::Result<Metric> {
    [
        Metric::ErrorRate,
        Metric::P50,
        Metric::P95,
        Metric::ErrorViewRate,
        Metric::Lcp,
        Metric::Inp,
        Metric::Cls,
        Metric::NewErrorTypes,
    ]
    .into_iter()
    .find(|m| metric_name(*m) == value)
    .ok_or_else(|| anyhow::anyhow!("unknown persisted metric"))
}

fn verdict_name(value: Verdict) -> &'static str {
    match value {
        Verdict::Ok => "ok",
        Verdict::Insufficient => "insufficient",
        Verdict::Watch => "watch",
        Verdict::NotServing => "not_serving",
        Verdict::Regressed => "regressed",
    }
}

fn parse_verdict(value: &str) -> anyhow::Result<Verdict> {
    [
        Verdict::Ok,
        Verdict::Insufficient,
        Verdict::Watch,
        Verdict::NotServing,
        Verdict::Regressed,
    ]
    .into_iter()
    .find(|v| verdict_name(*v) == value)
    .ok_or_else(|| anyhow::anyhow!("unknown persisted verdict"))
}

fn rule_name(value: BaselineRule) -> &'static str {
    match value {
        BaselineRule::Canary => "canary",
        BaselineRule::Previous => "previous",
        BaselineRule::EnvFallback => "env_fallback",
        BaselineRule::None => "none",
    }
}

fn parse_rule(value: &str) -> anyhow::Result<BaselineRule> {
    [
        BaselineRule::Canary,
        BaselineRule::Previous,
        BaselineRule::EnvFallback,
        BaselineRule::None,
    ]
    .into_iter()
    .find(|v| rule_name(*v) == value)
    .ok_or_else(|| anyhow::anyhow!("unknown persisted baseline rule"))
}

fn static_code(value: &str) -> anyhow::Result<&'static str> {
    [
        "regressed_significant",
        "new_error_types",
        "within_good_band",
        "below_min_effect",
        "within_noise",
        "improved",
        "not_significant_yet",
        "debounce_pending",
        "minor_new_error",
        "no_previous_version",
        "below_min_count",
        "capped",
        "seen_in_k8s_no_requests",
        "traffic_drop",
        "pre_existing",
        "rolled_back",
        "canary_drained",
        "canary_below_min",
        "canary_changed",
        "baseline_redetected",
        "recovered",
        "not_recovered",
        "pending",
    ]
    .into_iter()
    .find(|code| *code == value)
    .ok_or_else(|| anyhow::anyhow!("unknown persisted lifecycle code"))
}

async fn fallback_spec(
    org: &str,
    transition: &Transition,
    signal: &'static str,
    env: &str,
    window: ArmWindow,
    summaries: &[config::meta::service_identity::WhereSummaryRecord],
    local: bool,
) -> anyhow::Result<FallbackSpec> {
    let identity = db::service_identity::get_cached_overrides(org).await;
    let mut scopes = BTreeMap::new();
    for row in summaries.iter().filter(|row| {
        row.service_name == transition.service_name
            && row.where_key != transition.where_key
            && resolved_env(row, &identity) == env
    }) {
        scopes.insert(row.where_key.clone(), row.scope_key.clone());
    }
    let mut locations = BTreeSet::new();
    for (place, scope) in scopes {
        if local {
            locations.insert((place, transition.cluster.clone()));
        } else {
            for deploy in infra::table::service_version_deploys::history(
                infra::db::get_orm_client_rw().await,
                org,
                &scope,
                None,
                1000,
            )
            .await?
            {
                locations.insert((place.clone(), deploy.cluster));
            }
        }
    }
    let services = BTreeSet::from([transition.service_name.clone()]);
    let previous = previous_window(transition, window);
    let mut descriptors = Vec::new();
    for (place, region) in locations {
        let streams: BTreeSet<_> = summaries
            .iter()
            .filter(|row| {
                row.service_name == transition.service_name
                    && row.where_key == place
                    && row.signal == signal
            })
            .map(|row| row.source_stream.clone())
            .collect();
        for bounds in [window, previous] {
            descriptors.push((place.clone(), region.clone(), streams.clone(), bounds));
        }
    }
    Ok(FallbackSpec {
        services,
        signal,
        local,
        descriptors,
    })
}

/// Same-env candidates for the deploys at `wanted`, all read in one batch.
async fn fallback_for(
    org: &str,
    items: &[Work],
    prepared: &[Prepared],
    wanted: &[usize],
    summaries: &[config::meta::service_identity::WhereSummaryRecord],
    local: bool,
) -> anyhow::Result<Vec<Vec<BaselineCandidate>>> {
    let mut specs = Vec::with_capacity(wanted.len());
    for i in wanted {
        let prepared = &prepared[*i];
        specs.push(
            fallback_spec(
                org,
                &items[*i].0,
                primary_signal(&prepared.a),
                &prepared.env,
                prepared.a.window,
                summaries,
                local,
            )
            .await?,
        );
    }
    let selections: Vec<_> = specs.iter().flat_map(FallbackSpec::selections).collect();
    let mut aggregates = api::aggregate_grouped(org, &selections).await?.into_iter();
    Ok(wanted
        .iter()
        .zip(&specs)
        .map(|(i, spec)| {
            let read: Vec<_> = aggregates.by_ref().take(spec.descriptors.len()).collect();
            fallback_from(&items[*i].0, &prepared[*i].env, spec, read)
        })
        .collect())
}

fn fallback_from(
    transition: &Transition,
    env: &str,
    spec: &FallbackSpec,
    aggregates: Vec<Aggregate>,
) -> Vec<BaselineCandidate> {
    let mut candidates = Vec::new();
    for ((place, region, _, bounds), aggregate) in spec.descriptors.iter().zip(aggregates) {
        let latest_total = aggregate.volumes.values().map(|(_, latest)| latest).sum();
        for (version, (requests, latest_requests)) in aggregate.volumes {
            candidates.push(BaselineCandidate {
                service: transition.service_name.clone(),
                signal: spec.signal.into(),
                version: version.version,
                image: version.image,
                where_key: place.clone(),
                env: env.into(),
                cluster: region.clone(),
                window: *bounds,
                requests,
                latest_requests,
                latest_total,
                deploy_at: transition.at,
            });
        }
    }
    candidates
}

async fn emit_changes(
    org: &str,
    ring: &Ring,
    row: &Model,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    let previous = ring
        .events
        .iter()
        .filter(|previous| {
            previous["deploy_key"] == row.deploy_key && previous["event"] == "verdict_changed"
        })
        .max_by_key(|previous| previous["_timestamp"].as_i64());
    let value = serde_json::to_value(row)?;
    if previous.is_none_or(|previous| previous["verdict"] != row.verdict) {
        emit(org, ring, value.clone(), "verdict_changed", ownership).await?;
    }
    for (at, event) in [
        (row.frozen_at, "frozen"),
        (row.rechecked_at, "rechecked"),
        (row.baseline_switched_at, "baseline_changed"),
    ] {
        if at == Some(ring.end) {
            emit(org, ring, value.clone(), event, ownership).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    #[test]
    fn every_baseline_switch_reason_restores() {
        for reason in [
            "canary_drained",
            "canary_below_min",
            "canary_changed",
            "baseline_redetected",
        ] {
            assert_eq!(super::static_code(reason).ok(), Some(reason));
        }
    }

    #[test]
    fn a_pending_regression_is_checked_again_without_new_rows() {
        let hour = 3_600_000_000;
        let stored = |reason: &str| super::Model {
            scope_key: "scope".into(),
            reason_code: reason.into(),
            eval_start: 0,
            last_evaluated_at: 2 * hour,
            ..Default::default()
        };
        let clean = BTreeSet::new();
        let end = 2 * hour + 10_000_000;
        assert!(super::waits(
            &stored("regressed_significant"),
            Some(&clean),
            end
        ));
        assert!(!super::waits(
            &stored("debounce_pending"),
            Some(&clean),
            end
        ));
        let dirty = BTreeSet::from(["scope".to_string()]);
        assert!(!super::waits(
            &stored("regressed_significant"),
            Some(&dirty),
            end
        ));
        assert!(!super::waits(&stored("regressed_significant"), None, end));
    }

    #[test]
    fn ns2_recovery_resumes_after_persisted_restart() {
        use o2_enterprise::enterprise::service_identity::{
            deploys::Transition,
            not_serving::{self, NotServingInput, PreviousCheck},
            verdict::{self, EvaluationInput, State, Verdict},
        };
        let transition: Transition = serde_json::from_value(serde_json::json!({
            "deploy_key":"d","org_id":"o","service_name":"s","where_key":"w","scope_key":"scope","cluster":"c",
            "to_version":"v2","to_version_key":"v2-key","from_version":"v1","from_version_key":"v1-key",
            "kind":"deploy","entry_source":"traffic","at":0,"share_at_entry":1.0,"serving_versions":[],"overflow_count":0,
            "source_streams":["traces/t"],"superseded_at":null,"verdict_key":"verdict","created_at":0,"updated_at":0
        })).unwrap();
        let mut ns = NotServingInput {
            service: "s".into(),
            where_key: "w".into(),
            version: "v2".into(),
            now: 3_600_000_000,
            presence_windows: [vec![], vec![]],
            span_pods: vec![],
            agreement_matches: 0,
            agreement_total: 0,
            serving: BTreeSet::from(["v2".into()]),
            version_requests: [1, 1],
            baseline_mean: 100.0,
            baseline_count: 200,
            evaluating: true,
            window_starts: [3_000_000_000, 3_300_000_000],
            window_us: 300_000_000,
            previous: PreviousCheck {
                consecutive_drop: 1,
                first_requests_at: Some(0),
                not_serving_since: None,
            },
        };
        let dropped = not_serving::check(&ns);
        assert_eq!(dropped.reason, Some("traffic_drop"));
        let mut input = EvaluationInput {
            transition: &transition,
            baseline: Default::default(),
            traces: None,
            rum: None,
            endpoints_new: vec![],
            endpoints_base: vec![],
            new_windows: 12,
            eval_start: 0,
            now: ns.now,
            env: "prod",
            not_serving: dropped,
            prior: None,
            from_frozen: None,
        };
        let frozen = verdict::evaluate(&input);
        assert_eq!(frozen.verdict, Verdict::NotServing);
        assert_eq!(frozen.state, State::Frozen);
        let (stored, children) =
            super::stored_rows(&transition, &frozen, &input.not_serving, None, ns.now).unwrap();
        let restarted = super::restore(&stored, &children).unwrap();
        assert!(super::needs_admission(State::Evaluating, Some(&stored)));
        assert!(!super::needs_admission(State::Frozen, Some(&stored)));
        let remote = super::BaselineSelection {
            version: Some("remote-v1".into()),
            cluster: Some("other-region".into()),
            where_key: Some("remote-where".into()),
            rule: super::BaselineRule::EnvFallback,
            window: Some(super::ArmWindow {
                start: 0,
                end: 300_000_000,
                coverage: super::Coverage::Ok,
            }),
            ..Default::default()
        };
        let mut selected = restarted.clone();
        selected.baseline = remote;
        for now in [600_000_000, 900_000_000] {
            let (mut saved, _) =
                super::stored_rows(&transition, &selected, &input.not_serving, None, now).unwrap();
            assert!(saved.baseline_start.is_none());
            assert!(saved.baseline_end.is_none());
            saved.baseline_fanout_complete = true;
            let restored = super::restore(&saved, &[]).unwrap();
            selected.baseline = super::select_baseline(&super::BaselineInput {
                transition: &transition,
                signal: "traces",
                env: "prod",
                eval_start: 0,
                window_end: now,
                scope_requests: 100,
                candidates: &[],
                previous: Some(&restored.baseline),
                fanout_complete: true,
                rules: super::WindowRules {
                    window: 300_000_000,
                    max_span: super::DAY,
                    retention_start: 0,
                },
            });
            assert_eq!(selected.baseline.version.as_deref(), Some("remote-v1"));
            assert_eq!(selected.baseline.cluster.as_deref(), Some("other-region"));
            assert_eq!(selected.baseline.rule, super::BaselineRule::EnvFallback);
            assert!(!selected.baseline.request_fanout);
            let window = selected.baseline.window.unwrap();
            assert_eq!((window.start, window.end), (0, now.min(super::DAY)));
        }
        ns.previous = PreviousCheck {
            consecutive_drop: stored.ns_consecutive_drop as u32,
            first_requests_at: stored.ns_first_requests_at,
            not_serving_since: stored.ns_not_serving_since,
        };
        ns.now = 4_200_000_000;
        ns.window_starts = [3_600_000_000, 3_900_000_000];
        ns.version_requests = [1, 100];
        input.not_serving = not_serving::check(&ns);
        assert_eq!(input.not_serving.reason, None);
        assert_eq!(input.not_serving.eval_start, Some(3_900_000_000));
        input.now = ns.now;
        input.prior = Some(&restarted);
        let recovered = verdict::evaluate(&input);
        assert_ne!(recovered.verdict, Verdict::NotServing);
        assert_eq!(recovered.state, State::Evaluating);
        assert_eq!(recovered.eval_start, 3_900_000_000);
    }

    #[test]
    fn live_check_keeps_the_stored_verdict_until_the_same_debounce_confirms_a_change() {
        use o2_enterprise::enterprise::service_identity::{
            compare::TraceArm,
            deploys::Transition,
            verdict::{self, EvaluationInput, Verdict},
        };
        let transition: Transition = serde_json::from_value(serde_json::json!({
            "deploy_key":"d","org_id":"o","service_name":"s","where_key":"w","scope_key":"scope","cluster":"c",
            "to_version":"v2","to_version_key":"v2-key","from_version":"v1","from_version_key":"v1-key",
            "kind":"deploy","entry_source":"traffic","at":3_600_000_000_i64,"share_at_entry":1.0,"serving_versions":[],"overflow_count":0,
            "source_streams":["traces/t"],"superseded_at":null,"verdict_key":"verdict","created_at":0,"updated_at":0
        }))
        .unwrap();
        let window = |start: i64, end: i64| super::ArmWindow {
            start,
            end,
            coverage: super::Coverage::Ok,
        };
        let (wb, wa) = (
            window(2_400_000_000, 3_600_000_000),
            window(3_600_000_000, 4_800_000_000),
        );
        let arm = |requests, errors, window| super::ArmInput {
            window,
            data: Some(TraceArm {
                requests,
                errors,
                latency: None,
            }),
        };
        let check = |errors_new: u64, now: i64| EvaluationInput {
            transition: &transition,
            baseline: super::BaselineSelection {
                rule: super::BaselineRule::Previous,
                version: Some("v1".into()),
                where_key: Some("w".into()),
                window: Some(wb),
                ..Default::default()
            },
            traces: Some((arm(5000, errors_new, wa), arm(5000, 20, wb))),
            rum: None,
            endpoints_new: vec![],
            endpoints_base: vec![],
            new_windows: 4,
            eval_start: wa.start,
            now,
            env: "prod",
            not_serving: Default::default(),
            prior: None,
            from_frozen: None,
        };
        let stored = |evaluation: &super::Evaluation, now| {
            let (row, children) =
                super::stored_rows(&transition, evaluation, &Default::default(), None, now)
                    .unwrap();
            super::restore(&row, &children).unwrap()
        };
        let next = |errors, now, prior: &super::Evaluation, live: bool| {
            let mut input = check(errors, now);
            input.prior = Some(prior);
            if live {
                super::live(input)
            } else {
                verdict::evaluate(&input)
            }
        };
        let first = stored(
            &verdict::evaluate(&check(400, 3_900_000_000)),
            3_900_000_000,
        );
        assert_eq!(first.verdict, Verdict::Watch);
        let regressed = stored(&next(400, 4_200_000_000, &first, false), 4_200_000_000);
        assert_eq!(regressed.verdict, Verdict::Regressed);
        let still_failing = next(400, 4_500_000_000, &regressed, true);
        assert_eq!(still_failing.verdict, Verdict::Regressed);
        assert_eq!(still_failing.checks_done, regressed.checks_done + 1);
        let recovered_once = next(20, 4_500_000_000, &regressed, true);
        assert_eq!(recovered_once.verdict, Verdict::Regressed);
        assert_eq!(recovered_once.checks_done, regressed.checks_done);
        let ok = stored(&verdict::evaluate(&check(20, 3_900_000_000)), 3_900_000_000);
        assert_eq!(ok.verdict, Verdict::Ok);
        let live = next(400, 4_200_000_000, &ok, true);
        let tick = next(400, 4_200_000_000, &ok, false);
        assert_eq!(live.verdict, Verdict::Watch);
        assert_eq!(live.reason_code, tick.reason_code);
    }

    #[test]
    fn live_check_judges_current_data_against_a_frozen_or_rechecked_release_verdict() {
        use o2_enterprise::enterprise::service_identity::{
            compare::TraceArm,
            deploys::Transition,
            verdict::{self, EvaluationInput, Metric, State, Verdict},
        };
        let transition: Transition = serde_json::from_value(serde_json::json!({
            "deploy_key":"d","org_id":"o","service_name":"s","where_key":"w","scope_key":"scope","cluster":"c",
            "to_version":"v2","to_version_key":"v2-key","from_version":"v1","from_version_key":"v1-key",
            "kind":"deploy","entry_source":"traffic","at":3_600_000_000_i64,"share_at_entry":1.0,"serving_versions":[],"overflow_count":0,
            "source_streams":["traces/t"],"superseded_at":null,"verdict_key":"verdict","created_at":0,"updated_at":0
        }))
        .unwrap();
        let window = |start: i64, end: i64| super::ArmWindow {
            start,
            end,
            coverage: super::Coverage::Ok,
        };
        let (wb, wa) = (
            window(2_400_000_000, 3_600_000_000),
            window(3_600_000_000, 4_800_000_000),
        );
        let arm = |errors, window| super::ArmInput {
            window,
            data: Some(TraceArm {
                requests: 5000,
                errors,
                latency: None,
            }),
        };
        let check = |errors_new: u64, now: i64| EvaluationInput {
            transition: &transition,
            baseline: super::BaselineSelection {
                rule: super::BaselineRule::Previous,
                version: Some("v1".into()),
                where_key: Some("w".into()),
                window: Some(wb),
                ..Default::default()
            },
            traces: Some((arm(errors_new, wa), arm(20, wb))),
            rum: None,
            endpoints_new: vec![],
            endpoints_base: vec![],
            new_windows: 4,
            eval_start: wa.start,
            now,
            env: "prod",
            not_serving: Default::default(),
            prior: None,
            from_frozen: None,
        };
        let stored = |evaluation: &super::Evaluation, now| {
            let (row, children) =
                super::stored_rows(&transition, evaluation, &Default::default(), None, now)
                    .unwrap();
            super::restore(&row, &children).unwrap()
        };
        let worse = |live: &super::Evaluation| {
            live.metrics
                .iter()
                .any(|m| m.metric == Metric::ErrorRate && (m.significant || m.watch))
        };
        let frozen_at = 7_200_000_000;
        let frozen = stored(&verdict::evaluate(&check(20, frozen_at)), frozen_at);
        assert_eq!((frozen.verdict, frozen.state), (Verdict::Ok, State::Frozen));
        let mut input = check(400, frozen_at + 300_000_000);
        input.prior = Some(&frozen);
        let live = super::live(input);
        assert_eq!(live.verdict, Verdict::Watch);
        assert!(worse(&live), "the live metrics are the current data");
        assert_eq!(live.checks_done, frozen.checks_done + 1);
        let recheck_at = wa.start + 86_400_000_000;
        let mut input = check(20, recheck_at);
        input.prior = Some(&frozen);
        let rechecked = stored(&verdict::evaluate(&input), recheck_at);
        assert_eq!(rechecked.verdict, Verdict::Ok);
        assert!(rechecked.rechecked_at.is_some());
        let mut input = check(400, recheck_at + 300_000_000);
        input.prior = Some(&rechecked);
        let live = super::live(input);
        assert_eq!(live.verdict, Verdict::Watch);
        assert!(worse(&live), "the live metrics are the current data");
        let mut input = check(20, recheck_at + 300_000_000);
        input.prior = Some(&rechecked);
        assert_eq!(super::live(input).verdict, Verdict::Ok);
    }

    #[test]
    fn faster_version_with_a_new_error_type_is_never_headlined_by_its_improvement() {
        use o2_enterprise::enterprise::{
            search::datafusion::udaf::ddsketch::sketch_config,
            service_identity::{
                compare::{EndpointArm, TraceArm},
                deploys::Transition,
                verdict::{EvaluationInput, Verdict},
            },
        };
        let transition: Transition = serde_json::from_value(serde_json::json!({
            "deploy_key":"d","org_id":"o","service_name":"ingester","where_key":"w","scope_key":"scope","cluster":"c",
            "to_version":"rc2","to_version_key":"rc2-key","from_version":"rc1","from_version_key":"rc1-key",
            "kind":"deploy","entry_source":"traffic","at":3_600_000_000_i64,"share_at_entry":1.0,"serving_versions":[],"overflow_count":0,
            "source_streams":["traces/t"],"superseded_at":null,"verdict_key":"live","created_at":0,"updated_at":0
        }))
        .unwrap();
        let window = super::ArmWindow {
            start: 3_600_000_000,
            end: 4_800_000_000,
            coverage: super::Coverage::Ok,
        };
        let arm = |slowest_ms: u64| {
            let mut latency = sketches_ddsketch::DDSketch::new(sketch_config());
            for n in 0..5000_u64 {
                latency.add((1000 + n % slowest_ms * 1000) as f64);
            }
            super::ArmInput {
                window,
                data: Some(TraceArm {
                    requests: 5000,
                    errors: 50,
                    latency: Some(o2_enterprise::enterprise::service_identity::signals::histogram::Histogram::from_sketch(&latency, 1e6, 1e6)),
                }),
            }
        };
        let endpoint = |operation: &str, requests, errors| EndpointArm {
            operation: operation.into(),
            source_stream: "t".into(),
            requests,
            errors,
            latency: None,
        };
        let input = EvaluationInput {
            transition: &transition,
            baseline: super::BaselineSelection {
                rule: super::BaselineRule::Canary,
                version: Some("rc1".into()),
                where_key: Some("w".into()),
                window: Some(window),
                ..Default::default()
            },
            traces: Some((arm(12), arm(24))),
            rum: None,
            endpoints_new: vec![endpoint("GET /a", 4500, 10), endpoint("POST /new", 500, 40)],
            endpoints_base: vec![endpoint("GET /a", 5000, 50)],
            new_windows: 4,
            eval_start: window.start,
            now: window.end,
            env: "prod",
            not_serving: Default::default(),
            prior: None,
            from_frozen: None,
        };
        let (row, metrics) = super::preview(input, false).unwrap();
        assert_eq!(row.verdict, super::verdict_name(Verdict::Watch));
        let p95 = metrics.iter().find(|m| m.metric == "p95").unwrap();
        assert!(p95.new_value < p95.base_value, "the new version is faster");
        if let Some(metric) = &row.headline_metric {
            assert!(
                row.headline_new > row.headline_base,
                "{metric} improved yet heads a watch verdict"
            );
        }
    }

    #[test]
    fn new_error_types_headline_the_error_rate_not_a_tied_latency() {
        use o2_enterprise::enterprise::{
            search::datafusion::udaf::ddsketch::sketch_config,
            service_identity::{
                compare::{EndpointArm, TraceArm},
                deploys::Transition,
                verdict::{self, EvaluationInput, Metric, Verdict},
            },
        };
        let transition: Transition = serde_json::from_value(serde_json::json!({
            "deploy_key":"d","org_id":"o","service_name":"checkout","where_key":"w","scope_key":"scope","cluster":"c",
            "to_version":"1.5.0","to_version_key":"new-key","from_version":"1.4.0","from_version_key":"old-key",
            "kind":"deploy","entry_source":"traffic","at":3_600_000_000_i64,"share_at_entry":1.0,"serving_versions":[],"overflow_count":0,
            "source_streams":["traces/t"],"superseded_at":null,"verdict_key":"verdict","created_at":0,"updated_at":0
        }))
        .unwrap();
        let window = super::ArmWindow {
            start: 3_600_000_000,
            end: 4_800_000_000,
            coverage: super::Coverage::Ok,
        };
        let arm = |slowest_ms: u64, errors| {
            let mut latency = sketches_ddsketch::DDSketch::new(sketch_config());
            for n in 0..5000_u64 {
                latency.add((1000 + n % slowest_ms * 1000) as f64);
            }
            super::ArmInput {
                window,
                data: Some(TraceArm {
                    requests: 5000,
                    errors,
                    latency: Some(o2_enterprise::enterprise::service_identity::signals::histogram::Histogram::from_sketch(&latency, 1e6, 1e6)),
                }),
            }
        };
        let endpoint = |operation: &str, requests, errors| EndpointArm {
            operation: operation.into(),
            source_stream: "t".into(),
            requests,
            errors,
            latency: None,
        };
        let check = || EvaluationInput {
            transition: &transition,
            baseline: super::BaselineSelection {
                rule: super::BaselineRule::Previous,
                version: Some("1.4.0".into()),
                where_key: Some("w".into()),
                window: Some(window),
                ..Default::default()
            },
            traces: Some((arm(250, 400), arm(32, 20))),
            rum: None,
            endpoints_new: vec![
                endpoint("GET /a", 4000, 20),
                endpoint("POST /promo", 1000, 380),
            ],
            endpoints_base: vec![endpoint("GET /a", 5000, 20)],
            new_windows: 4,
            eval_start: window.start,
            now: window.end,
            env: "prod",
            not_serving: Default::default(),
            prior: None,
            from_frozen: None,
        };
        let first = verdict::evaluate(&check());
        let mut input = check();
        input.prior = Some(&first);
        let second = verdict::evaluate(&input);
        assert_eq!(
            (second.verdict, second.reason_code),
            (Verdict::Regressed, "new_error_types")
        );
        assert_eq!(second.headline, Some(Metric::ErrorRate));
    }

    #[test]
    fn a_picked_baseline_is_judged_once_without_debounce() {
        use o2_enterprise::enterprise::service_identity::{
            compare::{EndpointArm, TraceArm},
            deploys::Transition,
            verdict::{EvaluationInput, Verdict},
        };
        let transition: Transition = serde_json::from_value(serde_json::json!({
            "deploy_key":"d","org_id":"o","service_name":"orders-api","where_key":"w","scope_key":"scope","cluster":"c",
            "to_version":"2.0","to_version_key":"v2-key","from_version":"1.0","from_version_key":"v1-key",
            "kind":"deploy","entry_source":"traffic","at":3_600_000_000_i64,"share_at_entry":1.0,"serving_versions":[],"overflow_count":0,
            "source_streams":["traces/t"],"superseded_at":null,"verdict_key":"live","created_at":0,"updated_at":0
        }))
        .unwrap();
        let window = |start: i64, end: i64| super::ArmWindow {
            start,
            end,
            coverage: super::Coverage::Ok,
        };
        let (wb, wa) = (
            window(2_400_000_000, 3_600_000_000),
            window(3_600_000_000, 4_800_000_000),
        );
        let arm = |requests, errors, window| super::ArmInput {
            window,
            data: Some(TraceArm {
                requests,
                errors,
                latency: None,
            }),
        };
        let endpoint = |operation: &str, requests, errors| EndpointArm {
            operation: operation.into(),
            source_stream: "t".into(),
            requests,
            errors,
            latency: None,
        };
        let check = |errors_new: u64| EvaluationInput {
            transition: &transition,
            baseline: super::BaselineSelection {
                rule: super::BaselineRule::Previous,
                version: Some("1.0".into()),
                where_key: Some("w".into()),
                window: Some(wb),
                ..Default::default()
            },
            traces: Some((arm(1600, errors_new, wa), arm(1500, 0, wb))),
            rum: None,
            endpoints_new: vec![endpoint("POST /checkout", 1600, errors_new)],
            endpoints_base: vec![endpoint("POST /checkout", 1500, 0)],
            new_windows: 4,
            eval_start: wa.start,
            now: wa.end,
            env: "prod",
            not_serving: Default::default(),
            prior: None,
            from_frozen: None,
        };
        let verdict = |errors_new, once| {
            let (row, _) = super::preview(check(errors_new), once).unwrap();
            (row.verdict, row.reason_code)
        };
        let (scheduled, picked) = (verdict(450, false), verdict(450, true));
        assert_eq!(scheduled.0, super::verdict_name(Verdict::Watch));
        assert_eq!(scheduled.1, "debounce_pending");
        assert_eq!(picked.0, super::verdict_name(Verdict::Regressed));
        assert_ne!(picked.1, "debounce_pending");
        assert_eq!(verdict(0, true), verdict(0, false));
    }

    #[tokio::test]
    async fn a_rollback_reads_the_from_version_verdict_before_it_freezes() {
        use infra::table::service_versions::{
            create_tables_for_tests, sqlite_and_postgres_for_tests,
        };
        use o2_enterprise::enterprise::service_identity::{compare::TraceArm, deploys::Transition};
        let transition = |from: &str, to: &str, kind: &str, at: i64| -> Transition {
            use sha2::{Digest, Sha256};
            let key = format!(
                "{:x}",
                Sha256::digest(
                    serde_json::json!(["o", "rollback-api", "w", "c", to, at])
                        .to_string()
                        .as_bytes()
                )
            );
            serde_json::from_value(serde_json::json!({
                "deploy_key":key,"org_id":"o","service_name":"rollback-api","where_key":"w","scope_key":"scope","cluster":"c",
                "to_version":to,"to_version_key":format!("{to}-key"),"from_version":from,"from_version_key":format!("{from}-key"),
                "kind":kind,"entry_source":"traffic","at":at,"share_at_entry":1.0,"serving_versions":[],"overflow_count":0,
                "source_streams":["traces/t"],"superseded_at":null,"verdict_key":format!("verdict-{to}-{at}"),"created_at":0,"updated_at":0
            }))
            .unwrap()
        };
        let deploy = transition("1.0", "2.0", "deploy", 3_600_000_000);
        let rollback = transition("2.0", "1.0", "rollback", 7_200_000_000);
        let window = super::ArmWindow {
            start: 3_600_000_000,
            end: 4_800_000_000,
            coverage: super::Coverage::Ok,
        };
        let arm = |errors| super::ArmInput {
            window,
            data: Some(TraceArm {
                requests: 5000,
                errors,
                latency: None,
            }),
        };
        let evaluation = super::verdict::evaluate(&super::EvaluationInput {
            transition: &deploy,
            baseline: super::BaselineSelection {
                rule: super::BaselineRule::Previous,
                version: Some("1.0".into()),
                where_key: Some("w".into()),
                window: Some(window),
                ..Default::default()
            },
            traces: Some((arm(1500), arm(20))),
            rum: None,
            endpoints_new: vec![],
            endpoints_base: vec![],
            new_windows: 4,
            eval_start: window.start,
            now: window.end,
            env: "prod",
            not_serving: Default::default(),
            prior: None,
            from_frozen: None,
        });
        let (row, children) =
            super::stored_rows(&deploy, &evaluation, &Default::default(), None, window.end)
                .unwrap();
        assert_eq!(row.state, "evaluating");
        for conn in sqlite_and_postgres_for_tests("verdicts_rollback_from").await {
            create_tables_for_tests(&conn).await.unwrap();
            infra::table::service_version_deploys::put(
                &conn,
                super::deploys::model(&deploy, &[]).unwrap(),
            )
            .await
            .unwrap();
            super::table::put(&conn, row.clone(), children.clone())
                .await
                .unwrap();
            let from = super::from_verdict(&conn, "o", &rollback)
                .await
                .unwrap()
                .expect("an evaluating from-version verdict");
            assert_eq!(from.verdict, evaluation.verdict);
            assert!(
                super::from_verdict(&conn, "o", &deploy)
                    .await
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[test]
    fn stored_windows_are_the_judged_ones_and_a_frozen_recheck_keeps_them() {
        use super::{ArmWindow, Coverage, Model, judged_windows};
        let window = |start: i64, end: i64| ArmWindow {
            start,
            end,
            coverage: Coverage::Ok,
        };
        let mut row = Model {
            verdict: "regressed".into(),
            baseline_version: Some("1.0".into()),
            window_end: 999,
            ..Default::default()
        };
        judged_windows(&mut row, None, window(20, 50), window(20, 50));
        assert_eq!(
            (row.window_end, row.baseline_start, row.baseline_end),
            (50, Some(20), Some(50))
        );
        judged_windows(&mut row, None, window(20, 50), window(0, 20));
        assert_eq!(
            (row.window_end, row.baseline_start, row.baseline_end),
            (50, Some(0), Some(20))
        );
        let frozen = Model {
            state: "frozen".into(),
            ..row.clone()
        };
        let mut recheck = Model {
            window_end: 2000,
            ..row.clone()
        };
        judged_windows(
            &mut recheck,
            Some(&frozen),
            window(20, 1500),
            window(0, 1480),
        );
        assert_eq!(
            (
                recheck.window_end,
                recheck.baseline_start,
                recheck.baseline_end
            ),
            (50, Some(0), Some(20))
        );
        let mut first = Model {
            baseline_version: None,
            ..row.clone()
        };
        judged_windows(&mut first, None, window(20, 50), window(20, 50));
        assert_eq!(
            (first.window_end, first.baseline_start, first.baseline_end),
            (50, None, None)
        );
    }

    fn carries_unit_separator(value: &serde_json::Value) -> bool {
        use serde_json::Value;
        match value {
            Value::String(text) => text.contains('\u{1f}') || text.contains("\\u001f"),
            Value::Array(items) => items.iter().any(carries_unit_separator),
            Value::Object(map) => map
                .iter()
                .any(|(key, item)| key.contains('\u{1f}') || carries_unit_separator(item)),
            _ => false,
        }
    }

    /// Two builds of checkout 2.4.0 sent over OTLP, each span row read back as ingest stored it.
    async fn ingested_image_spans(org: &str, stream: &str) -> Vec<serde_json::Value> {
        use arrow::{array::Array, compute::cast, datatypes::DataType};
        use opentelemetry_proto::tonic::{
            collector::trace::v1::ExportTraceServiceRequest,
            common::v1::{AnyValue, KeyValue, any_value::Value},
            resource::v1::Resource,
            trace::v1::{ResourceSpans, ScopeSpans, Span},
        };
        let kv = |key: &str, value: &str| KeyValue {
            key: key.into(),
            value: Some(AnyValue {
                value: Some(Value::StringValue(value.into())),
            }),
            ..Default::default()
        };
        let now = chrono::Utc::now().timestamp_nanos_opt().unwrap() as u64;
        let mut next_span = 0_u64;
        let resource_spans = [
            (
                "checkout-a",
                "sha256:3f9c2ab14e0d7c55a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677ab",
            ),
            (
                "checkout-b",
                "sha256:9c1e4b7f00112233445566778899aabbccddeeff00112233445566778899aabb",
            ),
        ]
        .into_iter()
        .map(|(pod, digest)| ResourceSpans {
            resource: Some(Resource {
                attributes: vec![
                    kv("service.name", "checkout"),
                    kv("k8s.cluster.name", "prod-eu"),
                    kv("k8s.namespace.name", "shop"),
                    kv("k8s.pod.name", pod),
                    kv("service.version", "2.4.0"),
                    kv("container.image.name", "ghcr.io/acme/checkout"),
                    kv("container.image.tag", "2.4.0"),
                    kv("container.image.id", digest),
                ],
                ..Default::default()
            }),
            scope_spans: vec![ScopeSpans {
                spans: (0..30)
                    .map(|n| {
                        next_span += 1;
                        Span {
                            trace_id: vec![9; 16],
                            span_id: next_span.to_be_bytes().to_vec(),
                            name: "GET /cart".into(),
                            kind: 2,
                            start_time_unix_nano: now - n * 1_000_000,
                            end_time_unix_nano: now - n * 1_000_000 + 5_000_000,
                            ..Default::default()
                        }
                    })
                    .collect(),
                ..Default::default()
            }],
            ..Default::default()
        })
        .collect();
        infra::db::create_table().await.unwrap();
        crate::traces::handle_otlp_request(
            org,
            ExportTraceServiceRequest { resource_spans },
            config::meta::otlp::OtlpRequestType::HttpProtobuf,
            Some(stream),
            ingestion_common::IngestUser::from_user_email("a@a.com"),
        )
        .await
        .unwrap();
        let (_, batches) = ingester::read_from_memtable(
            org,
            config::meta::stream::StreamType::Traces.as_str(),
            stream,
            None,
            &[],
        )
        .await
        .unwrap();
        let numeric = ["_timestamp", "duration", "start_time", "end_time"];
        let mut rows = Vec::new();
        for entry in batches.into_iter().flat_map(|(_, entries)| entries) {
            let schema = entry.data.schema();
            for row in 0..entry.data.num_rows() {
                let mut values = serde_json::Map::new();
                for (i, field) in schema.fields().iter().enumerate() {
                    let Ok(column) = cast(entry.data.column(i), &DataType::Utf8) else {
                        continue;
                    };
                    let column = column
                        .as_any()
                        .downcast_ref::<arrow::array::StringArray>()
                        .unwrap();
                    if column.is_valid(row) {
                        let text = column.value(row);
                        values.insert(
                            field.name().clone(),
                            match text.parse::<i64>() {
                                Ok(n) if numeric.contains(&field.name().as_str()) => n.into(),
                                _ => text.into(),
                            },
                        );
                    }
                }
                rows.push(serde_json::Value::Object(values));
            }
        }
        rows
    }

    #[cfg(not(feature = "cloud"))]
    #[tokio::test]
    async fn otlp_and_k1_images_store_no_control_character_in_deploys_verdicts_or_streams() {
        use o2_enterprise::enterprise::{
            search::datafusion::udaf::ddsketch::DDSketchAgg,
            service_identity::{
                compare::TraceArm,
                deploys::{DetectInput, detect},
                signals::{mappers, sql},
                verdict::EvaluationInput,
            },
        };
        let (org, stream) = ("svcver_no_unit_sep_org", "svcver_no_unit_sep");
        let spans = ingested_image_spans(org, stream).await;
        assert_eq!(spans.len(), 60);
        let session = datafusion::prelude::SessionContext::new();
        session.register_udaf(DDSketchAgg::new().into());
        let path = std::env::temp_dir().join(format!(
            "{stream}_{}_{}.json",
            std::process::id(),
            config::utils::time::now_micros()
        ));
        let lines: Vec<String> = spans.iter().map(ToString::to_string).collect();
        std::fs::write(&path, lines.join("\n")).unwrap();
        session
            .register_json(stream, path.to_str().unwrap(), Default::default())
            .await
            .unwrap();
        let cols: std::collections::HashSet<String> = spans
            .iter()
            .flat_map(|row| row.as_object().unwrap().keys().cloned())
            .collect();
        let run = async |sql: String| {
            let batches = session.sql(&sql).await.unwrap().collect().await.unwrap();
            config::utils::arrow::record_batches_to_json_rows(&batches.iter().collect::<Vec<_>>())
                .unwrap()
                .into_iter()
                .map(serde_json::Value::Object)
                .collect::<Vec<_>>()
        };
        let interval = 300_000_000;
        let end = 100 * interval;
        let (mut signals, mut detail) = (Vec::new(), Vec::new());
        for start in [end - 2 * interval, end - interval] {
            let ctx = mappers::WindowCtx {
                org_id: org.into(),
                source_stream: stream.into(),
                window_start: start,
                window_secs: 300,
                written_at: 1,
                cluster: config::get_cluster_name(),
            };
            let t1 = run(sql::build_t1_sql(stream, 0, i64::MAX, &cols).unwrap()).await;
            signals.extend(mappers::map_t1(&ctx, &t1, &Default::default()));
            let t2 =
                run(sql::build_t2_sql(stream, 0, i64::MAX, &cols, sql::T2_TOP_N).unwrap()).await;
            detail.extend(mappers::map_t2(&ctx, &t2, &Default::default()));
        }
        assert_eq!(signals.len(), 4, "one traces row per image per window");
        let k1_ctx = mappers::WindowCtx {
            org_id: org.into(),
            source_stream: "kube_pod_container_info".into(),
            window_start: end - interval,
            window_secs: 300,
            written_at: 1,
            cluster: config::get_cluster_name(),
        };
        let k1 = mappers::map_k1(
            &k1_ctx,
            &[
                serde_json::json!({"namespace":"shop","pod":"checkout-a","container":"checkout","k8s_cluster":"prod-eu",
                "image":"ghcr.io/acme/checkout:2.4.0","image_id":"ghcr.io/acme/checkout@sha256:3f9c2ab14e0d7c55a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677ab"}),
            ],
        );
        let place = signals[0].where_key.clone();
        let ring = super::Ring {
            rows: signals.clone(),
            epoch: -100 * interval,
            end,
            interval,
            pods: Vec::new(),
            presence: [Vec::new(), k1.clone()],
            images: k1,
            presence_history: Default::default(),
            events: Vec::new(),
        };
        let detection = detect(&DetectInput {
            org_id: org.into(),
            service_name: "checkout".into(),
            where_key: place.clone(),
            cluster: config::get_cluster_name(),
            epoch: ring.epoch,
            now: end,
            window_us: interval,
            windows: ring.windows(
                &config::meta::service_identity::ServiceKey::of("checkout"),
                &place,
            ),
            serving: Vec::new(),
            current: None,
            history: Vec::new(),
            first_seen: Default::default(),
            pod_entries: Vec::new(),
        });
        assert_eq!(
            detection.transitions.len(),
            2,
            "each image is its own deploy"
        );
        let images = std::collections::BTreeSet::from([Some("3f9c2ab"), Some("9c1e4b7")]);
        assert_eq!(
            detection
                .transitions
                .iter()
                .map(|transition| (
                    transition.to_version.as_str(),
                    transition.to_image.as_deref()
                ))
                .collect::<std::collections::BTreeSet<_>>(),
            images.iter().map(|image| ("2.4.0", *image)).collect()
        );
        let window = |start: i64, end: i64| super::ArmWindow {
            start,
            end,
            coverage: super::Coverage::Ok,
        };
        let arm = |start| super::ArmInput {
            window: window(start, start + interval),
            data: Some(TraceArm {
                requests: 5000,
                errors: 20,
                latency: None,
            }),
        };
        let mut stored = Vec::new();
        for transition in &detection.transitions {
            stored.push(
                serde_json::to_value(
                    super::deploys::model(transition, &detection.serving).unwrap(),
                )
                .unwrap(),
            );
            let baseline = detection
                .transitions
                .iter()
                .find(|other| other.deploy_key != transition.deploy_key)
                .unwrap();
            let input = EvaluationInput {
                transition,
                baseline: super::BaselineSelection {
                    rule: super::BaselineRule::Canary,
                    version: Some(baseline.to_version.clone()),
                    image: baseline.to_image.clone(),
                    where_key: Some(place.clone()),
                    window: Some(window(end - interval, end)),
                    ..Default::default()
                },
                traces: Some((arm(end - interval), arm(end - interval))),
                rum: None,
                endpoints_new: vec![],
                endpoints_base: vec![],
                new_windows: 2,
                eval_start: end - 2 * interval,
                now: end,
                env: "prod",
                not_serving: Default::default(),
                prior: None,
                from_frozen: None,
            };
            let (row, _) = super::preview(input, true).unwrap();
            stored.push(serde_json::to_value(row).unwrap());
        }
        let columns = |fields: &[&str]| {
            stored
                .iter()
                .map(|row| {
                    fields
                        .iter()
                        .map(|field| row[*field].as_str())
                        .collect::<Vec<_>>()
                })
                .collect::<std::collections::BTreeSet<_>>()
        };
        assert_eq!(
            columns(&["to_version", "to_image"])
                .into_iter()
                .filter(|pair| pair[0].is_some())
                .collect::<std::collections::BTreeSet<_>>(),
            images
                .iter()
                .map(|image| vec![Some("2.4.0"), *image])
                .collect(),
            "deploy rows keep the text and put the image in its own column"
        );
        assert_eq!(
            columns(&["version", "image", "baseline_version", "baseline_image"])
                .into_iter()
                .filter(|row| row[0].is_some())
                .collect::<std::collections::BTreeSet<_>>(),
            [("9c1e4b7", "3f9c2ab"), ("3f9c2ab", "9c1e4b7")]
                .into_iter()
                .map(|(image, baseline)| vec![
                    Some("2.4.0"),
                    Some(image),
                    Some("2.4.0"),
                    Some(baseline)
                ])
                .collect(),
            "verdict rows keep both texts and put both images in their own columns"
        );
        stored.extend(signals.iter().map(|row| row.to_json()));
        stored.extend(detail.iter().map(|row| row.to_json()));
        assert_eq!(
            signals
                .iter()
                .map(|row| row.to_json()["image"].as_str().map(str::to_string))
                .collect::<std::collections::BTreeSet<_>>(),
            images
                .iter()
                .map(|image| image.map(str::to_string))
                .collect(),
            "the signals stream carries the image as its own field"
        );
        let packed: Vec<_> = stored
            .iter()
            .filter(|row| carries_unit_separator(row))
            .collect();
        assert!(packed.is_empty(), "{packed:#?}");
        std::fs::remove_file(path).ok();
    }
}
