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

//! Root-blocker chain assembly (proof §2.2 / §4: `pg_blocking_pids()` yields DIRECT blocker
//! edges only — multi-level transitive assembly is O2-side work: a chain is what the operator
//! needs to see, and the engine only reports its links).
//!
//! Input is a set of `blocked → blocking` edges sampled at one poll. Output is a forest of
//! blocking trees, each rooted at a **root blocker**: a session that blocks others but is itself
//! blocked by nobody. The root blocker is the actionable session — killing it releases the
//! entire subtree.
//!
//! ## The cases that make this non-trivial
//!
//! Real `pg_stat_activity` snapshots are not clean trees. Every one of these is handled
//! explicitly and covered by a test:
//!
//! - **Cycles.** A deadlock caught mid-detection samples as `A→B→A`; the engine has not yet aborted
//!   a victim. There is no root, so a cycle would loop forever in a naive walk. Cycles are
//!   detected, reported as `cyclic: true`, and rooted at the cycle's lowest pid (a stable,
//!   deterministic choice — NOT an arbitrary traversal-order pick).
//! - **Self-blocks.** `pid → pid` edges appear from `pg_blocking_pids()` in some lock-type corner
//!   cases. They carry no information and are dropped before assembly.
//! - **Orphans.** The blocker pid is frequently NOT itself a blocked row (it is simply holding a
//!   lock and running fine), so it has no inbound edge and no sample of its own. It is still a
//!   legitimate root and must appear.
//! - **Multi-level.** `A→B→C` must produce ONE tree rooted at C with depth 2, not three unrelated
//!   pairs.
//! - **Ties / fan-out.** One blocker with many blocked sessions is one tree with many children,
//!   ordered deterministically (by wait time desc, then pid) so the API response is stable.
//! - **Multiple direct blockers.** `pg_blocking_pids()` can return several blockers for one
//!   session. The edge with the LONGEST wait wins as the tree parent (the others remain in the flat
//!   sample list) — otherwise a session would appear in two trees and totals would double-count.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde_json::{Value, json};

use super::server_vantage::BlockingSample;

/// One node in an assembled blocking tree.
#[derive(Debug, Clone, PartialEq)]
pub struct ChainNode {
    pub pid: i64,
    pub app: Option<String>,
    pub query: Option<String>,
    pub fingerprint: Option<String>,
    /// Seconds this session has been waiting (root blockers wait for nobody → `None`).
    pub wait_seconds: Option<f64>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    /// Distance from the root blocker (root = 0).
    pub depth: usize,
    pub children: Vec<ChainNode>,
}

impl ChainNode {
    fn to_json(&self) -> Value {
        json!({
            "pid": self.pid,
            "app": self.app,
            "query": self.query,
            "fingerprint": self.fingerprint,
            "wait_seconds": self.wait_seconds,
            "wait_event_type": self.wait_event_type,
            "wait_event": self.wait_event,
            "depth": self.depth,
            "children": self.children.iter().map(|c| c.to_json()).collect::<Vec<_>>(),
        })
    }

    /// Total sessions in this subtree, including itself.
    fn subtree_size(&self) -> usize {
        1 + self
            .children
            .iter()
            .map(|c| c.subtree_size())
            .sum::<usize>()
    }

    fn max_depth(&self) -> usize {
        self.children
            .iter()
            .map(|c| c.max_depth())
            .max()
            .unwrap_or(self.depth)
            .max(self.depth)
    }

    fn max_wait(&self) -> f64 {
        let own = self.wait_seconds.unwrap_or(0.0);
        self.children
            .iter()
            .map(|c| c.max_wait())
            .fold(own, f64::max)
    }
}

/// One assembled blocking tree.
#[derive(Debug, Clone, PartialEq)]
pub struct BlockingChain {
    pub root: ChainNode,
    /// Sessions blocked (directly or transitively) by the root.
    pub blocked_count: usize,
    /// Deepest level below the root.
    pub depth: usize,
    /// Longest wait anywhere in the tree — the chain's severity ranking key.
    pub max_wait_seconds: f64,
    /// True when the edges formed a cycle (a deadlock sampled before the engine aborted a
    /// victim). The root is then the cycle's lowest pid and `blocked_count` counts the cycle.
    pub cyclic: bool,
    pub engine: Option<String>,
    pub database: Option<String>,
    pub instance: Option<String>,
}

impl BlockingChain {
    pub fn to_json(&self) -> Value {
        json!({
            "root": self.root.to_json(),
            "root_pid": self.root.pid,
            "root_app": self.root.app,
            "root_query": self.root.query,
            "root_fingerprint": self.root.fingerprint,
            "blocked_count": self.blocked_count,
            "depth": self.depth,
            "max_wait_seconds": self.max_wait_seconds,
            "cyclic": self.cyclic,
            "engine": self.engine,
            "database": self.database,
            "instance": self.instance,
        })
    }
}

