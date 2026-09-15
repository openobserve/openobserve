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

//! Per-(node, org) resolution table: two layers of typed key → service counts, plus known services.

use std::{
    collections::HashMap,
    net::IpAddr,
    num::NonZeroUsize,
    path::{Path, PathBuf},
};

use config::utils::time::SECOND_MICRO_SECS;
use lru::LruCache;
use serde::{Deserialize, Serialize};

use super::{
    RESOLUTION_MAX_KEYS,
    sql::{PairingRow, SelfIdentityRow},
};

pub const HOUR_MICROS: i64 = 3600 * SECOND_MICRO_SECS;
pub const WINDOW_24H_MICROS: i64 = 24 * HOUR_MICROS;
/// Second place at or above this share of the winner marks the lookup ambiguous.
pub const AMBIGUOUS_RATIO: f64 = 0.3;
const SNAPSHOT_DIR: &str = "service_graph";

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TypedKey {
    Host { key: String, port: Option<u16> },
    Ip { ip: String, port: Option<u16> },
    Rpc(String),
    Sig { client: String, op: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    Pairing,
    SelfKey,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    Pairing,
    SelfKey,
    Label,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HourBuckets {
    slots: Vec<(i64, u64)>,
}

pub type ServiceCounts = HashMap<String, HourBuckets>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
    pub service: String,
    pub tier: Tier,
    pub ambiguous: bool,
}

/// The candidate keys of one Q2 row, in the lookup order of design §4.3.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Candidates {
    pub peer_key: Option<String>,
    pub peer_port: Option<u16>,
    pub peer_ip: Option<String>,
    pub rpc: Option<String>,
    pub sig: Option<(String, String)>,
}

pub struct ResolutionTable {
    pairing: LruCache<TypedKey, ServiceCounts>,
    self_key: LruCache<TypedKey, ServiceCounts>,
    pub known_services: HashMap<String, HourBuckets>,
    pub self_identity_up_to: i64,
    pub pairing_up_to: i64,
    pub last_learn_at: i64,
    pub last_snapshot_at: i64,
    pub has_unresolved: bool,
    /// Incremented at the start of every learning pass; staging counts grace cycles against it.
    pub learn_gen: u64,
}

#[derive(Serialize, Deserialize)]
pub struct Snapshot {
    pairing: Vec<(TypedKey, ServiceCounts)>,
    self_key: Vec<(TypedKey, ServiceCounts)>,
    known_services: HashMap<String, HourBuckets>,
    self_identity_up_to: i64,
    pairing_up_to: i64,
}

impl TypedKey {
    pub fn addr(value: &str, port: Option<u16>) -> Self {
        let value = value.trim().to_string();
        if is_ip(&value) {
            Self::Ip { ip: value, port }
        } else {
            Self::Host { key: value, port }
        }
    }
}

impl Tier {
    pub fn as_str(self) -> &'static str {
        match self {
            Tier::Pairing => "pairing",
            Tier::SelfKey => "self_key",
            Tier::Label => "label",
        }
    }
}

impl HourBuckets {
    pub fn add(&mut self, now: i64, n: u64) {
        self.prune(now);
        let hour = now - now.rem_euclid(HOUR_MICROS);
        match self.slots.iter_mut().find(|s| s.0 == hour) {
            Some(slot) => slot.1 += n,
            None => self.slots.push((hour, n)),
        }
    }

    pub fn prune(&mut self, now: i64) {
        self.slots
            .retain(|(hour, _)| *hour >= now - WINDOW_24H_MICROS);
    }

    pub fn total(&self, now: i64) -> u64 {
        self.slots
            .iter()
            .filter(|(hour, _)| *hour >= now - WINDOW_24H_MICROS)
            .map(|(_, n)| *n)
            .sum()
    }
}

