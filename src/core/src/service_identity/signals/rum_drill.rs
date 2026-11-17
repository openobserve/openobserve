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

//! RUM drill sections of a compare: INP targets, Breakdown, pages and the vitals series.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    future::Future,
    time::Duration,
};

use config::meta::{promql::value::Value as PromValue, search, stream::StreamType};
use o2_enterprise::enterprise::{
    agent_signals::compare::{
        CiKind, CwvMetric, MetricDelta, QuantileSource, cwv_from_sketch, quantile_delta_ci,
    },
    search::datafusion::udaf::ddsketch::decode_tagged,
    service_identity::{
        infer::{IdentityInputs, where_identity},
        normalize::{SOURCE_RUM_VERSION, normalize_version},
        signals::{
            histogram::Histogram,
            mappers::{MAX_ERROR_FIELD_BYTES, SignalRow, error_sample},
            series::{
                L_PAGE, L_STATUS, L_VERSION, L_VITAL, M_PAGE_VIEWS, M_PAGE_VITALS, M_RUM_VITALS,
                STATUS_ERROR, VITALS as SERIES_VITALS,
            },
            sql::{build_error_sample_sql, page_expr},
        },
        verdict::Metric,
    },
};
use serde_json::{Map, Value, json};
use sketches_ddsketch::DDSketch;

use super::metrics::{self, ArmGrid, SeriesIncrease};

pub const RUM_STREAM: &str = "_rumdata";
/// Compare keys the drill adds; a restricted response drops every one.
pub const SECTIONS: [&str; 4] = ["inp_targets", "rum_breakdown", "pages", "rum_series"];
const TARGET: &str = "view_interaction_to_next_paint_target_selector";
const INP: &str = "view_interaction_to_next_paint";
const DIMS: [(&str, &str); 3] = [
    ("browser", "user_agent_user_agent_family"),
    ("device", "user_agent_device_family"),
    ("country", "geo_info_country_iso_code"),
];
const VITALS: [(&str, Metric, CwvMetric); 3] = [
    ("lcp_p75", Metric::Lcp, CwvMetric::Lcp),
    ("inp_p75", Metric::Inp, CwvMetric::Inp),
    ("cls_p75", Metric::Cls, CwvMetric::Cls),
];
const TOP_ROWS: usize = 20;
const TOP_VALUES: usize = 5;
const SECTION_TIMEOUT: Duration = Duration::from_secs(10);
// Each step divides the next, so raising the step to the window cadence never splits a bucket.
const SERIES_STEPS_SECS: [i64; 9] = [60, 300, 900, 1800, 3600, 10_800, 21_600, 43_200, 86_400];
const SERIES_MAX_BUCKETS: i64 = 48;

/// One compare arm; a baseline chosen by env fallback sits in its own where.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Arm<'a> {
    pub version: &'a str,
    pub place: &'a str,
    pub start: i64,
    pub end: i64,
}

/// What the drill reads, fixed before any schema is known.
#[derive(Clone, Copy)]
pub struct Request<'a> {
    pub services: &'a BTreeSet<String>,
    pub a: Arm<'a>,
    pub b: Option<Arm<'a>>,
    pub ci_level: f64,
    pub introduced: &'a [Value],
    pub max_groups: usize,
}

/// A request plus the schema facts one section loaded inside its own deadline.
pub struct Input<'a> {
    pub request: Request<'a>,
    /// Columns of the table the section reads; an absent column is never referenced.
    pub columns: &'a HashSet<String>,
    pub retention_start: i64,
}

/// The compare's own arms and request facts the drill reuses.
pub struct CompareArms<'a> {
    pub requested: bool,
    pub names: &'a BTreeSet<String>,
    pub a: Arm<'a>,
    pub b: Option<Arm<'a>>,
    pub ci_level: f64,
}

pub trait Searcher {
    fn hits(
        &self,
        sql: String,
        range: (i64, i64),
        size: usize,
    ) -> impl Future<Output = anyhow::Result<Vec<Value>>> + Send;

    /// Columns of one org table, empty when the table has none yet.
    fn columns(
        &self,
        table: &'static str,
    ) -> impl Future<Output = anyhow::Result<HashSet<String>>> + Send;

    fn retention_start(&self) -> impl Future<Output = anyhow::Result<i64>> + Send;

    /// One PromQL range read of the signal metrics on `grid`.
    fn metrics(
        &self,
        query: String,
        grid: ArmGrid,
    ) -> impl Future<Output = anyhow::Result<PromValue>> + Send;
}

/// Searches the org's streams; `size` is the statement's own LIMIT so nothing is capped silently.
pub struct LiveSearch {
    pub org: String,
}

impl Searcher for LiveSearch {
    fn hits(
        &self,
        sql: String,
        range: (i64, i64),
        size: usize,
    ) -> impl Future<Output = anyhow::Result<Vec<Value>>> + Send {
        let org = self.org.clone();
        async move {
            let request = search::Request {
                query: search::Query {
                    sql,
                    start_time: range.0,
                    end_time: range.1,
                    size: size as i64,
                    ..Default::default()
                },
                regions: vec![],
                clusters: vec![],
                timeout: SECTION_TIMEOUT.as_secs() as i64,
                use_cache: false,
                ..Default::default()
            };
            let response = crate::search::search(
                &config::ider::generate(),
                &org,
                StreamType::Logs,
                None,
                &request,
            )
            .await?;
            anyhow::ensure!(!response.is_partial, "partial RUM drill search");
            Ok(response.hits)
        }
    }

    fn columns(
        &self,
        table: &'static str,
    ) -> impl Future<Output = anyhow::Result<HashSet<String>>> + Send {
        let org = self.org.clone();
        async move {
            let schema = infra::schema::get(&org, table, StreamType::Logs).await?;
            Ok(schema
                .fields()
                .iter()
                .map(|field| field.name().to_string())
                .collect())
        }
    }

    fn retention_start(&self) -> impl Future<Output = anyhow::Result<i64>> + Send {
        let org = self.org.clone();
        async move {
            let stream_days = infra::schema::get_settings(&org, RUM_STREAM, StreamType::Logs)
                .await
                .map_or(0, |settings| settings.data_retention);
            Ok(retention_start(
                config::utils::time::now_micros(),
                stream_days,
                config::get_config().compact.data_retention_days,
            ))
        }
    }

    fn metrics(
        &self,
        query: String,
        grid: ArmGrid,
    ) -> impl Future<Output = anyhow::Result<PromValue>> + Send {
        let org = self.org.clone();
        async move { metrics::range(&org, &query, grid, false).await }
    }
}

/// One group's merged counters and vitals sketches.
#[derive(Default)]
struct Group {
    count: u64,
    views: u64,
    error_views: u64,
    lcp: Option<Dist>,
    inp: Option<Dist>,
    cls: Option<Dist>,
    start: Option<i64>,
    end: Option<i64>,
    /// Vitals bucket increases per vital and `le`, until [`Group::finish`] builds the histograms.
    buckets: BTreeMap<String, BTreeMap<String, f64>>,
}

impl Group {
    fn add(&mut self, hit: &Value) -> anyhow::Result<()> {
        let number = |name: &str| hit[name].as_u64().unwrap_or_default();
        self.count += number("n");
        self.views += number("views");
        self.error_views += number("error_views");
        for (target, name) in [
            (&mut self.lcp, "lcp_sketch"),
            (&mut self.inp, "inp_sketch"),
            (&mut self.cls, "cls_sketch"),
        ] {
            if let Some(blob) = hit[name].as_str().filter(|blob| !blob.is_empty()) {
                merge_into(target, Dist::Sketch(decode_tagged(blob)?))?;
            }
        }
        if let Some(start) = hit["row_start"].as_i64() {
            self.start = Some(self.start.map_or(start, |s| s.min(start)));
        }
        if let Some(end) = hit["row_end"].as_i64() {
            self.end = Some(self.end.map_or(end, |e| e.max(end)));
        }
        Ok(())
    }

    fn sketch(&self, metric: CwvMetric) -> Option<&Dist> {
        match metric {
            CwvMetric::Lcp => self.lcp.as_ref(),
            CwvMetric::Inp => self.inp.as_ref(),
            CwvMetric::Cls => self.cls.as_ref(),
        }
    }

    /// One page-views or vitals-bucket series increase of this group.
    fn add_series(&mut self, s: &SeriesIncrease, increase: f64) {
        let le = s.label("le");
        if le.is_empty() {
            let n = increase.round() as u64;
            self.views += n;
            self.count += n;
            if s.label(L_STATUS) == STATUS_ERROR {
                self.error_views += n;
            }
        } else {
            *self
                .buckets
                .entry(s.label(L_VITAL))
                .or_default()
                .entry(le)
                .or_default() += increase;
        }
        if let Some((start, end)) = s.span {
            self.start = Some(self.start.map_or(start, |v| v.min(start)));
            self.end = Some(self.end.map_or(end, |v| v.max(end)));
        }
    }

    /// Builds the vitals from the bucket increases, in the `_rumdata` units the sketches had.
    fn finish(&mut self, detail: bool) {
        for (vital, les) in std::mem::take(&mut self.buckets) {
            let Some((_, divisor)) = SERIES_VITALS.iter().find(|(name, _)| *name == vital) else {
                continue;
            };
            let pairs: Vec<(String, f64)> = les.into_iter().collect();
            let hist = Some(Dist::Buckets(Histogram::from_cumulative(
                &pairs, *divisor, detail,
            )));
            match vital.as_str() {
                "lcp" => self.lcp = hist,
                "inp" => self.inp = hist,
                "cls" => self.cls = hist,
                _ => {}
            }
        }
    }
}

/// A vital's distribution: raw `_rumdata` reads keep their sketch, metric reads their buckets.
#[derive(Clone)]
enum Dist {
    Sketch(DDSketch),
    Buckets(Histogram),
}

impl Dist {
    fn total(&self) -> u64 {
        match self {
            Dist::Sketch(sketch) => sketch.count() as u64,
            Dist::Buckets(hist) => hist.total(),
        }
    }

