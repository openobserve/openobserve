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

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use syn::{
    Attribute, BinOp, Block, Expr, ExprAsync, ExprAwait, ExprCall, ExprClosure, ExprForLoop,
    ExprIf, ExprLoop, ExprMacro, ExprMethodCall, ExprPath, ExprWhile, FnArg, GenericArgument,
    Generics, Ident, ImplItem, ImplItemFn, Item, ItemFn, ItemImpl, ItemMacro, ItemMod, ItemTrait,
    Local, Macro, Meta, Pat, PathArguments, PathSegment, ReturnType, Signature, StmtMacro, Token,
    TraitItem, TraitItemFn, Type, TypeParamBound, UseTree, Visibility,
    parse::{ParseStream, Parser, discouraged::Speculative},
    punctuated::Punctuated,
    visit::{self, Visit},
};

const CHECKS: &[&str] = &[
    "is_allowed",
    "can_read_stream",
    "can_use_cipher_key",
    "can_read_dashboard",
    "check_permissions",
    "check_stream_permissions",
    "check_folder_write_permissions",
    "check_cipher_key_permissions",
    "check_decision",
    "check_object",
    "org_wide_check",
    "org_wide_allows",
    "can_read",
    "security_allowed",
    "security_source_readable",
    "fleet_allowed",
];
const FOLLOWED_WRAPPERS: &[&str] = &[
    "attach_pod_evidence",
    "authorize_query_sources",
    "authorize_with",
    "can_run_incident_rca",
    "check_move_composite",
    "decide_object",
    "enrich_catalog",
    "enrich_versions",
    "evidence_outcome",
    "guard_own_stream_read",
    "guard_stream_reads",
    "guard_vrl_function",
    "guard_write",
    "has_module_access",
    "intel_list_write_allowed",
    "legacy_object_outcome",
    "may",
    "may_edit_module",
];
/// Helpers defined in another file that call one callback argument once per part, so the
/// callback's body runs in a loop: `(name, callback argument index)`.
const CROSS_FILE_LOOP_HELPERS: &[(&str, usize)] = &[("all_of", 2)];
const MAX_WRAPPER_PASSES: usize = 16;
const DBM_HANDLER_REASON: &str = "DBM query handler validates the selected stream";
const UNFOLLOWED_WRAPPERS: &[(&str, &str)] = &[
    (
        "admit_security_sources",
        "filters a request's existing denials",
    ),
    (
        "admit_security_sources_once",
        "one Security grant for the whole denied set",
    ),
    (
        "admit_security_sources_once_with",
        "one Security grant for the whole denied set, with the settings supplied",
    ),
    (
        "approve",
        "one AutoResolve approval on one run; its per-connection Checks are in approve_with",
    ),
    (
        "approve_with",
        "one AutoResolve approval: checks the chosen option's connections, then writes the plan; collides with the autoresolve_steps DB updater",
    ),
    (
        "agent_stream_permissions_with",
        "list primitive dispatch for the agent streams of one gen_ai page",
    ),
    (
        "alert_visibility",
        "loads alert and folder collections for an org",
    ),
    (
        "all_allowed",
        "list fallback for one all-of row, like decide_prefix",
    ),
    ("all_monitors", "org-wide grants for monitor resource types"),
    (
        "all_streams",
        "org-wide grants and unrelated cache accessor",
    ),
    (
        "allowed",
        "pipeline grant collides with RUM verdicts and org-wide On-Call grants; pipeline callers check one target per operation",
    ),
    (
        "authorize",
        "shared by panel, AI usage and route authorizers",
    ),
    (
        "authorize_decision",
        "one run's decision right: the requester, an admin, or any approver of its connections",
    ),
    (
        "authorize_objects",
        "list primitive with a bounded Check fallback",
    ),
    (
        "authorize_problem",
        "loads authorization facts for one On-Call problem",
    ),
    (
        "authorize_query",
        "checks streams and cipher keys named by one panel query",
    ),
    (
        "authorize_row",
        "one downtime row; callers are individual downtime operations",
    ),
    (
        "authorize_tables",
        "checks the enrichment tables referenced by one VRL function",
    ),
    (
        "authorize_unpriced",
        "query route gate checks the one submitted trace stream",
    ),
    (
        "authorize_manifest",
        "checks a panel's sets of dependencies",
    ),
    ("can_clear_cache", "checks every stream named by a query"),
    (
        "catalog",
        "service catalog handler collides with catalog accessors",
    ),
    (
        "check",
        "generic name shared by save hooks and unrelated checks",
    ),
    (
        "check_cipher_key_permissions_multi",
        "checks distinct keys across statements",
    ),
    (
        "check_query_fn_permissions",
        "checks deduplicated VRL layers as a batch",
    ),
    (
        "check_sql_stream_permissions",
        "checks every stream named by SQL",
    ),
    (
        "check_stream_permission",
        "same name for trace and profile route gates",
    ),
    (
        "check_targets",
        "checks the target set of one scheduled downtime",
    ),
    (
        "compare",
        "service version comparison collides with comparison helpers",
    ),
    ("decide", "list fallback collides with decision functions"),
    (
        "decide_prefix",
        "list fallback checks the unresolved prefix",
    ),
    (
        "decline",
        "one AutoResolve decline on one run, through authorize_decision",
    ),
    (
        "decline_with",
        "one decline: authorize_decision, then the run and step transition",
    ),
    (
        "denial_message",
        "formats denied dependencies of one request",
    ),
    (
        "denied_cipher_keys",
        "checks a batch of distinct cipher keys named by SQL",
    ),
    (
        "deploys",
        "service deploy markers collide with deploy row accessors",
    ),
    (
        "endpoint",
        "org-wide service grant and unrelated endpoint accessors",
    ),
    ("every_folder", "org-wide alert folder write grant"),
    (
        "evidence",
        "checks a set of streams and collides with evidence accessors",
    ),
    (
        "extend",
        "downtime extension collides with collection mutation",
    ),
    (
        "edit_refusal_with",
        "the save rule over one saved AutoResolve's connections: module PUT plus approve on each",
    ),
    (
        "first_unapproved_with",
        "searches one AutoResolve's connections for the first it may not approve",
    ),
    (
        "first_unreadable",
        "searches a set of objects for the first denial",
    ),
    ("fleet", "collides with fleet table column accessors"),
    ("folder", "collides with table and model folder accessors"),
    (
        "get_incident_with_alerts",
        "loads readable definitions for one incident",
    ),
    (
        "get_incident_with_triggers",
        "passes an always-allow callback to the shared incident loader",
    ),
    (
        "get_pipelines",
        "fleet query reads PromQL dependencies and shares its name with pipeline listings",
    ),
    (
        "guard_alert_read",
        "one alert read from the detection evidence route",
    ),
    (
        "guard_case",
        "org-wide Security grant after resolving the case marker",
    ),
    (
        "guard_case_or_incidents",
        "org-wide Security or Incidents grant",
    ),
    (
        "guard_dashboard_update",
        "checks changed query dependencies in a saved dashboard",
    ),
    (
        "guard_detection_definition",
        "checks the dependencies of one detection definition",
    ),
    (
        "guard_intel_list",
        "conditional org-wide Security grant for a threat-intel list",
    ),
    (
        "guard_loaded",
        "authorizes a batch of dependencies returned by its loader",
    ),
    (
        "guard_org_retention_update",
        "one conditional org-wide Security grant",
    ),
    (
        "guard_panel_add",
        "checks changed dashboard dependencies after adding one panel",
    ),
    (
        "guard_panel_update",
        "checks changed dashboard dependencies after editing one panel",
    ),
    (
        "guard_report",
        "checks report dashboards and changed query dependencies as a batch",
    ),
    (
        "guard_settings_update",
        "org-wide grant for weakening Security settings",
    ),
    ("guard_siem", "conditional org-wide Security grant"),
    (
        "guard_siem_case",
        "conditional org-wide Security grant for cases",
    ),
    (
        "guard_siem_ids",
        "one org-wide Security grant for the submitted alert ids",
    ),
    (
        "guard_stream_delete",
        "conditional org-wide Security grants on delete",
    ),
    (
        "holds",
        "only Caller::may_approve calls it; the bare name collides with file cache and alert digest helpers",
    ),
    (
        "hide_unreadable_status",
        "redacts an entire batch of public-link health details",
    ),
    (
        "involved_readable",
        "list primitive dispatch for the streams of one DBM request",
    ),
    (
        "involved_streams",
        "one explicit trace stream or a list-based lookup of implicit candidates",
    ),
    ("is_root", "role lookup and unrelated methods"),
    ("is_root_or_admin", "org membership role lookup"),
    (
        "list_dashboards",
        "dashboard listing already applies its visibility filter",
    ),
    (
        "list_v2",
        "alert listing gets grants for the batch and filters locally",
    ),
    (
        "listable_downtime_folders",
        "filters a set of downtime folders",
    ),
    (
        "live_visibility",
        "loads alert and folder collections for an org",
    ),
    (
        "loaded_denial_message",
        "loads and formats denied dependencies as a batch",
    ),
    (
        "match_visibility",
        "filters the matching downtimes as a batch",
    ),
    ("may_dismiss", "org-wide alert calibration grant"),
    (
        "metric_usage",
        "scans visible saved objects for references to one metric",
    ),
    (
        "move_dashboard",
        "single dashboard mutation and a same-named route",
    ),
    (
        "move_dashboards",
        "bulk mutation checks the ids in one move request",
    ),
    (
        "move_to_folder",
        "bulk mutation and similarly named folder-moving helpers",
    ),
    (
        "mute",
        "alert folder mutation collides with other mute operations",
    ),
    (
        "object",
        "generic name scoped by the four-argument method rule",
    ),
    (
        "objects_in_mode",
        "list primitive dispatch for a set of objects",
    ),
    ("oo_validator", "HTTP authentication middleware"),
    (
        "org_metric_usage",
        "scans visible saved objects for references to all metrics",
    ),
    (
        "org_wide",
        "org-wide grant already covered by METHOD_CHECKS",
    ),
    (
        "pipeline",
        "collides with pipeline constructors and column accessors",
    ),
    (
        "permitted_alerts",
        "list of alert grants, with one optional folder grant",
    ),
    (
        "prepare_security_setting",
        "validates one stream setting inside its update route",
    ),
    ("read_activity_body", DBM_HANDLER_REASON),
    ("read_blocking_body", DBM_HANDLER_REASON),
    ("read_dbm_instances_body", DBM_HANDLER_REASON),
    ("read_deadlocks_body", DBM_HANDLER_REASON),
    ("read_instance_metrics_body", DBM_HANDLER_REASON),
    (
        "readable_among",
        "list primitive dispatch for the trace streams of one graph request",
    ),
    ("readable_org_streams", "filters a set of streams"),
    (
        "readable_streams",
        "list primitive and unrelated stream-listing helpers",
    ),
    ("read_plans_body", DBM_HANDLER_REASON),
    ("read_samples_body", DBM_HANDLER_REASON),
    ("read_server_metrics_body", DBM_HANDLER_REASON),
    ("read_server_queries_body", DBM_HANDLER_REASON),
    (
        "read_server_samples_body",
        "DBM query handler validates the fixed server streams",
    ),
    ("read_table_health_body", DBM_HANDLER_REASON),
    (
        "readable_trace_streams_among",
        "list primitive dispatch for the trace streams of one graph request",
    ),
    (
        "reads_notes",
        "org-wide grants by AutoObserve decision family",
    ),
    (
        "replan",
        "one AutoResolve replan on one run, through authorize_decision",
    ),
    (
        "replan_with",
        "one replan: authorize_decision, then an optional correction and a new plan",
    ),
    (
        "request_wide_answers",
        "one optional org-wide list prelude grant",
    ),
    (
        "resolve_scope",
        "loads overview grants by module and stream type",
    ),
    (
        "scope_unavailable",
        "loads an overview under module-wide grants",
    ),
    ("security", "org-wide Security read grant"),
    (
        "security_scope_admits",
        "checks every stream named by a query",
    ),
    (
        "server_prologue",
        "loads columns for the fixed DB monitoring server stream",
    ),
    (
        "stream_outcomes_for_query",
        "list primitive with a bounded Check fallback",
    ),
    (
        "summary",
        "service verdict summary collides with summary builders",
    ),
    (
        "token_validator",
        "validates one incoming token and its route grant",
    ),
    (
        "type_answers",
        "list primitive gathers answers by object type",
    ),
    (
        "types_access",
        "per-type list primitive and its in-memory test checker",
    ),
    (
        "update_link",
        "updates one public link and authorizes its query dependencies",
    ),
    ("validator", "HTTP route authorization middleware"),
    (
        "validator_proxy_url",
        "HTTP authentication middleware for proxied URLs",
    ),
    (
        "values",
        "downtime typeahead collides with unrelated value accessors",
    ),
    (
        "verdicts",
        "service verdict list collides with verdict accessors",
    ),
    (
        "versions",
        "service versions handler collides with version accessors",
    ),
    (
        "visibility",
        "downtime batch filter collides with visibility accessors",
    ),
];
const METHOD_CHECKS: &[(&str, Option<usize>)] =
    &[("org_wide", None), ("object", Some(4)), ("read", Some(5))];
const COMMON_METHODS: &[&str] = &[
    "get", "new", "insert", "contains", "remove", "push", "iter", "len", "clone", "from", "into",
    "send", "call", "run", "next", "map", "filter",
];
const ADAPTERS: &[&str] = &[
    "map",
    "then",
    "filter",
    "filter_map",
    "flat_map",
    "for_each",
    "for_each_concurrent",
    "try_for_each",
    "try_for_each_concurrent",
    "fold",
    "try_fold",
    "any",
    "all",
    "find",
    "find_map",
    "position",
    "retain",
    "retain_mut",
    "sort_by_key",
    "sort_by_cached_key",
    "max_by_key",
    "min_by_key",
    "reduce",
    "dedup_by_key",
    "partition",
    "scan",
    "take_while",
    "skip_while",
    "map_while",
    "inspect",
    "and_then",
    "try_filter",
    "try_filter_map",
    "map_ok",
    "filter_map_ok",
    "zip",
    "chain",
];
const COLLECTION_METHODS: &[&str] = &["push", "push_back", "push_front", "extend", "insert"];
const COLLECTION_FAN_OUT: &[&str] = &[
    "join_all",
    "try_join_all",
    "select_all",
    "FuturesUnordered",
    "FuturesOrdered",
    "JoinSet",
    "buffer_unordered",
    "buffered",
];
const SKIP_DIRS: &[&str] = &["target", "node_modules", "tests", "benches", "examples"];
const ALLOWLIST: &str = include_str!("authz-loop-allowlist.txt");
const REASON_PLACEHOLDER: &str = "TODO reason";
const STORED_FORM: &str = "stored";

#[derive(Clone, Debug)]
struct Hit {
    path: String,
    func: String,
    call: String,
    form: String,
}

struct Scanner<'a> {
    path: &'a str,
    checks: &'a BTreeSet<String>,
    has_collection_marker: bool,
    pass: ScanPass<'a>,
    scope: Vec<String>,
    function: Option<FunctionScope>,
    enclosing_type_parameters: Vec<Ident>,
    in_trait_impl: bool,
    form: Option<String>,
    stored_evaluation: StoredEvaluation,
    hits: Vec<Hit>,
}