/// Session-level facts gathered across all samples mentioning a pid.
#[derive(Default, Clone)]
struct SessionInfo {
    app: Option<String>,
    query: Option<String>,
    fingerprint: Option<String>,
    wait_seconds: Option<f64>,
    wait_event_type: Option<String>,
    wait_event: Option<String>,
}

impl SessionInfo {
    /// Merge in a fact, preferring the first non-empty value but always keeping the LONGEST
    /// observed wait (samples of the same session across a window disagree; the worst case is
    /// the interesting one).
    fn absorb(&mut self, other: SessionInfo) {
        self.app = self.app.take().or(other.app);
        self.query = self.query.take().or(other.query);
        self.fingerprint = self.fingerprint.take().or(other.fingerprint);
        self.wait_event_type = self.wait_event_type.take().or(other.wait_event_type);
        self.wait_event = self.wait_event.take().or(other.wait_event);
        self.wait_seconds = match (self.wait_seconds, other.wait_seconds) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
    }
}

/// Assemble root-blocker chains from a set of blocking samples.
///
/// Samples are grouped by `(engine, instance, database)` first — pids are only comparable within
/// one server, so mixing instances would fabricate chains between unrelated databases.
pub fn assemble_chains(samples: &[BlockingSample]) -> Vec<BlockingChain> {
    // Group by server scope.
    let mut scopes: BTreeMap<(String, String, String), Vec<&BlockingSample>> = BTreeMap::new();
    for s in samples {
        let key = (
            s.engine.clone().unwrap_or_default(),
            s.instance.clone().unwrap_or_default(),
            s.database.clone().unwrap_or_default(),
        );
        scopes.entry(key).or_default().push(s);
    }

    let mut chains = Vec::new();
    for ((engine, instance, database), scoped) in scopes {
        chains.extend(assemble_scope(
            &scoped,
            opt(engine),
            opt(instance),
            opt(database),
        ));
    }

    // Deterministic, severity-first ordering: worst wait, then most sessions, then root pid.
    chains.sort_by(|a, b| {
        b.max_wait_seconds
            .partial_cmp(&a.max_wait_seconds)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.blocked_count.cmp(&a.blocked_count))
            .then(a.root.pid.cmp(&b.root.pid))
    });
    chains
}

fn opt(s: String) -> Option<String> {
    (!s.is_empty()).then_some(s)
}

fn assemble_scope(
    samples: &[&BlockingSample],
    engine: Option<String>,
    instance: Option<String>,
    database: Option<String>,
) -> Vec<BlockingChain> {
    // 1. Collect session facts and the blocked→blocking edge set.
    let mut sessions: HashMap<i64, SessionInfo> = HashMap::new();
    // blocked pid → (blocking pid, wait) — keep only the LONGEST-waiting edge per blocked
    // session so a session with several direct blockers lands in exactly one tree.
    let mut parent: HashMap<i64, (i64, f64)> = HashMap::new();
    // The set of pids that block someone (used to find roots that never appear as blocked).
    let mut blockers: BTreeSet<i64> = BTreeSet::new();

    for s in samples {
        let (Some(blocked), Some(blocking)) = (s.blocked_pid, s.blocking_pid) else {
            continue;
        };
        // Self-blocks carry no information and would form a degenerate 1-cycle.
        if blocked == blocking {
            continue;
        }

        sessions.entry(blocked).or_default().absorb(SessionInfo {
            app: s.blocked_app.clone(),
            query: s.blocked_query.clone(),
            fingerprint: s.blocked_fingerprint.clone(),
            wait_seconds: s.wait_seconds,
            wait_event_type: s.wait_event_type.clone(),
            wait_event: s.wait_event.clone(),
        });
        sessions.entry(blocking).or_default().absorb(SessionInfo {
            app: s.blocking_app.clone(),
            query: s.blocking_query.clone(),
            fingerprint: s.blocking_fingerprint.clone(),
            // A blocker's own wait is only known if it appears as a blocked row elsewhere.
            ..Default::default()
        });

        blockers.insert(blocking);
        let wait = s.wait_seconds.unwrap_or(0.0);
        parent
            .entry(blocked)
            .and_modify(|e| {
                if wait > e.1 {
                    *e = (blocking, wait);
                }
            })
            .or_insert((blocking, wait));
    }

    if parent.is_empty() {
        return Vec::new();
    }

    // 2. Children adjacency from the winning parent edges.
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    for (&blocked, &(blocking, _)) in &parent {
        children.entry(blocking).or_default().push(blocked);
    }

    // 3. Roots = blockers that are not themselves blocked. Sorted for determinism.
    let roots: Vec<i64> = blockers
        .iter()
        .copied()
        .filter(|p| !parent.contains_key(p))
        .collect();

    let mut chains = Vec::new();
    let mut visited: HashSet<i64> = HashSet::new();

    for root in roots {
        let node = build_node(root, 0, &children, &sessions, &mut visited);
        chains.push(finish(node, false, &engine, &instance, &database));
    }

    // 4. Anything unvisited is inside a CYCLE (every node has a parent, so no root exists). Root it
    //    at the cycle's lowest pid — deterministic, not traversal-order dependent.
    let mut remaining: BTreeSet<i64> = parent
        .keys()
        .copied()
        .chain(children.keys().copied())
        .filter(|p| !visited.contains(p))
        .collect();

    while let Some(&start) = remaining.iter().next() {
        // Walk the parent pointers to find the cycle this node feeds into.
        let cycle = find_cycle(start, &parent);
        let root = cycle.iter().copied().min().unwrap_or(start);
        // Break the cycle at the root by treating the root as parentless for traversal.
        let mut cyc_children = children.clone();
        if let Some((root_parent, _)) = parent.get(&root)
            && let Some(sibs) = cyc_children.get_mut(root_parent)
        {
            sibs.retain(|c| *c != root);
        }
        let node = build_node(root, 0, &cyc_children, &sessions, &mut visited);
        for p in collect_pids(&node) {
            remaining.remove(&p);
        }
        remaining.remove(&root);
        chains.push(finish(node, true, &engine, &instance, &database));
    }

    chains
}