    /// Both sides come from one read path, so kinds never mix.
    fn merge(&mut self, other: &Self) -> anyhow::Result<()> {
        match (self, other) {
            (Dist::Sketch(a), Dist::Sketch(b)) => a
                .merge(b)
                .map_err(|error| anyhow::anyhow!("sketch merge: {error:?}"))?,
            (Dist::Buckets(a), Dist::Buckets(b)) => a.add(b),
            _ => anyhow::bail!("a sketch and buckets cannot merge"),
        }
        Ok(())
    }
}

impl QuantileSource for Dist {
    fn samples(&self) -> usize {
        match self {
            Dist::Sketch(sketch) => sketch.samples(),
            Dist::Buckets(hist) => hist.samples(),
        }
    }

    fn at(&self, q: f64) -> Option<f64> {
        match self {
            Dist::Sketch(sketch) => sketch.at(q),
            Dist::Buckets(hist) => hist.at(q),
        }
    }

    fn accuracy(&self) -> (f64, CiKind) {
        match self {
            Dist::Sketch(sketch) => sketch.accuracy(),
            Dist::Buckets(hist) => hist.accuracy(),
        }
    }
}

/// A drill vital: the tiles' interval when both arms reach the floor, else values and a reason.
struct Vital {
    metric: &'static str,
    delta: Option<MetricDelta>,
    json: Value,
}

/// Runs every section at once, each loading its own schema facts under its own deadline.
pub async fn sections<S: Searcher + Sync>(
    searcher: &S,
    request: Request<'_>,
) -> Map<String, Value> {
    let (inp, breakdown, pages, series) = tokio::join!(
        bounded(
            inp_targets(searcher, request),
            json!({"rows":[],"truncated":false})
        ),
        bounded(
            rum_breakdown(searcher, request),
            json!({"dims":{},"truncated":false})
        ),
        bounded(pages(searcher, request), json!({"rows":[]})),
        bounded(
            series(searcher, request),
            json!({"interval_secs":null,"units":series_units(),"a":null,"b":null})
        ),
    );
    SECTIONS
        .into_iter()
        .map(str::to_string)
        .zip([inp, breakdown, pages, series])
        .collect()
}

