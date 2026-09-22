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

use std::collections::HashMap;

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
        1 + self.children.iter().map(Self::node_count).sum::<usize>()
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
        let mut frames: Vec<&str> = stack
            .split(';')
            .map(str::trim)
            .filter(|f| !f.is_empty())
            .rev()
            .collect();
        limit_root_to_leaf_depth(&mut frames);
        root.total = root.total.saturating_add(value);
        if frames.is_empty() {
            root.self_value = root.self_value.saturating_add(value);
            continue;
        }
        insert_path(&mut root, &frames, value);
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

fn insert_path(root: &mut TreeNode, frames: &[&str], value: i64) {
    let mut node = root;
    for (i, &name) in frames.iter().enumerate() {
        let idx = match node.children.iter().position(|c| c.name == name) {
            Some(i) => i,
            None => {
                node.children.push(TreeNode::new(name));
                node.children.len() - 1
            }
        };
        let child = &mut node.children[idx];
        child.total = child.total.saturating_add(value);
        if i + 1 == frames.len() {
            child.self_value = child.self_value.saturating_add(value);
            return;
        }
        node = child;
    }
}

/// Collapse the smallest children into [`OTHER_NODE_NAME`] until the tree has
/// at most `max_nodes` nodes (including the root).
pub fn truncate_tree(root: &mut TreeNode, max_nodes: usize) {
    if max_nodes == 0 {
        root.children.clear();
        root.self_value = root.total;
        return;
    }
    let mut budget = max_nodes;
    truncate_node(root, &mut budget);
}

fn truncate_node(node: &mut TreeNode, budget: &mut usize) {
    if *budget == 0 {
        collapse_children_into_self(node);
        return;
    }
    *budget = budget.saturating_sub(1);
    if node.children.is_empty() {
        return;
    }
    if *budget == 0 {
        collapse_children_into_self(node);
        return;
    }

    node.children
        .sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.name.cmp(&b.name)));

    // Not enough budget to keep every child even as a leaf: keep the heaviest,
    // fold the rest into `other`, and stop descending.
    if node.children.len() > *budget {
        let keep = (*budget).saturating_sub(1);
        let mut other = TreeNode::new(OTHER_NODE_NAME);
        for dropped in node.children.drain(keep..) {
            other.total = other.total.saturating_add(dropped.total);
            merge_exclusive_into(&mut other, &dropped);
        }
        if other.total > 0 || other.self_value > 0 {
            node.children.push(other);
        }
        for child in &mut node.children {
            collapse_children_into_self(child);
        }
        *budget = 0;
        return;
    }

    // Distribute remaining budget across children, heavier first.
    let n = node.children.len();
    let mut shares = vec![1_usize; n];
    let mut left = budget.saturating_sub(n);
    *budget = 0;
    let mut i = 0;
    while left > 0 {
        shares[i] += 1;
        left -= 1;
        i = (i + 1) % n;
    }
    for (child, share) in node.children.iter_mut().zip(shares) {
        let mut child_budget = share;
        truncate_node(child, &mut child_budget);
    }
}

fn merge_exclusive_into(dst: &mut TreeNode, src: &TreeNode) {
    let mut stack = vec![src];
    while let Some(node) = stack.pop() {
        dst.self_value = dst.self_value.saturating_add(node.self_value);
        for child in &node.children {
            stack.push(child);
        }
    }
}

fn collapse_children_into_self(node: &mut TreeNode) {
    let mut extra_self = 0_i64;
    for child in &node.children {
        extra_self = extra_self.saturating_add(child.total);
    }
    node.self_value = node.self_value.saturating_add(extra_self);
    node.children.clear();
}

/// Aggregate all nodes with the same function name for the Top Table.
pub fn flatten_top_functions(root: &TreeNode) -> Vec<TopFunction> {
    let mut agg: HashMap<&str, (i64, i64)> = HashMap::new();
    flatten_into(root, &mut agg);
    // Synthetic nodes are not real functions.
    agg.remove(ROOT_NODE_NAME);
    agg.remove(OTHER_NODE_NAME);
    agg.remove(TRUNCATED_ANCESTORS_NAME);
    let mut top: Vec<TopFunction> = agg
        .into_iter()
        .map(|(name, (self_value, total))| TopFunction {
            name: name.to_string(),
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

fn flatten_into<'a>(node: &'a TreeNode, agg: &mut HashMap<&'a str, (i64, i64)>) {
    let mut stack = vec![node];
    while let Some(node) = stack.pop() {
        let entry = agg.entry(node.name.as_str()).or_insert((0, 0));
        entry.0 = entry.0.saturating_add(node.self_value);
        entry.1 = entry.1.saturating_add(node.total);
        for child in &node.children {
            stack.push(child);
        }
    }
}

pub fn resolve_max_nodes(requested: Option<usize>) -> usize {
    requested
        .unwrap_or(DEFAULT_MAX_NODES)
        .clamp(1, MAX_MAX_NODES)
}

pub fn build_merge_result(stacks: &[(String, i64)], max_nodes: usize) -> MergeResult {
    let mut root = fold_stacks(stacks.iter().map(|(s, v)| (s.as_str(), *v)));
    let total = root.total;
    // Top Table must use exclusive weights from the full tree. Truncation folds
    // inclusive mass into `self` / `other` and would corrupt Top Table numbers.
    let top = flatten_top_functions(&root);
    if max_nodes > 0 {
        truncate_tree(&mut root, max_nodes);
    }
    MergeResult { total, root, top }
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
    fn flatten_top_sums_self_by_function_name() {
        let root = fold_stacks([("a;shared", 3), ("b;shared", 4)]);
        let top = flatten_top_functions(&root);
        let shared = top.iter().find(|t| t.name == "shared").unwrap();
        assert_eq!(shared.self_value, 0);
        assert_eq!(shared.total, 7);
        let a = top.iter().find(|t| t.name == "a").unwrap();
        assert_eq!(a.self_value, 3);
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
        assert_eq!(result.top[0].name, "hot");
        assert_eq!(result.top[0].self_value, 100);
    }

    #[test]
    fn build_merge_result_keeps_top_exclusive_after_truncate() {
        let stacks: Vec<(String, i64)> = (0..40).map(|i| (format!("leaf{i};common"), 10)).collect();
        let result = build_merge_result(&stacks, 5);
        assert!(result.root.node_count() <= 5);
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
        assert!(result.root.node_count() <= 1);
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