impl Candidates {
    pub fn keys(&self, with_sig: bool) -> Vec<TypedKey> {
        let mut keys = vec![];
        if let Some(pk) = self.peer_key.as_deref() {
            let host_or_ip = |port| TypedKey::addr(pk, port);
            if self.peer_port.is_some() {
                keys.push(host_or_ip(self.peer_port));
            }
            keys.push(host_or_ip(None));
        }
        if let Some(ip) = self.peer_ip.as_deref() {
            if self.peer_port.is_some() {
                keys.push(TypedKey::Ip {
                    ip: ip.to_string(),
                    port: self.peer_port,
                });
            }
            keys.push(TypedKey::Ip {
                ip: ip.to_string(),
                port: None,
            });
        }
        if let Some(rpc) = &self.rpc {
            keys.push(TypedKey::Rpc(rpc.clone()));
        }
        if with_sig
            && self.peer_key.is_none()
            && self.peer_ip.is_none()
            && self.rpc.is_none()
            && let Some((client, op)) = &self.sig
        {
            keys.push(TypedKey::Sig {
                client: client.clone(),
                op: op.clone(),
            });
        }
        keys
    }
}

impl Snapshot {
    pub fn to_json(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }
}

impl ResolutionTable {
    pub fn new(self_identity_up_to: i64, pairing_up_to: i64) -> Self {
        Self::with_capacity(RESOLUTION_MAX_KEYS / 2, self_identity_up_to, pairing_up_to)
    }

    pub fn with_capacity(per_layer: usize, self_identity_up_to: i64, pairing_up_to: i64) -> Self {
        let cap = NonZeroUsize::new(per_layer.max(1)).unwrap();
        Self {
            pairing: LruCache::new(cap),
            self_key: LruCache::new(cap),
            known_services: HashMap::new(),
            self_identity_up_to,
            pairing_up_to,
            last_learn_at: 0,
            last_snapshot_at: 0,
            has_unresolved: false,
            learn_gen: 0,
        }
    }

    pub fn cold_start_boundary(claimed_offsets: &[i64], fallback: i64) -> i64 {
        claimed_offsets
            .iter()
            .copied()
            .filter(|o| *o > 0)
            .min()
            .unwrap_or(fallback)
    }

    pub fn key_count(&self) -> usize {
        self.pairing.len() + self.self_key.len()
    }

    pub fn prune(&mut self, now: i64) {
        self.known_services.retain(|_, b| {
            b.prune(now);
            b.total(now) > 0
        });
        Self::prune_layer(&mut self.pairing, now);
        Self::prune_layer(&mut self.self_key, now);
    }

    pub fn learn_self_identity(&mut self, rows: &[SelfIdentityRow], now: i64) {
        for row in rows {
            self.known_services
                .entry(row.service_name.clone())
                .or_default()
                .add(now, row.requests);
            if row.server_requests == 0 {
                continue;
            }
            let mut keys = vec![];
            if let Some(k) = &row.infer_self_key {
                keys.push(TypedKey::addr(k, row.infer_self_port));
            }
            if let Some(ip) = &row.infer_self_ip {
                keys.push(TypedKey::Ip {
                    ip: ip.clone(),
                    port: None,
                });
            }
            if let Some(rpc) = &row.rpc_service {
                keys.push(TypedKey::Rpc(rpc.clone()));
            }
            for key in keys {
                Self::learn(
                    &mut self.self_key,
                    key,
                    &row.service_name,
                    row.server_requests,
                    now,
                );
            }
        }
    }

    pub fn learn_pairing(&mut self, rows: &[PairingRow], now: i64) {
        for row in rows {
            let mut keys = vec![];
            if let Some(k) = &row.peer_key {
                keys.push(TypedKey::addr(k, row.peer_port));
            }
            if let Some(ip) = &row.peer_ip {
                keys.push(TypedKey::Ip {
                    ip: ip.clone(),
                    port: None,
                });
            }
            if let Some(rpc) = &row.peer_rpc {
                keys.push(TypedKey::Rpc(rpc.clone()));
            }
            if let Some(op) = &row.peer_sig {
                keys.push(TypedKey::Sig {
                    client: row.client.clone(),
                    op: op.clone(),
                });
            }
            for key in keys {
                Self::learn(&mut self.pairing, key, &row.callee, row.n, now);
            }
        }
    }