/// Adds the drill sections to a compare that asked for RUM, unless the caller is restricted.
pub async fn attach(
    ctx: &crate::service_identity::api::Context,
    response: &mut Value,
    arms: CompareArms<'_>,
) {
    if !allowed(arms.requested, ctx.readable.rum, response) {
        return;
    }
    let introduced = response["rum"]["error_types"]["introduced"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let request = Request {
        services: arms.names,
        a: arms.a,
        b: arms.b,
        ci_level: arms.ci_level,
        introduced: &introduced,
        max_groups: o2_enterprise::enterprise::service_identity::signals::sql::CANDIDATE_LIMIT,
    };
    let searcher = LiveSearch {
        org: ctx.org.clone(),
    };
    let (mut sections, samples) =
        tokio::join!(sections(&searcher, request), sampled(&searcher, request));
    apply_samples(response, &mut sections, &samples);
    if let Some(object) = response.as_object_mut() {
        object.extend(sections);
    }
}

/// Each drill section from its real mapper on two fixed arms, for the schema contract test.
#[cfg(feature = "test-utils")]
pub fn representative_sections() -> anyhow::Result<Map<String, Value>> {
    let services = BTreeSet::from(["web".to_string()]);
    let arm = |version| Arm {
        version,
        place: "env:prod",
        start: 0,
        end: 3_600_000_000,
    };
    let request = Request {
        services: &services,
        a: arm("2.0"),
        b: Some(arm("1.0")),
        ci_level: 0.9,
        introduced: &[],
        max_groups: 10,
    };
    let columns: HashSet<String> = [TARGET, DIMS[0].1, DIMS[1].1].map(str::to_string).into();
    let input = Input {
        request,
        columns: &columns,
        retention_start: i64::MIN,
    };
    let rows = |version: &str| {
        vec![
            json!({"service":"web","env":"prod","version":version,"n":3,"views":3,"error_views":1,"target":"button#buy","page":"/","dim":"browser","value":"Chrome"}),
        ]
    };
    let pages = |views| {
        let group = Group {
            views,
            ..Default::default()
        };
        BTreeMap::from([("/".to_string(), group)])
    };
    let buckets = || BTreeMap::from([(0, Group::default())]);
    let sections = [
        map_inp(&input, &rows("2.0"), Some(&rows("1.0")))?,
        map_breakdown(&input, &rows("2.0"), Some(&rows("1.0")))?,
        map_pages(&request, [pages(3), pages(2)])?,
        map_series(&request, 300, [buckets(), buckets()])?,
    ];
    Ok(SECTIONS
        .into_iter()
        .map(str::to_string)
        .zip(sections)
        .collect())
}

/// Fills each introduced error type's sample link and page, then recounts new types per page.
pub fn apply_samples(
    response: &mut Value,
    sections: &mut Map<String, Value>,
    samples: &HashMap<String, SignalRow>,
) {
    let mut pages: HashMap<String, usize> = HashMap::new();
    if let Some(rows) = response["rum"]["error_types"]["introduced"].as_array_mut() {
        for row in rows {
            let sample = row["fingerprint"].as_str().and_then(|fp| samples.get(fp));
            if let (Some(sample), Some(object)) = (sample, row.as_object_mut()) {
                let fields = [
                    (
                        "sample_error_id",
                        sample.sample_error_id.clone().map(Value::from),
                    ),
                    ("sample_ts", sample.sample_ts.map(Value::from)),
                    (
                        "sample_stack_top",
                        sample.sample_stack_top.clone().map(Value::from),
                    ),
                    ("page", sample.page.clone().map(Value::from)),
                ];
                for (key, value) in fields {
                    if let Some(value) = value {
                        object.insert(key.into(), value);
                    }
                }
            }
            if let Some(page) = row["page"].as_str() {
                *pages.entry(page.to_string()).or_default() += 1;
            }
        }
    }
    if let Some(rows) = sections
        .get_mut("pages")
        .and_then(|pages| pages.get_mut("rows"))
        .and_then(Value::as_array_mut)
    {
        for row in rows {
            let count = row["page"]
                .as_str()
                .and_then(|page| pages.get(page))
                .copied();
            row["new_error_types"] = json!(count.unwrap_or_default());
        }
    }
}

/// Drill evidence needs RUM requested, `_rumdata` readable and no restricted verdict.
pub fn allowed(requested: bool, readable: bool, response: &Value) -> bool {
    requested
        && readable
        && response["stored_verdict"]["restricted"] != true
        && response["live_verdict"]["restricted"] != true
}

/// The oldest retained `_rumdata` timestamp; global retention 0 stops the compactor deleting.
pub fn retention_start(now: i64, stream_days: i64, global_days: i64) -> i64 {
    if global_days <= 0 {
        return i64::MIN;
    }
    let days = if stream_days > 0 {
        stream_days
    } else {
        global_days
    };
    now.saturating_sub(days.saturating_mul(86_400_000_000))
}

/// One arm's INP candidates, grouped by raw env and version so Rust normalises them.
pub fn inp_sql(input: &Input<'_>, arm: Arm<'_>) -> String {
    let text = |name: &str| column(input.columns, name, "VARCHAR");
    let keys = [
        text("service"),
        text("env"),
        text("version"),
        format!("\"{TARGET}\""),
        page_expr(&text("view_url")),
    ];
    format!(
        "SELECT {} AS service, {} AS env, {} AS version, {} AS target, {} AS page, approx_quantile_sketch(\"{INP}\") AS inp_sketch, COUNT(*) AS n FROM \"{RUM_STREAM}\" WHERE {} AND {} = 'view' AND \"{INP}\" > 0 AND \"{TARGET}\" <> '' GROUP BY {} ORDER BY n DESC LIMIT {}",
        keys[0],
        keys[1],
        keys[2],
        keys[3],
        keys[4],
        arm_filter(input, arm),
        text("type"),
        keys.join(", "),
        input.request.max_groups
    )
}

/// Arm A's raw error groups for the introduced types; a cut error type cannot narrow the scan.
pub fn error_sample_sql(input: &Input<'_>, arm: Arm<'_>) -> String {
    let types: Option<Vec<String>> = input
        .request
        .introduced
        .iter()
        .map(|row| {
            row["error_type"]
                .as_str()
                .filter(|t| !t.is_empty() && t.len() < MAX_ERROR_FIELD_BYTES)
                .map(literal)
        })
        .collect();
    let mut filter = arm_filter(input, arm);
    if let Some(types) = types.filter(|types| !types.is_empty()) {
        let column = column(input.columns, "error_type", "VARCHAR");
        filter.push_str(&format!(" AND {column} IN ({})", types.join(",")));
    }
    build_error_sample_sql(RUM_STREAM, &filter, input.columns, input.request.max_groups)
}

/// One arm's Breakdown candidates: a branch per present dimension in one statement.
pub fn breakdown_sql(input: &Input<'_>, arm: Arm<'_>) -> String {
    let text = |name: &str| column(input.columns, name, "VARCHAR");
    let number = |name: &str| column(input.columns, name, "DOUBLE");
    let kind = text("type");
    let view_id = text("view_id");
    let sketch = |name: &str, scale: &str, positive: bool| {
        let value = number(name);
        let measured = if positive {
            format!(" AND {value} > 0")
        } else {
            String::new()
        };
        format!(
            "approx_quantile_sketch(CASE WHEN {kind} = 'view'{measured} THEN {value}{scale} END)"
        )
    };
    let measures = [
        format!("approx_distinct(CASE WHEN {kind} = 'view' THEN {view_id} END) AS views"),
        format!("approx_distinct(CASE WHEN {kind} = 'error' THEN {view_id} END) AS error_views"),
        format!(
            "{} AS lcp_sketch",
            sketch("view_largest_contentful_paint", "", true)
        ),
        format!("{} AS inp_sketch", sketch(INP, "", true)),
        format!(
            "{} AS cls_sketch",
            sketch("view_cumulative_layout_shift", " * 1000000", false)
        ),
        "COUNT(*) AS n".to_string(),
    ]
    .join(", ");
    let identity = [text("service"), text("env"), text("version")];
    let branches: Vec<_> = DIMS
        .iter()
        .filter(|(_, name)| input.columns.contains(*name))
        .map(|(dim, name)| {
            format!(
                "SELECT '{dim}' AS dim, {} AS service, {} AS env, {} AS version, CAST(\"{name}\" AS VARCHAR) AS value, {measures} FROM \"{RUM_STREAM}\" WHERE {} AND {kind} IN ('view','error') AND \"{name}\" IS NOT NULL GROUP BY {}, \"{name}\"",
                identity[0],
                identity[1],
                identity[2],
                arm_filter(input, arm),
                identity.join(", ")
            )
        })
        .collect();
    format!(
        "SELECT * FROM ({}) ORDER BY n DESC LIMIT {}",
        branches.join(" UNION ALL "),
        input.request.max_groups
    )
}

/// Merges normalised INP groups and keeps the 20 slowest A interactions.
pub fn map_inp(input: &Input<'_>, a: &[Value], b: Option<&[Value]>) -> anyhow::Result<Value> {
    let request = input.request;
    let key = |hit: &Value| {
        Some((
            hit["target"].as_str()?.to_string(),
            hit["page"].as_str().unwrap_or("/").to_string(),
        ))
    };
    let groups_a = grouped(a, |hit| in_arm(hit, request.a), key)?;
    let groups_b = match (b, request.b) {
        (Some(hits), Some(arm)) => Some(grouped(hits, |hit| in_arm(hit, arm), key)?),
        _ => None,
    };
    let mut rows: Vec<_> = groups_a
        .iter()
        .map(|(key, group)| (key, group, p75(group.inp.as_ref(), CwvMetric::Inp)))
        .collect();
    rows.sort_by(|x, y| {
        y.2.partial_cmp(&x.2)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(y.1.count.cmp(&x.1.count))
            .then(x.0.cmp(y.0))
    });
    let arm =
        |group: &Group| json!({"p75_ms":p75(group.inp.as_ref(), CwvMetric::Inp),"n":group.count});
    let rows: Vec<_> = rows
        .into_iter()
        .take(TOP_ROWS)
        .map(|((target, page), group, _)| {
            let b = groups_b
                .as_ref()
                .and_then(|groups| groups.get(&(target.clone(), page.clone())))
                .map(arm);
            json!({"target":target,"page":page,"a":arm(group),"b":b})
        })
        .collect();
    Ok(
        json!({"status":"ok","reason":null,"error":null,"truncated":truncated(input, a, b),"rows":rows}),
    )
}

/// Merges normalised Breakdown groups and keeps the top five A values per dimension.
pub fn map_breakdown(input: &Input<'_>, a: &[Value], b: Option<&[Value]>) -> anyhow::Result<Value> {
    let request = input.request;
    let key = |hit: &Value| {
        Some((
            hit["dim"].as_str()?.to_string(),
            hit["value"]
                .as_str()
                .filter(|value| !value.is_empty())?
                .to_string(),
        ))
    };
    let groups_a = grouped(a, |hit| in_arm(hit, request.a), key)?;
    let groups_b = match (b, request.b) {
        (Some(hits), Some(arm)) => grouped(hits, |hit| in_arm(hit, arm), key)?,
        _ => BTreeMap::new(),
    };
    let mut dims = absent_dims(input);
    for (dim, name) in DIMS {
        if !input.columns.contains(name) {
            continue;
        }
        let mut values: Vec<_> = groups_a.iter().filter(|((d, _), _)| d == dim).collect();
        if values.is_empty() {
            dims[dim] = json!({"status":"insufficient","reason":"field_absent","values":[]});
            continue;
        }
        values.sort_by(|x, y| y.1.views.cmp(&x.1.views).then(x.0.1.cmp(&y.0.1)));
        let values: Vec<_> = values
            .into_iter()
            .take(TOP_VALUES)
            .map(|(key, group)| {
                let base = groups_b.get(key);
                let mut row = json!({"value":key.1,"a":{"views":group.views,"error_views":group.error_views},"b":{"views":base.map_or(0, |g| g.views),"error_views":base.map_or(0, |g| g.error_views)}});
                for vital in vitals(Some(group), base, request.ci_level) {
                    row[vital.metric] = vital.json;
                }
                row
            })
            .collect();
        dims[dim] = json!({"status":"ok","reason":null,"values":values});
    }
    Ok(
        json!({"status":"ok","reason":null,"error":null,"truncated":truncated(input, a, b),"dims":dims}),
    )
}

/// Pages from both arms' page series, worst regression first.
fn map_pages(request: &Request<'_>, groups: [BTreeMap<String, Group>; 2]) -> anyhow::Result<Value> {
    let [pages_a, pages_b] = groups;
    if pages_a.is_empty() || pages_b.is_empty() {
        return Ok(insufficient("detail_coarse", json!({"rows":[]})));
    }
    let mut rows: Vec<(Option<f64>, u64, String, Value)> = pages_a
        .iter()
        .map(|(page, group)| {
            let base = pages_b.get(page);
            let new_error_types = request
                .introduced
                .iter()
                .filter(|row| row["page"].as_str() == Some(page.as_str()))
                .count();
            let mut row = json!({"page":page,"views":{"a":group.views,"b":base.map_or(0, |g| g.views)},"new_error_types":new_error_types});
            let deltas = vitals(Some(group), base, request.ci_level);
            let worst = worst(&deltas);
            for vital in deltas {
                row[vital.metric] = vital.json;
            }
            row["worst"] = worst.map_or(Value::Null, |(metric, delta)| json!({"metric":metric,"delta":delta}));
            (worst.map(|(_, delta)| delta), group.views, page.clone(), row)
        })
        .collect();
    rows.sort_by(|x, y| {
        match (x.0, y.0) {
            (Some(a), Some(b)) => b.partial_cmp(&a).unwrap_or(std::cmp::Ordering::Equal),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
        .then(y.1.cmp(&x.1))
        .then(x.2.cmp(&y.2))
    });
    Ok(
        json!({"status":"ok","reason":null,"error":null,"rows":rows.into_iter().take(TOP_ROWS).map(|row| row.3).collect::<Vec<_>>()}),
    )
}

/// Per-arm p75 buckets in wire units; an arm under the vitals floor keeps its buckets, values null.
fn map_series(
    request: &Request<'_>,
    step_secs: i64,
    buckets: [BTreeMap<i64, Group>; 2],
) -> anyhow::Result<Value> {
    let interval = series_interval(step_secs);
    let interval_us = interval.saturating_mul(1_000_000);
    let mut observed = false;
    let mut arm_series = |index: usize, arm: Arm<'_>| -> anyhow::Result<Value> {
        let buckets = &buckets[index];
        observed |= !buckets.is_empty();
        let mut result = json!({"version":arm.version,"where_key":arm.place,"start_time":arm.start,"end_time":arm.end});
        for (key, metric, cwv) in VITALS {
            result[key] = metric_series(buckets, arm, interval_us, metric.floor(), cwv)?;
        }
        Ok(result)
    };
    let a = arm_series(0, request.a)?;
    let b = request.b.map(|arm| arm_series(1, arm)).transpose()?;
    let mut result = if observed {
        json!({"status":"ok","reason":null,"error":null})
    } else {
        json!({"status":"insufficient","reason":"no_data","error":null})
    };
    result["interval_secs"] = json!(interval);
    result["units"] = series_units();
    result["a"] = a;
    result["b"] = b.unwrap_or(Value::Null);
    Ok(result)
}

async fn bounded(section: impl Future<Output = anyhow::Result<Value>>, empty: Value) -> Value {
    let mut result = match tokio::time::timeout(SECTION_TIMEOUT, section).await {
        Ok(Ok(value)) => return value,
        Ok(Err(error)) => {
            log::warn!("[ServiceVersions] RUM drill section failed: {error}");
            failure("error", "query failed")
        }
        Err(_) => failure("timeout", ""),
    };
    if let (Some(target), Some(body)) = (result.as_object_mut(), empty.as_object()) {
        target.extend(body.clone());
    }
    result
}

/// The sample lookup under the section deadline; a failure only leaves the links absent.
async fn sampled<S: Searcher + Sync>(
    searcher: &S,
    request: Request<'_>,
) -> HashMap<String, SignalRow> {
    match tokio::time::timeout(SECTION_TIMEOUT, error_samples(searcher, request)).await {
        Ok(Ok(samples)) => samples,
        Ok(Err(error)) => {
            log::warn!("[ServiceVersions] RUM error sample lookup failed: {error}");
            HashMap::new()
        }
        Err(_) => {
            log::warn!("[ServiceVersions] RUM error sample lookup timed out");
            HashMap::new()
        }
    }
}

/// The newest retained raw sample of each introduced type in arm A; an aged-out one is absent.
async fn error_samples<S: Searcher + Sync>(
    searcher: &S,
    request: Request<'_>,
) -> anyhow::Result<HashMap<String, SignalRow>> {
    let wanted: HashSet<&str> = request
        .introduced
        .iter()
        .filter_map(|row| row["fingerprint"].as_str())
        .collect();
    if wanted.is_empty() {
        return Ok(HashMap::new());
    }
    let (columns, retention_start) = raw_facts(searcher).await?;
    let input = Input {
        request,
        columns: &columns,
        retention_start,
    };
    let arm = request.a;
    let hits = searcher
        .hits(
            error_sample_sql(&input, arm),
            (arm.start.max(retention_start), arm.end),
            request.max_groups,
        )
        .await?;
    let mut samples: HashMap<String, SignalRow> = HashMap::new();
    for row in hits.iter().filter(|hit| in_arm(hit, arm)).map(error_sample) {
        let Some(fingerprint) = row.error_fingerprint.clone() else {
            continue;
        };
        if !wanted.contains(fingerprint.as_str()) {
            continue;
        }
        let newer = samples
            .get(&fingerprint)
            .is_none_or(|kept| row.sample_ts > kept.sample_ts);
        if newer {
            samples.insert(fingerprint, row);
        }
    }
    Ok(samples)
}

async fn raw_facts<S: Searcher + Sync>(searcher: &S) -> anyhow::Result<(HashSet<String>, i64)> {
    let (columns, retention) =
        tokio::join!(searcher.columns(RUM_STREAM), searcher.retention_start());
    Ok((columns?, retention?))
}

async fn inp_targets<S: Searcher + Sync>(
    searcher: &S,
    request: Request<'_>,
) -> anyhow::Result<Value> {
    let (columns, retention_start) = raw_facts(searcher).await?;
    let input = Input {
        request,
        columns: &columns,
        retention_start,
    };
    let empty = json!({"rows":[],"truncated":false});
    if !columns.contains(TARGET) || !columns.contains(INP) {
        return Ok(insufficient("sdk_no_inp_target", empty));
    }
    if aged_out(&input) {
        return Ok(insufficient("raw_aged_out", empty));
    }
    let (a, b) = raw_pair(searcher, &input, inp_sql).await?;
    map_inp(&input, &a, b.as_deref())
}

async fn rum_breakdown<S: Searcher + Sync>(
    searcher: &S,
    request: Request<'_>,
) -> anyhow::Result<Value> {
    let (columns, retention_start) = raw_facts(searcher).await?;
    let input = Input {
        request,
        columns: &columns,
        retention_start,
    };
    if aged_out(&input) {
        return Ok(insufficient(
            "raw_aged_out",
            json!({"dims":{},"truncated":false}),
        ));
    }
    if !DIMS.iter().any(|(_, column)| columns.contains(*column)) {
        return Ok(insufficient(
            "field_absent",
            json!({"dims":absent_dims(&input),"truncated":false}),
        ));
    }
    let (a, b) = raw_pair(searcher, &input, breakdown_sql).await?;
    map_breakdown(&input, &a, b.as_deref())
}

async fn raw_pair<S: Searcher + Sync>(
    searcher: &S,
    input: &Input<'_>,
    sql: fn(&Input<'_>, Arm<'_>) -> String,
) -> anyhow::Result<(Vec<Value>, Option<Vec<Value>>)> {
    let query = |arm: Arm<'_>| {
        searcher.hits(
            sql(input, arm),
            (arm.start, arm.end),
            input.request.max_groups,
        )
    };
    let b = async {
        match input.request.b {
            Some(arm) => query(arm).await.map(Some),
            None => Ok(None),
        }
    };
    let (a, b) = tokio::join!(query(input.request.a), b);
    Ok((a?, b?))
}

