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

//! Edge resolution rules 1–6 over a Q2 row, series identities, and the grace staging area.

use std::collections::HashMap;

use super::{
    GRACE_LEARN_CYCLES, LEARN_INTERVAL_SECS,
    resolution::{Candidates, ResolutionTable, Tier, first_label, is_ip},
    sql::{Q2Row, WindowCounts},
};

/// Emitted `client` label of entry edges; `client_type` keeps it apart from a service named `user`.
pub const CLIENT_USER: &str = "user";
/// Emitted `client_type` label value of entry edges.
pub const CLIENT_TYPE_USER: &str = "user";
/// Emitted `client_type` label value of consumer edges (Q3, topic → service).
pub const CLIENT_TYPE_QUEUE: &str = "queue";
/// Emitted `client_type` label value when the caller of a tool/model edge is an agent (Q5/Q6).
pub const CLIENT_TYPE_AGENT: &str = "agent";
/// Emitted `connection_type` label value of an explicit `peer.service` that is not a known service.
pub const CONNECTION_EXTERNAL: &str = "external";
/// Emitted `connection_type` label value of a service → agent edge (Q4).
pub const CONNECTION_AGENT: &str = "agent";
/// Emitted `connection_type` label value of an agent/service → tool edge (Q5).
pub const CONNECTION_TOOL: &str = "tool";
/// Emitted `connection_type` label value of an agent/service → model edge (Q6).
pub const CONNECTION_MODEL: &str = "model";
/// Emitted `reason` label value: the only peer key was a bare IP.
pub const REASON_IP_ONLY: &str = "ip_only";
/// Emitted `reason` label value: no peer key at all and no signature hit.
pub const REASON_NO_PEER: &str = "no_peer";
/// Emitted `reason` label value: the majority won with a runner-up at ≥ 30 %.
pub const REASON_AMBIGUOUS: &str = "ambiguous";
/// Emitted `reason` label value: the edge found no slot within the stream's budget.
pub const REASON_CARDINALITY: &str = "cardinality";