    pub fn is_known_service(&self, name: &str, now: i64) -> bool {
        self.known_services
            .get(name)
            .is_some_and(|b| b.total(now) > 0)
    }

    pub fn known_service_count(&self, now: i64) -> usize {
        self.known_services
            .values()
            .filter(|b| b.total(now) > 0)
            .count()
    }

    /// Pairing layer first (①②③④), then self_key (①②③); `Sig` keys exist only in the pairing layer.
    pub fn resolve_candidates(&self, c: &Candidates, now: i64) -> Option<Resolved> {
        let keys = c.keys(true);
        for key in &keys {
            if let Some((service, ambiguous)) = self.lookup(Layer::Pairing, key, now) {
                return Some(Resolved {
                    service,
                    tier: Tier::Pairing,
                    ambiguous,
                });
            }
        }
        for key in keys.iter().filter(|k| !matches!(k, TypedKey::Sig { .. })) {
            if let Some((service, ambiguous)) = self.lookup(Layer::SelfKey, key, now) {
                return Some(Resolved {
                    service,
                    tier: Tier::SelfKey,
                    ambiguous,
                });
            }
        }
        None
    }

    /// Majority by summed 24 h weight; `peek` keeps lookups read-only so recency follows learning.
    pub fn lookup(&self, layer: Layer, key: &TypedKey, now: i64) -> Option<(String, bool)> {
        let counts = match layer {
            Layer::Pairing => self.pairing.peek(key)?,
            Layer::SelfKey => self.self_key.peek(key)?,
        };
        let mut ranked: Vec<(&String, u64)> = counts
            .iter()
            .map(|(svc, b)| (svc, b.total(now)))
            .filter(|(_, n)| *n > 0)
            .collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        let (winner, top) = ranked.first()?;
        let second = ranked.get(1).map(|(_, n)| *n).unwrap_or(0);
        let ambiguous = second as f64 >= *top as f64 * AMBIGUOUS_RATIO;
        Some(((*winner).clone(), ambiguous))
    }

    pub fn to_snapshot_json(&self) -> Result<Vec<u8>, serde_json::Error> {
        self.snapshot().to_json()
    }

    /// The owned copy taken under the table lock; encoding it happens outside the lock.
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            pairing: self
                .pairing
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            self_key: self
                .self_key
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            known_services: self.known_services.clone(),
            self_identity_up_to: self.self_identity_up_to,
            pairing_up_to: self.pairing_up_to,
        }
    }

    pub fn from_snapshot_json(bytes: &[u8], now: i64) -> Result<Self, serde_json::Error> {
        let snap: Snapshot = serde_json::from_slice(bytes)?;
        let mut table = Self::new(snap.self_identity_up_to, snap.pairing_up_to);
        let mut known = snap.known_services;
        known.retain(|_, b| {
            b.prune(now);
            b.total(now) > 0
        });
        table.known_services = known;
        for (k, v) in snap.pairing.into_iter().rev() {
            Self::restore(&mut table.pairing, k, v, now);
        }
        for (k, v) in snap.self_key.into_iter().rev() {
            Self::restore(&mut table.self_key, k, v, now);
        }
        Ok(table)
    }

    fn learn(
        layer: &mut LruCache<TypedKey, ServiceCounts>,
        key: TypedKey,
        service: &str,
        n: u64,
        now: i64,
    ) {
        if n == 0 {
            return;
        }
        match layer.get_mut(&key) {
            Some(counts) => counts.entry(service.to_string()).or_default().add(now, n),
            None => {
                let mut counts = ServiceCounts::new();
                counts.entry(service.to_string()).or_default().add(now, n);
                layer.put(key, counts);
            }
        }
    }

    fn prune_layer(layer: &mut LruCache<TypedKey, ServiceCounts>, now: i64) {
        let mut empty = vec![];
        for (key, counts) in layer.iter_mut() {
            counts.retain(|_, b| {
                b.prune(now);
                b.total(now) > 0
            });
            if counts.is_empty() {
                empty.push(key.clone());
            }
        }
        for key in empty {
            layer.pop(&key);
        }
    }

    fn restore(
        layer: &mut LruCache<TypedKey, ServiceCounts>,
        key: TypedKey,
        mut counts: ServiceCounts,
        now: i64,
    ) {
        counts.retain(|_, b| {
            b.prune(now);
            b.total(now) > 0
        });
        if !counts.is_empty() {
            layer.put(key, counts);
        }
    }
}