impl<'a> Scanner<'a> {
    fn new(
        path: &'a str,
        checks: &'a BTreeSet<String>,
        has_collection_marker: bool,
        pass: ScanPass<'a>,
    ) -> Self {
        Self {
            path,
            checks,
            has_collection_marker,
            pass,
            scope: Vec::new(),
            function: None,
            enclosing_type_parameters: Vec::new(),
            in_trait_impl: false,
            form: None,
            stored_evaluation: StoredEvaluation::Initializer,
            hits: Vec::new(),
        }
    }

    fn with_scope(&mut self, name: &Ident, visit: impl FnOnce(&mut Self)) {
        self.scope.push(name.to_string());
        visit(self);
        self.scope.pop();
    }

    fn with_type_parameters(&mut self, generics: &Generics, visit: impl FnOnce(&mut Self)) {
        let parameters = generics.type_params().map(|param| param.ident.clone());
        let previous = std::mem::replace(&mut self.enclosing_type_parameters, parameters.collect());
        visit(self);
        self.enclosing_type_parameters = previous;
    }

    fn with_function(
        &mut self,
        sig: &Signature,
        body: Option<&Block>,
        exported: bool,
        visit: impl FnOnce(&mut Self),
    ) {
        let mut fan_out = CollectionFanOut {
            helpers: self.file_helpers(),
            found: false,
        };
        if self.has_collection_marker
            && let Some(body) = body
        {
            fan_out.visit_block(body);
        }
        let collects_futures = fan_out.found;
        self.with_scope(&sig.ident, |scanner| {
            let (call_index, parameters) = match &mut scanner.pass {
                ScanPass::Discover(calls) => (
                    Some(calls.add_function(sig, exported)),
                    sig.inputs
                        .iter()
                        .enumerate()
                        .filter_map(|(index, arg)| {
                            callable_parameter_name(arg, sig, &scanner.enclosing_type_parameters)
                                .map(|name| (name, index))
                        })
                        .collect(),
                ),
                ScanPass::Report(_) => (None, BTreeMap::new()),
            };
            let previous = scanner.function.replace(FunctionScope {
                scope_len: scanner.scope.len(),
                collects_futures,
                call_index,
                parameters,
                local_wrappers: BTreeSet::new(),
                stored_futures: BTreeMap::new(),
                saw_check: false,
            });
            // a fn item declared inside a loop body does not run once per iteration
            let outer_form = scanner.form.take();
            visit(scanner);
            scanner.form = outer_form;
            scanner.function = previous;
        });
    }

    fn with_form(&mut self, form: String, visit: impl FnOnce(&mut Self)) {
        let previous = self.form.replace(form);
        visit(self);
        self.form = previous;
    }

    fn with_stored_evaluation(
        &mut self,
        evaluation: StoredEvaluation,
        visit: impl FnOnce(&mut Self),
    ) {
        let previous = std::mem::replace(&mut self.stored_evaluation, evaluation);
        visit(self);
        self.stored_evaluation = previous;
    }

    fn visit_arguments(
        &mut self,
        arguments: &Punctuated<Expr, Token![,]>,
        form: Option<String>,
        callee: CallbackCallee<'_>,
        qualified: bool,
    ) {
        let adapter = form
            .as_deref()
            .and_then(|form| form.strip_prefix("adapter:"));
        for (index, argument) in arguments.iter().enumerate() {
            let adapter_callback = adapter.is_some_and(|name| {
                !["zip", "chain"].contains(&name)
                    && index + 1 == arguments.len()
                    && (!qualified || index > 0)
            });
            let (name, position) = match callee {
                CallbackCallee::Local { name, receiver } => (Some(name), index + receiver),
                _ => (None, index),
            };
            let (invoked, repeated) = self.callback_position(callee, position);
            let argument_form = form.as_ref().filter(|form| {
                if form.starts_with("via:") {
                    repeated
                        && (is_deferred_callable(argument) || callback_path(argument).is_some())
                } else {
                    !qualified
                        || adapter.is_none()
                        || (adapter_callback
                            && (is_deferred_callable(argument)
                                || callback_path(argument).is_some()))
                }
            });
            if adapter.is_none() || adapter_callback {
                self.note_forwarded_parameter(argument, name, position, argument_form.is_some());
            }
            let callback = adapter_callback || invoked;
            if let Some(form) = argument_form {
                if form.starts_with("join:") {
                    self.record_stored_futures(argument, form);
                }
                self.with_form(form.clone(), |scanner| {
                    scanner.visit_argument(argument, callback)
                });
            } else {
                self.visit_argument(argument, callback);
            }
        }
    }

    fn callback_position(&self, callee: CallbackCallee<'_>, index: usize) -> (bool, bool) {
        let name = match callee {
            CallbackCallee::None => return (false, false),
            CallbackCallee::UnresolvedAlias => return (true, true),
            CallbackCallee::CrossFile(callback) => return (index == callback, index == callback),
            CallbackCallee::Local { name, .. } => name,
        };
        if let Some(callback) = cross_file_callback(name) {
            return (index == callback, index == callback);
        }
        let ScanPass::Report(helpers) = &self.pass else {
            return (false, false);
        };
        let Some(positions) = helpers.callbacks.get(name) else {
            return (false, false);
        };
        (
            positions.invoked.contains(&index),
            positions.repeated.contains(&index),
        )
    }

    fn visit_argument(&mut self, argument: &Expr, callback: bool) {
        if callback
            && let Some(path) = callback_path(argument)
            && let Some(segment) = path.path.segments.last()
        {
            let spelling = segment.ident.to_string();
            let single_ident = path.qself.is_none() && path.path.get_ident().is_some();
            self.record_call(
                unraw(&spelling),
                CallKind::function(path, single_ident, None),
            );
        }
        self.visit_expr(argument);
    }

    fn record_stored_futures(&mut self, argument: &Expr, form: &str) {
        match future_binding_expr(argument) {
            Expr::Array(array) => {
                for element in &array.elems {
                    self.record_stored_futures(element, form);
                }
            }
            Expr::Macro(expr) if expr.mac.path.is_ident("vec") => {
                if let Ok(elements) = expr
                    .mac
                    .parse_body_with(Punctuated::<Expr, Token![,]>::parse_terminated)
                {
                    for element in &elements {
                        self.record_stored_futures(element, form);
                    }
                }
            }
            expr => self.replay_future_binding(expr, form),
        }
    }

    fn replay_future_binding(&mut self, expr: &Expr, form: &str) {
        let (Some(scope), Some(ident)) = (&self.function, bare_ident(expr)) else {
            return;
        };
        if let Some(hits) = scope.stored_futures.get(unraw(&ident.to_string())) {
            self.hits.extend(hits.iter().cloned().map(|mut hit| {
                hit.form = form.to_owned();
                hit
            }));
        }
    }

    fn visit_local_capturing_futures(&mut self, node: &Local) -> Vec<Hit> {
        let Some(init) = node
            .init
            .as_ref()
            .filter(|init| self.form.is_none() && !is_local_closure(&init.expr))
        else {
            visit::visit_local(self, node);
            return Vec::new();
        };
        for attr in &node.attrs {
            self.visit_attribute(attr);
        }
        self.visit_pat(&node.pat);
        let hits = self.capture_stored_futures(|scanner| scanner.visit_expr(&init.expr));
        if let Some((_, diverge)) = &init.diverge {
            self.visit_expr(diverge);
        }
        hits
    }

    fn visit_method_arguments(&mut self, node: &ExprMethodCall, name: &str) {
        let form = self.helper_form(name).or_else(|| self.method_form(name));
        let receiver = bare_ident(&node.receiver).filter(|_| {
            form.is_none()
                && self.form.is_none()
                && self.function.is_some()
                && matches!(&self.pass, ScanPass::Report(_))
                && (COLLECTION_METHODS.contains(&name) || name == "append")
        });
        let Some(receiver) = receiver else {
            let callee = CallbackCallee::Local { name, receiver: 1 };
            self.visit_arguments(&node.args, form, callee, false);
            return;
        };

        let mut hits = self.capture_stored_futures(|scanner| {
            for argument in &node.args {
                scanner.visit_expr(argument);
            }
        });
        let scope = self.function.as_mut().expect("mutation function scope");
        if name == "append"
            && let Some(source) = appended_binding(node)
            && let Some(mut moved) = scope.stored_futures.remove(unraw(&source.to_string()))
        {
            hits.append(&mut moved);
        }
        if !hits.is_empty() {
            let spelling = receiver.to_string();
            scope
                .stored_futures
                .entry(unraw(&spelling).to_owned())
                .or_default()
                .append(&mut hits);
        }
    }

    fn capture_stored_futures(&mut self, visit: impl FnOnce(&mut Self)) -> Vec<Hit> {
        let start = self.hits.len();
        self.with_form(STORED_FORM.into(), |scanner| {
            scanner.with_stored_evaluation(StoredEvaluation::Initializer, visit);
        });
        if self.hits.len() == start {
            return Vec::new();
        }
        // A nested fan-out runs independently of how the stored futures are consumed.
        let (hits, kept) = self
            .hits
            .split_off(start)
            .into_iter()
            .partition(|hit| hit.form == STORED_FORM);
        self.hits.extend::<Vec<Hit>>(kept);
        hits
    }

    fn method_form(&self, name: &str) -> Option<String> {
        if name == "spawn" {
            return Some("spawn".into());
        }
        if ADAPTERS.contains(&name) {
            return Some(format!("adapter:{name}"));
        }
        if COLLECTION_METHODS.contains(&name)
            && self
                .function
                .as_ref()
                .is_some_and(|scope| scope.collects_futures)
        {
            return Some("collected".into());
        }
        None
    }

    fn helper_form(&self, name: &str) -> Option<String> {
        match &self.pass {
            ScanPass::Report(helpers)
                if helpers
                    .callbacks
                    .get(name)
                    .is_some_and(|positions| !positions.repeated.is_empty()) =>
            {
                Some(format!("via:{name}"))
            }
            _ => None,
        }
    }

    fn function_argument_form<'name>(
        &self,
        path: &ExprPath,
        name: &'name str,
        local: bool,
        qualified: bool,
    ) -> (Option<String>, CallbackCallee<'name>) {
        let rename = self.file_helpers().renamed_call(path, name);
        let original = match rename {
            Some(ImportOriginal::Named(original)) => original,
            Some(ImportOriginal::Unresolved) => {
                return (Some(format!("via:{name}")), CallbackCallee::UnresolvedAlias);
            }
            None => name,
        };
        if let Some(callback) = cross_file_callback(original) {
            return (
                Some(format!("via:{original}")),
                CallbackCallee::CrossFile(callback),
            );
        }
        let form = call_form(&path.path, original);
        if rename.is_some() || form.is_some() {
            return (form, CallbackCallee::None);
        }
        if local {
            let callee = CallbackCallee::Local { name, receiver: 0 };
            (self.helper_form(name), callee)
        } else {
            let method = qualified.then(|| self.method_form(name)).flatten();
            (method, CallbackCallee::None)
        }
    }

    fn file_helpers(&self) -> &FileHelpers {
        match &self.pass {
            ScanPass::Discover(calls) => &calls.helpers,
            ScanPass::Report(helpers) => helpers,
        }
    }

    fn record_call(&mut self, name: &str, kind: CallKind) {
        let helpers = self.file_helpers();
        let single_ident = matches!(
            kind,
            CallKind::Function {
                single_ident: true,
                ..
            }
        );
        let alias = single_ident
            .then(|| helpers.aliases.get(name))
            .flatten()
            .and_then(|originals| {
                originals
                    .iter()
                    .find(|original| kind.is_check_alias(original, self.checks))
            })
            .cloned();
        let is_check = alias.is_some() || kind.is_check(name, self.checks);
        match &mut self.pass {
            ScanPass::Discover(calls) => {
                let Some(scope) = self.function.as_ref() else {
                    return;
                };
                let func = &mut calls.functions[scope.call_index.expect("discovery function")];
                func.calls_check |= is_check;
                if single_ident && let Some(&index) = scope.parameters.get(name) {
                    func.callbacks.insert(index, self.form.is_some());
                }
                func.callees.extend(kind.callee(name));
            }
            ScanPass::Report(helpers)
                if is_check
                    || (single_ident
                        && self
                            .function
                            .as_ref()
                            .is_some_and(|scope| scope.local_wrappers.contains(name)))
                    || kind
                        .callee(name)
                        .as_deref()
                        .is_some_and(|callee| helpers.resolves_to_wrapper(callee)) =>
            {
                if let Some(scope) = &mut self.function {
                    scope.saw_check = true;
                }
                self.record_hit(alias.as_deref().unwrap_or(name));
            }
            ScanPass::Report(_) => {}
        }
    }

    fn note_forwarded_parameter(
        &mut self,
        argument: &Expr,
        callee: Option<&str>,
        position: usize,
        argument_fans_out: bool,
    ) {
        let (ScanPass::Discover(calls), Some(scope)) = (&mut self.pass, &self.function) else {
            return;
        };
        let Some(ident) = callback_path(argument)
            .filter(|path| path.qself.is_none())
            .and_then(|path| path.path.get_ident())
        else {
            return;
        };
        let spelling = ident.to_string();
        let Some(&parameter) = scope.parameters.get(unraw(&spelling)) else {
            return;
        };
        let func = &mut calls.functions[scope.call_index.expect("discovery function")];
        let repeated = self.form.is_some() || argument_fans_out;
        if let Some(callee) = callee {
            func.forwards.push(CallbackForward {
                callee: callee.to_owned(),
                position,
                parameter,
                repeated,
            });
        } else if repeated {
            func.callbacks.insert(parameter, true);
        }
    }

    fn record_hit(&mut self, call: &str) {
        if let Some(form) = &self.form
            && !(form == STORED_FORM && self.stored_evaluation == StoredEvaluation::Awaited)
        {
            let func = self.function.as_ref().map_or_else(
                || "<top>".to_owned(),
                |scope| self.scope[..scope.scope_len].join("::"),
            );
            self.hits.push(Hit {
                path: self.path.to_owned(),
                func,
                call: call.to_owned(),
                form: form.clone(),
            });
        }
    }

    fn visit_if_condition(&mut self, condition: &Expr) {
        match condition {
            Expr::Binary(expr) if matches!(expr.op, BinOp::And(_)) => {
                for attr in &expr.attrs {
                    self.visit_attribute(attr);
                }
                self.visit_if_condition(&expr.left);
                self.visit_if_condition(&expr.right);
            }
            Expr::Let(expr) => {
                self.visit_expr(condition);
                if let Some(scope) = &mut self.function {
                    let mut bindings = PatternBindings::default();
                    bindings.visit_pat(&expr.pat);
                    for name in bindings.names {
                        scope.stored_futures.remove(&name);
                        scope.local_wrappers.remove(&name);
                    }
                }
            }
            _ => self.visit_expr(condition),
        }
    }
}

