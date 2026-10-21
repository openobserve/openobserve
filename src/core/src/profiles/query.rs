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

//! Profile query helpers: fold stacked samples into a call tree for
//! Flame Graph / Call Tree / Top Table views.

use std::{
    cmp::{Ordering, Reverse},
    collections::{BinaryHeap, HashMap, HashSet},
};

use serde::{Deserialize, Serialize};

pub const DEFAULT_MAX_NODES: usize = 2048;
/// Hard upper bound for `max_nodes` to avoid unbounded response trees.
pub const MAX_MAX_NODES: usize = 16_384;
/// Max frames kept per stack at ingest and when folding into a call tree.
/// Bounds recursion / stack use independently of the response `max_nodes` cap.
pub const MAX_STACK_DEPTH: usize = 128;
pub const OTHER_NODE_NAME: &str = "other";
pub const ROOT_NODE_NAME: &str = "total";
/// Synthetic frame for ancestors dropped when a stack exceeds [`MAX_STACK_DEPTH`].
pub const TRUNCATED_ANCESTORS_NAME: &str = "[truncated]";

/// Profiled time of one OTLP Profile, on one row per (profile, instance) so sums count it once.
pub const PROFILE_DURATION_COLUMN: &str = "profile_duration_nanos";
/// Columns that identify one profiled process; profiled time is tracked per this identity.
pub const INSTANCE_KEY_COLUMNS: &[&str] = &[
    "service_name",
    "service_instance_id",
    "host_name",
    "process_pid",
];

/// Top-bar dimensions from `/profiles/meta`; not Tags Filter keys.
pub const META_DIMENSION_COLUMNS: &[&str] = &["otel_scope_name", "service_name", "profile_type"];

/// Internal / measurement columns that must not become Tags Filter keys.
pub const EXCLUDED_TAG_DISCOVERY_KEYS: &[&str] = &[
    "_timestamp",
    "stack",
    "value",
    "tags",
    "sample_tags",
    "event_id",
    "extractor_version",
    "frame_count",
    "duration_nanos",
    PROFILE_DURATION_COLUMN,
    "period",
    "period_nanos",
    "period_type",
    "period_unit",
    "profile_id",
    "profile_unit",
    "otel_scope_version",
    // Payload / summary columns (not business tags).
    "bytes",
    "profile_blob",
    "profile_encoding",
    "has_original_payload",
    "has_trace_link",
    "original_payload_format",
    "original_payload_size",
    "sample_count",
    "sample_value_count",
    "sample_value_sum",
    "linked_sample_count",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TreeNode {
    pub name: String,
    #[serde(rename = "self")]
    pub self_value: i64,
    pub total: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<TreeNode>,
}

impl TreeNode {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            self_value: 0,
            total: 0,
            children: Vec::new(),
        }
    }

    pub fn node_count(&self) -> usize {
        count_nodes(self)
    }
}