async fn pages<S: Searcher + Sync>(searcher: &S, request: Request<'_>) -> anyhow::Result<Value> {
    let Some(b) = request.b else {
        return Ok(insufficient("detail_coarse", json!({"rows":[]})));
    };
    let window = window_micros();
    let now = config::utils::time::now_micros();
    let mut groups: [BTreeMap<String, Group>; 2] = Default::default();
    for (index, arm) in [request.a, b].into_iter().enumerate() {
        let grid = metrics::arm_grid(arm.start, arm.end, window, now);
        for family in [M_PAGE_VIEWS, M_PAGE_VITALS] {
            let value = searcher
                .metrics(page_query(&request, arm, family, grid), grid)
                .await?;
            for s in metrics::increases(&value, grid.start, grid.step, i64::MAX) {
                if s.label(L_VERSION) == arm.version {
                    let page = s.label(L_PAGE);
                    groups[index]
                        .entry(page)
                        .or_default()
                        .add_series(&s, s.total);
                }
            }
        }
        groups[index]
            .values_mut()
            .for_each(|group| group.finish(true));
    }
    map_pages(&request, groups)
}

async fn series<S: Searcher + Sync>(searcher: &S, request: Request<'_>) -> anyhow::Result<Value> {
    let window = window_micros();
    let now = config::utils::time::now_micros();
    let arms: Vec<Arm<'_>> = std::iter::once(request.a).chain(request.b).collect();
    let hourly = arms
        .iter()
        .any(|arm| metrics::arm_grid(arm.start, arm.end, window, now).hourly);
    let step = chart_step(&request, window, hourly);
    let step_us = step * 1_000_000;
    let mut buckets: [BTreeMap<i64, Group>; 2] = Default::default();
    for (index, arm) in arms.into_iter().enumerate() {
        // The tiles' arm grid, so no chart bucket counts a window outside the arm.
        let grid = metrics::arm_grid(arm.start, arm.end, window, now);
        let value = searcher
            .metrics(page_query(&request, arm, M_RUM_VITALS, grid), grid)
            .await?;
        for (series, steps) in metrics::step_increases(&value, grid.start, grid.step) {
            if series.label(L_VERSION) != arm.version {
                continue;
            }
            for (t, increase) in steps {
                let from = t - grid.step;
                buckets[index]
                    .entry(from - from.rem_euclid(step_us))
                    .or_default()
                    .add_series(&series, increase);
            }
        }
        buckets[index]
            .values_mut()
            .for_each(|group| group.finish(false));
    }
    map_series(&request, step, buckets)
}

/// A RUM family of one drill arm; the drill reads every region like the compare.
fn page_query(request: &Request<'_>, arm: Arm<'_>, family: &str, grid: ArmGrid) -> String {
    let services: BTreeSet<String> = request
        .services
        .iter()
        .map(|name| config::meta::service_identity::service_key(name))
        .collect();
    let name = if family == M_PAGE_VIEWS {
        family.to_string()
    } else {
        format!("{family}_bucket")
    };
    let selector = format!(
        "{name}{{service=~{},where_key={},version={}}}",
        metrics::any_of(services.iter().map(String::as_str)),
        metrics::literal(arm.place),
        metrics::literal(arm.version),
    );
    metrics::arm_query(&selector, grid.start, grid.end, grid.step).0
}

fn window_micros() -> i64 {
    o2_enterprise::enterprise::common::config::get_config()
        .service_signals
        .window_secs as i64
        * 1_000_000
}

fn failure(status: &str, message: &str) -> Value {
    json!({"status":status,"reason":status,"error":(!message.is_empty()).then_some(message)})
}

fn insufficient(reason: &str, body: Value) -> Value {
    let mut result = json!({"status":"insufficient","reason":reason,"error":null});
    if let (Some(target), Some(body)) = (result.as_object_mut(), body.as_object()) {
        target.extend(body.clone());
    }
    result
}

fn aged_out(input: &Input<'_>) -> bool {
    std::iter::once(input.request.a)
        .chain(input.request.b)
        .any(|arm| arm.start < input.retention_start)
}

fn column(columns: &HashSet<String>, name: &str, null: &str) -> String {
    if columns.contains(name) {
        format!("\"{name}\"")
    } else {
        format!("CAST(NULL AS {null})")
    }
}

fn literal(value: &str) -> String {
    super::api::literal(value)
}