impl<'ast> Visit<'ast> for Scanner<'_> {
    fn visit_item(&mut self, node: &'ast Item) {
        if !is_test(item_attrs(node)) {
            visit::visit_item(self, node);
        }
    }

    fn visit_impl_item(&mut self, node: &'ast ImplItem) {
        if !is_test(impl_item_attrs(node)) {
            visit::visit_impl_item(self, node);
        }
    }

    fn visit_trait_item(&mut self, node: &'ast TraitItem) {
        if !is_test(trait_item_attrs(node)) {
            visit::visit_trait_item(self, node);
        }
    }

    fn visit_item_mod(&mut self, node: &'ast ItemMod) {
        self.with_scope(&node.ident, |scanner| visit::visit_item_mod(scanner, node));
    }

    fn visit_item_impl(&mut self, node: &'ast ItemImpl) {
        let previous = std::mem::replace(&mut self.in_trait_impl, node.trait_.is_some());
        self.with_type_parameters(&node.generics, |scanner| {
            if let Some(name) = self_type_name(&node.self_ty) {
                scanner.with_scope(name, |scanner| visit::visit_item_impl(scanner, node));
            } else {
                visit::visit_item_impl(scanner, node);
            }
        });
        self.in_trait_impl = previous;
    }

    fn visit_item_trait(&mut self, node: &'ast ItemTrait) {
        self.with_type_parameters(&node.generics, |scanner| {
            scanner.with_scope(&node.ident, |scanner| {
                visit::visit_item_trait(scanner, node)
            });
        });
    }

    fn visit_item_fn(&mut self, node: &'ast ItemFn) {
        let exported = !matches!(node.vis, Visibility::Inherited);
        let previous = std::mem::take(&mut self.enclosing_type_parameters);
        self.with_function(&node.sig, Some(&node.block), exported, |scanner| {
            visit::visit_item_fn(scanner, node);
        });
        self.enclosing_type_parameters = previous;
    }

    fn visit_impl_item_fn(&mut self, node: &'ast ImplItemFn) {
        let exported = self.in_trait_impl || !matches!(node.vis, Visibility::Inherited);
        self.with_function(&node.sig, Some(&node.block), exported, |scanner| {
            visit::visit_impl_item_fn(scanner, node);
        });
    }

    fn visit_trait_item_fn(&mut self, node: &'ast TraitItemFn) {
        self.with_function(&node.sig, node.default.as_ref(), true, |scanner| {
            visit::visit_trait_item_fn(scanner, node);
        });
    }

    fn visit_block(&mut self, node: &'ast Block) {
        let outer = self
            .function
            .as_ref()
            .map(|scope| (scope.local_wrappers.clone(), scope.stored_futures.clone()));
        visit::visit_block(self, node);
        if let (Some(scope), Some((wrappers, futures))) = (&mut self.function, outer) {
            scope.local_wrappers = wrappers;
            scope.stored_futures = futures;
        }
    }

    fn visit_local(&mut self, node: &'ast Local) {
        let (ScanPass::Report(_), Some(scope), Some(name)) =
            (&self.pass, &mut self.function, binding_name(&node.pat))
        else {
            visit::visit_local(self, node);
            return;
        };
        let previous = std::mem::take(&mut scope.saw_check);
        let hits = self.visit_local_capturing_futures(node);
        let scope = self.function.as_mut().expect("local function scope");
        if hits.is_empty() {
            scope.stored_futures.remove(&name);
        } else {
            scope.stored_futures.insert(name.clone(), hits);
        }
        let is_callback = node
            .init
            .as_ref()
            .is_some_and(|init| matches!(init.expr.as_ref(), Expr::Closure(_)));
        if is_callback && scope.saw_check {
            scope.local_wrappers.insert(name);
        } else {
            scope.local_wrappers.remove(&name);
        }
        scope.saw_check |= previous;
    }

    fn visit_expr_for_loop(&mut self, node: &'ast ExprForLoop) {
        for attr in &node.attrs {
            self.visit_attribute(attr);
        }
        self.visit_pat(&node.pat);
        self.visit_expr(&node.expr);
        self.with_form("for".into(), |scanner| scanner.visit_block(&node.body));
    }

    fn visit_expr_while(&mut self, node: &'ast ExprWhile) {
        for attr in &node.attrs {
            self.visit_attribute(attr);
        }
        self.with_form("while".into(), |scanner| {
            scanner.visit_expr(&node.cond);
            scanner.visit_block(&node.body);
        });
    }

    fn visit_expr_loop(&mut self, node: &'ast ExprLoop) {
        for attr in &node.attrs {
            self.visit_attribute(attr);
        }
        self.with_form("loop".into(), |scanner| scanner.visit_block(&node.body));
    }

    fn visit_expr_if(&mut self, node: &'ast ExprIf) {
        if !has_let_condition(&node.cond) {
            visit::visit_expr_if(self, node);
            return;
        }
        for attr in &node.attrs {
            self.visit_attribute(attr);
        }
        let outer = self
            .function
            .as_ref()
            .map(|scope| (scope.local_wrappers.clone(), scope.stored_futures.clone()));
        self.visit_if_condition(&node.cond);
        self.visit_block(&node.then_branch);
        if let (Some(scope), Some((wrappers, futures))) = (&mut self.function, outer) {
            scope.local_wrappers = wrappers;
            scope.stored_futures = futures;
        }
        if let Some((_, otherwise)) = &node.else_branch {
            self.visit_expr(otherwise);
        }
    }

    fn visit_expr_await(&mut self, node: &'ast ExprAwait) {
        for attr in &node.attrs {
            self.visit_attribute(attr);
        }
        if self.form.as_deref() == Some(STORED_FORM)
            && self.stored_evaluation != StoredEvaluation::Deferred
        {
            self.with_stored_evaluation(StoredEvaluation::Awaited, |scanner| {
                if let Expr::Async(expr) = ungroup_expr(&node.base) {
                    visit::visit_expr_async(scanner, expr);
                } else {
                    scanner.visit_expr(&node.base);
                }
            });
        } else {
            self.visit_expr(&node.base);
        }
    }

    // Async and closure bodies can run after the enclosing initializer has completed.
    fn visit_expr_async(&mut self, node: &'ast ExprAsync) {
        self.with_stored_evaluation(StoredEvaluation::Deferred, |scanner| {
            visit::visit_expr_async(scanner, node);
        });
    }

    fn visit_expr_closure(&mut self, node: &'ast ExprClosure) {
        self.with_stored_evaluation(StoredEvaluation::Deferred, |scanner| {
            visit::visit_expr_closure(scanner, node);
        });
    }

    fn visit_expr_call(&mut self, node: &'ast ExprCall) {
        let path = call_path(&node.func);
        let spelling = path
            .and_then(|path| path.path.segments.last())
            .map(|segment| segment.ident.to_string());
        let (form, callee, qualified) = if let (Some(path), Some(spelling)) = (path, &spelling) {
            let name = unraw(spelling);
            let single_ident = path.qself.is_none() && path.path.get_ident().is_some();
            let kind = CallKind::function(path, single_ident, Some(node.args.len()));
            let local = matches!(kind, CallKind::Function { local: true, .. });
            let qualified = matches!(
                kind,
                CallKind::Function {
                    qualified: true,
                    ..
                }
            );
            let (form, callee) = self.function_argument_form(path, name, local, qualified);
            self.record_call(name, kind);
            (form, callee, qualified)
        } else {
            (None, CallbackCallee::None, false)
        };
        for attr in &node.attrs {
            self.visit_attribute(attr);
        }
        self.visit_expr(&node.func);
        self.visit_arguments(&node.args, form, callee, qualified);
    }

    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        let spelling = node.method.to_string();
        let name = unraw(&spelling);
        self.record_call(
            name,
            CallKind::Method {
                arg_count: node.args.len(),
            },
        );
        for attr in &node.attrs {
            self.visit_attribute(attr);
        }
        self.visit_expr(&node.receiver);
        if let Some(turbofish) = &node.turbofish {
            self.visit_angle_bracketed_generic_arguments(turbofish);
        }
        self.visit_method_arguments(node, name);
    }

    fn visit_expr_macro(&mut self, node: &'ast ExprMacro) {
        visit::visit_expr_macro(self, node);
        visit_macro_body(self, &node.mac);
    }

    fn visit_stmt_macro(&mut self, node: &'ast StmtMacro) {
        visit::visit_stmt_macro(self, node);
        visit_macro_body(self, &node.mac);
    }

    fn visit_item_macro(&mut self, node: &'ast ItemMacro) {
        visit::visit_item_macro(self, node);
        visit_macro_body(self, &node.mac);
    }
}

#[derive(Clone, Copy)]
enum CallbackCallee<'a> {
    None,
    Local { name: &'a str, receiver: usize },
    CrossFile(usize),
    UnresolvedAlias,
}

#[derive(PartialEq, Eq)]
enum StoredEvaluation {
    Initializer,
    Awaited,
    Deferred,
}

struct FunctionScope {
    scope_len: usize,
    collects_futures: bool,
    call_index: Option<usize>,
    parameters: BTreeMap<String, usize>,
    local_wrappers: BTreeSet<String>,
    stored_futures: BTreeMap<String, Vec<Hit>>,
    saw_check: bool,
}

#[derive(Default)]
struct PatternBindings {
    names: Vec<String>,
}

impl<'ast> Visit<'ast> for PatternBindings {
    fn visit_pat_ident(&mut self, node: &'ast syn::PatIdent) {
        self.names.push(unraw(&node.ident.to_string()).to_owned());
        visit::visit_pat_ident(self, node);
    }
}

enum ScanPass<'a> {
    Discover(&'a mut FileCalls),
    Report(&'a FileHelpers),
}

#[derive(Default)]
struct FileCalls {
    functions: Vec<FunctionCalls>,
    helpers: FileHelpers,
}

impl FileCalls {
    fn add_function(&mut self, sig: &Signature, exported: bool) -> usize {
        let index = self.functions.len();
        let name = unraw(&sig.ident.to_string()).to_owned();
        if sig.receiver().is_some() {
            self.helpers.methods.insert(name.clone());
        }
        self.helpers.callbacks.entry(name.clone()).or_default();
        self.functions.push(FunctionCalls {
            name,
            export_candidate: exported && returns_authorization_answer(&sig.output),
            ..FunctionCalls::default()
        });
        index
    }

    fn resolve(&mut self) {
        loop {
            let mut changed = false;
            for function in &self.functions {
                changed |= function.resolve(&mut self.helpers);
            }
            if !changed {
                break;
            }
        }
    }

    fn exported_wrappers(&self) -> BTreeSet<String> {
        self.functions
            .iter()
            .filter(|function| function.export_candidate && function.wraps_check(&self.helpers))
            .map(|function| function.name.clone())
            .collect()
    }
}

#[derive(Default)]
struct FunctionCalls {
    name: String,
    export_candidate: bool,
    calls_check: bool,
    callees: BTreeSet<String>,
    callbacks: CallbackPositions,
    forwards: Vec<CallbackForward>,
}

impl FunctionCalls {
    fn wraps_check(&self, helpers: &FileHelpers) -> bool {
        self.calls_check
            || self
                .callees
                .iter()
                .any(|callee| helpers.resolves_to_wrapper(callee))
    }

    fn resolve(&self, helpers: &mut FileHelpers) -> bool {
        let mut changed = false;
        if !helpers.wrappers.contains(&self.name) && self.wraps_check(helpers) {
            changed |= helpers.wrappers.insert(self.name.clone());
        }
        let mut callbacks = self.callbacks.clone();
        for forward in &self.forwards {
            forward.resolve(&helpers.callbacks, &mut callbacks);
        }
        let known = helpers
            .callbacks
            .get_mut(&self.name)
            .expect("registered callable");
        changed |= known.merge(callbacks);
        changed
    }
}

#[derive(Clone, Default)]
struct CallbackPositions {
    invoked: BTreeSet<usize>,
    repeated: BTreeSet<usize>,
}

impl CallbackPositions {
    fn insert(&mut self, index: usize, repeated: bool) {
        self.invoked.insert(index);
        if repeated {
            self.repeated.insert(index);
        }
    }

    fn merge(&mut self, other: Self) -> bool {
        let previous = (self.invoked.len(), self.repeated.len());
        self.invoked.extend(other.invoked);
        self.repeated.extend(other.repeated);
        previous != (self.invoked.len(), self.repeated.len())
    }
}

struct CallbackForward {
    callee: String,
    position: usize,
    parameter: usize,
    repeated: bool,
}

impl CallbackForward {
    fn resolve(
        &self,
        callees: &BTreeMap<String, CallbackPositions>,
        caller: &mut CallbackPositions,
    ) {
        match callees.get(&self.callee) {
            Some(callee) if callee.invoked.contains(&self.position) => {
                caller.insert(
                    self.parameter,
                    self.repeated || callee.repeated.contains(&self.position),
                );
            }
            // An unresolved callee in a loop may invoke the forwarded callback each time.
            None if self.repeated => caller.insert(self.parameter, true),
            _ => {}
        }
    }
}

#[derive(Default)]
struct FileHelpers {
    wrappers: BTreeSet<String>,
    callbacks: BTreeMap<String, CallbackPositions>,
    // a `use`d name resolves to another module's item, not this file's same-named fn
    imported: BTreeSet<String>,
    aliases: BTreeMap<String, BTreeSet<String>>,
    methods: BTreeSet<String>,
}

impl FileHelpers {
    fn renamed_call(&self, path: &ExprPath, name: &str) -> Option<ImportOriginal<'_>> {
        let segments = &path.path.segments;
        if path.qself.is_some()
            || path.path.leading_colon.is_some()
            || !(segments.len() == 1 || (segments.len() == 2 && segments[0].ident == "self"))
        {
            return None;
        }
        let originals = self.aliases.get(name)?;
        match originals.first() {
            Some(original) if originals.len() == 1 && original != "self" => {
                Some(ImportOriginal::Named(original))
            }
            _ => Some(ImportOriginal::Unresolved),
        }
    }

    fn resolves_to_wrapper(&self, callee: &str) -> bool {
        let (kind, name) = callee.split_at(2);
        self.wrappers.contains(name)
            && match kind {
                "f:" => !self.imported.contains(name),
                _ => self.methods.contains(name) && !COMMON_METHODS.contains(&name),
            }
    }
}

#[derive(Clone, Copy)]
enum ImportOriginal<'a> {
    Named(&'a str),
    Unresolved,
}

enum CallKind {
    Function {
        single_ident: bool,
        local: bool,
        qualified: bool,
        arg_count: Option<usize>,
    },
    Method {
        arg_count: usize,
    },
}

impl CallKind {
    fn function(path: &ExprPath, single_ident: bool, arg_count: Option<usize>) -> Self {
        let segments = &path.path.segments;
        let local = single_ident
            || (path.qself.is_none()
                && segments.len() == 2
                && (segments[0].ident == "Self" || segments[0].ident == "self"));
        let qualified = !local && (path.qself.is_some() || segments.len() > 1);
        Self::Function {
            single_ident,
            local,
            qualified,
            arg_count,
        }
    }

    fn is_check(&self, name: &str, checks: &BTreeSet<String>) -> bool {
        match self {
            Self::Function {
                qualified,
                arg_count,
                ..
            } => {
                checks.contains(name)
                    || (*qualified
                        && arg_count.is_some_and(|count| is_method_check(name, count, 1)))
            }
            Self::Method { arg_count } => {
                !COMMON_METHODS.contains(&name)
                    && (checks.contains(name) || is_method_check(name, *arg_count, 0))
            }
        }
    }

    fn is_check_alias(&self, original: &str, checks: &BTreeSet<String>) -> bool {
        checks.contains(original)
            || matches!(self, Self::Function { arg_count: Some(count), .. } if is_method_check(original, *count, 1))
    }

    // Qualified paths can name external items that share a name with a local wrapper.
    fn callee(&self, name: &str) -> Option<String> {
        match self {
            Self::Function { local: false, .. } => None,
            Self::Function { .. } => Some(format!("f:{name}")),
            Self::Method { .. } => Some(format!("m:{name}")),
        }
    }
}