/// Series identity without `trace_stream` (one state per stream already scopes it).
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SeriesKey {
    Edge {
        client: String,
        client_type: String,
        server: String,
        connection_type: String,
        /// Empty on every edge except agent/tool/model ones (design §4.5).
        agent_env: String,
    },
    Node {
        server: String,
    },
    Unresolved {
        client: String,
        reason: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct StagingKey {
    pub client: String,
    pub peer_key: Option<String>,
    pub peer_port: Option<u16>,
    pub peer_ip: Option<String>,
    pub rpc_service: Option<String>,
    pub op_sig: Option<String>,
    pub infer_service_name: Option<String>,
    pub infer_service_type: Option<String>,
    pub explicit_peer: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Edge {
        key: SeriesKey,
        tier: Option<Tier>,
        ambiguous: bool,
    },
    Unresolved(&'static str),
    Pending,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Contribution {
    pub key: SeriesKey,
    pub counts: WindowCounts,
    pub tier: Option<Tier>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Admission {
    pub key: SeriesKey,
    pub tier: Option<Tier>,
    pub windows: Vec<(i64, WindowCounts)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StagedEntry {
    pub windows: Vec<(i64, WindowCounts)>,
    pub cycles: u32,
    seq: u64,
}

#[derive(Debug, Default)]
pub struct Staging {
    entries: HashMap<StagingKey, StagedEntry>,
    next_seq: u64,
}

impl SeriesKey {
    pub fn edge(client: &str, server: &str, connection_type: &str) -> Self {
        Self::Edge {
            client: client.to_string(),
            client_type: String::new(),
            server: server.to_string(),
            connection_type: connection_type.to_string(),
            agent_env: String::new(),
        }
    }

    pub fn queue_edge(destination: &str, consumer: &str) -> Self {
        Self::Edge {
            client: destination.to_string(),
            client_type: CLIENT_TYPE_QUEUE.to_string(),
            server: consumer.to_string(),
            connection_type: String::new(),
            agent_env: String::new(),
        }
    }

    pub fn entry_edge(service: &str) -> Self {
        Self::Edge {
            client: CLIENT_USER.to_string(),
            client_type: CLIENT_TYPE_USER.to_string(),
            server: service.to_string(),
            connection_type: String::new(),
            agent_env: String::new(),
        }
    }

    /// Q4: the host service calling an agent; the agent node is identified by name only (§4.6).
    pub fn agent_edge(service: &str, agent: &str, agent_env: &str) -> Self {
        Self::Edge {
            client: service.to_string(),
            client_type: String::new(),
            server: agent.to_string(),
            connection_type: CONNECTION_AGENT.to_string(),
            agent_env: agent_env.to_string(),
        }
    }

    /// Q5/Q6: without an owning agent the call is attributed to the host service (§4.2).
    pub fn agent_call_edge(
        agent_from: Option<&str>,
        service: &str,
        server: &str,
        connection_type: &str,
        agent_env: &str,
    ) -> Self {
        let (client, client_type) = match agent_from {
            Some(agent) => (agent, CLIENT_TYPE_AGENT),
            None => (service, ""),
        };
        Self::Edge {
            client: client.to_string(),
            client_type: client_type.to_string(),
            server: server.to_string(),
            connection_type: connection_type.to_string(),
            agent_env: agent_env.to_string(),
        }
    }

    pub fn node(server: &str) -> Self {
        Self::Node {
            server: server.to_string(),
        }
    }

    pub fn unresolved(client: &str, reason: &str) -> Self {
        Self::Unresolved {
            client: client.to_string(),
            reason: reason.to_string(),
        }
    }

    pub fn is_edge(&self) -> bool {
        matches!(self, Self::Edge { .. })
    }
}

impl StagingKey {
    pub fn from_row(row: &Q2Row) -> Self {
        Self {
            client: row.client.clone(),
            peer_key: row.infer_peer_key.clone(),
            peer_port: row.infer_peer_port,
            peer_ip: row.infer_peer_ip.clone(),
            rpc_service: row.rpc_service.clone(),
            op_sig: row.op_sig.clone(),
            infer_service_name: row.infer_service_name.clone(),
            infer_service_type: row.infer_service_type.clone(),
            explicit_peer: row.explicit_peer,
        }
    }

    fn candidates(&self) -> Candidates {
        Candidates {
            peer_key: self.peer_key.clone(),
            peer_port: self.peer_port,
            peer_ip: self.peer_ip.clone(),
            rpc: self.rpc_service.clone(),
            sig: self.op_sig.clone().map(|op| (self.client.clone(), op)),
        }
    }

    fn peer_is_bare_ip(&self) -> bool {
        self.peer_key.as_deref().is_some_and(is_ip) || self.peer_ip.as_deref().is_some_and(is_ip)
    }
}

impl Staging {
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Windows a key may hold: the whole grace period at the current window width.
    pub fn max_windows(flush_secs: u64) -> usize {
        let per_cycle = (LEARN_INTERVAL_SECS as u64).div_ceil(flush_secs.max(1));
        (GRACE_LEARN_CYCLES as usize * per_cycle as usize).max(1)
    }

    pub fn classify_window(
        &mut self,
        rows: &[Q2Row],
        table: &ResolutionTable,
        now: i64,
        window_end: i64,
        max_windows: usize,
    ) -> (Vec<Contribution>, usize) {
        let mut out = vec![];
        let mut staged = 0;
        for row in rows {
            let key = StagingKey::from_row(row);
            match resolve(&key, table, now, false) {
                Outcome::Pending => {
                    self.stage(key, window_end, row.counts, max_windows);
                    staged += 1;
                }
                outcome => push_outcome(&mut out, &key.client, outcome, row.counts),
            }
        }
        (out, staged)
    }

    pub fn stage(
        &mut self,
        key: StagingKey,
        window_end: i64,
        counts: WindowCounts,
        max_windows: usize,
    ) {
        let seq = self.next_seq;
        let entry = self.entries.entry(key).or_insert_with(|| {
            self.next_seq += 1;
            StagedEntry {
                windows: vec![],
                cycles: 0,
                seq,
            }
        });
        match entry.windows.last_mut() {
            Some((end, c)) if *end == window_end => c.add(&counts),
            _ => entry.windows.push((window_end, counts)),
        }
        while entry.windows.len() > max_windows.max(1) {
            let (_, oldest) = entry.windows.remove(0);
            if let Some((_, newest)) = entry.windows.last_mut() {
                newest.add(&oldest);
            }
        }
    }

    pub fn learning_pass(&mut self, table: &ResolutionTable, now: i64) -> Vec<Admission> {
        let mut admitted = vec![];
        let mut keys: Vec<StagingKey> = self.entries.keys().cloned().collect();
        keys.sort_by_key(|k| self.entries[k].seq);
        for key in keys {
            let entry = self.entries.get_mut(&key).unwrap();
            let mut outcome = resolve(&key, table, now, false);
            if outcome == Outcome::Pending {
                entry.cycles += 1;
                if entry.cycles < GRACE_LEARN_CYCLES {
                    continue;
                }
                outcome = finalize(&key);
            }
            let entry = self.entries.remove(&key).unwrap();
            push_admission(&mut admitted, &key.client, outcome, entry.windows);
        }
        admitted
    }

    pub fn finalize_oldest(&mut self, n: usize) -> Vec<Admission> {
        let mut keys: Vec<(u64, StagingKey)> = self
            .entries
            .iter()
            .map(|(k, e)| (e.seq, k.clone()))
            .collect();
        keys.sort_by_key(|(seq, _)| *seq);
        let mut admitted = vec![];
        for (_, key) in keys.into_iter().take(n) {
            let entry = self.entries.remove(&key).unwrap();
            push_admission(&mut admitted, &key.client, finalize(&key), entry.windows);
        }
        admitted
    }
}

/// Rules 1–4; with `finalize` the miss falls through to rules 5/6 instead of `Pending`.
pub fn resolve(
    key: &StagingKey,
    table: &ResolutionTable,
    now: i64,
    finalize_miss: bool,
) -> Outcome {
    if key.explicit_peer
        && let Some(server) = key.infer_service_name.as_deref()
    {
        let connection_type = if table.is_known_service(server, now) {
            ""
        } else {
            CONNECTION_EXTERNAL
        };
        return Outcome::Edge {
            key: SeriesKey::edge(&key.client, server, connection_type),
            tier: None,
            ambiguous: false,
        };
    }
    if let Some((server, tier, ambiguous)) = resolve_learned(key, table, now) {
        return Outcome::Edge {
            key: SeriesKey::edge(&key.client, &server, ""),
            tier: Some(tier),
            ambiguous,
        };
    }
    if finalize_miss {
        finalize(key)
    } else {
        Outcome::Pending
    }
}

/// Rules 2–4: pairing, self_key (with the first-label override), first label alone.
fn resolve_learned(
    key: &StagingKey,
    table: &ResolutionTable,
    now: i64,
) -> Option<(String, Tier, bool)> {
    let label = key
        .peer_key
        .as_deref()
        .and_then(first_label)
        .filter(|l| table.is_known_service(l, now));
    if let Some(r) = table.resolve_candidates(&key.candidates(), now) {
        if r.tier == Tier::SelfKey
            && let Some(label) = label
            && label != r.service
        {
            return Some((label.to_string(), Tier::Label, false));
        }
        return Some((r.service, r.tier, r.ambiguous));
    }
    label.map(|l| (l.to_string(), Tier::Label, false))
}

/// Rules 5–6.
fn finalize(key: &StagingKey) -> Outcome {
    if let Some(server) = key.infer_service_name.as_deref() {
        let connection_type = key.infer_service_type.as_deref().unwrap_or("");
        return Outcome::Edge {
            key: SeriesKey::edge(&key.client, server, connection_type),
            tier: None,
            ambiguous: false,
        };
    }
    // a host-name key that never resolved and carries no inferred name is reported as `no_peer`
    if key.peer_is_bare_ip() {
        Outcome::Unresolved(REASON_IP_ONLY)
    } else {
        Outcome::Unresolved(REASON_NO_PEER)
    }
}

fn push_outcome(out: &mut Vec<Contribution>, client: &str, outcome: Outcome, counts: WindowCounts) {
    match outcome {
        Outcome::Edge {
            key,
            tier,
            ambiguous,
        } => {
            out.push(Contribution { key, counts, tier });
            if ambiguous {
                out.push(Contribution {
                    key: SeriesKey::unresolved(client, REASON_AMBIGUOUS),
                    counts,
                    tier: None,
                });
            }
        }
        Outcome::Unresolved(reason) => out.push(Contribution {
            key: SeriesKey::unresolved(client, reason),
            counts,
            tier: None,
        }),
        Outcome::Pending => {}
    }
}

fn push_admission(
    out: &mut Vec<Admission>,
    client: &str,
    outcome: Outcome,
    windows: Vec<(i64, WindowCounts)>,
) {
    match outcome {
        Outcome::Edge {
            key,
            tier,
            ambiguous,
        } => {
            if ambiguous {
                out.push(Admission {
                    key: SeriesKey::unresolved(client, REASON_AMBIGUOUS),
                    tier: None,
                    windows: windows.clone(),
                });
            }
            out.push(Admission { key, tier, windows });
        }
        Outcome::Unresolved(reason) => out.push(Admission {
            key: SeriesKey::unresolved(client, reason),
            tier: None,
            windows,
        }),
        Outcome::Pending => {}
    }
}

#[cfg(test)]
mod tests {
    use config::utils::time::SECOND_MICRO_SECS;

    use super::{
        super::sql::{PairingRow, SelfIdentityRow},
        *,
    };

    const NOW: i64 = 1_700_000_000 * SECOND_MICRO_SECS;

    fn counts(n: u64) -> WindowCounts {
        WindowCounts {
            requests: n,
            errors: 0,
            dur_sum: n as i64 * 1000,
            buckets: [n; 17],
        }
    }

    fn row(client: &str, peer_key: Option<&str>) -> Q2Row {
        Q2Row {
            client: client.to_string(),
            infer_peer_key: peer_key.map(str::to_string),
            infer_peer_port: None,
            infer_peer_ip: None,
            rpc_service: None,
            op_sig: None,
            infer_service_name: peer_key.filter(|k| !is_ip(k)).map(str::to_string),
            infer_service_type: Some("external".to_string()),
            explicit_peer: false,
            counts: counts(1),
        }
    }

    fn known(table: &mut ResolutionTable, services: &[&str]) {
        let rows: Vec<SelfIdentityRow> = services
            .iter()
            .map(|s| SelfIdentityRow {
                service_name: s.to_string(),
                infer_self_key: None,
                infer_self_port: None,
                infer_self_ip: None,
                rpc_service: None,
                server_requests: 1,
                requests: 1,
            })
            .collect();
        table.learn_self_identity(&rows, NOW);
    }

    fn self_key(table: &mut ResolutionTable, svc: &str, key: &str) {
        table.learn_self_identity(
            &[SelfIdentityRow {
                service_name: svc.to_string(),
                infer_self_key: Some(key.to_string()),
                infer_self_port: None,
                infer_self_ip: None,
                rpc_service: None,
                server_requests: 10,
                requests: 10,
            }],
            NOW,
        );
    }

    #[test]
    fn test_rule1_explicit_peer_known_vs_external() {
        let mut t = ResolutionTable::new(0, 0);
        known(&mut t, &["payments"]);
        let mut r = row("checkout", Some("payments"));
        r.explicit_peer = true;
        let key = StagingKey::from_row(&r);
        assert_eq!(
            resolve(&key, &t, NOW, false),
            Outcome::Edge {
                key: SeriesKey::edge("checkout", "payments", ""),
                tier: None,
                ambiguous: false
            }
        );
        let mut r = row("checkout", Some("stripe"));
        r.explicit_peer = true;
        let key = StagingKey::from_row(&r);
        assert_eq!(
            resolve(&key, &t, NOW, false),
            Outcome::Edge {
                key: SeriesKey::edge("checkout", "stripe", CONNECTION_EXTERNAL),
                tier: None,
                ambiguous: false
            }
        );
    }

    #[test]
    fn test_rule2_pairing_and_rule3_self_key_with_label_override() {
        let mut t = ResolutionTable::new(0, 0);
        known(&mut t, &["frontend", "frontend-proxy"]);
        self_key(&mut t, "frontend", "frontend-proxy");
        let key = StagingKey::from_row(&row("load-generator", Some("frontend-proxy:8080")));
        assert_eq!(
            resolve(&key, &t, NOW, false),
            Outcome::Edge {
                key: SeriesKey::edge("load-generator", "frontend-proxy", ""),
                tier: Some(Tier::Label),
                ambiguous: false
            }
        );
        let key = StagingKey::from_row(&row("load-generator", Some("frontend-proxy.svc")));
        assert!(matches!(
            resolve(&key, &t, NOW, false),
            Outcome::Edge {
                tier: Some(Tier::Label),
                ..
            }
        ));
        let key = StagingKey::from_row(&row("load-generator", Some("opaque.example")));
        self_key(&mut t, "frontend", "opaque.example");
        assert_eq!(
            resolve(&key, &t, NOW, false),
            Outcome::Edge {
                key: SeriesKey::edge("load-generator", "frontend", ""),
                tier: Some(Tier::SelfKey),
                ambiguous: false
            }
        );
        t.learn_pairing(
            &[PairingRow {
                client: "load-generator".into(),
                peer_key: Some("frontend-proxy".into()),
                peer_port: None,
                peer_ip: None,
                peer_rpc: None,
                peer_sig: None,
                callee: "envoy".into(),
                n: 3,
            }],
            NOW,
        );
        let key = StagingKey::from_row(&row("load-generator", Some("frontend-proxy")));
        assert!(matches!(
            resolve(&key, &t, NOW, false),
            Outcome::Edge { tier: Some(Tier::Pairing), key: SeriesKey::Edge { server, .. }, .. } if server == "envoy"
        ));
    }

    #[test]
    fn test_rule4_label_only_and_pending() {
        let mut t = ResolutionTable::new(0, 0);
        known(&mut t, &["currency"]);
        let key = StagingKey::from_row(&row(
            "checkout",
            Some("currency.default.svc.cluster.local:8080"),
        ));
        assert_eq!(
            resolve(&key, &t, NOW, false),
            Outcome::Edge {
                key: SeriesKey::edge("checkout", "currency", ""),
                tier: Some(Tier::Label),
                ambiguous: false
            }
        );
        let key = StagingKey::from_row(&row("checkout", Some("api.stripe.com")));
        assert_eq!(resolve(&key, &t, NOW, false), Outcome::Pending);
    }

    #[test]
    fn test_rules5_6_finalize() {
        let t = ResolutionTable::new(0, 0);
        let key = StagingKey::from_row(&row("checkout", Some("api.stripe.com")));
        assert_eq!(
            resolve(&key, &t, NOW, true),
            Outcome::Edge {
                key: SeriesKey::edge("checkout", "api.stripe.com", "external"),
                tier: None,
                ambiguous: false
            }
        );
        let key = StagingKey::from_row(&row("checkout", Some("10.0.0.8")));
        assert_eq!(
            resolve(&key, &t, NOW, true),
            Outcome::Unresolved(REASON_IP_ONLY)
        );
        let mut r = row("checkout", None);
        r.infer_peer_ip = Some("10.0.0.9".into());
        assert_eq!(
            resolve(&StagingKey::from_row(&r), &t, NOW, true),
            Outcome::Unresolved(REASON_IP_ONLY)
        );
        let key = StagingKey::from_row(&row("checkout", None));
        assert_eq!(
            resolve(&key, &t, NOW, true),
            Outcome::Unresolved(REASON_NO_PEER)
        );
        let mut r = row("checkout", None);
        r.op_sig = Some("GET /x".into());
        assert_eq!(
            resolve(&StagingKey::from_row(&r), &t, NOW, true),
            Outcome::Unresolved(REASON_NO_PEER)
        );
    }

    #[test]
    fn test_staging_keeps_windows_and_finalizes_after_grace() {
        let mut t = ResolutionTable::new(0, 0);
        let mut staging = Staging::default();
        let rows = vec![row("checkout", Some("api.stripe.com"))];
        for w in 1..=3 {
            let (out, staged) = staging.classify_window(&rows, &t, NOW, w * SECOND_MICRO_SECS, 10);
            assert!(out.is_empty());
            assert_eq!(staged, 1);
        }
        assert_eq!(staging.len(), 1);
        assert!(staging.learning_pass(&t, NOW).is_empty());
        let admitted = staging.learning_pass(&t, NOW);
        assert_eq!(admitted.len(), 1);
        assert_eq!(
            admitted[0].key,
            SeriesKey::edge("checkout", "api.stripe.com", "external")
        );
        assert_eq!(admitted[0].tier, None);
        let ends: Vec<i64> = admitted[0].windows.iter().map(|w| w.0).collect();
        assert_eq!(
            ends,
            vec![
                SECOND_MICRO_SECS,
                2 * SECOND_MICRO_SECS,
                3 * SECOND_MICRO_SECS
            ]
        );
        assert!(admitted[0].windows.iter().all(|w| w.1.requests == 1));
        assert!(staging.is_empty());

        staging.classify_window(&rows, &t, NOW, 4 * SECOND_MICRO_SECS, 10);
        known(&mut t, &["api"]);
        let admitted = staging.learning_pass(&t, NOW);
        assert_eq!(admitted[0].key, SeriesKey::edge("checkout", "api", ""));
        assert_eq!(admitted[0].tier, Some(Tier::Label));
    }

    #[test]
    fn test_staging_bounds_and_early_finalize() {
        let t = ResolutionTable::new(0, 0);
        let mut staging = Staging::default();
        let key = StagingKey::from_row(&row("a", Some("x.example")));
        for w in 1..=5 {
            staging.stage(key.clone(), w * SECOND_MICRO_SECS, counts(1), 2);
        }
        let entry = &staging.entries[&key];
        assert_eq!(entry.windows.len(), 2);
        assert_eq!(entry.windows[0], (4 * SECOND_MICRO_SECS, counts(2)));
        assert_eq!(entry.windows[1].0, 5 * SECOND_MICRO_SECS);
        assert_eq!(entry.windows[1].1.requests, 3);
        assert_eq!(Staging::max_windows(60), 10);
        assert_eq!(Staging::max_windows(600), 2);

        let key2 = StagingKey::from_row(&row("b", Some("y.example")));
        staging.stage(key2, 6 * SECOND_MICRO_SECS, counts(1), 2);
        let early = staging.finalize_oldest(1);
        assert_eq!(early.len(), 1);
        assert_eq!(early[0].key, SeriesKey::edge("a", "x.example", "external"));
        assert_eq!(staging.len(), 1);
        assert!(staging.learning_pass(&t, NOW).is_empty());
    }

    #[test]
    fn test_ambiguous_adds_unresolved_contribution() {
        let mut t = ResolutionTable::new(0, 0);
        self_key(&mut t, "a", "gw");
        t.learn_self_identity(
            &[SelfIdentityRow {
                service_name: "b".into(),
                infer_self_key: Some("gw".into()),
                infer_self_port: None,
                infer_self_ip: None,
                rpc_service: None,
                server_requests: 5,
                requests: 5,
            }],
            NOW,
        );
        let mut staging = Staging::default();
        let (out, staged) =
            staging.classify_window(&[row("c", Some("gw"))], &t, NOW, SECOND_MICRO_SECS, 10);
        assert_eq!(staged, 0);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].key, SeriesKey::edge("c", "a", ""));
        assert_eq!(out[0].tier, Some(Tier::SelfKey));
        assert_eq!(out[1].key, SeriesKey::unresolved("c", REASON_AMBIGUOUS));
    }

    #[test]
    fn test_identities() {
        assert_eq!(
            SeriesKey::queue_edge("orders", "fraud"),
            SeriesKey::Edge {
                client: "orders".into(),
                client_type: "queue".into(),
                server: "fraud".into(),
                connection_type: String::new(),
                agent_env: String::new()
            }
        );
        assert_eq!(
            SeriesKey::entry_edge("frontend"),
            SeriesKey::Edge {
                client: "user".into(),
                client_type: "user".into(),
                server: "frontend".into(),
                connection_type: String::new(),
                agent_env: String::new()
            }
        );
        assert!(SeriesKey::entry_edge("x").is_edge());
        assert!(!SeriesKey::node("x").is_edge());
        assert!(!SeriesKey::unresolved("x", REASON_CARDINALITY).is_edge());
    }

    #[test]
    fn test_agent_identities() {
        assert!(matches!(
            SeriesKey::edge("a", "b", ""),
            SeriesKey::Edge { agent_env, .. } if agent_env.is_empty()
        ));
        assert_eq!(
            SeriesKey::agent_edge("o2-ai", "sre-rca", "prod"),
            SeriesKey::Edge {
                client: "o2-ai".into(),
                client_type: String::new(),
                server: "sre-rca".into(),
                connection_type: CONNECTION_AGENT.into(),
                agent_env: "prod".into()
            }
        );
        assert_eq!(
            SeriesKey::agent_call_edge(Some("sre-rca"), "o2-ai", "search", CONNECTION_TOOL, ""),
            SeriesKey::Edge {
                client: "sre-rca".into(),
                client_type: CLIENT_TYPE_AGENT.into(),
                server: "search".into(),
                connection_type: CONNECTION_TOOL.into(),
                agent_env: String::new()
            }
        );
        assert_eq!(
            SeriesKey::agent_call_edge(None, "o2-ai", "gpt-4o", CONNECTION_MODEL, "dev"),
            SeriesKey::Edge {
                client: "o2-ai".into(),
                client_type: String::new(),
                server: "gpt-4o".into(),
                connection_type: CONNECTION_MODEL.into(),
                agent_env: "dev".into()
            }
        );
        assert_ne!(
            SeriesKey::agent_edge("svc", "a", "prod"),
            SeriesKey::agent_edge("svc", "a", "")
        );
        assert!(SeriesKey::agent_edge("s", "a", "").is_edge());
        assert!(SeriesKey::agent_call_edge(None, "s", "t", CONNECTION_TOOL, "").is_edge());
        assert!(SeriesKey::agent_call_edge(Some("a"), "s", "m", CONNECTION_MODEL, "").is_edge());
    }
}