fn arm_filter(input: &Input<'_>, arm: Arm<'_>) -> String {
    use config::meta::service_identity::{service_key, service_key_spellings};
    let names: BTreeSet<String> = input
        .request
        .services
        .iter()
        .flat_map(|name| service_key_spellings(&service_key(name)))
        .collect();
    format!(
        "_timestamp >= {} AND _timestamp < {} AND LOWER(TRIM({})) IN ({})",
        arm.start,
        arm.end,
        column(input.columns, "service", "VARCHAR"),
        names
            .iter()
            .map(|name| literal(name))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn series_step(request: &Request<'_>) -> i64 {
    let span = std::iter::once(request.a)
        .chain(request.b)
        .map(|arm| (arm.end - arm.start).max(0) / 1_000_000)
        .max()
        .unwrap_or_default();
    series_interval((span + SERIES_MAX_BUCKETS - 1) / SERIES_MAX_BUCKETS)
}

/// Chart step in seconds: at least one window, whole hours once either arm is read in hours.
fn chart_step(request: &Request<'_>, window: i64, hourly: bool) -> i64 {
    let floor = if hourly { 3_600 } else { window / 1_000_000 };
    series_interval(series_step(request).max(floor))
}

fn series_interval(at_least_secs: i64) -> i64 {
    let day = SERIES_STEPS_SECS[SERIES_STEPS_SECS.len() - 1];
    SERIES_STEPS_SECS
        .into_iter()
        .find(|step| *step >= at_least_secs)
        .unwrap_or_else(|| (at_least_secs + day - 1) / day * day)
}

fn series_units() -> Value {
    json!({"lcp_p75":"s","inp_p75":"ms","cls_p75":"unitless"})
}

fn metric_series(
    buckets: &BTreeMap<i64, Group>,
    arm: Arm<'_>,
    interval_us: i64,
    floor: u64,
    metric: CwvMetric,
) -> anyhow::Result<Value> {
    let mut merged = None;
    for sketch in buckets.values().filter_map(|group| group.sketch(metric)) {
        merge_into(&mut merged, sketch.clone())?;
    }
    let n = merged.as_ref().map_or(0, Dist::total);
    let reason = match n {
        0 => Some("no_data"),
        n if n < floor => Some("below_min_count"),
        _ => None,
    };
    let value = |sketch: Option<&Dist>| p75(sketch.filter(|_| reason.is_none()), metric);
    let first = arm.start - arm.start.rem_euclid(interval_us);
    let last = (arm.end - 1).max(arm.start);
    let points: Vec<_> = (0..)
        .map(|index: i64| first + index * interval_us)
        .take_while(|t| *t <= last)
        .map(|t| {
            let sketch = buckets.get(&t).and_then(|group| group.sketch(metric));
            json!({"t":t,"value":value(sketch),"n":sketch.map_or(0, Dist::total)})
        })
        .collect();
    Ok(
        json!({"status":if reason.is_some() {"insufficient"} else {"ok"},"reason":reason,"n":n,"floor":floor,"value":value(merged.as_ref()),"points":points}),
    )
}

fn merge_into(target: &mut Option<Dist>, sketch: Dist) -> anyhow::Result<()> {
    match target {
        Some(current) => current.merge(&sketch)?,
        None => *target = Some(sketch),
    }
    Ok(())
}

fn in_arm(hit: &Value, arm: Arm<'_>) -> bool {
    let Some(service) = hit["service"].as_str() else {
        return false;
    };
    normalize_version(
        hit["version"].as_str().unwrap_or_default(),
        SOURCE_RUM_VERSION,
        None,
    )
    .version
        == arm.version
        && where_identity(&IdentityInputs::rum(service, hit["env"].as_str())).where_key == arm.place
}

fn grouped<K: Ord>(
    hits: &[Value],
    keep: impl Fn(&Value) -> bool,
    key: impl Fn(&Value) -> Option<K>,
) -> anyhow::Result<BTreeMap<K, Group>> {
    let mut groups: BTreeMap<K, Group> = BTreeMap::new();
    for hit in hits.iter().filter(|hit| keep(hit)) {
        if let Some(key) = key(hit) {
            groups.entry(key).or_default().add(hit)?;
        }
    }
    Ok(groups)
}

fn p75(sketch: Option<&Dist>, metric: CwvMetric) -> Option<f64> {
    sketch
        .and_then(|sketch| sketch.at(0.75))
        .map(|value| cwv_from_sketch(metric, value))
}

fn vital(
    metric: &'static str,
    (kind, cwv): (Metric, CwvMetric),
    sketches: (Option<&Dist>, Option<&Dist>),
    ci_level: f64,
) -> Vital {
    let floor = kind.floor();
    let delta = match sketches {
        (Some(a), Some(b)) if a.total() >= floor && b.total() >= floor => {
            Some(quantile_delta_ci(a, b, 0.75, ci_level))
                .filter(|delta| !delta.insufficient)
                .map(|raw| {
                    let unit = |value: f64| cwv_from_sketch(cwv, value);
                    MetricDelta {
                        a: unit(raw.a),
                        b: unit(raw.b),
                        delta: unit(raw.delta),
                        lo: unit(raw.lo),
                        hi: unit(raw.hi),
                        ..raw
                    }
                })
        }
        _ => None,
    };
    let json = match &delta {
        Some(delta) => {
            let mut value = serde_json::to_value(delta).unwrap_or_default();
            value["reason"] = Value::Null;
            value
        }
        None => {
            let reason = if sketches.0.is_some() && sketches.1.is_some() {
                "below_min_count"
            } else {
                "no_data"
            };
            json!({"a":p75(sketches.0, cwv),"b":p75(sketches.1, cwv),"delta":null,"lo":null,"hi":null,"ci_kind":null,"insufficient":true,"straddles_zero":true,"reason":reason})
        }
    };
    Vital {
        metric,
        delta,
        json,
    }
}

fn vitals(a: Option<&Group>, b: Option<&Group>, ci_level: f64) -> [Vital; 3] {
    VITALS.map(|(metric, kind, cwv)| {
        vital(
            metric,
            (kind, cwv),
            (a.and_then(|g| g.sketch(cwv)), b.and_then(|g| g.sketch(cwv))),
            ci_level,
        )
    })
}

fn absent_dims(input: &Input<'_>) -> Value {
    Value::Object(
        DIMS.iter()
            .filter(|(_, name)| !input.columns.contains(*name))
            .map(|(dim, _)| {
                (
                    dim.to_string(),
                    json!({"status":"insufficient","reason":"field_absent","values":[]}),
                )
            })
            .collect(),
    )
}

fn truncated(input: &Input<'_>, a: &[Value], b: Option<&[Value]>) -> bool {
    let limit = input.request.max_groups;
    a.len() >= limit || b.is_some_and(|b| b.len() >= limit)
}

/// The largest relative change; a real change outranks noise.
fn worst(vitals: &[Vital; 3]) -> Option<(&'static str, f64)> {
    let relative = |noise: bool| {
        vitals
            .iter()
            .filter_map(|vital| vital.delta.as_ref().map(|delta| (vital.metric, delta)))
            .filter(|(_, delta)| delta.b > 0.0 && delta.straddles_zero == noise)
            .map(|(metric, delta)| (metric, delta.delta / delta.b))
            .max_by(|x, y| x.1.partial_cmp(&y.1).unwrap_or(std::cmp::Ordering::Equal))
    };
    relative(false).or_else(|| relative(true))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use config::meta::promql::{
        NAME_LABEL,
        value::{Label, RangeValue, Sample},
    };
    use o2_enterprise::enterprise::{
        agent_signals::compare::CiKind,
        search::datafusion::udaf::ddsketch::{encode_tagged, sketch_config},
        service_identity::signals::histogram::{BOUNDS, INF_LE, LE},
    };

    use super::*;

    // A bucket p75 lands within one D238 bucket (x2^(1/4)) of the sketch's, pages and series alike.
    const BUCKET_BAND: f64 = 1.189_207_115;
    // `sketch_of` spreads samples over 1.00-1.06 x base; the sketch keeps 1% relative accuracy.
    const SKETCH_P75: f64 = 1.045;
    const SKETCH_BAND: f64 = 1.03;
    const SERVICE: &str = "web-shop";
    const PLACE: &str = "env:prod";
    /// Arm A (the new version) first, then its baseline B.
    const VERSIONS: [&str; 2] = ["0.0.2", "0.0.1"];
    /// Per arm, the LCP (s), INP (ms) and CLS every page and Breakdown sample sits near.
    const VITALS_AT: [[f64; 3]; 2] = [[1.6, 210.0, 0.03], [2.0, 180.0, 0.12]];
    // `_rumdata` holds LCP and INP in ns, and the Breakdown scan scales CLS by 1e6.
    const RAW_SCALE: [f64; 3] = [1e9, 1e6, 1e6];
    /// INP target scan rows: target, page, interactions per arm, INP ms per arm.
    const INP_ROWS: [(&str, &str, [u64; 2], [f64; 2]); 3] = [
        ("a.nav-link", "/", [1520, 800], [128.0, 109.0]),
        (
            "button#plan-toggle",
            "/pricing",
            [1520, 800],
            [258.0, 220.0],
        ),
        ("input#search", "/docs/:id", [1520, 800], [184.0, 157.0]),
    ];
    /// Breakdown scan rows: dim, value, views per arm (one vitals sample each), error views per
    /// arm.
    const BREAKDOWN_ROWS: [(&str, &str, [u64; 2], [u64; 2]); 9] = [
        ("browser", "Chrome", [1502, 800], [153, 80]),
        ("browser", "Edge", [381, 199], [0, 0]),
        ("browser", "Firefox", [1134, 607], [153, 80]),
        ("browser", "Mobile Safari", [1518, 789], [153, 79]),
        ("browser", "Opera", [120, 60], [0, 0]),
        ("browser", "Samsung Internet", [700, 520], [20, 10]),
        ("device", "Mac", [1502, 800], [153, 80]),
        ("device", "Other", [1526, 803], [153, 80]),
        ("device", "iPhone", [1518, 789], [153, 79]),
    ];
    /// Page rollup rows: page, views per arm (one vitals sample each), error views per arm.
    const PAGE_ROWS: [(&str, [u64; 2], [u64; 2]); 3] = [
        ("/", [1203, 803], [0, 0]),
        ("/docs/:id", [1196, 789], [0, 0]),
        ("/pricing", [1192, 800], [360, 240]),
    ];

    type Labels = Vec<(String, String)>;
    type Series = Vec<(i64, f64)>;

    /// One service in prod: baseline B for six windows, then A for six, ending well before now.
    struct Fixture {
        services: BTreeSet<String>,
        columns: HashSet<String>,
        start: i64,
    }

    impl Fixture {
        fn new() -> Self {
            let w = window_micros();
            let columns = [
                "service",
                "env",
                "version",
                "type",
                "view_id",
                "view_largest_contentful_paint",
                "view_cumulative_layout_shift",
                INP,
                TARGET,
                "user_agent_user_agent_family",
                "user_agent_device_family",
            ];
            Self {
                services: BTreeSet::from([SERVICE.to_string()]),
                columns: columns.into_iter().map(str::to_string).collect(),
                start: (config::utils::time::now_micros() - 20 * w).div_euclid(w) * w,
            }
        }

        fn arm(&self, index: usize) -> Arm<'static> {
            let span = 6 * window_micros();
            let start = self.start + (1 - index as i64) * span;
            Arm {
                version: VERSIONS[index],
                place: PLACE,
                start,
                end: start + span,
            }
        }

        fn request(&self) -> Request<'_> {
            Request {
                services: &self.services,
                a: self.arm(0),
                b: Some(self.arm(1)),
                ci_level: 0.9,
                introduced: &[],
                max_groups: 1000,
            }
        }

        /// The rows one arm's raw scan returns from `env`.
        fn raw(index: usize, read: Read, env: &str) -> Vec<Value> {
            let version = VERSIONS[index];
            match read {
                Read::Inp => INP_ROWS
                    .iter()
                    .map(|(target, page, n, ms)| {
                        let inp = blob(n[index], ms[index] * RAW_SCALE[1]);
                        json!({"service":SERVICE,"env":env,"version":version,"target":target,"page":page,"n":n[index],"inp_sketch":inp})
                    })
                    .collect(),
                Read::Breakdown => BREAKDOWN_ROWS
                    .iter()
                    .map(|(dim, value, views, errors)| {
                        let mut hit = json!({"service":SERVICE,"env":env,"version":version,"dim":dim,"value":value,"views":views[index],"error_views":errors[index]});
                        for (v, name) in ["lcp_sketch", "inp_sketch", "cls_sketch"].iter().enumerate() {
                            hit[*name] = json!(blob(views[index], VITALS_AT[index][v] * RAW_SCALE[v]));
                        }
                        hit
                    })
                    .collect(),
            }
        }
    }

    #[derive(Clone, Copy)]
    enum Read {
        Inp,
        Breakdown,
    }

    /// Answers each arm's raw scans from the fixture rows and the metric reads from [`Written`].
    struct Replay<'a> {
        fixture: &'a Fixture,
        columns: HashSet<String>,
        raw: AtomicUsize,
        metrics: AtomicUsize,
        stall: Option<&'static str>,
        retention_start: i64,
        broken: Option<(&'static str, bool)>,
        written: Written,
    }

    impl<'a> Replay<'a> {
        fn new(fixture: &'a Fixture) -> Self {
            Self {
                fixture,
                columns: fixture.columns.clone(),
                raw: AtomicUsize::new(0),
                metrics: AtomicUsize::new(0),
                stall: None,
                retention_start: i64::MIN,
                broken: None,
                written: Written::of(fixture),
            }
        }
    }

    impl Searcher for Replay<'_> {
        fn hits(
            &self,
            sql: String,
            range: (i64, i64),
            _size: usize,
        ) -> impl Future<Output = anyhow::Result<Vec<Value>>> + Send {
            self.raw.fetch_add(1, Ordering::SeqCst);
            let stalled = self.stall.is_some_and(|marker| sql.contains(marker));
            let arm = (0..2).find(|index| {
                let arm = self.fixture.arm(*index);
                (arm.start, arm.end) == range
            });
            let read = match () {
                _ if sql.contains(" AS target") => Some(Read::Inp),
                _ if sql.contains(" AS dim") => Some(Read::Breakdown),
                _ => None,
            };
            let hits = arm
                .zip(read)
                .map(|(arm, read)| Fixture::raw(arm, read, "prod"));
            async move {
                if stalled {
                    std::future::pending::<()>().await;
                }
                hits.ok_or_else(|| anyhow::anyhow!("a scan or range the drill never issues"))
            }
        }

        fn columns(
            &self,
            table: &'static str,
        ) -> impl Future<Output = anyhow::Result<HashSet<String>>> + Send {
            let columns = match table {
                RUM_STREAM => self.columns.clone(),
                _ => HashSet::new(),
            };
            broken_or(self.broken.filter(|(name, _)| *name == table), columns)
        }

        fn retention_start(&self) -> impl Future<Output = anyhow::Result<i64>> + Send {
            let start = self.retention_start;
            async move { Ok(start) }
        }

        fn metrics(
            &self,
            query: String,
            grid: ArmGrid,
        ) -> impl Future<Output = anyhow::Result<PromValue>> + Send {
            self.metrics.fetch_add(1, Ordering::SeqCst);
            let broken = self.broken.filter(|(name, _)| query.starts_with(name));
            let value = self.written.read(&query, grid);
            broken_or(broken, value)
        }
    }

    /// The page rollup rows as the writer's cumulative series, sampled at each grid step.
    #[derive(Default)]
    struct Written(BTreeMap<(String, Labels), Series>);

    impl Written {
        fn of(fixture: &Fixture) -> Self {
            let mut out = Self::default();
            for index in 0..2 {
                let arm = fixture.arm(index);
                for (page, views, errors) in PAGE_ROWS {
                    let base = [(L_VERSION, arm.version), (L_PAGE, page)];
                    let ok = views[index] - errors[index];
                    for (status, n) in [("ok", ok), (STATUS_ERROR, errors[index])] {
                        let labels = [base[0], base[1], (L_STATUS, status)];
                        out.add(M_PAGE_VIEWS, &labels, arm, n as f64);
                    }
                    out.vitals(M_PAGE_VITALS, &base, arm, index, views[index]);
                    out.vitals(M_RUM_VITALS, &base[..1], arm, index, views[index]);
                }
            }
            out
        }

        fn vitals(
            &mut self,
            family: &str,
            base: &[(&str, &str)],
            arm: Arm<'_>,
            index: usize,
            n: u64,
        ) {
            for (v, vital) in ["lcp", "inp", "cls"].into_iter().enumerate() {
                let (_, divisor) = SERIES_VITALS
                    .iter()
                    .find(|(name, _)| *name == vital)
                    .unwrap();
                let sketch = samples(n, VITALS_AT[index][v] * RAW_SCALE[v]);
                let hist = Histogram::from_sketch(&sketch, *divisor, *divisor);
                let mut cumulative = 0.0;
                for (i, count) in hist.counts.iter().enumerate() {
                    cumulative += *count as f64;
                    let le = if i < BOUNDS { LE[i].as_str() } else { INF_LE };
                    let mut labels = base.to_vec();
                    labels.extend([(L_VITAL, vital), ("le", le)]);
                    self.add(&format!("{family}_bucket"), &labels, arm, cumulative);
                }
            }
        }

        /// A delta written at the arm's end; a new series starts from its 0 baseline at the start.
        fn add(&mut self, metric: &str, labels: &[(&str, &str)], arm: Arm<'_>, n: f64) {
            let mut key: Labels = labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            key.sort();
            let samples = self.0.entry((metric.to_string(), key)).or_default();
            let last = samples.last().map_or(0.0, |s| s.1);
            if samples.is_empty() {
                samples.push((arm.start, 0.0));
            }
            samples.push((arm.end, last + n));
        }

        fn read(&self, query: &str, grid: ArmGrid) -> PromValue {
            let mut matrix = Vec::new();
            for ((metric, labels), samples) in &self.0 {
                if !query.starts_with(&format!("{metric}{{")) {
                    continue;
                }
                let points = (0..)
                    .map(|k: i64| grid.start + k * grid.step)
                    .take_while(|t| *t <= grid.end);
                let read: Vec<Sample> = points
                    .filter_map(|t| {
                        let last = samples.iter().rfind(|(at, _)| (*at).min(grid.end) <= t)?;
                        Some(Sample::new(t, last.1))
                    })
                    .collect();
                let mut labels: Vec<_> = labels
                    .iter()
                    .map(|(k, v)| std::sync::Arc::new(Label::new(k.as_str(), v.as_str())))
                    .collect();
                labels.push(std::sync::Arc::new(Label::new(NAME_LABEL, metric.as_str())));
                matrix.push(RangeValue {
                    labels,
                    samples: read,
                    exemplars: None,
                    time_window: None,
                });
            }
            PromValue::Matrix(matrix)
        }
    }

    /// Answers the sample lookup with fixed raw error groups and records each statement.
    struct Samples {
        hits: Vec<Value>,
        columns: HashSet<String>,
        retention_start: i64,
        sql: std::sync::Mutex<Vec<String>>,
    }

    impl Samples {
        fn new(fixture: &Fixture, hits: Vec<Value>, retention_start: i64) -> Self {
            Self {
                hits,
                columns: fixture.columns.clone(),
                retention_start,
                sql: Default::default(),
            }
        }
    }

    impl Searcher for Samples {
        fn hits(
            &self,
            sql: String,
            _range: (i64, i64),
            _size: usize,
        ) -> impl Future<Output = anyhow::Result<Vec<Value>>> + Send {
            self.sql.lock().unwrap().push(sql);
            let hits = self.hits.clone();
            async move { Ok(hits) }
        }

        fn columns(
            &self,
            _table: &'static str,
        ) -> impl Future<Output = anyhow::Result<HashSet<String>>> + Send {
            let columns = self.columns.clone();
            async move { Ok(columns) }
        }

        fn retention_start(&self) -> impl Future<Output = anyhow::Result<i64>> + Send {
            let start = self.retention_start;
            async move { Ok(start) }
        }

        async fn metrics(&self, _query: String, _grid: ArmGrid) -> anyhow::Result<PromValue> {
            Ok(PromValue::None)
        }
    }

    /// Cumulative series sampled at each grid step, the step at the end included.
    struct Cumulative(Vec<(Labels, Series)>);

    impl Searcher for Cumulative {
        async fn hits(
            &self,
            _sql: String,
            _range: (i64, i64),
            _size: usize,
        ) -> anyhow::Result<Vec<Value>> {
            Ok(vec![])
        }

        async fn columns(&self, _table: &'static str) -> anyhow::Result<HashSet<String>> {
            Ok(HashSet::new())
        }

        async fn retention_start(&self) -> anyhow::Result<i64> {
            Ok(i64::MIN)
        }

        fn metrics(
            &self,
            _query: String,
            grid: ArmGrid,
        ) -> impl Future<Output = anyhow::Result<PromValue>> + Send {
            let matrix = self
                .0
                .iter()
                .map(|(labels, samples)| RangeValue {
                    labels: labels
                        .iter()
                        .map(|(k, v)| std::sync::Arc::new(Label::new(k.as_str(), v.as_str())))
                        .collect(),
                    samples: (0..)
                        .map(|k: i64| grid.start + k * grid.step)
                        .take_while(|t| *t <= grid.end)
                        .filter_map(|t| {
                            let (_, v) = samples.iter().rfind(|(at, _)| *at <= t)?;
                            Some(Sample::new(t, *v))
                        })
                        .collect(),
                    exemplars: None,
                    time_window: None,
                })
                .collect();
            async move { Ok(PromValue::Matrix(matrix)) }
        }
    }

    async fn broken_or<T>(broken: Option<(&'static str, bool)>, value: T) -> anyhow::Result<T> {
        match broken {
            Some((_, true)) => {
                std::future::pending::<()>().await;
                unreachable!()
            }
            Some((_, false)) => anyhow::bail!("read failed"),
            None => Ok(value),
        }
    }

    fn samples(count: u64, base: f64) -> DDSketch {
        let mut sketch = DDSketch::new(sketch_config());
        for index in 0..count {
            sketch.add(base + (index % 7) as f64 * base * 0.01);
        }
        sketch
    }

    fn sketch_of(count: usize, base: f64) -> Dist {
        Dist::Sketch(samples(count as u64, base))
    }

    fn blob(count: u64, base: f64) -> String {
        encode_tagged(&samples(count, base)).unwrap()
    }

    fn assert_near(got: &Value, want: f64, ratio: f64, what: &str) {
        let got = got.as_f64().unwrap();
        assert!(
            got <= want * ratio && got * ratio >= want,
            "{what}: {got} vs {want}"
        );
    }

    /// Vitals with both arms at the floor carry a delta near the fixture's p75; noise has values
    /// only.
    fn assert_vitals(row: &Value, noise: bool, band: f64, ci_kind: &str) {
        for (v, (key, ..)) in VITALS.iter().enumerate() {
            let vital = &row[key];
            if noise {
                assert_eq!(vital["reason"], "below_min_count", "{row}");
                assert!(
                    vital["delta"].is_null() && vital["a"].as_f64() > Some(0.0),
                    "{row}"
                );
                continue;
            }
            assert_eq!(vital["ci_kind"], ci_kind, "{row}");
            assert!(
                vital["delta"].is_f64() && vital["reason"].is_null(),
                "{row}"
            );
            for (index, arm) in ["a", "b"].into_iter().enumerate() {
                assert_near(&vital[arm], VITALS_AT[index][v] * SKETCH_P75, band, key);
            }
        }
    }

    fn raw_error(version: &str, error_type: &str, ts: i64, url: &str) -> Value {
        json!({"service":SERVICE,"env":"prod","version":version,"error_type":error_type,"error_message":"x is undefined","error_handling":"unhandled","count":3,"sample":format!("{ts}|err-{ts}|{url}"),"sample_stack":"TypeError: x is undefined\n    at render (app.js:1:2)"})
    }

    fn introduced_row(hit: &Value) -> Value {
        let row = error_sample(hit);
        json!({"fingerprint":row.error_fingerprint,"count":3,"error_type":row.error_type,"error_message":row.error_message})
    }

    fn page_rows() -> Map<String, Value> {
        let rows = json!({"rows":[{"page":"/checkout","new_error_types":0},{"page":"/pricing","new_error_types":0}]});
        Map::from_iter([("pages".to_string(), rows)])
    }

    #[tokio::test]
    async fn healthy_drill_keeps_counts_order_and_wire_units() {
        let fixture = Fixture::new();
        let replay = Replay::new(&fixture);
        let sections = sections(&replay, fixture.request()).await;
        // Two raw scans per arm; pages read views and vitals per arm, the series one vitals read.
        let reads = [&replay.raw, &replay.metrics].map(|n| n.load(Ordering::SeqCst));
        assert_eq!(reads, [4, 6]);
        let inp = sections["inp_targets"]["rows"].as_array().unwrap();
        let slowest: Vec<_> = inp
            .iter()
            .map(|row| row["target"].as_str().unwrap())
            .collect();
        assert_eq!(
            slowest,
            ["button#plan-toggle", "input#search", "a.nav-link"]
        );
        for (target, _, n, ms) in INP_ROWS {
            let row = inp.iter().find(|row| row["target"] == target).unwrap();
            for (index, arm) in ["a", "b"].into_iter().enumerate() {
                assert_eq!(row[arm]["n"], n[index], "{target}");
                assert_near(
                    &row[arm]["p75_ms"],
                    ms[index] * SKETCH_P75,
                    SKETCH_BAND,
                    target,
                );
            }
        }
        let dims = &sections["rum_breakdown"]["dims"];
        let browsers = dims["browser"]["values"].as_array().unwrap();
        let top: Vec<_> = browsers
            .iter()
            .map(|row| row["value"].as_str().unwrap())
            .collect();
        assert_eq!(
            top,
            [
                "Mobile Safari",
                "Chrome",
                "Firefox",
                "Samsung Internet",
                "Edge"
            ]
        );
        for row in browsers
            .iter()
            .chain(dims["device"]["values"].as_array().unwrap())
        {
            let (.., views, errors) = BREAKDOWN_ROWS.iter().find(|r| r.1 == row["value"]).unwrap();
            for (index, arm) in ["a", "b"].into_iter().enumerate() {
                let want = json!({"views":views[index],"error_views":errors[index]});
                assert_eq!(row[arm], want, "{row}");
            }
            assert_vitals(row, row["value"] == "Edge", SKETCH_BAND, "sketch_band");
        }
        assert_eq!(dims["country"]["reason"], "field_absent");
        let pages = sections["pages"]["rows"].as_array().unwrap();
        assert_eq!(pages.len(), PAGE_ROWS.len());
        for (page, views, _) in PAGE_ROWS {
            let row = pages.iter().find(|row| row["page"] == page).unwrap();
            assert_eq!(row["views"], json!({"a":views[0],"b":views[1]}), "{page}");
            assert_vitals(row, false, BUCKET_BAND, "histogram_band");
        }
        for (index, arm) in ["a", "b"].into_iter().enumerate() {
            let n: u64 = PAGE_ROWS.iter().map(|row| row.1[index]).sum();
            for (v, (key, ..)) in VITALS.iter().enumerate() {
                let line = &sections["rum_series"][arm][key];
                assert_eq!(line["n"], n, "{arm} {key}");
                assert_near(
                    &line["value"],
                    VITALS_AT[index][v] * SKETCH_P75,
                    BUCKET_BAND,
                    key,
                );
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_missing_or_failing_source_degrades_only_its_sections() {
        let fixture = Fixture::new();
        let healthy = sections(&Replay::new(&fixture), fixture.request()).await;
        const RAW: &[&str] = &["inp_targets", "rum_breakdown"];
        let timeout = ["timeout", "timeout", ""];
        let failed = ["error", "error", "query failed"];
        // name, fault, degraded sections, their status, reason and error, raw scans issued
        type Case = (
            &'static str,
            fn(&mut Replay<'_>),
            &'static [&'static str],
            [&'static str; 3],
            Option<usize>,
        );
        let cases: [Case; 8] = [
            (
                "no INP target column",
                |r| {
                    r.columns.remove(TARGET);
                },
                &["inp_targets"],
                ["insufficient", "sdk_no_inp_target", ""],
                Some(2),
            ),
            (
                "raw rows aged out",
                |r| r.retention_start = r.fixture.arm(1).start + 1,
                RAW,
                ["insufficient", "raw_aged_out", ""],
                Some(0),
            ),
            (
                "INP scan stalls",
                |r| r.stall = Some(" AS target"),
                &["inp_targets"],
                timeout,
                None,
            ),
            (
                "RUM schema read fails",
                |r| r.broken = Some((RUM_STREAM, false)),
                RAW,
                failed,
                None,
            ),
            (
                "RUM schema read stalls",
                |r| r.broken = Some((RUM_STREAM, true)),
                RAW,
                timeout,
                None,
            ),
            (
                "page views read fails",
                |r| r.broken = Some((M_PAGE_VIEWS, false)),
                &["pages"],
                failed,
                None,
            ),
            (
                "page vitals read stalls",
                |r| r.broken = Some((M_PAGE_VITALS, true)),
                &["pages"],
                timeout,
                None,
            ),
            (
                "RUM vitals read fails",
                |r| r.broken = Some((M_RUM_VITALS, false)),
                &["rum_series"],
                failed,
                None,
            ),
        ];
        for (case, fault, degraded, [status, reason, error], raw_reads) in cases {
            let mut replay = Replay::new(&fixture);
            fault(&mut replay);
            let got = sections(&replay, fixture.request()).await;
            for key in SECTIONS {
                let section = &got[key];
                if !degraded.contains(&key) {
                    assert_eq!(section, &healthy[key], "{case}: {key}");
                    continue;
                }
                let outcome =
                    ["status", "reason", "error"].map(|k| section[k].as_str().unwrap_or(""));
                assert_eq!(outcome, [status, reason, error], "{case}: {key}");
            }
            if let Some(n) = raw_reads {
                assert_eq!(replay.raw.load(Ordering::SeqCst), n, "{case}");
            }
        }
    }

    #[tokio::test]
    async fn raw_rum_filter_matches_canonical_service_spellings() {
        let mut fixture = Fixture::new();
        fixture.services = BTreeSet::from(["checkout".to_string()]);
        let input = Input {
            request: fixture.request(),
            columns: &fixture.columns,
            retention_start: i64::MIN,
        };
        let arm = input.request.a;
        let filter = arm_filter(&input, arm);
        let sql = format!(
            "SELECT * FROM (SELECT {} AS _timestamp, 'Checkout.service' AS service) WHERE {filter}",
            arm.start
        );
        let batches = datafusion::prelude::SessionContext::new()
            .sql(&sql)
            .await
            .unwrap()
            .collect()
            .await
            .unwrap();
        assert_eq!(
            batches.iter().map(|batch| batch.num_rows()).sum::<usize>(),
            1
        );
    }

    #[test]
    fn retention_prefers_the_stream_setting() {
        let day = 86_400_000_000;
        assert_eq!(retention_start(10 * day, 3, 7), 7 * day);
        assert_eq!(retention_start(10 * day, 0, 7), 3 * day);
    }

    #[test]
    fn disabled_retention_never_ages_out() {
        let day = 86_400_000_000;
        assert_eq!(retention_start(10 * day, 0, 0), i64::MIN);
        assert_eq!(retention_start(10 * day, 3, 0), i64::MIN);
        assert_eq!(retention_start(10 * day, 0, -1), i64::MIN);
    }

    #[test]
    fn baseline_in_another_where_is_read_from_its_own_where() {
        let fixture = Fixture::new();
        let staging = where_identity(&IdentityInputs::rum(SERVICE, Some("staging"))).where_key;
        let same = fixture.request();
        let (a, moved_b) = (
            same.a,
            Arm {
                place: &staging,
                ..same.b.unwrap()
            },
        );
        let moved = Request {
            b: Some(moved_b),
            ..same
        };
        for (read, map) in [
            (
                Read::Inp,
                map_inp as fn(&Input<'_>, &[Value], Option<&[Value]>) -> anyhow::Result<Value>,
            ),
            (Read::Breakdown, map_breakdown),
        ] {
            let section = |request: Request<'_>, env: &str| {
                let input = Input {
                    request,
                    columns: &fixture.columns,
                    retention_start: i64::MIN,
                };
                map(
                    &input,
                    &Fixture::raw(0, read, "prod"),
                    Some(&Fixture::raw(1, read, env)),
                )
                .unwrap()
            };
            let healthy = section(same, "prod");
            assert_eq!(section(moved, "staging"), healthy);
            assert_ne!(
                section(moved, "prod"),
                healthy,
                "B must not be read from A's where"
            );
        }
        let place = |value: &str| format!("where_key={}", metrics::literal(value));
        let grid = |arm: Arm<'_>| metrics::arm_grid(arm.start, arm.end, 60_000_000, arm.end);
        for family in [M_PAGE_VIEWS, M_PAGE_VITALS, M_RUM_VITALS] {
            let query = |arm: Arm<'_>| page_query(&moved, arm, family, grid(arm));
            assert!(query(moved_b).contains(&place(&staging)), "{family}");
            assert!(query(a).contains(&place(a.place)), "{family}");
        }
    }

    #[test]
    fn vitals_below_the_floor_are_noise() {
        let group = |count: usize, base: f64| Group {
            inp: Some(sketch_of(count, base)),
            ..Group::default()
        };
        let inp = |a: &Group, b: &Group| {
            vitals(Some(a), Some(b), 0.9)
                .into_iter()
                .find(|vital| vital.metric == "inp_p75")
                .unwrap()
        };
        let below = inp(&group(499, 250e6), &group(499, 150e6));
        assert!(below.delta.is_none());
        assert_eq!(below.json["insufficient"], true);
        assert_eq!(below.json["reason"], "below_min_count");
        assert!(below.json["a"].as_f64().unwrap() > 200.0);
        let one_side = inp(&group(500, 250e6), &group(499, 150e6));
        assert!(one_side.delta.is_none());
        let at = inp(&group(500, 250e6), &group(500, 150e6));
        let delta = at.delta.expect("both arms reach the floor");
        assert!(!delta.insufficient && !delta.straddles_zero);
        assert!(delta.delta > 50.0, "{}", at.json);
    }

    #[test]
    fn series_below_the_floor_keeps_buckets_with_null_values() {
        let arm = Arm {
            version: "v2",
            place: "env:prod",
            start: 0,
            end: 180_000_000,
        };
        let interval = 60_000_000;
        let buckets = BTreeMap::from([(
            interval,
            Group {
                inp: Some(sketch_of(10, 150e6)),
                ..Group::default()
            },
        )]);
        let line = metric_series(&buckets, arm, interval, 500, CwvMetric::Inp).unwrap();
        assert_eq!(line["status"], "insufficient");
        assert_eq!(line["reason"], "below_min_count");
        assert_eq!(line["n"], 10);
        assert!(line["value"].is_null());
        assert_eq!(
            line["points"],
            json!([{"t":0,"value":null,"n":0},{"t":interval,"value":null,"n":10},{"t":2 * interval,"value":null,"n":0}])
        );
        let empty = metric_series(&BTreeMap::new(), arm, interval, 500, CwvMetric::Lcp).unwrap();
        assert_eq!(empty["reason"], "no_data");
        assert_eq!(empty["n"], 0);
        let enough = metric_series(&buckets, arm, interval, 10, CwvMetric::Inp).unwrap();
        assert_eq!(enough["status"], "ok");
        assert!((enough["value"].as_f64().unwrap() - 150.0).abs() < 5.0);
        assert!(enough["points"][0]["value"].is_null());
        assert!(enough["points"][1]["value"].is_f64());
    }

    #[test]
    fn chart_step_rises_to_the_window_and_to_hours() {
        assert_eq!(series_interval(10), 60);
        assert_eq!(series_interval(61), 300);
        assert_eq!(series_interval(3_600), 3_600);
        assert_eq!(series_interval(4_000), 10_800);
        assert_eq!(series_interval(100_000), 172_800);
        let services = BTreeSet::from(["web".to_string()]);
        let arm = Arm {
            version: "v2",
            place: "env:prod",
            start: 0,
            end: 7_200_000_000,
        };
        let request = Request {
            services: &services,
            a: arm,
            b: None,
            ci_level: 0.9,
            introduced: &[],
            max_groups: 10,
        };
        assert_eq!(series_step(&request), 300);
        assert_eq!(chart_step(&request, 60_000_000, false), 300);
        assert_eq!(chart_step(&request, 900_000_000, false), 900);
        assert_eq!(chart_step(&request, 60_000_000, true), 3_600);
        let none = map_series(&request, 300, Default::default()).unwrap();
        assert_eq!(none["status"], "insufficient");
        assert_eq!(none["reason"], "no_data");
        assert!(none["b"].is_null());
    }

    #[test]
    fn restricted_or_unreadable_callers_get_no_drill() {
        let open = json!({"stored_verdict":{"restricted":false},"live_verdict":null});
        assert!(allowed(true, true, &open));
        assert!(!allowed(false, true, &open));
        assert!(!allowed(true, false, &open));
        for key in ["stored_verdict", "live_verdict"] {
            let mut restricted = open.clone();
            restricted[key] = json!({"restricted":true});
            assert!(!allowed(true, true, &restricted), "{key}");
        }
    }

    #[test]
    fn worst_prefers_a_real_change_over_noise() {
        let vital = |metric: &'static str, b: f64, change: f64, noise: bool| Vital {
            metric,
            delta: Some(MetricDelta {
                a: b + change,
                b,
                delta: change,
                lo: change,
                hi: change,
                straddles_zero: noise,
                insufficient: false,
                ci_kind: CiKind::SketchBand,
            }),
            json: Value::Null,
        };
        let vitals = [
            vital("lcp_p75", 100.0, -20.0, false),
            vital("inp_p75", 100.0, 40.0, true),
            vital("cls_p75", 0.1, 0.01, false),
        ];
        let (metric, change) = worst(&vitals).unwrap();
        assert_eq!(metric, "cls_p75");
        assert!((change - 0.1).abs() < 1e-9);
    }

    #[tokio::test]
    async fn introduced_error_types_link_their_newest_raw_sample() {
        let fixture = Fixture::new();
        let version = VERSIONS[0];
        let older = raw_error(version, "TypeError", 1_000, "https://shop.example/pricing");
        let newer = raw_error(version, "TypeError", 2_000, "https://shop.example/checkout");
        let not_new = raw_error(version, "RangeError", 3_000, "https://shop.example/pricing");
        let other_version = raw_error(
            "zz-other-9.9.9",
            "TypeError",
            4_000,
            "https://shop.example/pricing",
        );
        let introduced = vec![introduced_row(&newer)];
        let request = Request {
            introduced: &introduced,
            ..fixture.request()
        };
        let searcher = Samples::new(
            &fixture,
            vec![older, newer.clone(), not_new, other_version],
            i64::MIN,
        );
        let samples = error_samples(&searcher, request).await.unwrap();
        let sql = searcher.sql.lock().unwrap().clone();
        assert_eq!(sql.len(), 1);
        assert!(sql[0].contains("IN ('TypeError')"), "{}", sql[0]);
        assert!(
            sql[0].contains(&format!("_timestamp >= {}", request.a.start)),
            "{}",
            sql[0]
        );
        let mut response = json!({"rum":{"error_types":{"introduced":introduced.clone()}}});
        let mut sections = page_rows();
        apply_samples(&mut response, &mut sections, &samples);
        let row = &response["rum"]["error_types"]["introduced"][0];
        let want = error_sample(&newer);
        assert_eq!(row["sample_error_id"], "err-2000");
        assert_eq!(row["sample_ts"], 2_000);
        assert_eq!(row["page"], json!(want.page.unwrap()));
        assert!(
            row["sample_stack_top"]
                .as_str()
                .unwrap()
                .contains("app.js:1:2")
        );
        let pages = sections["pages"]["rows"].as_array().unwrap();
        let count = |page: &str| {
            pages.iter().find(|r| r["page"] == page).unwrap()["new_error_types"].clone()
        };
        assert_eq!(
            (count(row["page"].as_str().unwrap()), pages.len()),
            (json!(1), 2)
        );
    }

    #[tokio::test]
    async fn an_aged_out_sample_leaves_the_link_absent() {
        let fixture = Fixture::new();
        let gone = raw_error(
            VERSIONS[0],
            "TypeError",
            1_000,
            "https://shop.example/checkout",
        );
        let introduced = vec![introduced_row(&gone)];
        let request = Request {
            introduced: &introduced,
            ..fixture.request()
        };
        let searcher = Samples::new(&fixture, vec![], request.a.end);
        let samples = error_samples(&searcher, request).await.unwrap();
        let mut response = json!({"rum":{"error_types":{"introduced":introduced.clone()}}});
        let mut sections = page_rows();
        apply_samples(&mut response, &mut sections, &samples);
        let row = response["rum"]["error_types"]["introduced"][0]
            .as_object()
            .unwrap();
        for key in ["sample_error_id", "sample_ts", "sample_stack_top", "page"] {
            assert!(!row.contains_key(key), "{key}");
        }
        assert!(
            sections["pages"]["rows"]
                .as_array()
                .unwrap()
                .iter()
                .all(|r| r["new_error_types"] == 0)
        );
    }

    #[tokio::test]
    async fn no_introduced_type_reads_no_raw_sample() {
        let fixture = Fixture::new();
        let searcher = Samples::new(&fixture, vec![], i64::MIN);
        let samples = error_samples(&searcher, fixture.request()).await.unwrap();
        assert!(samples.is_empty());
        assert!(searcher.sql.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn series_counts_only_the_windows_inside_each_arm() {
        let w = window_micros();
        let hour = 3_600_000_000;
        let t0 = (config::utils::time::now_micros() - 150 * w).div_euclid(hour) * hour;
        let cumulative: Vec<(i64, f64)> = (0..=110).map(|k| (t0 + k * w, 3.0 * k as f64)).collect();
        let source = Cumulative(
            [LE[10].as_str(), INF_LE]
                .into_iter()
                .map(|le| {
                    let labels = [(L_VERSION, "2.0"), (L_VITAL, "inp"), ("le", le)];
                    let labels = labels.map(|(k, v)| (k.to_string(), v.to_string()));
                    (labels.to_vec(), cumulative.clone())
                })
                .collect(),
        );
        let services = BTreeSet::from(["web".to_string()]);
        let arm = Arm {
            version: "2.0",
            place: "p",
            start: t0 + 3 * w,
            end: t0 + 103 * w,
        };
        let request = Request {
            services: &services,
            a: arm,
            b: None,
            ci_level: 0.9,
            introduced: &[],
            max_groups: 1000,
        };
        let got = series(&source, request).await.unwrap();
        let line = &got["a"]["inp_p75"];
        assert!(
            got["interval_secs"].as_i64().unwrap() * 1_000_000 > w,
            "{got}"
        );
        assert_eq!(line["n"], 300, "{line}");
        let points: u64 = line["points"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["n"].as_u64().unwrap())
            .sum();
        assert_eq!(points, 300);
    }
}