struct CollectionFanOut<'a> {
    helpers: &'a FileHelpers,
    found: bool,
}

impl<'ast> Visit<'ast> for CollectionFanOut<'_> {
    fn visit_item(&mut self, node: &'ast Item) {
        if !self.found && !is_test(item_attrs(node)) {
            visit::visit_item(self, node);
        }
    }

    fn visit_impl_item(&mut self, node: &'ast ImplItem) {
        if !self.found && !is_test(impl_item_attrs(node)) {
            visit::visit_impl_item(self, node);
        }
    }

    fn visit_trait_item(&mut self, node: &'ast TraitItem) {
        if !self.found && !is_test(trait_item_attrs(node)) {
            visit::visit_trait_item(self, node);
        }
    }

    fn visit_expr(&mut self, node: &'ast Expr) {
        if !self.found {
            visit::visit_expr(self, node);
        }
    }

    fn visit_path_segment(&mut self, node: &'ast PathSegment) {
        self.found |= COLLECTION_FAN_OUT.contains(&unraw(&node.ident.to_string()));
        if !self.found {
            visit::visit_path_segment(self, node);
        }
    }

    fn visit_expr_call(&mut self, node: &'ast ExprCall) {
        if let Some(path) = call_path(&node.func)
            && let Some(segment) = path.path.segments.last()
            && let Some(ImportOriginal::Named(original)) = self
                .helpers
                .renamed_call(path, unraw(&segment.ident.to_string()))
        {
            self.found |= COLLECTION_FAN_OUT.contains(&original);
        }
        if !self.found {
            visit::visit_expr_call(self, node);
        }
    }

    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        self.found |= COLLECTION_FAN_OUT.contains(&unraw(&node.method.to_string()));
        if !self.found {
            visit::visit_expr_method_call(self, node);
        }
    }

    fn visit_macro(&mut self, node: &'ast Macro) {
        visit::visit_macro(self, node);
        if !self.found {
            visit_macro_body(self, node);
        }
    }
}

#[derive(Default)]
struct UseNames {
    names: BTreeSet<String>,
    aliases: BTreeMap<String, BTreeSet<String>>,
}

impl<'ast> Visit<'ast> for UseNames {
    fn visit_item(&mut self, node: &'ast Item) {
        if !is_test(item_attrs(node)) {
            visit::visit_item(self, node);
        }
    }

    fn visit_use_tree(&mut self, node: &'ast UseTree) {
        match node {
            UseTree::Name(name) => {
                self.names.insert(unraw(&name.ident.to_string()).to_owned());
            }
            UseTree::Rename(rename) => {
                let alias = unraw(&rename.rename.to_string()).to_owned();
                self.names.insert(alias.clone());
                self.aliases
                    .entry(alias)
                    .or_default()
                    .insert(unraw(&rename.ident.to_string()).to_owned());
            }
            _ => visit::visit_use_tree(self, node),
        }
    }
}

type Allowlist<'a> = BTreeMap<(&'a str, &'a str), &'a str>;

fn scan_source(path: &str, src: &str) -> Vec<Hit> {
    scan_source_with(path, src, &base_checks())
}

fn scan_source_with(path: &str, src: &str, checks: &BTreeSet<String>) -> Vec<Hit> {
    let file = parse_source(path, src);
    if is_test(&file.attrs) {
        return Vec::new();
    }
    let has_collection_marker = COLLECTION_FAN_OUT.iter().any(|name| src.contains(*name));
    let calls = discover_file(path, &file, checks, has_collection_marker);
    let mut scanner = Scanner::new(
        path,
        checks,
        has_collection_marker,
        ScanPass::Report(&calls.helpers),
    );
    scanner.visit_file(&file);
    scanner.hits
}

fn exported_wrappers(path: &str, src: &str, checks: &BTreeSet<String>) -> BTreeSet<String> {
    let file = parse_source(path, src);
    if is_test(&file.attrs) {
        return BTreeSet::new();
    }
    let has_collection_marker = COLLECTION_FAN_OUT.iter().any(|name| src.contains(*name));
    discover_file(path, &file, checks, has_collection_marker).exported_wrappers()
}

fn parse_source(path: &str, src: &str) -> syn::File {
    syn::parse_file(src).unwrap_or_else(|error| panic!("failed to parse {path}: {error}"))
}

fn discover_file(
    path: &str,
    file: &syn::File,
    checks: &BTreeSet<String>,
    has_collection_marker: bool,
) -> FileCalls {
    let mut imports = UseNames::default();
    imports.visit_file(file);
    let mut calls = FileCalls::default();
    calls.helpers.imported = imports.names;
    calls.helpers.aliases = imports.aliases;
    Scanner::new(
        path,
        checks,
        has_collection_marker,
        ScanPass::Discover(&mut calls),
    )
    .visit_file(file);
    calls.resolve();
    calls
}

fn base_checks() -> BTreeSet<String> {
    CHECKS.iter().map(|&name| name.to_owned()).collect()
}

fn binding_name(pat: &Pat) -> Option<String> {
    match pat {
        Pat::Ident(pat) => Some(unraw(&pat.ident.to_string()).to_owned()),
        Pat::Type(pat) => binding_name(&pat.pat),
        _ => None,
    }
}

fn has_let_condition(expr: &Expr) -> bool {
    match expr {
        Expr::Let(_) => true,
        Expr::Binary(expr) if matches!(expr.op, BinOp::And(_)) => {
            has_let_condition(&expr.left) || has_let_condition(&expr.right)
        }
        _ => false,
    }
}

fn callable_parameter_name(
    arg: &FnArg,
    sig: &Signature,
    enclosing_type_parameters: &[Ident],
) -> Option<String> {
    let FnArg::Typed(arg) = arg else {
        return None;
    };
    if is_callable_parameter(&arg.ty, sig, enclosing_type_parameters) {
        binding_name(&arg.pat)
    } else {
        None
    }
}

fn is_callable_parameter(ty: &Type, sig: &Signature, enclosing_type_parameters: &[Ident]) -> bool {
    match ty {
        Type::Path(ty) => {
            ty.path.get_ident().is_some_and(|ident| {
                enclosing_type_parameters.contains(ident)
                    || sig
                        .generics
                        .type_params()
                        .any(|param| &param.ident == ident)
            }) || ty.path.segments.last().is_some_and(is_callable_pointer)
        }
        Type::ImplTrait(ty) => ty.bounds.iter().any(is_fn_bound),
        Type::BareFn(_) => true,
        Type::Reference(ty) => {
            is_dyn_callable(&ty.elem)
                || is_callable_parameter(&ty.elem, sig, enclosing_type_parameters)
        }
        Type::Ptr(ty) => is_dyn_callable(&ty.elem),
        Type::Group(ty) => is_callable_parameter(&ty.elem, sig, enclosing_type_parameters),
        Type::Paren(ty) => is_callable_parameter(&ty.elem, sig, enclosing_type_parameters),
        _ => false,
    }
}

fn is_callable_pointer(segment: &PathSegment) -> bool {
    if !["Box", "Arc", "Rc", "Pin"]
        .iter()
        .any(|name| segment.ident == *name)
    {
        return false;
    }
    first_type_argument(segment).is_some_and(|ty| {
        is_dyn_callable(ty)
            || matches!(ty, Type::Path(path) if path.path.segments.last().is_some_and(is_callable_pointer))
    })
}

fn is_dyn_callable(ty: &Type) -> bool {
    match ty {
        Type::TraitObject(ty) => ty.bounds.iter().any(is_fn_bound),
        Type::Group(ty) => is_dyn_callable(&ty.elem),
        Type::Paren(ty) => is_dyn_callable(&ty.elem),
        _ => false,
    }
}

fn is_fn_bound(bound: &TypeParamBound) -> bool {
    matches!(bound, TypeParamBound::Trait(bound) if bound.path.segments.last().is_some_and(|segment| {
        ["Fn", "FnMut", "FnOnce", "AsyncFn", "AsyncFnMut", "AsyncFnOnce"]
            .iter()
            .any(|name| segment.ident == *name)
    }))
}

fn is_deferred_callable(expr: &Expr) -> bool {
    match expr {
        Expr::Closure(_) | Expr::Async(_) => true,
        Expr::Reference(expr) => is_deferred_callable(&expr.expr),
        Expr::Paren(expr) => is_deferred_callable(&expr.expr),
        Expr::Group(expr) => is_deferred_callable(&expr.expr),
        Expr::Call(call) if call.args.len() == 1 => {
            let Some(path) = call_path(&call.func) else {
                return false;
            };
            let mut segments = path.path.segments.iter().rev();
            let (Some(method), Some(ty)) = (segments.next(), segments.next()) else {
                return false;
            };
            matches!(
                (
                    unraw(&ty.ident.to_string()),
                    unraw(&method.ident.to_string())
                ),
                ("Box" | "Arc" | "Rc", "new") | ("Box", "pin")
            ) && call.args.first().is_some_and(is_deferred_callable)
        }
        _ => false,
    }
}

fn returns_authorization_answer(output: &ReturnType) -> bool {
    let ReturnType::Type(_, ty) = output else {
        return false;
    };
    match ty.as_ref() {
        Type::Path(ty) => ty.path.segments.last().is_some_and(|segment| {
            ["bool", "Outcome", "Folded"]
                .iter()
                .any(|name| segment.ident == *name)
                || (["Option", "Result"]
                    .iter()
                    .any(|name| segment.ident == *name)
                    && first_type_argument(segment).is_some())
        }),
        Type::ImplTrait(ty) => ty.bounds.iter().any(is_boolean_future),
        _ => false,
    }
}

fn first_type_argument(segment: &PathSegment) -> Option<&Type> {
    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        return None;
    };
    match args.args.first()? {
        GenericArgument::Type(ty) => Some(ty),
        _ => None,
    }
}

fn is_bool(ty: &Type) -> bool {
    matches!(ty, Type::Path(ty) if ty.path.segments.last().is_some_and(|segment| segment.ident == "bool"))
}

fn is_boolean_future(bound: &TypeParamBound) -> bool {
    let TypeParamBound::Trait(bound) = bound else {
        return false;
    };
    let Some(future) = bound
        .path
        .segments
        .last()
        .filter(|segment| segment.ident == "Future")
    else {
        return false;
    };
    let PathArguments::AngleBracketed(args) = &future.arguments else {
        return false;
    };
    args.args.iter().any(|arg| {
        matches!(arg, GenericArgument::AssocType(assoc) if assoc.ident == "Output" && is_bool(&assoc.ty))
    })
}

fn visit_macro_body<V: for<'ast> Visit<'ast>>(visitor: &mut V, mac: &Macro) {
    let name = mac
        .path
        .segments
        .last()
        .map(|segment| segment.ident.to_string());
    let special = match name.as_deref() {
        Some("select") => mac.parse_body_with(parse_select_expressions).ok(),
        Some("matches") => mac.parse_body_with(parse_matches_expressions).ok(),
        _ => None,
    };
    if let Some(expressions) = special {
        for expression in &expressions {
            visitor.visit_expr(expression);
        }
    } else if let Ok(expressions) =
        mac.parse_body_with(Punctuated::<Expr, Token![,]>::parse_terminated)
    {
        for expression in &expressions {
            visitor.visit_expr(expression);
        }
    } else if let Ok(statements) = mac.parse_body_with(Block::parse_within) {
        for statement in &statements {
            visitor.visit_stmt(statement);
        }
    } else if let Ok(expressions) = mac.parse_body_with(parse_macro_expression_chunks) {
        for expression in &expressions {
            visitor.visit_expr(expression);
        }
    }
}

fn parse_select_expressions(input: ParseStream<'_>) -> syn::Result<Vec<Expr>> {
    let mut expressions = Vec::new();
    if input.peek(Ident) && input.peek2(Token![;]) {
        let mode: Ident = input.parse()?;
        if mode != "biased" {
            return Err(syn::Error::new(mode.span(), "expected biased"));
        }
        input.parse::<Token![;]>()?;
    }
    while !input.is_empty() {
        if input.peek(Token![else]) {
            input.parse::<Token![else]>()?;
        } else {
            Pat::parse_multi_with_leading_vert(input)?;
            if input.peek(Token![=]) && !input.peek(Token![=>]) {
                input.parse::<Token![=]>()?;
                expressions.push(input.parse()?);
                if input.peek(Token![,]) && input.peek2(Token![if]) {
                    input.parse::<Token![,]>()?;
                    input.parse::<Token![if]>()?;
                    expressions.push(input.parse()?);
                }
            }
        }
        input.parse::<Token![=>]>()?;
        expressions.push(Expr::parse_with_earlier_boundary_rule(input)?);
        if input.peek(Token![,]) {
            input.parse::<Token![,]>()?;
        }
    }
    Ok(expressions)
}

fn parse_matches_expressions(input: ParseStream<'_>) -> syn::Result<Vec<Expr>> {
    let mut expressions = vec![input.parse()?];
    input.parse::<Token![,]>()?;
    Pat::parse_multi_with_leading_vert(input)?;
    if input.peek(Token![if]) {
        input.parse::<Token![if]>()?;
        expressions.push(input.parse()?);
    }
    if input.peek(Token![,]) {
        input.parse::<Token![,]>()?;
    }
    Ok(expressions)
}

fn parse_macro_expression_chunks(input: ParseStream<'_>) -> syn::Result<Vec<Expr>> {
    let mut expressions = Vec::new();
    while !input.is_empty() {
        let fork = input.fork();
        if let Ok(expr) = fork.parse::<Expr>()
            && fork.cursor() != input.cursor()
        {
            input.advance_to(&fork);
            expressions.push(expr);
            if input.peek(Token![,]) {
                input.parse::<Token![,]>()?;
            } else if input.peek(Token![;]) {
                input.parse::<Token![;]>()?;
            } else if input.peek(Token![=>]) {
                input.parse::<Token![=>]>()?;
            } else if input.peek(Token![:]) && !input.peek(Token![::]) {
                input.parse::<Token![:]>()?;
            }
            continue;
        }
        let nested = input.step(|cursor| {
            if let Some((inner, _, _, next)) = cursor.any_group() {
                let expressions = parse_macro_expression_chunks
                    .parse2(inner.token_stream())
                    .unwrap_or_default();
                return Ok((expressions, next));
            }
            let (_, next) = cursor
                .token_tree()
                .ok_or_else(|| cursor.error("expected token tree"))?;
            Ok((Vec::new(), next))
        })?;
        expressions.extend(nested);
    }
    Ok(expressions)
}

fn call_path(callee: &Expr) -> Option<&ExprPath> {
    match callee {
        Expr::Path(expr) => Some(expr),
        Expr::Paren(expr) => call_path(&expr.expr),
        Expr::Group(expr) => call_path(&expr.expr),
        _ => None,
    }
}

fn callback_path(argument: &Expr) -> Option<&ExprPath> {
    match ungroup_expr(argument) {
        Expr::Reference(reference) => callback_path(&reference.expr),
        Expr::Path(path) => Some(path),
        _ => None,
    }
}

fn ungroup_expr(expr: &Expr) -> &Expr {
    match expr {
        Expr::Paren(expr) => ungroup_expr(&expr.expr),
        Expr::Group(expr) => ungroup_expr(&expr.expr),
        _ => expr,
    }
}