pub fn is_ip(value: &str) -> bool {
    value.parse::<IpAddr>().is_ok()
}

pub fn first_label(peer_key: &str) -> Option<&str> {
    let host = strip_port(peer_key);
    if host.is_empty() || is_ip(host) {
        return None;
    }
    let label = host.split('.').next().unwrap_or(host);
    (!label.is_empty()).then_some(label)
}

fn strip_port(key: &str) -> &str {
    let key = key.trim();
    if key.starts_with('[') {
        return key.split(']').next().unwrap_or(key).trim_start_matches('[');
    }
    match key.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') && port.parse::<u16>().is_ok() => host,
        _ => key,
    }
}

pub fn snapshot_path(org: &str) -> PathBuf {
    Path::new(&config::get_config().common.data_cache_dir)
        .join(SNAPSHOT_DIR)
        .join(format!("{org}.json"))
}

/// Temp file in the same directory then rename, so a crash never leaves a torn snapshot.
pub fn write_snapshot_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("snapshot")
    ));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

pub fn read_snapshot_file(path: &Path, now: i64) -> Option<ResolutionTable> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            log::warn!("[ServiceGraph] snapshot {} unreadable: {e}", path.display());
            return None;
        }
    };
    match ResolutionTable::from_snapshot_json(&bytes, now) {
        Ok(t) => Some(t),
        Err(e) => {
            log::warn!("[ServiceGraph] snapshot {} unparsable: {e}", path.display());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000 * SECOND_MICRO_SECS;

    fn self_identity(
        svc: &str,
        key: Option<&str>,
        port: Option<u16>,
        ip: Option<&str>,
        rpc: Option<&str>,
        n: u64,
    ) -> SelfIdentityRow {
        SelfIdentityRow {
            service_name: svc.to_string(),
            infer_self_key: key.map(str::to_string),
            infer_self_port: port,
            infer_self_ip: ip.map(str::to_string),
            rpc_service: rpc.map(str::to_string),
            server_requests: n,
            requests: n.max(1),
        }
    }

    fn pairing(client: &str, key: Option<&str>, callee: &str, n: u64) -> PairingRow {
        PairingRow {
            client: client.to_string(),
            peer_key: key.map(str::to_string),
            peer_port: None,
            peer_ip: None,
            peer_rpc: None,
            peer_sig: None,
            callee: callee.to_string(),
            n,
        }
    }

    fn host(key: &str) -> Candidates {
        Candidates {
            peer_key: Some(key.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn test_typed_key_classification_and_labels() {
        assert_eq!(
            TypedKey::addr("10.0.0.8", Some(80)),
            TypedKey::Ip {
                ip: "10.0.0.8".into(),
                port: Some(80)
            }
        );
        assert_eq!(
            TypedKey::addr("payments.svc", None),
            TypedKey::Host {
                key: "payments.svc".into(),
                port: None
            }
        );
        assert_eq!(
            first_label("currency.default.svc.cluster.local"),
            Some("currency")
        );
        assert_eq!(first_label("frontend-proxy:8080"), Some("frontend-proxy"));
        assert_eq!(first_label("10.0.0.8"), None);
        assert_eq!(first_label("[::1]:80"), None);
        assert_eq!(first_label(""), None);
    }

    #[test]
    fn test_candidate_key_order() {
        let c = Candidates {
            peer_key: Some("payments.svc".into()),
            peer_port: Some(443),
            peer_ip: Some("10.0.0.8".into()),
            rpc: Some("pay.Pay".into()),
            sig: Some(("a".into(), "op".into())),
        };
        let keys = c.keys(true);
        assert_eq!(keys.len(), 5);
        assert!(matches!(
            &keys[0],
            TypedKey::Host {
                port: Some(443),
                ..
            }
        ));
        assert!(matches!(&keys[1], TypedKey::Host { port: None, .. }));
        assert!(matches!(
            &keys[2],
            TypedKey::Ip {
                port: Some(443),
                ..
            }
        ));
        assert!(matches!(&keys[3], TypedKey::Ip { port: None, .. }));
        assert!(matches!(&keys[4], TypedKey::Rpc(_)));
        let sig_only = Candidates {
            sig: Some(("a".into(), "op".into())),
            ..Default::default()
        };
        assert_eq!(sig_only.keys(true).len(), 1);
        assert!(sig_only.keys(false).is_empty());
    }

    #[test]
    fn test_pairing_beats_self_key() {
        let mut t = ResolutionTable::new(0, 0);
        t.learn_self_identity(
            &[self_identity(
                "frontend",
                Some("frontend-proxy"),
                None,
                None,
                None,
                100,
            )],
            NOW,
        );
        t.learn_pairing(
            &[pairing(
                "load-generator",
                Some("frontend-proxy"),
                "frontend-proxy",
                1,
            )],
            NOW,
        );
        let r = t.resolve_candidates(&host("frontend-proxy"), NOW).unwrap();
        assert_eq!(r.service, "frontend-proxy");
        assert_eq!(r.tier, Tier::Pairing);
        assert!(!r.ambiguous);
    }

    #[test]
    fn test_host_miss_then_ip_hit_and_rpc_only() {
        let mut t = ResolutionTable::new(0, 0);
        t.learn_self_identity(
            &[
                self_identity("currency", None, None, Some("10.0.0.5"), None, 10),
                self_identity(
                    "product-catalog",
                    None,
                    None,
                    None,
                    Some("oteldemo.ProductCatalogService"),
                    10,
                ),
            ],
            NOW,
        );
        let c = Candidates {
            peer_key: Some("opaque-host".into()),
            peer_ip: Some("10.0.0.5".into()),
            ..Default::default()
        };
        let r = t.resolve_candidates(&c, NOW).unwrap();
        assert_eq!(r.service, "currency");
        assert_eq!(r.tier, Tier::SelfKey);
        let c = Candidates {
            rpc: Some("oteldemo.ProductCatalogService".into()),
            ..Default::default()
        };
        assert_eq!(
            t.resolve_candidates(&c, NOW).unwrap().service,
            "product-catalog"
        );
        assert!(t.resolve_candidates(&host("nothing"), NOW).is_none());
        assert!(t.is_known_service("currency", NOW));
        assert!(!t.is_known_service("nobody", NOW));
    }

    #[test]
    fn test_majority_and_ambiguous() {
        let mut t = ResolutionTable::new(0, 0);
        t.learn_self_identity(
            &[
                self_identity("a", Some("gw"), None, None, None, 70),
                self_identity("b", Some("gw"), None, None, None, 30),
            ],
            NOW,
        );
        let r = t.resolve_candidates(&host("gw"), NOW).unwrap();
        assert_eq!(r.service, "a");
        assert!(r.ambiguous);
        t.learn_self_identity(
            &[self_identity("a", Some("gw"), None, None, None, 100)],
            NOW,
        );
        let r = t.resolve_candidates(&host("gw"), NOW).unwrap();
        assert_eq!(r.service, "a");
        assert!(!r.ambiguous);
    }

    #[test]
    fn test_bucket_expiry_after_24h() {
        let mut t = ResolutionTable::new(0, 0);
        t.learn_self_identity(&[self_identity("old", Some("h"), None, None, None, 5)], NOW);
        assert!(t.resolve_candidates(&host("h"), NOW).is_some());
        let later = NOW + WINDOW_24H_MICROS + HOUR_MICROS;
        assert!(t.resolve_candidates(&host("h"), later).is_none());
        assert!(!t.is_known_service("old", later));
        assert_eq!(t.known_service_count(later), 0);
        let mut b = HourBuckets::default();
        b.add(NOW, 1);
        b.add(NOW + HOUR_MICROS * 25, 2);
        assert_eq!(b.slots.len(), 1);
        assert_eq!(b.total(NOW + HOUR_MICROS * 25), 2);
    }

    #[test]
    fn test_prune_reclaims_expired_services_and_keys() {
        let mut t = ResolutionTable::new(0, 0);
        for i in 0..50 {
            let at = NOW + i * HOUR_MICROS;
            t.learn_self_identity(
                &[self_identity(
                    &format!("svc{i}"),
                    Some("stable-host"),
                    None,
                    None,
                    None,
                    1,
                )],
                at,
            );
            t.learn_self_identity(
                &[self_identity(
                    "only-old",
                    Some(&format!("h{i}")),
                    None,
                    None,
                    None,
                    1,
                )],
                at,
            );
        }
        let later = NOW + 49 * HOUR_MICROS;
        assert_eq!(t.known_services.len(), 51);
        assert_eq!(t.key_count(), 51);
        t.prune(later);
        assert_eq!(t.known_service_count(later), t.known_services.len());
        assert!(t.known_services.len() < 30);
        assert!(!t.known_services.contains_key("svc0"));
        assert!(t.known_services.contains_key("svc49"));
        let stable = t.lookup(Layer::SelfKey, &TypedKey::addr("stable-host", None), later);
        assert!(stable.is_some());
        assert!(t.key_count() < 30, "{}", t.key_count());
        assert!(t.resolve_candidates(&host("h0"), later).is_none());
        let bytes = t.to_snapshot_json().unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("svc0\""));
    }

    #[test]
    fn test_lru_cap() {
        let mut t = ResolutionTable::with_capacity(2, 0, 0);
        for i in 0..3 {
            t.learn_self_identity(
                &[self_identity(
                    "s",
                    Some(&format!("h{i}")),
                    None,
                    None,
                    None,
                    1,
                )],
                NOW,
            );
        }
        assert_eq!(t.key_count(), 2);
        assert!(t.resolve_candidates(&host("h0"), NOW).is_none());
        assert!(t.resolve_candidates(&host("h2"), NOW).is_some());
    }

    #[test]
    fn test_snapshot_round_trip_and_corrupt_fallback() {
        let mut t = ResolutionTable::new(100, 200);
        t.learn_self_identity(
            &[self_identity("svc", Some("h"), Some(80), None, None, 3)],
            NOW,
        );
        t.learn_pairing(&[pairing("c", Some("h"), "svc2", 2)], NOW);
        let bytes = t.to_snapshot_json().unwrap();
        let back = ResolutionTable::from_snapshot_json(&bytes, NOW).unwrap();
        assert_eq!(back.self_identity_up_to, 100);
        assert_eq!(back.pairing_up_to, 200);
        assert_eq!(back.key_count(), 2);
        assert!(back.is_known_service("svc", NOW));
        let c = Candidates {
            peer_key: Some("h".into()),
            peer_port: Some(80),
            ..Default::default()
        };
        assert_eq!(back.resolve_candidates(&c, NOW).unwrap().service, "svc2");
        let stale =
            ResolutionTable::from_snapshot_json(&bytes, NOW + 2 * WINDOW_24H_MICROS).unwrap();
        assert_eq!(stale.key_count(), 0);
        assert!(stale.known_services.is_empty());

        let dir = std::env::temp_dir().join(format!("sg_snapshot_{}", std::process::id()));
        let path = dir.join("org.json");
        assert!(read_snapshot_file(&path, NOW).is_none());
        write_snapshot_file(&path, b"{not json").unwrap();
        assert!(read_snapshot_file(&path, NOW).is_none());
        write_snapshot_file(&path, &bytes).unwrap();
        assert_eq!(read_snapshot_file(&path, NOW).unwrap().key_count(), 2);
        assert!(!dir.join(".org.json.tmp").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_cold_start_boundary_is_min_claimed_offset() {
        assert_eq!(
            ResolutionTable::cold_start_boundary(&[500, 300, 0], 900),
            300
        );
        assert_eq!(ResolutionTable::cold_start_boundary(&[0, 0], 900), 900);
        assert_eq!(ResolutionTable::cold_start_boundary(&[], 900), 900);
    }
}