/// Follow parent pointers from `start` until a pid repeats — the repeated pid is on the cycle.
/// Returns the members of that cycle.
fn find_cycle(start: i64, parent: &HashMap<i64, (i64, f64)>) -> Vec<i64> {
    let mut seen_order: Vec<i64> = Vec::new();
    let mut seen: HashSet<i64> = HashSet::new();
    let mut cur = start;
    loop {
        if !seen.insert(cur) {
            // `cur` is the entry point of the cycle; the cycle is the tail from its first
            // occurrence onward.
            let at = seen_order.iter().position(|p| *p == cur).unwrap_or(0);
            return seen_order[at..].to_vec();
        }
        seen_order.push(cur);
        match parent.get(&cur) {
            Some((next, _)) => cur = *next,
            // No cycle after all (shouldn't happen for unvisited nodes, but never loop).
            None => return seen_order,
        }
    }
}

fn collect_pids(node: &ChainNode) -> Vec<i64> {
    let mut out = vec![node.pid];
    for c in &node.children {
        out.extend(collect_pids(c));
    }
    out
}

/// Depth-first tree build with a visited guard — the guard is what makes a cycle terminate.
fn build_node(
    pid: i64,
    depth: usize,
    children: &HashMap<i64, Vec<i64>>,
    sessions: &HashMap<i64, SessionInfo>,
    visited: &mut HashSet<i64>,
) -> ChainNode {
    visited.insert(pid);
    let info = sessions.get(&pid).cloned().unwrap_or_default();

    let mut kids: Vec<ChainNode> = Vec::new();
    if let Some(list) = children.get(&pid) {
        // Deterministic child order: longest wait first, then pid.
        let mut sorted: Vec<i64> = list
            .iter()
            .copied()
            .filter(|c| !visited.contains(c))
            .collect();
        sorted.sort_by(|a, b| {
            let wa = sessions.get(a).and_then(|s| s.wait_seconds).unwrap_or(0.0);
            let wb = sessions.get(b).and_then(|s| s.wait_seconds).unwrap_or(0.0);
            wb.partial_cmp(&wa)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(b))
        });
        for c in sorted {
            if visited.contains(&c) {
                continue;
            }
            kids.push(build_node(c, depth + 1, children, sessions, visited));
        }
    }

    ChainNode {
        pid,
        app: info.app,
        query: info.query,
        fingerprint: info.fingerprint,
        wait_seconds: info.wait_seconds,
        wait_event_type: info.wait_event_type,
        wait_event: info.wait_event,
        depth,
        children: kids,
    }
}

fn finish(
    root: ChainNode,
    cyclic: bool,
    engine: &Option<String>,
    instance: &Option<String>,
    database: &Option<String>,
) -> BlockingChain {
    let blocked_count = root.subtree_size().saturating_sub(1);
    let depth = root.max_depth();
    let max_wait_seconds = root.max_wait();
    BlockingChain {
        root,
        blocked_count,
        depth,
        max_wait_seconds,
        cyclic,
        engine: engine.clone(),
        database: database.clone(),
        instance: instance.clone(),
    }
}