fn is_local_closure(expr: &Expr) -> bool {
    match expr {
        Expr::Closure(_) => true,
        Expr::Paren(expr) => is_local_closure(&expr.expr),
        Expr::Group(expr) => is_local_closure(&expr.expr),
        _ => false,
    }
}

fn bare_ident(expr: &Expr) -> Option<&Ident> {
    match expr {
        Expr::Path(expr) if expr.qself.is_none() => expr.path.get_ident(),
        _ => None,
    }
}

fn appended_binding(node: &ExprMethodCall) -> Option<&Ident> {
    match node.args.first()? {
        Expr::Reference(arg) if arg.mutability.is_some() => bare_ident(&arg.expr),
        _ => None,
    }
}

fn future_binding_expr(argument: &Expr) -> &Expr {
    match ungroup_expr(argument) {
        Expr::Reference(expr) => future_binding_expr(&expr.expr),
        Expr::MethodCall(expr)
            if expr.args.is_empty() && (expr.method == "into_iter" || expr.method == "iter") =>
        {
            future_binding_expr(&expr.receiver)
        }
        Expr::MethodCall(expr)
            if expr.method == "drain"
                && expr.args.len() == 1
                && matches!(expr.args.first().map(ungroup_expr), Some(Expr::Range(range))
                    if range.start.is_none() && range.end.is_none()
                    && matches!(range.limits, syn::RangeLimits::HalfOpen(_))) =>
        {
            future_binding_expr(&expr.receiver)
        }
        expr => expr,
    }
}

fn unraw(name: &str) -> &str {
    name.strip_prefix("r#").unwrap_or(name)
}

fn is_method_check(name: &str, arg_count: usize, receiver_args: usize) -> bool {
    METHOD_CHECKS.iter().any(|&(method, arity)| {
        method == name && arity.is_none_or(|arity| arity + receiver_args == arg_count)
    })
}

fn cross_file_callback(name: &str) -> Option<usize> {
    CROSS_FILE_LOOP_HELPERS
        .iter()
        .find_map(|&(helper, index)| (helper == name).then_some(index))
}

fn call_form(path: &syn::Path, name: &str) -> Option<String> {
    match name {
        "spawn" | "spawn_local" | "spawn_blocking" => Some("spawn".into()),
        "join_all" | "try_join_all" | "select_all" | "select_ok" => Some(format!("join:{name}")),
        "iter" if path_contains(path, &["stream"]) => Some("join:iter".into()),
        "from_iter" if path_contains(path, &["FuturesUnordered", "FuturesOrdered"]) => {
            Some("join:from_iter".into())
        }
        _ => None,
    }
}

fn path_contains(path: &syn::Path, names: &[&str]) -> bool {
    path.segments
        .iter()
        .any(|segment| names.contains(&unraw(&segment.ident.to_string())))
}

fn self_type_name(ty: &Type) -> Option<&Ident> {
    match ty {
        Type::Path(ty) => ty.path.segments.last().map(|segment| &segment.ident),
        Type::Paren(ty) => self_type_name(&ty.elem),
        Type::Group(ty) => self_type_name(&ty.elem),
        Type::Reference(ty) => self_type_name(&ty.elem),
        _ => None,
    }
}

fn is_test(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        let path = attr.path();
        path.segments
            .last()
            .is_some_and(|segment| segment.ident == "test")
            || (path.is_ident("cfg")
                && attr
                    .parse_args::<Meta>()
                    .is_ok_and(|meta| is_test_cfg(&meta)))
    })
}

fn is_test_cfg(meta: &Meta) -> bool {
    match meta {
        Meta::Path(path) => path.is_ident("test"),
        Meta::List(list) if list.path.is_ident("all") => list
            .parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
            .is_ok_and(|args| args.iter().any(is_test_cfg)),
        _ => false,
    }
}

fn item_attrs(item: &Item) -> &[Attribute] {
    match item {
        Item::Const(item) => &item.attrs,
        Item::Enum(item) => &item.attrs,
        Item::ExternCrate(item) => &item.attrs,
        Item::Fn(item) => &item.attrs,
        Item::ForeignMod(item) => &item.attrs,
        Item::Impl(item) => &item.attrs,
        Item::Macro(item) => &item.attrs,
        Item::Mod(item) => &item.attrs,
        Item::Static(item) => &item.attrs,
        Item::Struct(item) => &item.attrs,
        Item::Trait(item) => &item.attrs,
        Item::TraitAlias(item) => &item.attrs,
        Item::Type(item) => &item.attrs,
        Item::Union(item) => &item.attrs,
        Item::Use(item) => &item.attrs,
        _ => &[],
    }
}

fn impl_item_attrs(item: &ImplItem) -> &[Attribute] {
    match item {
        ImplItem::Const(item) => &item.attrs,
        ImplItem::Fn(item) => &item.attrs,
        ImplItem::Type(item) => &item.attrs,
        ImplItem::Macro(item) => &item.attrs,
        _ => &[],
    }
}

fn trait_item_attrs(item: &TraitItem) -> &[Attribute] {
    match item {
        TraitItem::Const(item) => &item.attrs,
        TraitItem::Fn(item) => &item.attrs,
        TraitItem::Type(item) => &item.attrs,
        TraitItem::Macro(item) => &item.attrs,
        _ => &[],
    }
}

fn collect_rust_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("failed to read directory {}: {error}", dir.display()));
    for entry in entries {
        let entry = entry
            .unwrap_or_else(|error| panic!("failed to read entry in {}: {error}", dir.display()));
        let path = entry.path();
        let kind = entry.file_type().unwrap_or_else(|error| {
            panic!("failed to read file type for {}: {error}", path.display())
        });
        if kind.is_dir() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_ref()) {
                collect_rust_files(&path, files);
            }
        } else if kind.is_file() && path.extension().is_some_and(|ext| ext == "rs") {
            files.push(path);
        }
    }
}

fn read_source(src_root: &Path, file: &Path) -> (String, String) {
    let relative = file.strip_prefix(src_root).unwrap();
    let path = relative
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    let src = fs::read_to_string(file)
        .unwrap_or_else(|error| panic!("failed to read src/{path}: {error}"));
    (format!("src/{path}"), src)
}

fn scan_files<F: Sync, T: Send>(files: &[F], scan: impl Fn(&F) -> T + Sync) -> Vec<T> {
    let workers = std::thread::available_parallelism().map_or(4, usize::from);
    let chunk = files.len().div_ceil(workers).max(1);
    let scan = &scan;
    std::thread::scope(|threads| {
        let handles: Vec<_> = files
            .chunks(chunk)
            .map(|part| threads.spawn(move || part.iter().map(scan).collect::<Vec<_>>()))
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap())
            .collect()
    })
}

fn scan_tree<F: Sync>(
    files: &[F],
    followed: &[&str],
    read: impl Fn(&F) -> (String, String) + Sync,
) -> (BTreeSet<String>, Vec<Hit>) {
    let files = scan_files(files, read);
    let (checks, candidates) = discover_tree_wrappers(&files, followed);
    let hits = scan_files(&files, |(path, src)| {
        if may_call_check(src, &checks) {
            scan_source_with(path, src, &checks)
        } else {
            Vec::new()
        }
    })
    .into_iter()
    .flatten()
    .collect();
    (candidates, hits)
}

fn discover_tree_wrappers(
    files: &[(String, String)],
    followed: &[&str],
) -> (BTreeSet<String>, BTreeSet<String>) {
    let mut checks = base_checks();
    let mut candidates = BTreeSet::new();
    let mut added = BTreeSet::<String>::new();
    for pass in 0..MAX_WRAPPER_PASSES {
        let discovered = scan_files(files, |(path, src)| {
            if (pass == 0 && may_call_check(src, &checks))
                || added.iter().any(|name| src.contains(name.as_str()))
            {
                exported_wrappers(path, src, &checks)
            } else {
                BTreeSet::new()
            }
        });
        candidates.extend(discovered.into_iter().flatten().filter(|name| {
            !CHECKS.contains(&name.as_str()) && !COMMON_METHODS.contains(&name.as_str())
        }));
        added = followed
            .iter()
            .filter(|&&name| candidates.contains(name) && !checks.contains(name))
            .map(|&name| name.to_owned())
            .collect();
        if added.is_empty() {
            return (checks, candidates);
        }
        checks.extend(added.iter().cloned());
    }
    panic!("cross-file authorization wrapper discovery did not converge");
}

// Every hit needs the call name in the source text, so files without one skip the slow parse.
fn may_call_check(src: &str, checks: &BTreeSet<String>) -> bool {
    checks.iter().any(|name| src.contains(name.as_str()))
        || METHOD_CHECKS.iter().any(|&(name, arity)| {
            if arity.is_none() {
                src.contains(name)
            } else {
                src.match_indices(name).any(|(index, _)| {
                    let suffix = src[index + name.len()..].trim_ascii_start();
                    suffix.starts_with(['(', ')'])
                        || suffix
                            .strip_prefix("as")
                            .is_some_and(|rest| rest.starts_with(char::is_whitespace))
                        || ["/*", "//", "::"]
                            .iter()
                            .any(|prefix| suffix.starts_with(prefix))
                })
            }
        })
}

fn is_placeholder_reason(reason: &str) -> bool {
    reason.eq_ignore_ascii_case(REASON_PLACEHOLDER) || reason.starts_with("TODO")
}

fn parse_allowlist(src: &str) -> Result<Allowlist<'_>, String> {
    let mut allowlist = BTreeMap::new();
    for (index, line) in src.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let number = index + 1;
        let fields: Vec<_> = line.split('|').map(str::trim).collect();
        let [path, func, reason] = fields.as_slice() else {
            return Err(format!(
                "allowlist line {number}: expected path | func | reason"
            ));
        };
        if path.is_empty() || func.is_empty() || reason.is_empty() {
            return Err(format!(
                "allowlist line {number}: path, func and reason are required"
            ));
        }
        if is_placeholder_reason(reason) {
            return Err(format!(
                "allowlist line {number}: reason must explain why the check is allowed"
            ));
        }
        if allowlist.insert((*path, *func), *reason).is_some() {
            return Err(format!(
                "allowlist line {number}: duplicate key {path} | {func}"
            ));
        }
    }
    Ok(allowlist)
}

fn allowlist_failures(hits: &[Hit], allowlist: &Allowlist<'_>) -> String {
    let mut grouped = BTreeMap::<(&str, &str), Vec<&Hit>>::new();
    for hit in hits {
        grouped.entry((&hit.path, &hit.func)).or_default().push(hit);
    }

    let mut message = String::new();
    for ((path, func), hits) in grouped
        .iter()
        .filter(|(key, _)| !allowlist.contains_key(*key))
    {
        writeln!(message, "{path} | {func} | {REASON_PLACEHOLDER}").unwrap();
        for hit in hits {
            writeln!(message, "  {} {}", hit.call, hit.form).unwrap();
        }
    }
    if !message.is_empty() {
        message.insert_str(0, "Unallowlisted per-object authorization checks:\n");
        message.push_str(
            "Use openobserve_core::authz::list (authorize_objects / readable_streams) or add an allowlist entry with a reason.\n",
        );
    }

    let mut stale = allowlist
        .iter()
        .filter(|(key, _)| !grouped.contains_key(*key))
        .peekable();
    if stale.peek().is_some() {
        message.push_str("Stale allowlist entries:\n");
        for ((path, func), reason) in stale {
            writeln!(message, "{path} | {func} | {reason}").unwrap();
        }
    }
    message
}

fn wrapper_classification_failures(
    candidates: &BTreeSet<String>,
    followed: &[&str],
    unfollowed: &[(&str, &str)],
) -> String {
    let mut failures = String::new();
    for name in candidates {
        let name = name.as_str();
        if CHECKS.contains(&name)
            || followed.contains(&name)
            || unfollowed.iter().any(|&(entry, _)| entry == name)
        {
            continue;
        }
        writeln!(failures, "({name:?}, {REASON_PLACEHOLDER:?}),").unwrap();
    }
    if !failures.is_empty() {
        failures.push_str(
            "classify new cross-file check wrappers in FOLLOWED_WRAPPERS or UNFOLLOWED_WRAPPERS\n",
        );
    }
    let followed_entries = followed.iter().map(|&name| ("FOLLOWED_WRAPPERS", name));
    let unfollowed_entries = unfollowed
        .iter()
        .map(|&(name, _)| ("UNFOLLOWED_WRAPPERS", name));
    for (list, name) in followed_entries.chain(unfollowed_entries) {
        if !CHECKS.contains(&name) && !candidates.contains(name) {
            writeln!(failures, "stale {list} entry: {name}").unwrap();
        }
    }
    failures
}

fn assert_hit(src: &str, func: &str, call: &str, form: &str) {
    let hits = scan_source("fixture.rs", src);
    assert_eq!(hits.len(), 1, "{hits:?}");
    let hit = &hits[0];
    assert_eq!(hit.path, "fixture.rs");
    assert_eq!(hit.func, func);
    assert_eq!(hit.call, call);
    assert_eq!(hit.form, form);
}

#[test]
fn per_object_check_loops_are_allowlisted() {
    let start = Instant::now();
    let src_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut files = Vec::new();
    collect_rust_files(&src_root, &mut files);
    files.sort_unstable();

    let (candidates, hits) = scan_tree(&files, FOLLOWED_WRAPPERS, |file| {
        read_source(&src_root, file)
    });
    eprintln!(
        "authz loop guard scanned {} files and found {} wrapper candidates ({} followed, {} unfollowed) and {} hits in {:?}",
        files.len(),
        candidates.len(),
        FOLLOWED_WRAPPERS.len(),
        UNFOLLOWED_WRAPPERS.len(),
        hits.len(),
        start.elapsed()
    );
    let mut failures = parse_allowlist(ALLOWLIST).map_or_else(
        |error| format!("{error}\n"),
        |allowlist| allowlist_failures(&hits, &allowlist),
    );
    failures.push_str(&wrapper_classification_failures(
        &candidates,
        FOLLOWED_WRAPPERS,
        UNFOLLOWED_WRAPPERS,
    ));
    if !failures.is_empty() {
        panic!("{failures}");
    }
}

#[test]
fn detects_for_loop() {
    const SRC: &str = r"
        async fn read(ids: Ids) {
            for id in ids {
                checker.can_read_stream(org, id).await;
            }
        }
    ";
    assert_hit(SRC, "read", "can_read_stream", "for");
}

#[test]
fn detects_buffered_stream_adapter() {
    const SRC: &str = r"
        async fn read(ids: Ids) {
            futures::stream::iter(ids)
                .map(|id| async move { checker.can_read_stream(org, id).await })
                .buffer_unordered(16);
        }
    ";
    assert_hit(SRC, "read", "can_read_stream", "adapter:map");
}

#[test]
fn detects_paths_passed_to_adapters() {
    const WRAPPER: &str = r"
        impl Reader {
            fn allowed(id: Id) -> Option<Id> { check_permissions(id).then_some(id) }
            fn read(ids: Ids) {
                ids.iter().filter_map(Self::allowed);
                ids.iter().filter_map(other::allowed);
            }
        }
    ";
    const CHECK: &str = r"
        fn read(ids: Ids) { stream::iter(ids).then(check_object); }
    ";
    assert_hit(WRAPPER, "Reader::read", "allowed", "adapter:filter_map");
    assert_hit(CHECK, "read", "check_object", "adapter:then");
}