impl CallNode for TreeNode {
    fn named(name: &str) -> Self {
        Self::new(name)
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn children(&self) -> &[Self] {
        &self.children
    }

    fn children_mut(&mut self) -> &mut Vec<Self> {
        &mut self.children
    }

    fn absorb(&mut self, dropped: &Self) {
        self.total = self.total.saturating_add(dropped.total);
        self.self_value = self.self_value.saturating_add(dropped.total);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TopFunction {
    pub name: String,
    #[serde(rename = "self")]
    pub self_value: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MergeResult {
    pub total: i64,
    pub root: TreeNode,
    pub top: Vec<TopFunction>,
    /// True when the call tree was cut to `max_nodes` and dropped nodes folded into `other`.
    #[serde(default)]
    pub tree_truncated: bool,
}

/// Differential call-tree node: `total` / `self` are the comparison side, `before_*` the baseline.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiffNode {
    pub name: String,
    #[serde(rename = "self")]
    pub self_value: i64,
    pub total: i64,
    pub before_self: i64,
    pub before_total: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<DiffNode>,
}

impl DiffNode {
    fn credit(&mut self, value: i64, leaf: bool, baseline: bool) {
        let (total, self_value) = if baseline {
            (&mut self.before_total, &mut self.before_self)
        } else {
            (&mut self.total, &mut self.self_value)
        };
        *total = total.saturating_add(value);
        if leaf {
            *self_value = self_value.saturating_add(value);
        }
    }
}

impl CallNode for DiffNode {
    fn named(name: &str) -> Self {
        Self {
            name: name.to_string(),
            ..Default::default()
        }
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn children(&self) -> &[Self] {
        &self.children
    }

    fn children_mut(&mut self) -> &mut Vec<Self> {
        &mut self.children
    }

    fn absorb(&mut self, dropped: &Self) {
        self.credit(dropped.total, true, false);
        self.credit(dropped.before_total, true, true);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiffTopFunction {
    pub name: String,
    pub before_self: i64,
    pub before_total: i64,
    pub after_self: i64,
    pub after_total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiffResult {
    pub baseline_total: i64,
    pub comparison_total: i64,
    pub root: DiffNode,
    pub top: Vec<DiffTopFunction>,
    pub tree_truncated: bool,
}

/// Call-tree node shape shared by the merge and diff trees so both fold and cut alike.
trait CallNode: Default {
    fn named(name: &str) -> Self;
    fn name(&self) -> &str;
    fn children(&self) -> &[Self];
    fn children_mut(&mut self) -> &mut Vec<Self>;
    /// Add a dropped sibling's weight to this `other` node, as both total and self.
    fn absorb(&mut self, dropped: &Self);
}

/// Max-heap key for best-first cutting; `total_cmp` makes f64 weights totally ordered.
struct CutWeight(f64);

impl PartialEq for CutWeight {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for CutWeight {}

impl PartialOrd for CutWeight {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for CutWeight {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0)
    }
}

struct CutSlot<T> {
    node: T,
    parent: usize,
    kept: bool,
    pending: usize,
    other: Option<T>,
}

/// Fold leaf→root `;`-joined stacks into a root→leaf call tree.
///
/// Each `(stack, value)` contributes `value` to every frame on the path
/// (`total`) and to the leaf frame's exclusive time (`self`).
/// Paths longer than [`MAX_STACK_DEPTH`] keep the leafward frames and replace
/// dropped root ancestors with [`TRUNCATED_ANCESTORS_NAME`]; insertion is iterative.
pub fn fold_stacks<'a, I>(stacks: I) -> TreeNode
where
    I: IntoIterator<Item = (&'a str, i64)>,
{
    let mut root = TreeNode::new(ROOT_NODE_NAME);
    for (stack, value) in stacks {
        if value == 0 {
            continue;
        }
        add_stack(&mut root, stack, |node, leaf| {
            node.total = node.total.saturating_add(value);
            if leaf {
                node.self_value = node.self_value.saturating_add(value);
            }
        });
    }
    root
}

/// Fold both sides into one tree so every frame carries its baseline and comparison values.
pub fn fold_diff_stacks(baseline: &[(String, i64)], comparison: &[(String, i64)]) -> DiffNode {
    let mut root = DiffNode::named(ROOT_NODE_NAME);
    for (stacks, is_baseline) in [(baseline, true), (comparison, false)] {
        for (stack, value) in stacks {
            if *value == 0 {
                continue;
            }
            add_stack(&mut root, stack, |node, leaf| {
                node.credit(*value, leaf, is_baseline)
            });
        }
    }
    root
}

/// Cap a root→leaf path: keep the executing leaf, mark missing ancestors.
pub fn limit_root_to_leaf_depth(frames: &mut Vec<&str>) {
    if frames.len() <= MAX_STACK_DEPTH {
        return;
    }
    // Keep leafward frames; one slot is reserved for the truncation marker.
    let keep = MAX_STACK_DEPTH.saturating_sub(1).max(1);
    let start = frames.len().saturating_sub(keep);
    let kept = frames[start..].to_vec();
    frames.clear();
    if keep < MAX_STACK_DEPTH {
        frames.push(TRUNCATED_ANCESTORS_NAME);
    }
    frames.extend(kept);
}

/// Cap a stored leaf→root path the same way ingest and fold agree on.
pub fn limit_leaf_to_root_depth(frames: &mut Vec<String>) {
    if frames.len() <= MAX_STACK_DEPTH {
        return;
    }
    let keep = MAX_STACK_DEPTH.saturating_sub(1).max(1);
    frames.truncate(keep);
    if keep < MAX_STACK_DEPTH {
        frames.push(TRUNCATED_ANCESTORS_NAME.to_string());
    }
}

/// Cut to at most `max(max_nodes, 2)` nodes, `other` included, by heaviest total; true if cut.
pub fn truncate_tree(root: &mut TreeNode, max_nodes: usize) -> bool {
    cut_tree(root, max_nodes, |node| node.total as f64)
}

/// Aggregate Top Table rows from leaf→root stacks (pprof flat/cum semantics).
///
/// Each sample adds `value` to a function's `total` at most once even if that
/// name appears multiple times on the stack; `self` is only the leaf frame.
pub fn aggregate_top_functions<'a, I>(stacks: I) -> Vec<TopFunction>
where
    I: IntoIterator<Item = (&'a str, i64)>,
{
    let mut agg: HashMap<String, (i64, i64)> = HashMap::new();
    for (stack, value) in stacks {
        if value == 0 {
            continue;
        }
        let frames = root_to_leaf_frames(stack);
        if frames.is_empty() {
            continue;
        }
        if let Some(&leaf) = frames.last()
            && !is_synthetic_top_name(leaf)
        {
            let entry = agg.entry(leaf.to_string()).or_insert((0, 0));
            entry.0 = entry.0.saturating_add(value);
        }
        let mut seen = HashSet::with_capacity(frames.len());
        for &name in &frames {
            if is_synthetic_top_name(name) || !seen.insert(name) {
                continue;
            }
            let entry = agg.entry(name.to_string()).or_insert((0, 0));
            entry.1 = entry.1.saturating_add(value);
        }
    }
    sort_top_functions(agg)
}

fn is_synthetic_top_name(name: &str) -> bool {
    name == ROOT_NODE_NAME || name == OTHER_NODE_NAME || name == TRUNCATED_ANCESTORS_NAME
}

fn sort_top_functions(agg: HashMap<String, (i64, i64)>) -> Vec<TopFunction> {
    let mut top: Vec<TopFunction> = agg
        .into_iter()
        .map(|(name, (self_value, total))| TopFunction {
            name,
            self_value,
            total,
        })
        .collect();
    top.sort_by(|a, b| {
        b.self_value
            .cmp(&a.self_value)
            .then_with(|| b.total.cmp(&a.total))
            .then_with(|| a.name.cmp(&b.name))
    });
    top
}

/// In-use memory values are snapshots: average them per snapshot, never sum over time.
pub fn is_snapshot_profile_type(profile_type: &str) -> bool {
    profile_type.starts_with("inuse_")
}

pub fn resolve_max_nodes(requested: Option<usize>) -> usize {
    requested
        .unwrap_or(DEFAULT_MAX_NODES)
        .clamp(1, MAX_MAX_NODES)
}

pub fn build_merge_result(stacks: &[(String, i64)], max_nodes: usize) -> MergeResult {
    let mut root = fold_stacks(stacks.iter().map(|(s, v)| (s.as_str(), *v)));
    let total = root.total;
    // Top Table from raw stacks so recursive/same-name frames are not double-counted.
    // Truncation would corrupt Top numbers if derived from the truncated tree.
    let top = aggregate_top_functions(stacks.iter().map(|(s, v)| (s.as_str(), *v)));
    let tree_truncated = max_nodes > 0 && truncate_tree(&mut root, max_nodes);
    MergeResult {
        total,
        root,
        top,
        tree_truncated,
    }
}

/// Cut by each node's larger share of either side's total so hot frames of both sides survive.
pub fn build_diff_result(
    baseline: &[(String, i64)],
    comparison: &[(String, i64)],
    max_nodes: usize,
) -> DiffResult {
    let mut root = fold_diff_stacks(baseline, comparison);
    let (baseline_total, comparison_total) = (root.before_total, root.total);
    let top = diff_top_functions(baseline, comparison, baseline_total, comparison_total);
    let tree_truncated = max_nodes > 0
        && cut_tree(&mut root, max_nodes, |node| {
            share(node.total, comparison_total).max(share(node.before_total, baseline_total))
        });
    DiffResult {
        baseline_total,
        comparison_total,
        root,
        top,
        tree_truncated,
    }
}

/// True for columns that must never be written as flattened tags.
pub fn is_reserved_profile_column(name: &str) -> bool {
    EXCLUDED_TAG_DISCOVERY_KEYS.contains(&name) || name.is_empty()
}

pub fn is_meta_dimension_column(name: &str) -> bool {
    META_DIMENSION_COLUMNS.contains(&name)
}

/// Columns shown in Tags Filter (`label_names`) and used with `/tag_values`.
pub fn is_profiles_tag_column(name: &str) -> bool {
    is_safe_filter_key(name) && !is_reserved_profile_column(name) && !is_meta_dimension_column(name)
}

/// Label names from stream schema: schema columns minus blacklist and meta dimensions.
pub fn label_names_from_schema_fields<'a>(
    fields: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let mut names: Vec<String> = fields
        .into_iter()
        .filter(|name| is_profiles_tag_column(name))
        .map(|s| s.to_string())
        .collect();
    names.sort();
    names.dedup();
    names
}

pub fn is_filterable_column(name: &str) -> bool {
    is_safe_filter_key(name) && !is_reserved_profile_column(name)
}

pub fn is_safe_filter_key(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
}

/// Normalize dotted resource keys to the snake_case column name.
pub fn normalize_tag_key(key: &str) -> String {
    key.replace('.', "_")
}

/// Split a stored leaf→root stack into depth-capped root→leaf frames.
fn root_to_leaf_frames(stack: &str) -> Vec<&str> {
    let mut frames: Vec<&str> = stack
        .split(';')
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .rev()
        .collect();
    limit_root_to_leaf_depth(&mut frames);
    frames
}

/// Credit one stack along its path; the root is the leaf (gets self) only for an empty stack.
fn add_stack<T: CallNode>(root: &mut T, stack: &str, mut credit: impl FnMut(&mut T, bool)) {
    let frames = root_to_leaf_frames(stack);
    credit(root, frames.is_empty());
    let mut node = root;
    for (i, &name) in frames.iter().enumerate() {
        let idx = match node.children().iter().position(|c| c.name() == name) {
            Some(idx) => idx,
            None => {
                node.children_mut().push(T::named(name));
                node.children().len() - 1
            }
        };
        let child = &mut node.children_mut()[idx];
        credit(child, i + 1 == frames.len());
        node = child;
    }
}

/// Best-first cut; the budget also pays for one `other` child per kept node that lost children.
fn cut_tree<T: CallNode>(root: &mut T, max_nodes: usize, weight: impl Fn(&T) -> f64) -> bool {
    // Root plus one `other` child is the smallest tree that keeps every sum exact.
    let max_nodes = max_nodes.max(2);
    if count_nodes(root) <= max_nodes {
        return false;
    }
    let mut slots = vec![CutSlot {
        node: std::mem::take(root),
        parent: 0,
        kept: true,
        pending: 0,
        other: None,
    }];
    let mut heap = BinaryHeap::new();
    let mut kept = 1_usize;
    let mut open_parents = 0_usize;
    open_cut_slot(&mut slots, 0, &mut heap, &weight, &mut open_parents);
    while let Some((_, Reverse(idx))) = heap.pop() {
        let parent = slots[idx].parent;
        let opens = usize::from(!slots[idx].node.children().is_empty());
        let closes = usize::from(slots[parent].pending == 1);
        if kept + 1 + open_parents + opens - closes > max_nodes {
            break;
        }
        kept += 1;
        slots[idx].kept = true;
        slots[parent].pending -= 1;
        open_parents -= closes;
        open_cut_slot(&mut slots, idx, &mut heap, &weight, &mut open_parents);
    }
    // Children always sit after their parent, so a reverse pass completes each subtree first.
    for idx in (1..slots.len()).rev() {
        let parent = slots[idx].parent;
        if slots[idx].kept {
            let node = finish_cut_slot(&mut slots[idx]);
            slots[parent].node.children_mut().push(node);
        } else {
            let dropped = std::mem::take(&mut slots[idx].node);
            slots[parent]
                .other
                .get_or_insert_with(|| T::named(OTHER_NODE_NAME))
                .absorb(&dropped);
        }
    }
    *root = finish_cut_slot(&mut slots[0]);
    true
}

fn open_cut_slot<T: CallNode>(
    slots: &mut Vec<CutSlot<T>>,
    idx: usize,
    heap: &mut BinaryHeap<(CutWeight, Reverse<usize>)>,
    weight: &impl Fn(&T) -> f64,
    open_parents: &mut usize,
) {
    let children = std::mem::take(slots[idx].node.children_mut());
    if children.is_empty() {
        return;
    }
    slots[idx].pending = children.len();
    *open_parents += 1;
    for child in children {
        heap.push((CutWeight(weight(&child)), Reverse(slots.len())));
        slots.push(CutSlot {
            node: child,
            parent: idx,
            kept: false,
            pending: 0,
            other: None,
        });
    }
}

/// Kept children were pushed in reverse slot order; restore it and append `other` last.
fn finish_cut_slot<T: CallNode>(slot: &mut CutSlot<T>) -> T {
    let mut node = std::mem::take(&mut slot.node);
    node.children_mut().reverse();
    node.children_mut().extend(slot.other.take());
    node
}

fn count_nodes<T: CallNode>(node: &T) -> usize {
    1 + node.children().iter().map(count_nodes).sum::<usize>()
}

fn diff_top_functions(
    baseline: &[(String, i64)],
    comparison: &[(String, i64)],
    baseline_total: i64,
    comparison_total: i64,
) -> Vec<DiffTopFunction> {
    let mut rows: HashMap<String, DiffTopFunction> = HashMap::new();
    for (stacks, is_baseline) in [(baseline, true), (comparison, false)] {
        for top in aggregate_top_functions(stacks.iter().map(|(s, v)| (s.as_str(), *v))) {
            let row = rows
                .entry(top.name.clone())
                .or_insert_with(|| DiffTopFunction {
                    name: top.name,
                    before_self: 0,
                    before_total: 0,
                    after_self: 0,
                    after_total: 0,
                });
            if is_baseline {
                row.before_self = top.self_value;
                row.before_total = top.total;
            } else {
                row.after_self = top.self_value;
                row.after_total = top.total;
            }
        }
    }
    let change = |row: &DiffTopFunction| {
        (share(row.after_total, comparison_total) - share(row.before_total, baseline_total)).abs()
    };
    let mut top: Vec<DiffTopFunction> = rows.into_values().collect();
    top.sort_by(|a, b| {
        change(b)
            .total_cmp(&change(a))
            .then_with(|| a.name.cmp(&b.name))
    });
    top
}

fn share(value: i64, total: i64) -> f64 {
    if total == 0 {
        0.0
    } else {
        value as f64 / total as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_stacks_builds_root_to_leaf_tree_with_self_and_total() {
        // Stored as leaf→root
        let root = fold_stacks([
            ("leaf;mid;root_fn", 10),
            ("other;mid;root_fn", 5),
            ("alone", 2),
        ]);
        assert_eq!(root.name, "total");
        assert_eq!(root.total, 17);
        assert_eq!(root.self_value, 0);

        let root_fn = root.children.iter().find(|c| c.name == "root_fn").unwrap();
        assert_eq!(root_fn.total, 15);
        assert_eq!(root_fn.self_value, 0);

        let mid = root_fn.children.iter().find(|c| c.name == "mid").unwrap();
        assert_eq!(mid.total, 15);
        let leaf = mid.children.iter().find(|c| c.name == "leaf").unwrap();
        assert_eq!(leaf.self_value, 10);
        assert_eq!(leaf.total, 10);
        let other = mid.children.iter().find(|c| c.name == "other").unwrap();
        assert_eq!(other.self_value, 5);

        let alone = root.children.iter().find(|c| c.name == "alone").unwrap();
        assert_eq!(alone.self_value, 2);
        assert_eq!(alone.total, 2);
    }

    #[test]
    fn aggregate_top_sums_self_by_function_name() {
        let top = aggregate_top_functions([("a;shared", 3), ("b;shared", 4)]);
        let shared = top.iter().find(|t| t.name == "shared").unwrap();
        assert_eq!(shared.self_value, 0);
        assert_eq!(shared.total, 7);
        let a = top.iter().find(|t| t.name == "a").unwrap();
        assert_eq!(a.self_value, 3);
        assert_eq!(a.total, 3);
    }

    #[test]
    fn aggregate_top_counts_repeated_frame_name_once_per_sample() {
        // leaf→root with the same name at leaf and ancestor (recursion).
        let top = aggregate_top_functions([("foo;bar;foo", 100)]);
        let foo = top.iter().find(|t| t.name == "foo").unwrap();
        assert_eq!(foo.self_value, 100);
        assert_eq!(foo.total, 100);
        let bar = top.iter().find(|t| t.name == "bar").unwrap();
        assert_eq!(bar.self_value, 0);
        assert_eq!(bar.total, 100);
        assert!(top.iter().all(|t| t.total <= 100));
    }

    #[test]
    fn build_merge_result_top_total_never_exceeds_sample_total() {
        let stacks = vec![
            ("foo;bar;foo".to_string(), 50),
            ("foo;baz;foo".to_string(), 50),
            ("leaf;mid;root".to_string(), 89),
        ];
        let result = build_merge_result(&stacks, DEFAULT_MAX_NODES);
        assert_eq!(result.total, 189);
        for row in &result.top {
            assert!(
                row.total <= result.total,
                "{} total {} > merge total {}",
                row.name,
                row.total,
                result.total
            );
        }
        let foo = result.top.iter().find(|t| t.name == "foo").unwrap();
        assert_eq!(foo.total, 100);
        assert_eq!(foo.self_value, 100);
    }

    #[test]
    fn truncate_tree_respects_max_nodes() {
        let stacks: Vec<(String, i64)> = (0..50)
            .map(|i| (format!("leaf{i};common"), i + 1))
            .collect();
        let mut root = fold_stacks(stacks.iter().map(|(s, v)| (s.as_str(), *v)));
        let before = root.node_count();
        assert!(before > 10);
        truncate_tree(&mut root, 10);
        assert!(root.node_count() <= 10);
        // total weight preserved at root
        let expected: i64 = (1..=50).sum();
        assert_eq!(root.total, expected);
    }

    #[test]
    fn build_merge_result_returns_sorted_top() {
        let stacks = vec![("hot;main".to_string(), 100), ("cold;main".to_string(), 1)];
        let result = build_merge_result(&stacks, DEFAULT_MAX_NODES);
        assert_eq!(result.total, 101);
        assert!(!result.tree_truncated);
        assert_eq!(result.top[0].name, "hot");
        assert_eq!(result.top[0].self_value, 100);
    }

    #[test]
    fn build_merge_result_keeps_top_exclusive_after_truncate() {
        let stacks: Vec<(String, i64)> = (0..40).map(|i| (format!("leaf{i};common"), 10)).collect();
        let result = build_merge_result(&stacks, 5);
        assert!(result.root.node_count() <= 5);
        assert!(result.tree_truncated);
        let leaf0 = result.top.iter().find(|t| t.name == "leaf0").unwrap();
        assert_eq!(leaf0.self_value, 10);
        let common = result.top.iter().find(|t| t.name == "common").unwrap();
        assert_eq!(common.self_value, 0);
        assert_eq!(common.total, 400);
    }

    #[test]
    fn resolve_max_nodes_clamps() {
        assert_eq!(resolve_max_nodes(None), DEFAULT_MAX_NODES);
        assert_eq!(resolve_max_nodes(Some(0)), 1);
        assert_eq!(resolve_max_nodes(Some(MAX_MAX_NODES + 10)), MAX_MAX_NODES);
    }

    #[test]
    fn fold_stacks_empty_stack_adds_to_root_self() {
        let root = fold_stacks([("", 7), ("a;main", 3)]);
        assert_eq!(root.total, 10);
        assert_eq!(root.self_value, 7);
    }

    #[test]
    fn fold_stacks_truncates_depth_to_max_stack_depth() {
        // leaf→root; after rev, leafward frames are kept under a truncation marker.
        let frames: Vec<String> = (0..(MAX_STACK_DEPTH + 50))
            .map(|i| format!("f{i}"))
            .collect();
        let stack = frames.join(";");
        let root = fold_stacks([(stack.as_str(), 1)]);
        assert_eq!(root.total, 1);
        let mut depth = 0usize;
        let mut node = &root;
        while let Some(child) = node.children.first() {
            depth += 1;
            node = child;
        }
        assert_eq!(depth, MAX_STACK_DEPTH);
        assert_eq!(root.children[0].name, TRUNCATED_ANCESTORS_NAME);
        // Stored leaf is f0; it must remain the exclusive hotspot.
        assert_eq!(node.name, "f0");
        assert_eq!(node.self_value, 1);
    }

    #[test]
    fn fold_stacks_keeps_leaf_self_when_just_over_depth_limit() {
        // Review reproduction: hot_leaf;caller1;...;caller{MAX} (MAX+1 frames).
        let mut frames = vec!["hot_leaf".to_string()];
        for i in 1..=MAX_STACK_DEPTH {
            frames.push(format!("caller{i}"));
        }
        let stack = frames.join(";");
        let result = build_merge_result(&[(stack, 100)], DEFAULT_MAX_NODES);
        let hot = result.top.iter().find(|t| t.name == "hot_leaf").unwrap();
        assert_eq!(hot.self_value, 100);
        assert!(
            result
                .top
                .iter()
                .find(|t| t.name == "caller1")
                .map(|t| t.self_value)
                .unwrap_or(0)
                == 0
        );
        assert_eq!(result.root.children[0].name, TRUNCATED_ANCESTORS_NAME);
    }

    #[test]
    fn limit_leaf_to_root_depth_matches_fold_leaf_side() {
        let mut frames: Vec<String> = (0..(MAX_STACK_DEPTH + 10))
            .map(|i| format!("f{i}"))
            .collect();
        limit_leaf_to_root_depth(&mut frames);
        assert_eq!(frames.len(), MAX_STACK_DEPTH);
        assert_eq!(frames[0], "f0");
        assert_eq!(frames[frames.len() - 1], TRUNCATED_ANCESTORS_NAME);
    }

    #[test]
    fn build_merge_result_handles_deep_stack_without_panic() {
        let frames: Vec<String> = (0..10_000).map(|i| format!("f{i}")).collect();
        let stacks = vec![(frames.join(";"), 1)];
        let result = build_merge_result(&stacks, 1);
        assert_eq!(result.total, 1);
        // A budget of 1 still returns root plus `other` so root.self stays exact.
        assert_eq!(result.root.node_count(), 2);
        assert_eq!(result.root.self_value, 0);
        assert_eq!(result.root.children[0].name, OTHER_NODE_NAME);
        assert_eq!(result.root.children[0].total, 1);
    }

    fn child<'a>(node: &'a TreeNode, name: &str) -> &'a TreeNode {
        node.children
            .iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("{} has no child {name}", node.name))
    }

    fn assert_tree_sums_hold(node: &TreeNode) {
        let children: i64 = node.children.iter().map(|c| c.total).sum();
        assert_eq!(node.total, node.self_value + children, "at {}", node.name);
        node.children.iter().for_each(assert_tree_sums_hold);
    }

    #[test]
    fn truncate_tree_leaves_a_tree_under_budget_unchanged() {
        let mut root = fold_stacks([("a;main", 5), ("b;main", 3), ("c;util", 1), ("", 2)]);
        let before = root.clone();
        assert!(!truncate_tree(&mut root, before.node_count()));
        assert_eq!(root, before);
    }

    #[test]
    fn truncate_tree_keeps_heaviest_paths_and_exact_sums() {
        let mut stacks = vec![("hot3;hot2;hot1;main".to_string(), 1000)];
        stacks.extend((0..30).map(|i| (format!("cold{i};main"), 1)));
        stacks.push(("lone;bg".to_string(), 7));
        let mut root = fold_stacks(stacks.iter().map(|(s, v)| (s.as_str(), *v)));
        assert_eq!(root.node_count(), 37);

        assert!(truncate_tree(&mut root, 8));
        assert_eq!(root.node_count(), 8);
        assert_eq!(root.total, 1037);
        assert_tree_sums_hold(&root);

        let main = child(&root, "main");
        assert_eq!(main.self_value, 0);
        let hot3 = child(child(child(main, "hot1"), "hot2"), "hot3");
        assert_eq!((hot3.total, hot3.self_value), (1000, 1000));
        let other = child(main, OTHER_NODE_NAME);
        assert_eq!((other.total, other.self_value), (30, 30));
        assert!(other.children.is_empty());
        assert_eq!(child(child(&root, "bg"), "lone").self_value, 7);
    }

    fn owned(pairs: &[(&str, i64)]) -> Vec<(String, i64)> {
        pairs.iter().map(|(s, v)| (s.to_string(), *v)).collect()
    }

    fn diff_child<'a>(node: &'a DiffNode, name: &str) -> &'a DiffNode {
        node.children
            .iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("{} has no child {name}", node.name))
    }

    fn assert_diff_sums_hold(node: &DiffNode) {
        let after: i64 = node.children.iter().map(|c| c.total).sum();
        let before: i64 = node.children.iter().map(|c| c.before_total).sum();
        assert_eq!(
            node.total,
            node.self_value + after,
            "after at {}",
            node.name
        );
        assert_eq!(
            node.before_total,
            node.before_self + before,
            "before at {}",
            node.name
        );
        node.children.iter().for_each(assert_diff_sums_hold);
    }

    #[test]
    fn fold_diff_stacks_keeps_both_sides_on_one_tree() {
        let baseline = owned(&[("a;main", 10), ("gone;main", 5)]);
        let comparison = owned(&[("a;main", 20), ("new;main", 4), ("", 1)]);
        let root = fold_diff_stacks(&baseline, &comparison);
        assert_eq!(
            (root.total, root.before_total, root.self_value),
            (25, 15, 1)
        );
        assert_diff_sums_hold(&root);
        let main = diff_child(&root, "main");
        let gone = diff_child(main, "gone");
        assert_eq!(
            (
                gone.total,
                gone.self_value,
                gone.before_total,
                gone.before_self
            ),
            (0, 0, 5, 5)
        );
        let new = diff_child(main, "new");
        assert_eq!(
            (new.total, new.self_value, new.before_total, new.before_self),
            (4, 4, 0, 0)
        );
        let a = diff_child(main, "a");
        assert_eq!((a.total, a.before_total), (20, 10));
    }

    #[test]
    fn diff_top_orders_by_share_change() {
        let baseline = owned(&[("hot;main", 50), ("steady;main", 50)]);
        let comparison = owned(&[("hot;main", 180), ("steady;main", 18), ("fresh;main", 2)]);
        let result = build_diff_result(&baseline, &comparison, DEFAULT_MAX_NODES);
        assert_eq!((result.baseline_total, result.comparison_total), (100, 200));
        assert!(!result.tree_truncated);
        // Share change: steady 0.50->0.09, hot 0.50->0.90, fresh 0->0.01, main 1->1.
        let names: Vec<&str> = result.top.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["steady", "hot", "fresh", "main"]);
        let fresh = &result.top[2];
        assert_eq!(
            (
                fresh.before_self,
                fresh.before_total,
                fresh.after_self,
                fresh.after_total
            ),
            (0, 0, 2, 2)
        );
    }

    #[test]
    fn diff_cut_keeps_a_frame_heavy_only_in_the_baseline() {
        let baseline = owned(&[("old;main", 90), ("x0;main", 10)]);
        let comparison: Vec<(String, i64)> = (0..20).map(|i| (format!("x{i};main"), 5)).collect();
        let result = build_diff_result(&baseline, &comparison, 5);
        assert!(result.tree_truncated);
        assert_eq!(count_nodes(&result.root), 5);
        assert_diff_sums_hold(&result.root);
        let main = diff_child(&result.root, "main");
        let old = diff_child(main, "old");
        assert_eq!((old.total, old.before_total), (0, 90));
        let other = diff_child(main, OTHER_NODE_NAME);
        assert_eq!(
            (
                other.total,
                other.self_value,
                other.before_total,
                other.before_self
            ),
            (95, 95, 0, 0)
        );
    }

    #[test]
    fn label_names_from_schema_fields_drops_reserved_and_meta() {
        let names = label_names_from_schema_fields([
            "_timestamp",
            "stack",
            "k8s_pod_name",
            "service_name",
            "otel_scope_name",
            "profile_type",
            "value",
            "profile_blob",
            "has_original_payload",
            "sample_count",
            "bytes",
            "host_name",
            PROFILE_DURATION_COLUMN,
        ]);
        assert_eq!(
            names,
            vec!["host_name".to_string(), "k8s_pod_name".to_string()]
        );
    }

    #[test]
    fn flattened_tag_columns_are_filterable() {
        assert!(is_filterable_column("k8s_pod_name"));
        assert!(is_filterable_column("cloud_region"));
        assert!(is_filterable_column("service_name"));
        assert!(!is_filterable_column("stack"));
        assert!(!is_filterable_column("value"));
        assert!(!is_filterable_column("period_type"));
        assert!(!is_filterable_column("profile_blob"));
        assert!(!is_profiles_tag_column("sample_count"));
        assert!(is_meta_dimension_column("service_name"));
        assert!(!is_meta_dimension_column("k8s_pod_name"));
        assert!(!is_profiles_tag_column("service_name"));
        assert!(is_profiles_tag_column("k8s_pod_name"));
    }
}