#[test]
fn detects_checks_in_additional_adapters() {
    for adapter in [
        "retain_mut",
        "sort_by_key",
        "sort_by_cached_key",
        "max_by_key",
        "min_by_key",
        "reduce",
        "dedup_by_key",
        "try_filter_map",
        "filter_map_ok",
    ] {
        let src = format!("fn read(ids: Ids) {{ ids.{adapter}(|id| check_permissions(id)); }}");
        assert_hit(
            &src,
            "read",
            "check_permissions",
            &format!("adapter:{adapter}"),
        );
    }
}

#[test]
fn detects_fan_out_in_ufcs_calls() {
    const SPAWN: &str = r"
        fn read() { JoinSet::spawn(jobs, async move { can_read_stream(org, id).await }); }
    ";
    const COLLECTION: &str = r"
        fn read() {
            Vec::push(&mut futs, check_permissions(org, id));
            join_all(futs);
        }
    ";

    for (callee, arguments, adapter) in [
        (
            "Iterator::map",
            "ids.iter(), |id| check_permissions(org, id)",
            "map",
        ),
        (
            "futures::StreamExt::for_each_concurrent",
            "s, 8, |id| async move { check_permissions(org, id).await }",
            "for_each_concurrent",
        ),
        (
            "StreamExt::then",
            "s, |id| check_permissions(org, id)",
            "then",
        ),
        (
            "<I as Iterator>::filter",
            "it, |id| check_permissions(org, id)",
            "filter",
        ),
        ("<I>::map", "it, |id| check_permissions(org, id)", "map"),
    ] {
        let src = format!("fn read() {{ {callee}({arguments}); }}");
        assert_hit(
            &src,
            "read",
            "check_permissions",
            &format!("adapter:{adapter}"),
        );
    }

    assert_hit(SPAWN, "read", "can_read_stream", "spawn");
    assert_hit(COLLECTION, "read", "check_permissions", "collected");
}

#[test]
fn ignores_qualified_calls_without_fan_out() {
    const SRC: &str = r"
        async fn read(id: Id) {
            Vec::with_capacity(check_permissions(org, id).await);
            other::helper(ids, |id| check_permissions(org, id));
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn detects_prebuilt_futures_for_join_all() {
    const SRC: &str = r"
        async fn read(ids: Ids) {
            let futs: Vec<_> = ids.iter().map(|id| check_permissions(org, id)).collect();
            join_all(futs).await;
        }
    ";
    assert_hit(SRC, "read", "check_permissions", "adapter:map");
}

#[test]
fn keeps_loop_hits_in_future_literals() {
    const VEC: &str = r"
        async fn read(ids: Ids) {
            for id in ids {
                let checks = vec![check_permissions(org, id)];
            }
        }
    ";
    const TUPLE: &str = r"
        async fn read(ids: Ids) {
            for id in ids {
                let t = (check_permissions(org, id).await, 1);
            }
        }
    ";
    const SPAWNED: &str = r"
        async fn read(id: Id) {
            let handles = vec![tokio::spawn(async move { check_permissions(org, id).await })];
        }
    ";
    assert_hit(VEC, "read", "check_permissions", "for");
    assert_hit(TUPLE, "read", "check_permissions", "for");
    assert_hit(SPAWNED, "read", "check_permissions", "spawn");
}

#[test]
fn detects_bound_vec_futures_for_join_all() {
    const SRC: &str = r"
        async fn read(a: Id, b: Id) {
            let checks = vec![check_permissions(org, a), check_permissions(org, b)];
            join_all(checks).await;
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert_eq!(hits.len(), 2, "{hits:?}");
    for hit in hits {
        assert_eq!(hit.func, "read");
        assert_eq!(hit.call, "check_permissions");
        assert_eq!(hit.form, "join:join_all");
    }
}

#[test]
fn detects_futures_stored_by_a_constructor() {
    const SRC: &str = r"
        async fn read(a: Id, b: Id) {
            let checks = Vec::from([check_permissions(org, a), can_read_stream(org, b)]);
            join_all(checks).await;
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert_eq!(hits.len(), 2, "{hits:?}");
    for (hit, call) in hits.iter().zip(["check_permissions", "can_read_stream"]) {
        assert_eq!(hit.func, "read");
        assert_eq!(hit.call, call);
        assert_eq!(hit.form, "join:join_all");
    }
}

#[test]
fn detects_futures_stored_by_collect() {
    const SRC: &str = r"
        async fn read(a: Id) {
            let futs: Vec<_> = std::iter::once(check_permissions(org, a)).collect();
            join_all(futs).await;
        }
    ";
    assert_hit(SRC, "read", "check_permissions", "join:join_all");
}

#[test]
fn ignores_eager_checks_stored_as_awaited_results() {
    const SRC: &str = r"
        async fn read(s: Stream) {
            let results = [checker.can_read_stream(user, s).await];
            stream::iter(results);
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn detects_deferred_checks_inside_awaited_initializers() {
    const ASYNC_BLOCK: &str = r"
        async fn read(id: Id) {
            let checks = vec![async move { check_permissions(org, id).await }];
            join_all(checks).await;
        }
    ";
    assert_hit(ASYNC_BLOCK, "read", "check_permissions", "join:join_all");

    for deferred in [
        "async move { check_permissions(org, id).await }",
        "async move |id| check_permissions(org, id).await",
    ] {
        let src = format!(
            "async fn read() {{
                let checks = wrap({deferred}, can_read_stream(org, id)).await;
                stream::iter(checks);
            }}"
        );
        assert_hit(&src, "read", "check_permissions", "join:iter");
    }
}

#[test]
fn detects_bound_array_and_tuple_futures_in_join_arguments() {
    const ARRAY: &str = r"
        fn read(id: Id) {
            let checks = [check_permissions(org, id)];
            {
                let checks = load_futures();
                join_all(checks);
            }
            FuturesUnordered::from_iter((checks).into_iter());
        }
    ";
    const TUPLE: &str = r"
        fn read(id: Id) {
            let checks = (check_permissions(org, id),);
            stream::iter(&((checks).iter()));
        }
    ";
    assert_hit(ARRAY, "read", "check_permissions", "join:from_iter");
    assert_hit(TUPLE, "read", "check_permissions", "join:iter");
}

#[test]
fn ignores_unjoined_and_rebound_future_bindings() {
    const SRC: &str = r"
        async fn read(a: Id) {
            let checks = vec![check_permissions(org, a)];
            log(checks);
            let checks = vec![check_permissions(org, a)];
            let checks = load_futures();
            join_all(checks).await;
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn detects_futures_pushed_for_join_all() {
    const SRC: &str = r"
        async fn read(id: Id) {
            let mut futs = Vec::new();
            if enabled {
                futs.push(async move { check_permissions(org, id).await });
            }
            join_all(futs).await;
        }
    ";
    assert_hit(SRC, "read", "check_permissions", "collected");
}

#[test]
fn detects_futures_extended_for_try_join_all_once() {
    const SRC: &str = r"
        async fn read(a: Id) {
            let mut futs = Vec::new();
            futs.extend([check_permissions(org, a)]);
            try_join_all(futs).await;
        }
    ";
    assert_hit(SRC, "read", "check_permissions", "collected");
}

#[test]
fn detects_futures_added_by_collection_mutations() {
    for mutation in [
        "push(check_permissions(org, id))",
        "push_back(check_permissions(org, id))",
        "push_front(check_permissions(org, id))",
        "extend([check_permissions(org, id)])",
        "insert(0, check_permissions(org, id))",
        "append(&mut vec![check_permissions(org, id)])",
    ] {
        let src = format!(
            "async fn read() {{
                let mut futs = Vec::new();
                futs.push(can_read_stream(org, id).await);
                futs.{mutation};
                stream::iter(futs);
            }}"
        );
        assert_hit(&src, "read", "check_permissions", "join:iter");
    }
}

#[test]
fn moves_appended_futures_into_the_receiving_binding() {
    const SRC: &str = r"
        fn read() {
            let mut futs = vec![check_permissions(org, a)];
            let mut other = Vec::from([can_read_stream(org, b)]);
            futs.append(&mut other);
            stream::iter(other);
            join_all(futs);
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert_eq!(hits.len(), 2, "{hits:?}");
    for (hit, call) in hits.iter().zip(["check_permissions", "can_read_stream"]) {
        assert_eq!(hit.func, "read");
        assert_eq!(hit.call, call);
        assert_eq!(hit.form, "join:join_all");
    }
}

#[test]
fn detects_join_arguments_through_expression_macros() {
    const SRC: &str = r"
        async fn read(id: Id) {
            futures::future::join_all(vec![check_permissions(org, id)]).await;
        }
    ";
    assert_hit(SRC, "read", "check_permissions", "join:join_all");
}

#[test]
fn detects_spawn_inside_and_outside_loops() {
    const IN_LOOP: &str = r"
        async fn read(ids: Ids) {
            for id in ids {
                tokio::spawn(async move { is_allowed(org, id).await });
            }
        }
    ";
    const STANDALONE: &str = r"
        async fn read(id: Id) {
            tokio::spawn(async move { is_allowed(org, id).await });
        }
    ";
    assert_hit(IN_LOOP, "read", "is_allowed", "spawn");
    assert_hit(STANDALONE, "read", "is_allowed", "spawn");
}

#[test]
fn detects_while_body() {
    const SRC: &str = r"
        async fn read() {
            while let Some(id) = rx.recv().await {
                security_allowed(org, id).await;
            }
        }
    ";
    assert_hit(SRC, "read", "security_allowed", "while");
}

#[test]
fn detects_checks_in_while_conditions() {
    const CONDITION: &str = r"
        async fn read() {
            while check_permissions(org, next_id()).await {
                process().await;
            }
        }
    ";
    const LET_CHAIN: &str = r"
        async fn read() {
            while let Some(id) = cur.next() && can_read_stream(org, id).await {}
        }
    ";
    assert_hit(CONDITION, "read", "check_permissions", "while");
    assert_hit(LET_CHAIN, "read", "can_read_stream", "while");
}

#[test]
fn detects_loop_body() {
    const SRC: &str = r"
        async fn read() {
            loop {
                checks.org_wide(org, user, query).await;
            }
        }
    ";
    assert_hit(SRC, "read", "org_wide", "loop");
}

#[test]
fn detects_named_checks_in_both_call_forms() {
    const SRC: &str = r"
        async fn read(ids: Ids) {
            for id in ids {
                check_folder_write_permissions(org, user, id).await;
                auth.check_cipher_key_permissions(id).await;
                auth.org_wide(id).await;
            }
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    let calls: Vec<_> = hits.iter().map(|hit| hit.call.as_str()).collect();
    assert_eq!(
        calls,
        [
            "check_folder_write_permissions",
            "check_cipher_key_permissions",
            "org_wide",
        ]
    );
}

#[test]
fn detects_check_in_macro_in_loop() {
    const SRC: &str = r"
        async fn read(ids: Ids) {
            for id in ids {
                assert!(check_permissions(org, id).await);
            }
        }
    ";
    assert_hit(SRC, "read", "check_permissions", "for");
}

#[test]
fn detects_check_in_statement_list_macro() {
    const SRC: &str = r"
        async fn read(ids: Ids) {
            for id in ids {
                run! {
                    let allowed = check_permissions(org, id).await;
                    allowed
                }
            }
        }
    ";
    assert_hit(SRC, "read", "check_permissions", "for");
}

#[test]
fn qualifies_impl_method() {
    const SRC: &str = r"
        impl Foo {
            async fn bar(&self, ids: Ids) {
                for id in ids {
                    self.object(org, user, query, id).await;
                }
            }
        }
    ";
    assert_hit(SRC, "Foo::bar", "object", "for");
}

#[test]
fn detects_qualified_method_checks_with_receiver_arguments() {
    for (call, name) in [
        (
            "LegacyChecks::object(checks, org, user, query, object)",
            "object",
        ),
        ("<C as ListChecks>::read(checks, a, b, c, d, e)", "read"),
        ("LegacyChecks::org_wide(checks)", "org_wide"),
    ] {
        let src = format!("fn fetch(ids: Ids) {{ for id in ids {{ {call}; }} }}");
        assert!(may_call_check(&src, &base_checks()), "{call}");
        assert_hit(&src, "fetch", name, "for");
    }
}

#[test]
fn ignores_arity_mismatches_and_local_functions_named_like_method_checks() {
    const SRC: &str = r"
        impl Reader {
            fn fetch(ids: Ids) {
                for id in ids {
                    store::read(key);
                    LegacyChecks::object(org, user, query, id);
                    object(checks, org, user, query, id);
                    Self::object(checks, org, user, query, id);
                    self::read(checks, a, b, c, d, e);
                }
            }
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn qualifies_nested_function_in_trait_default_method() {
    const SRC: &str = r"
        mod auth {
            trait Reader {
                fn read(&self) {
                    fn inner() {
                        loop {
                            checks.can_read(id);
                        }
                    }
                }
            }
        }
    ";
    assert_hit(SRC, "auth::Reader::read::inner", "can_read", "loop");
}

#[test]
fn detects_check_wrapper_in_for_loop() {
    const SRC: &str = r"
        async fn allowed(id: Id) -> bool { check_permissions(id).await }
        async fn read(ids: Ids) {
            for id in ids {
                allowed(id).await;
            }
        }
    ";
    assert_hit(SRC, "read", "allowed", "for");
}

#[test]
fn detects_transitive_check_wrapper_in_adapter() {
    const SRC: &str = r"
        async fn outer(id: Id) -> bool { allowed(id).await }
        async fn read(ids: Ids) {
            ids.map(|id| async move { outer(id).await });
        }
        async fn allowed(id: Id) -> bool { check_permissions(id).await }
    ";
    assert_hit(SRC, "read", "outer", "adapter:map");
}

#[test]
fn exported_wrappers_are_followed_across_files() {
    const A: &str = r"
        pub async fn can_edit_folder(org: Org, folder: Folder) -> bool {
            check_permissions(org, folder).await
        }
        async fn private_folder_check(org: Org, folder: Folder) -> bool {
            check_permissions(org, folder).await
        }
        pub async fn folder_score(org: Org, folder: Folder) -> u8 {
            u8::from(can_edit_folder(org, folder).await)
        }
    ";
    const B: &str = r"
        async fn edit_folders(folders: Folders) {
            for f in folders {
                can_edit_folder(org, f).await;
                editor.can_edit_folder(org, f).await;
            }
        }
    ";
    let files = [("a.rs", A), ("b.rs", B)];
    let read = |&(path, src): &(&str, &str)| (path.to_owned(), src.to_owned());
    let (exported, hits) = scan_tree(&files, &[], read);
    assert_eq!(exported, BTreeSet::from(["can_edit_folder".to_owned()]));
    assert!(hits.is_empty(), "{hits:?}");

    let (candidates, hits) = scan_tree(&files, &["can_edit_folder"], read);
    assert_eq!(candidates, exported);
    assert_eq!(hits.len(), 2, "{hits:?}");
    for hit in hits {
        assert_eq!(hit.path, "b.rs");
        assert_eq!(hit.func, "edit_folders");
        assert_eq!(hit.call, "can_edit_folder");
        assert_eq!(hit.form, "for");
    }
}

#[test]
fn scan_tree_detects_method_checks_with_spaced_suffixes() {
    for suffix in [" /* c */ ", " ", " // c\n", "::<T>"] {
        let src = format!(
            "async fn fetch(ids: Ids) {{
                for id in ids {{ checks.object{suffix}(org, user, query, id).await; }}
            }}"
        );
        let (_, hits) = scan_tree(&[src], &[], |src| ("fixture.rs".to_owned(), src.clone()));
        assert_eq!(hits.len(), 1, "{suffix:?}: {hits:?}");
        assert_eq!(hits[0].func, "fetch");
        assert_eq!(hits[0].call, "object");
        assert_eq!(hits[0].form, "for");
    }
}

#[test]
fn exports_visible_wrappers_with_boolean_like_returns() {
    const SRC: &str = r"
        mod auth {
            pub(super) fn result(id: Id) -> std::result::Result<bool, Error> {
                Ok(with_option(id).is_some())
            }
            pub(crate) fn with_option(id: Id) -> Option<Id> {
                check_permissions(id).then_some(id)
            }
            pub(in crate::auth) fn with_future(id: Id) -> impl Future<Output = bool> {
                async move { check_permissions(id).await }
            }
            trait Reader {
                fn default_check(&self, id: Id) -> bool { check_permissions(id) }
                fn overridden_check(&self, id: Id) -> bool;
            }
            impl Reader for Auth {
                fn overridden_check(&self, id: Id) -> bool { check_permissions(id) }
            }
            impl Auth {
                pub(crate) fn inherent_check(&self, id: Id) -> bool { check_permissions(id) }
                fn private_check(&self, id: Id) -> bool { check_permissions(id) }
                fn unrelated(&self, id: Id) -> bool { check_permissions(id) }
            }
            impl Other {
                pub fn unrelated(&self, id: Id) -> bool { true }
            }
            pub fn get(id: Id) -> bool { check_permissions(id) }
            #[cfg(test)]
            pub fn test_check(id: Id) -> bool { check_permissions(id) }
        }
    ";
    let (exported, _) = scan_tree(&[SRC], &[], |src| {
        ("fixture.rs".to_owned(), (*src).to_owned())
    });
    assert_eq!(
        exported,
        BTreeSet::from(
            [
                "default_check",
                "inherent_check",
                "overridden_check",
                "result",
                "with_future",
                "with_option",
            ]
            .map(str::to_owned)
        )
    );
}

#[test]
fn detects_wrappers_in_impl_and_trait_macro_bodies() {
    const SRC: &str = r"
        trait Reader {
            fn outer(&self, id: Id) { assert!(self.allowed(id)); }
        }
        impl Foo {
            fn allowed(&self, id: Id) { checks.object(org, user, query, id); }
        }
        fn read(ids: Ids, reader: Reader) {
            for id in ids {
                reader.outer(id);
            }
        }
    ";
    assert_hit(SRC, "read", "outer", "for");
}

#[test]
fn ignores_check_wrapper_outside_fan_out() {
    const SRC: &str = r"
        async fn allowed(id: Id) -> bool { check_permissions(id).await }
        async fn read(id: Id) { allowed(id).await; }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn ignores_common_wrapper_method_names() {
    const SRC: &str = r"
        fn get(id: Id) -> bool { check_permissions(id) }
        fn read(ids: Ids) {
            for id in ids {
                cache.get(id);
                get(id);
            }
        }
    ";
    assert_hit(SRC, "read", "get", "for");
}

#[test]
fn detects_check_passed_to_fan_out_helper() {
    const SRC: &str = r"
        async fn each<F, Fut>(ids: Vec<Id>, check: F) where F: Fn(Id) -> Fut {
            for id in ids {
                check(id).await;
            }
        }
        async fn caller(ids: Ids) { each(ids, |id| check_permissions(id)).await; }
        async fn process_all(ids: Ids) { each(ids, |id| process(id)).await; }
    ";
    assert_hit(SRC, "caller", "check_permissions", "via:each");
}

#[test]
fn detects_async_fn_mut_fan_out_and_ignores_eager_checks() {
    const SRC: &str = r"
        async fn write_moves(
            moves: &[(Downtime, i64)],
            mut write: impl AsyncFnMut(&Downtime, i64) -> bool,
        ) {
            for (moved, expected) in moves { write(moved, *expected).await; }
        }
        async fn caller(moves: &[(Downtime, i64)]) {
            write_moves(moves, async |d, e| check_permissions(org, d).await).await;
        }
        async fn eager(id: Id) {
            let save = async |d, e| save_move(d, e).await;
            write_moves(&load_moves(check_permissions(org, id).await), save).await;
        }
    ";
    assert_hit(SRC, "caller", "check_permissions", "via:write_moves");
}

#[test]
fn detects_fn_pointer_fan_out() {
    const SRC: &str = r"
        fn each(ids: Ids, f: fn(Id) -> bool) {
            for id in ids { f(id); }
        }
        fn caller(ids: Ids) { each(ids, |id| can_read_stream(org, id)); }
    ";
    assert_hit(SRC, "caller", "can_read_stream", "via:each");
}

#[test]
fn detects_check_passed_to_fan_out_method() {
    const SRC: &str = r"
        impl Jobs {
            fn each<F>(&self, check: F) {
                let mut futures = Vec::new();
                futures.push(check(id));
                join_all(futures);
            }
        }
        fn caller(jobs: Jobs) { jobs.each(|id| check_permissions(id)); }
    ";
    assert_hit(SRC, "caller", "check_permissions", "via:each");
}

#[test]
fn detects_fan_out_methods_with_enclosing_type_parameters() {
    const IMPL: &str = r"
        impl<F> Runner<F> where F: Fn(Id) {
            fn each(&self, ids: Ids, check: F) {
                for id in ids { check(id); }
            }
        }
        fn caller(runner: Runner<fn(Id)>, ids: Ids) {
            runner.each(ids, |id| { check_permissions(org, id); });
        }
    ";
    const TRAIT: &str = r"
        trait Runner<F: Fn(Id)> {
            fn each(&self, ids: Ids, check: F) {
                for id in ids { check(id); }
            }
        }
        fn caller(runner: impl Runner<fn(Id)>, ids: Ids) {
            runner.each(ids, |id| { check_permissions(org, id); });
        }
    ";
    for src in [IMPL, TRAIT] {
        assert_hit(src, "caller", "check_permissions", "via:each");
    }
}

#[test]
fn ignores_eager_checks_in_helper_arguments() {
    const SRC: &str = r"
        fn render(org_id: &str, rows: Vec<Row>) {
            for row in rows { log(org_id, row); }
        }
        fn each(ids: Ids, f: impl FnMut(Id)) {
            for id in ids { f(id); }
        }
        async fn caller() {
            render(org, check_permissions(org, id).await);
            other::render(org, |id| check_permissions(org, id));
            each(load_ids(check_permissions(org, id).await), |id| log(id));
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn detects_transitive_fan_out_helpers() {
    const SRC: &str = r"
        fn outer<F: Fn(Id)>(ids: Ids, f: &F) { middle(ids, f); }
        fn middle(ids: Ids, f: &dyn Fn(Id)) { each(ids, f); }
        fn each(ids: Ids, f: impl FnOnce(Id)) {
            for id in ids { f(id); }
        }
        fn caller(ids: Ids) { outer(ids, |id| can_read_stream(org, id)); }
    ";
    assert_hit(SRC, "caller", "can_read_stream", "via:outer");
}

#[test]
fn ignores_forwarding_to_qualified_function() {
    const SRC: &str = r"
        fn each(ids: Ids, f: impl Fn(Id)) {
            for id in ids { f(id); }
        }
        fn fwd(ids: Ids, f: impl Fn(Id)) { other_mod::each(ids, f); }
        fn caller(ids: Ids) { fwd(ids, |id| check_permissions(org, id)); }
        fn direct(ids: Ids) { other_mod::each(ids, |id| check_permissions(org, id)); }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn detects_fan_out_in_self_qualified_helper_calls() {
    const SRC: &str = r"
        fn each(ids: Ids, f: impl Fn(Id)) {
            for id in ids { f(id); }
        }
        fn caller(ids: Ids) { self::each(ids, |id| check_permissions(org, id)); }
    ";
    assert_hit(SRC, "caller", "check_permissions", "via:each");
}

#[test]
fn detects_async_block_passed_to_fan_out_helper() {
    const SRC: &str = r"
        fn each<F>(ids: Ids, run: &F) {
            for id in ids { process(id, run); }
        }
        fn caller(ids: Ids) { each(ids, async move { check_permissions(org, id).await }); }
    ";
    assert_hit(SRC, "caller", "check_permissions", "via:each");
}

#[test]
fn detects_wrapped_deferred_arguments_to_fan_out_helpers() {
    const BORROWED: &str = r"
        fn each(ids: Ids, f: &dyn Fn(Id)) {
            for id in ids { f(id); }
        }
        fn caller(ids: Ids) {
            each(ids, (&|id| { check_permissions(org, id); }));
        }
    ";
    const PINNED: &str = r"
        async fn each<F: Future<Output = bool>>(ids: Ids, f: F) {
            for id in ids { run(id, &f).await; }
        }
        async fn caller(ids: Ids, id: Id) {
            each(ids, Box::pin(async move { check_permissions(org, id).await })).await;
        }
    ";
    assert_hit(BORROWED, "caller", "check_permissions", "via:each");
    assert_hit(PINNED, "caller", "check_permissions", "via:each");
}

#[test]
fn detects_local_check_closures() {
    const DIRECT: &str = r"
        async fn read(ds: Docs) {
            let ok = |id| check_permissions(org, id);
            for d in ds { ok(&d.id).await; }
        }
    ";
    const ASYNC: &str = r"
        fn authorized(id: Id) -> bool { can_read_stream(org, id) }
        async fn read(ds: Docs) {
            let ok = |id| async move { authorized(id) };
            for d in ds { ok(&d.id).await; }
        }
        fn unrelated(ids: Ids) {
            for id in ids { ok(id); }
        }
    ";
    assert_hit(DIRECT, "read", "ok", "for");
    assert_hit(ASYNC, "read", "ok", "for");
}

#[test]
fn ignores_test_only_cfg_and_keeps_other_cfgs() {
    const SRC: &str = r#"
        #[cfg(all(test, feature = "enterprise"))]
        mod tests {
            fn allowed(id: Id) { check_permissions(id); }
            fn test_loop() { loop { check_permissions(id); } }
        }
        #[cfg(all(feature = "x", all(test, feature = "y")))]
        fn nested_test() { loop { check_permissions(id); } }
        #[cfg(any(test, feature = "x"))]
        #[cfg(not(test))]
        fn f() { loop { allowed(id); check_permissions(id); } }
    "#;
    assert_hit(SRC, "f", "check_permissions", "loop");
}

#[test]
fn ignores_checks_outside_fan_out() {
    const SRC: &str = r"
        async fn read(id: Id) {
            check_permissions(org, id).await;
            for id in ids {
                process(id).await;
            }
            for id in check_permissions(org, id).await {
                process(id).await;
            }
            futs.push(async move { check_permissions(org, id).await });
            for id in ids {
                fn declared_in_loop() {
                    check_permissions(org, id);
                }
            }
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn ignores_test_items_and_unrelated_object_method() {
    const SRC: &str = r"
        #[cfg(test)]
        mod tests {
            async fn read(ids: Ids) {
                for id in ids {
                    check_permissions(org, id).await;
                }
            }
        }
        #[tokio::test]
        async fn read(ids: Ids) {
            for id in ids {
                check_permissions(org, id).await;
            }
        }
        async fn unrelated(ids: Ids) {
            for id in ids {
                obj.object(org, id);
            }
        }
    ";
    let hits = scan_source("fixture.rs", SRC);
    assert!(hits.is_empty(), "{hits:?}");
}

#[test]
fn rejects_empty_allowlist_reason_and_duplicate_key() {
    assert!(parse_allowlist("src/foo.rs | read | ").is_err());
    assert!(parse_allowlist("src/foo.rs | read | TODO reason").is_err());
    assert!(parse_allowlist("src/foo.rs | read | todo Reason").is_err());
    assert!(parse_allowlist("src/foo.rs | read | TODO fill this in").is_err());
    assert!(parse_allowlist("src/foo.rs | read | first\nsrc/foo.rs | read | second").is_err());
}

#[test]
fn reports_missing_and_stale_allowlist_entries() {
    let hits = [Hit {
        path: "a".into(),
        func: "f".into(),
        call: "check_permissions".into(),
        form: "for".into(),
    }];

    let empty = parse_allowlist("").unwrap();
    let failures = allowlist_failures(&hits, &empty);
    assert!(failures.contains("Unallowlisted"), "{failures}");
    assert!(failures.contains("a | f | TODO reason"), "{failures}");

    let with_orphan = parse_allowlist("a | f | reason\nb | g | reason").unwrap();
    let failures = allowlist_failures(&hits, &with_orphan);
    assert!(failures.contains("Stale allowlist entries"), "{failures}");
    assert!(failures.contains("b | g | reason"), "{failures}");
    assert!(!failures.contains("Unallowlisted"), "{failures}");

    let matching = parse_allowlist("a | f | reason").unwrap();
    let failures = allowlist_failures(&hits, &matching);
    assert!(failures.is_empty(), "{failures}");
}

#[test]
fn wrappers_resolve_only_to_this_file() {
    const SELF_CALL: &str = r"
        impl Reader {
            async fn allowed(id: Id) -> bool {
                check_permissions(id).await
            }
            async fn read(ids: Ids) {
                for id in ids {
                    Self::allowed(id).await;
                }
            }
        }
    ";
    const OTHER_MODULE: &str = r"
        async fn allowed(id: Id) -> bool {
            check_permissions(id).await
        }
        async fn read(ids: Ids) {
            for id in ids {
                service::allowed(id).await;
            }
        }
    ";
    const IMPORTED: &str = r"
        async fn search(id: Id) -> bool {
            check_permissions(id).await
        }
        async fn values(ids: Ids) {
            use crate::service::search;
            for id in ids {
                search(id).await;
            }
        }
    ";
    assert_hit(SELF_CALL, "Reader::read", "allowed", "for");
    for src in [OTHER_MODULE, IMPORTED] {
        let hits = scan_source("fixture.rs", src);
        assert!(hits.is_empty(), "{hits:?}");
    }
}

#[test]
fn method_wrappers_need_a_same_file_method() {
    const SRC: &str = r"
        async fn values(id: Id) -> bool {
            check_permissions(id).await
        }
        impl Auth {
            async fn folder(&self, id: Id) -> bool {
                check_permissions(id).await
            }
        }
        async fn read(auth: Auth, ids: Ids, map: Map) {
            for id in ids {
                auth.folder(id).await;
                map.values();
            }
        }
    ";
    assert_hit(SRC, "read", "folder", "for");
}

#[test]
fn detects_check_closure_forwarded_into_a_loop() {
    const SRC: &str = r"
        async fn fallback_one<F>(fallback: &F, id: Id) -> bool {
            fallback(id).await
        }
        async fn permissions_with<F>(ids: Ids, fallback: F) {
            for id in ids {
                fallback_one(&fallback, id).await;
            }
        }
        async fn load(ids: Ids) {
            permissions_with(ids, |id| can_read_stream(org, id)).await;
        }
    ";
    assert_hit(SRC, "load", "can_read_stream", "via:permissions_with");
}

#[test]
fn reports_missing_and_stale_wrapper_classifications() {
    assert!(
        UNFOLLOWED_WRAPPERS
            .iter()
            .all(|&(_, reason)| !is_placeholder_reason(reason))
    );
    let candidates = BTreeSet::from(["unclassified".to_owned(), "fleet_allowed".to_owned()]);
    let failures = wrapper_classification_failures(
        &candidates,
        &["stale_followed"],
        &[
            ("stale_unfollowed", "reason"),
            ("can_read_stream", "base check"),
        ],
    );
    assert_eq!(
        failures,
        concat!(
            "(\"unclassified\", \"TODO reason\"),\n",
            "classify new cross-file check wrappers in FOLLOWED_WRAPPERS or UNFOLLOWED_WRAPPERS\n",
            "stale FOLLOWED_WRAPPERS entry: stale_followed\n",
            "stale UNFOLLOWED_WRAPPERS entry: stale_unfollowed\n",
        )
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_select_futures_guards_and_handlers_in_loops() {
        for (arm, call) in [
            (
                "Ok(id) = check_permissions(id) => handle(id)",
                "check_permissions",
            ),
            ("_ = recv(), if can_read(id) => handle(id)", "can_read"),
            (
                "_ = recv() => { can_read_stream(id).await }",
                "can_read_stream",
            ),
            (
                "_ = recv() => {}, else => check_object(id).await",
                "check_object",
            ),
            (
                "None = recv() => {} Some(id) = recv() => { check_permissions(id).await }",
                "check_permissions",
            ),
        ] {
            let src =
                format!("async fn read() {{ loop {{ tokio::select! {{ biased; {arm} }} }} }}");
            assert_hit(&src, "read", call, "loop");
        }
    }

    #[test]
    fn ignores_one_check_in_select_outside_fan_out() {
        let src = "async fn read() { tokio::select! { _ = check_permissions(id) => {} } }";
        let hits = scan_source("fixture.rs", src);
        assert!(hits.is_empty(), "{hits:?}");
    }

    #[test]
    fn detects_macro_expression_lists_and_fallback_chunks() {
        for invocation in [
            "tokio::join!(receive(), check_permissions(id))",
            "futures::join!(check_permissions(id), receive())",
            "tokio::try_join!(receive(), check_permissions(id))",
            "vec![check_permissions(id); count]",
            "matches!(answer, Some(id) if check_permissions(id))",
            "assert_eq!(a, b, \"{}\", check_permissions(id))",
            "format!(\"{}\", answer = check_permissions(id))",
            "mixed!(field => invalid; check_permissions(id), unrelated())",
            "mixed!(check_permissions(id) => unrelated())",
        ] {
            let src = format!("fn read() {{ for id in ids {{ {invocation}; }} }}");
            assert_hit(&src, "read", "check_permissions", "for");
        }
    }

    #[test]
    fn detects_checks_inside_json_object_macros() {
        for invocation in [
            r#"serde_json::json!({"a": check_permissions(id).await, "b": 1})"#,
            r#"json!([{"nested": {"deep": check_permissions(id)}}])"#,
            r#"json!({"list": [1, check_permissions(id).await]})"#,
        ] {
            let src = format!("async fn read() {{ for id in ids {{ {invocation}; }} }}");
            assert_hit(&src, "read", "check_permissions", "for");
        }
        let src = r#"fn read() { for id in ids { json!({"a": 1, "b": [2, 3]}); } }"#;
        let hits = scan_source("fixture.rs", src);
        assert!(hits.is_empty(), "{hits:?}");
    }

    #[test]
    fn detects_check_in_computed_json_key() {
        let src = r"
            async fn read() {
                for id in ids {
                    serde_json::json!({check_permissions(id).await.to_string(): 1});
                }
            }
        ";
        assert_hit(src, "read", "check_permissions", "for");
    }

    #[test]
    fn detects_check_in_nested_json_key_method_chain() {
        let src = r#"
            async fn read() {
                for id in ids {
                    json!({"nested": {check_permissions(id).await.to_string().to_uppercase(): 1}});
                }
            }
        "#;
        assert_hit(src, "read", "check_permissions", "for");
    }

    #[test]
    fn detects_checks_before_custom_macro_tokens() {
        for token in [":", "@"] {
            let src = format!(
                "async fn read() {{ for id in ids {{ m!(check_permissions(id).await {token} x); }} }}"
            );
            assert_hit(&src, "read", "check_permissions", "for");
        }
    }

    #[test]
    fn ignores_custom_macro_without_checks() {
        let src = "async fn read() { for id in ids { m!(render(id).await : x); } }";
        let hits = scan_source("fixture.rs", src);
        assert!(hits.is_empty(), "{hits:?}");
    }

    #[test]
    fn replays_stored_checks_drained_into_join_all() {
        let src = r"
            async fn read() {
                let mut checks = vec![check_permissions(a)];
                join_all(checks.drain(..)).await;
            }
        ";
        assert_hit(src, "read", "check_permissions", "join:join_all");
    }

    #[test]
    fn replays_each_separately_bound_check_in_a_join_literal() {
        for (join, items) in [
            ("join_all", "[a, b]"),
            ("join_all", "vec![a, b]"),
            ("try_join_all", "[a, b]"),
        ] {
            let src = format!(
                "async fn read() {{
                    let a = check_permissions(first);
                    let b = can_read_stream(second);
                    {join}({items}).await;
                }}"
            );
            let hits = scan_source("fixture.rs", &src);
            assert_eq!(hits.len(), 2, "{hits:?}");
            for (hit, call) in hits.iter().zip(["check_permissions", "can_read_stream"]) {
                assert_eq!(hit.func, "read");
                assert_eq!(hit.call, call);
                assert_eq!(hit.form, format!("join:{join}"));
            }
        }
    }

    #[test]
    fn applies_helper_fan_out_only_to_the_repeated_callback_position() {
        let src = r"
            fn each(ids: Ids, once: impl Fn(), mut repeated: impl FnMut(Id)) {
                once();
                for id in ids { repeated(id); }
            }
            fn forward(ids: Ids, next: impl FnMut(Id), reload: impl Fn()) {
                each(ids, reload, next);
            }
            fn read(ids: Ids) {
                forward(ids, |id| check_permissions(id), || can_read_stream(id));
            }
        ";
        assert_hit(src, "read", "check_permissions", "via:forward");
    }

    #[test]
    fn detects_qualified_all_of_callbacks() {
        for (import, callee) in [
            ("", "crate::authz::list::all_of"),
            ("use crate::authz::list as l;", "l::all_of"),
        ] {
            let src = format!(
                "{import}
                async fn read() {{
                    {callee}(calls, xs, |x, c| async move {{ check_permissions(x, c).await }}).await;
                }}"
            );
            assert_hit(&src, "read", "check_permissions", "via:all_of");
        }
    }

    #[test]
    fn detects_renamed_all_of_callbacks() {
        for callee in ["fold", "fold::<_, _>"] {
            let src = format!(
                "use crate::authz::list::all_of as fold;
                async fn read() {{
                    {callee}(calls, xs, |x, c| async move {{ check_permissions(x, c).await }}).await;
                }}"
            );
            assert_hit(&src, "read", "check_permissions", "via:all_of");
        }
    }

    #[test]
    fn detects_all_of_callbacks_renamed_in_grouped_imports() {
        for import in [
            "use crate::authz::list::{Calls, all_of as fold};",
            "use crate::{authz::list::{Calls, all_of as fold}, other};",
        ] {
            let src = format!(
                "{import}
                async fn read() {{
                    fold(Calls::Send, xs, |x, c| async move {{ check_permissions(x, c).await }}).await;
                }}"
            );
            assert_hit(&src, "read", "check_permissions", "via:all_of");
        }
    }

    #[test]
    fn detects_futures_passed_to_renamed_join_combinators() {
        for join in ["join_all", "try_join_all", "select_all", "select_ok"] {
            let src = format!(
                "use futures::future::{join} as wait_all;
                async fn read(id: Id) {{
                    let futs = std::iter::once(check_permissions(id)).map(Box::pin);
                    wait_all(futs).await;
                }}"
            );
            assert_hit(&src, "read", "check_permissions", &format!("join:{join}"));
        }
    }

    #[test]
    fn detects_checks_in_callbacks_to_unresolved_aliases() {
        for (imports, callback, check) in [
            (
                "use crate::authz::list::all_of as fold; use other::once as fold;",
                "|x, c| check_permissions(x, c)",
                "check_permissions",
            ),
            (
                "use other::module::{self as fold};",
                "async { check_permissions(id).await }",
                "check_permissions",
            ),
            (
                "use crate::authz::list::all_of as fold; use other::once as fold;",
                "check_one",
                "check_one",
            ),
        ] {
            let src = format!(
                "{imports}
                fn check_one(id: Id) {{ check_permissions(id); }}
                async fn read() {{ fold(calls, xs, {callback}).await; }}"
            );
            assert_hit(&src, "read", check, "via:fold");
        }
    }

    #[test]
    fn ignores_callbacks_to_renamed_non_combinators() {
        let src = r"
            use std::cmp::max as biggest;
            fn read() {
                biggest(id, || check_permissions(id));
            }
        ";
        let hits = scan_source("fixture.rs", src);
        assert!(hits.is_empty(), "{hits:?}");
    }

    #[test]
    fn ignores_checks_in_immediately_awaited_async_initializers() {
        let src = r"
            async fn read() {
                let x = (async { check_permissions(id).await }).await;
                stream::iter(x);
            }
        ";
        let hits = scan_source("fixture.rs", src);
        assert!(hits.is_empty(), "{hits:?}");
    }

    #[test]
    fn masks_if_let_bindings_in_the_success_scope_only() {
        let src = r"
            async fn read() {
                let checks = vec![check_permissions(id)];
                if let Some((checks, _)) = load_futures() && ready(&checks) {
                    join_all(checks).await;
                } else {
                    try_join_all(checks).await;
                }
            }
        ";
        assert_hit(src, "read", "check_permissions", "join:try_join_all");
    }

    #[test]
    fn detects_renamed_check_imports_through_the_tree_prefilter() {
        let files = [
            "use crate::auth::{check_permissions as cp}; fn fetch() { loop { cp(id); } }",
            "use crate::auth::object as cp; fn fetch() { loop { cp(auth, org, user, query, id); } }",
        ];
        let (_, hits) = scan_tree(&files, &[], |src| {
            ("fixture.rs".to_owned(), (*src).to_owned())
        });
        assert_eq!(hits.len(), 2, "{hits:?}");
        for (hit, call) in hits.iter().zip(["check_permissions", "object"]) {
            assert_eq!(hit.call, call);
            assert_eq!(hit.form, "loop");
        }
    }

    #[test]
    fn counts_path_arguments_only_in_callback_positions() {
        let src = r"
            fn once(f: impl Fn(Id), id: Id) { f(id); }
            async fn read(ids: Ids) {
                let is_allowed = true;
                for id in ids {
                    log(id, is_allowed);
                    once(check_permissions, id);
                }
            }
        ";
        assert_hit(src, "read", "check_permissions", "for");
    }

    #[test]
    fn detects_dashboard_checks_in_helpers_with_check_named_callbacks() {
        let src = r"
            pub async fn hide_unreadable_slugs(ids: Ids, can_read: impl AsyncFn(Id) -> bool) {
                for id in ids { can_read(id).await; }
            }
            pub async fn hide_unreadable_details(ids: Ids, can_read: impl AsyncFn(Id) -> bool) {
                for id in ids { can_read(id).await; }
            }
        ";
        let hits = scan_source("fixture.rs", src);
        assert_eq!(hits.len(), 2, "{hits:?}");
        assert_eq!(hits[0].func, "hide_unreadable_slugs");
        assert_eq!(hits[1].func, "hide_unreadable_details");
    }

    #[test]
    fn ignores_prelisted_schema_grants() {
        let src = r"
            fn hide_unreadable_schemas(streams: Streams, is_granted: impl Fn(Stream) -> bool) {
                for stream in streams.iter_mut().filter(|s| !is_granted(s)) { clear(stream); }
            }
        ";
        let hits = scan_source("fixture.rs", src);
        assert!(hits.is_empty(), "{hits:?}");
        let key = (
            "src/api/management/src/request/stream/mod.rs",
            "hide_unreadable_schemas",
        );
        assert!(!parse_allowlist(ALLOWLIST).unwrap().contains_key(&key));
    }

    #[test]
    fn discovers_two_hops_of_cross_file_deny_by_error_wrappers() {
        let files = [
            (
                "a.rs",
                "pub fn check_move(id: Id) -> Result<Id, Error> { ensure(check_permissions(id)) }",
            ),
            (
                "b.rs",
                "pub fn guard_vrl(id: Id) -> Result<(), Error> { a::check_move(id)?; Ok(()) }",
            ),
            (
                "c.rs",
                "pub fn guard_query(id: Id) -> Option<Error> { b::guard_vrl(id).err() }",
            ),
            (
                "d.rs",
                "fn read(ids: Ids) { for id in ids { c::guard_query(id); } }",
            ),
        ];
        let (candidates, hits) = scan_tree(
            &files,
            &["check_move", "guard_vrl", "guard_query"],
            |&(path, src)| (path.to_owned(), src.to_owned()),
        );
        assert_eq!(
            candidates,
            BTreeSet::from(["check_move", "guard_vrl", "guard_query"].map(str::to_owned))
        );
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].call, "guard_query");
        assert_eq!(hits[0].form, "for");
    }

    #[test]
    fn detects_query_function_guard_and_checks_its_allowlist_entry() {
        let path = "src/api/search/src/search/mod.rs";
        let files = [
            ("authz.rs", "pub fn authorize_with(id: Id) -> Result<(), Denied> { check_permissions(id) }"),
            ("query.rs", "pub fn authorize_query_sources(id: Id) -> Result<(), Denied> { authz::authorize_with(id) }"),
            ("background_access.rs", "pub fn guard_write(id: Id) -> Result<(), Response> { query::authorize_query_sources(id) }
                pub fn guard_vrl_function(id: Id) -> Result<(), Response> { guard_write(id) }"),
            (path, "fn check_query_fn_permissions(sources: Sources) {
                for source in sources { background_access::guard_vrl_function(source); }
            }"),
        ];
        let (_, hits) = scan_tree(&files, FOLLOWED_WRAPPERS, |&(path, src)| {
            (path.to_owned(), src.to_owned())
        });
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].call, "guard_vrl_function");
        let allowlist = parse_allowlist(ALLOWLIST).unwrap();
        let reason = allowlist
            .get(&(path, "check_query_fn_permissions"))
            .unwrap();
        assert!(reason.starts_with("query-bounded") && reason.contains("deduplicated"));
    }

    #[test]
    fn visits_qualified_adapter_setup_under_the_enclosing_form() {
        let src = r"
            async fn read(ids: Ids) {
                Iterator::map(&load(check_permissions(id).await), identity);
                <I as Iterator>::fold(ids, can_read_stream(id).await, combine);
                Iterator::map(ids, make_callback(check_object(id).await));
                for id in ids {
                    Iterator::map(&load(check_permissions(id).await), identity);
                }
            }
        ";
        assert_hit(src, "read", "check_permissions", "for");
    }

    #[test]
    fn prefilters_parenthesized_qualified_method_checks() {
        let files = ["async fn fetch() {
            for id in ids { (LegacyChecks::object)(checks, org, user, query, id).await; }
        }"];
        let (_, hits) = scan_tree(&files, &[], |src| {
            ("fixture.rs".to_owned(), (*src).to_owned())
        });
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].call, "object");
        assert_eq!(hits[0].form, "for");
    }
}
