// Copyright 2025 OpenObserve Inc.
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
    collections::{HashSet, VecDeque},
    ops::ControlFlow,
};

use config::TIMESTAMP_COL_NAME;
use sqlparser::ast::{
    BinaryOperator, Expr, Function, FunctionArg, FunctionArgExpr, FunctionArguments, GroupByExpr,
    Query, Select, SelectItem, SetExpr, Statement, TableFactor, Visitor,
};

use super::utils::get_object_name_value;

#[derive(Debug, Clone)]
struct QueryInfo {
    group_by_columns: Vec<String>,
    aggregation_aliases: Vec<String>,
    projections: Vec<SelectItem>,
    has_aggregation: bool,
    is_main_query: bool,
}

#[derive(Debug, Clone)]
struct FunctionPair {
    outer_function: String,
    inner_function: String,
}

impl FunctionPair {
    fn new(outer: &str, inner: &str) -> Self {
        Self {
            outer_function: outer.to_uppercase(),
            inner_function: inner.to_uppercase(),
        }
    }
}

#[derive(Debug)]
struct CacheAggregationVisitor {
    matches_pattern: bool,
    query_depth: usize,
    aggregation_aliases: HashSet<String>, // Available aggregation aliases
    // Queue-based processing
    query_queue: VecDeque<QueryInfo>,

    // Function pair rules - THIS IS THE NEW CONFIGURABLE PART
    supported_patterns: Vec<FunctionPair>,
}

impl CacheAggregationVisitor {
    fn new() -> Self {
        // CONFIGURABLE PATTERNS - Add/modify patterns here
        let supported_patterns = vec![
            FunctionPair::new("SUM", "COUNT"), // SUM in outer, COUNT in inner
            FunctionPair::new("MAX", "MAX"),   // MAX in outer, MAX in inner
            FunctionPair::new("MIN", "MIN"),   // MIN in outer, MIN in inner
            FunctionPair::new("SUM", "SUM"),   // SUM in outer, SUM in inner
            FunctionPair::new("", "APPROX_TOPK"), /* Special case: outer query uses alias directly,
                                                * inner has approx_topk */
            FunctionPair::new("", "APPROX_TOPK_DISTINCT"), /* Special case: outer query uses
                                                            * alias directly, inner has
                                                            * approx_topk_distinct */
        ];

        Self {
            matches_pattern: false,
            query_depth: 0,
            aggregation_aliases: HashSet::new(),
            query_queue: VecDeque::new(),
            supported_patterns, // Store the configurable patterns
        }
    }

    // Check if binary operator is safe for arithmetic on cached aggregations
    fn is_safe_arithmetic_operator(op: &BinaryOperator) -> bool {
        matches!(
            op,
            // Arithmetic operators
            BinaryOperator::Plus
                | BinaryOperator::Minus
                | BinaryOperator::Multiply
                | BinaryOperator::Divide
                | BinaryOperator::Modulo
            // Bitwise operators (deterministic)
                | BinaryOperator::BitwiseAnd
                | BinaryOperator::BitwiseOr
                | BinaryOperator::BitwiseXor
            // Comparison operators (for CASE expressions)
                | BinaryOperator::Eq
                | BinaryOperator::NotEq
                | BinaryOperator::Lt
                | BinaryOperator::LtEq
                | BinaryOperator::Gt
                | BinaryOperator::GtEq
        )
    }

    // Check if function is deterministic and safe for cached arithmetic
    fn is_safe_math_function(func: &Function) -> bool {
        if let Some(name) = func.name.0.first() {
            let func_name = get_object_name_value(name).to_uppercase();
            matches!(
                func_name.as_str(),
                // Basic mathematical functions
                "ABS" | "SQRT" | "CBRT" | "ROUND" | "FLOOR" | "CEIL" | "TRUNC" | "SIGNUM"
                // Trigonometric functions
                | "SIN" | "COS" | "TAN" | "COT" | "ASIN" | "ACOS" | "ATAN" | "ATAN2"
                | "SINH" | "COSH" | "TANH" | "ASINH" | "ACOSH" | "ATANH"
                // Logarithmic and exponential functions
                | "LOG" | "LOG2" | "LOG10" | "LN" | "EXP"
                // Power functions
                | "POWER" | "POW"
                // Comparison and null handling
                | "GREATEST" | "LEAST" | "COALESCE" | "NULLIF"
                // Conversion functions
                | "DEGREES" | "RADIANS"
                // Advanced numeric functions
                | "GCD" | "LCM" | "FACTORIAL" | "NANVL" | "ISNAN" | "ISZERO"
                // Constants (deterministic)
                | "PI"
                // Hashing functions (deterministic)
                | "DIGEST" | "MD5" | "SHA224" | "SHA256" | "SHA384" | "SHA512"
                // String conversion functions (deterministic)
                | "TO_HEX" | "ENCODE" | "DECODE"
                // Additional conditional functions
                | "NVL" | "NVL2"
                // Date/time extraction (deterministic for cached data)
                | "DATE_PART" | "DATE_TRUNC" /* NOTE: Excluded non-deterministic functions like
                                              * RANDOM, NOW, UUID, etc. */
            )
        } else {
            false
        }
    }

    // Check if expression safely references only cached aggregation aliases
    fn is_safe_expression_on_cached_aggregates(expr: &Expr, cached_aliases: &[String]) -> bool {
        match expr {
            // Direct reference to cached aggregate
            Expr::Identifier(ident) => cached_aliases.contains(&ident.value),

            // Compound identifier like alias.field (for approx_topk patterns)
            Expr::CompoundIdentifier(parts) => {
                if let Some(first_part) = parts.first() {
                    cached_aliases.contains(&first_part.value)
                } else {
                    false
                }
            }

            // Arithmetic expressions on cached aggregates
            Expr::BinaryOp { left, op, right } => {
                Self::is_safe_arithmetic_operator(op)
                    && Self::is_safe_expression_on_cached_aggregates(left, cached_aliases)
                    && Self::is_safe_expression_on_cached_aggregates(right, cached_aliases)
            }

            // Safe mathematical functions on cached aggregates
            Expr::Function(func) => {
                if Self::is_safe_math_function(func) {
                    if let FunctionArguments::List(args) = &func.args {
                        args.args.iter().all(|arg| {
                            if let FunctionArg::Unnamed(FunctionArgExpr::Expr(expr)) = arg {
                                Self::is_safe_expression_on_cached_aggregates(expr, cached_aliases)
                            } else {
                                false
                            }
                        })
                    } else {
                        false
                    }
                } else {
                    false
                }
            }

            // Literals are safe
            Expr::Value(_) => true,

            // Parentheses - check inner expression
            Expr::Nested(inner) => {
                Self::is_safe_expression_on_cached_aggregates(inner, cached_aliases)
            }

            // Case expressions on cached aggregates - simplified for now
            // Case expressions on cached aggregates
            Expr::Case {
                operand,
                conditions,
                else_result,
                ..
            } => {
                // Check operand if present
                if let Some(op) = operand
                    && !Self::is_safe_expression_on_cached_aggregates(op, cached_aliases)
                {
                    return false;
                }

                // Check all conditions and results
                for case_when in conditions.iter() {
                    if !Self::is_safe_expression_on_cached_aggregates(
                        &case_when.condition,
                        cached_aliases,
                    ) || !Self::is_safe_expression_on_cached_aggregates(
                        &case_when.result,
                        cached_aliases,
                    ) {
                        return false;
                    }
                }

                // Check else result if present
                if let Some(else_expr) = else_result {
                    Self::is_safe_expression_on_cached_aggregates(else_expr, cached_aliases)
                } else {
                    true
                }
            }

            // Cast expressions on cached aggregates
            Expr::Cast { expr, .. } => {
                Self::is_safe_expression_on_cached_aggregates(expr, cached_aliases)
            }

            // Unsafe: Subqueries, non-deterministic functions, etc.
            _ => false,
        }
    }

    // Check if expression is a timestamp-related expression (to exclude per Rule1)
    fn is_timestamp_related_expr(expr: &Expr) -> bool {
        match expr {
            Expr::Identifier(ident) => ident.value == TIMESTAMP_COL_NAME,
            Expr::CompoundIdentifier(parts) => parts
                .last()
                .map(|part| part.value == TIMESTAMP_COL_NAME)
                .unwrap_or(false),
            Expr::Function(func) => {
                if let Some(name) = func.name.0.first()
                    && get_object_name_value(name).to_lowercase() == "histogram"
                    && let FunctionArguments::List(args) = &func.args
                {
                    return args.args.iter().any(|arg| {
                        if let FunctionArg::Unnamed(FunctionArgExpr::Expr(expr)) = arg {
                            Self::is_timestamp_related_expr(expr)
                        } else {
                            false
                        }
                    });
                }
                false
            }
            _ => false,
        }
    }

    // Functions allowed in outer query - USES CONFIGURABLE PATTERNS
    fn is_outer_query_function(&self, func: &Function) -> bool {
        if let Some(name) = func.name.0.first() {
            let func_name = get_object_name_value(name).to_uppercase();
            self.supported_patterns
                .iter()
                .any(|pattern| pattern.outer_function == func_name)
        } else {
            false
        }
    }

    // Functions allowed in subquery - USES CONFIGURABLE PATTERNS
    fn is_subquery_function(&self, func: &Function) -> bool {
        if let Some(name) = func.name.0.first() {
            let func_name = get_object_name_value(name).to_uppercase();
            self.supported_patterns
                .iter()
                .any(|pattern| pattern.inner_function == func_name)
        } else {
            false
        }
    }

    fn is_aggregation_function(&self, func: &Function, is_outer_query: bool) -> bool {
        if is_outer_query {
            self.is_outer_query_function(func)
        } else {
            self.is_subquery_function(func)
        }
    }

    // Extract GROUP BY column names
    fn extract_group_by_columns(group_by: &GroupByExpr) -> Vec<String> {
        let mut columns = Vec::new();
        if let GroupByExpr::Expressions(exprs, _) = group_by {
            for expr in exprs {
                if let Expr::Identifier(ident) = expr {
                    columns.push(ident.value.clone());
                } else if let Expr::CompoundIdentifier(parts) = expr
                    && let Some(last) = parts.last()
                {
                    columns.push(last.value.clone());
                }
            }
        }
        columns
    }

    // Process query to extract relevant information
    fn analyze_query_info(
        &mut self,
        projections: &[SelectItem],
        group_by: &GroupByExpr,
        is_outer_query: bool,
    ) -> QueryInfo {
        let mut aggregation_aliases = Vec::new();
        let mut has_aggregation = false;

        // Extract GROUP BY columns
        let group_by_columns = Self::extract_group_by_columns(group_by);

        // Analyze projections for aggregations
        for item in projections {
            match item {
                SelectItem::ExprWithAlias {
                    expr: Expr::Function(func),
                    alias,
                } => {
                    if self.is_aggregation_function(func, is_outer_query) {
                        has_aggregation = true;
                        aggregation_aliases.push(alias.value.clone());
                        // Add to global aliases for outer query reference
                        self.aggregation_aliases.insert(alias.value.clone());
                    } else if !is_outer_query {
                        // Check for unnest(approx_topk(...)) and unnest(approx_topk_distinct(...))
                        // patterns
                        if let Some(name) = func.name.0.first()
                            && get_object_name_value(name).to_lowercase() == "unnest"
                            && let FunctionArguments::List(args) = &func.args
                            && let Some(FunctionArg::Unnamed(FunctionArgExpr::Expr(
                                Expr::Function(inner_func),
                            ))) = args.args.first()
                            && let Some(inner_name) = inner_func.name.0.first()
                        {
                            let inner_func_name = get_object_name_value(inner_name).to_uppercase();
                            if inner_func_name == "APPROX_TOPK"
                                || inner_func_name == "APPROX_TOPK_DISTINCT"
                            {
                                has_aggregation = true;
                                aggregation_aliases.push(alias.value.clone());
                                // Add to global aliases for outer query reference
                                self.aggregation_aliases.insert(alias.value.clone());
                            }
                        }
                    }
                }
                SelectItem::ExprWithAlias {
                    expr: Expr::Identifier(ident),
                    alias,
                } => {
                    // Special case for approx_topk: outer query uses alias directly
                    if is_outer_query && self.aggregation_aliases.contains(&ident.value) {
                        has_aggregation = true;
                        aggregation_aliases.push(alias.value.clone());
                    }
                }
                SelectItem::ExprWithAlias {
                    expr: Expr::CompoundIdentifier(parts),
                    alias,
                } => {
                    // Special case for approx_topk: outer query uses compound identifier like
                    // item.value
                    if is_outer_query
                        && let Some(first_part) = parts.first()
                        && self.aggregation_aliases.contains(&first_part.value)
                    {
                        has_aggregation = true;
                        aggregation_aliases.push(alias.value.clone());
                    }
                }
                SelectItem::UnnamedExpr(Expr::Function(func)) => {
                    if self.is_aggregation_function(func, is_outer_query) {
                        has_aggregation = true;
                    } else if !is_outer_query {
                        // Check for direct usage of approx_topk and approx_topk_distinct
                        if let Some(name) = func.name.0.first() {
                            let func_name = get_object_name_value(name).to_uppercase();
                            if func_name == "APPROX_TOPK" || func_name == "APPROX_TOPK_DISTINCT" {
                                has_aggregation = true;
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        QueryInfo {
            group_by_columns,
            aggregation_aliases,
            projections: projections.to_vec(),
            has_aggregation,
            is_main_query: false, // Will be set correctly by caller
        }
    }

    // Check Rule1: Query has aggregation and NO timestamp patterns
    fn follows_rule1(&self, query_info: &QueryInfo) -> bool {
        if !query_info.has_aggregation {
            return false;
        }

        // Check projections for timestamp patterns
        for item in &query_info.projections {
            match item {
                SelectItem::UnnamedExpr(expr) => {
                    if Self::is_timestamp_related_expr(expr) {
                        return false;
                    }
                }
                SelectItem::ExprWithAlias { expr, .. } => {
                    // Allow any valid inner query function on _timestamp as count-like operation
                    if let Expr::Function(func) = expr
                        && let Some(name) = func.name.0.first()
                    {
                        let func_name = get_object_name_value(name).to_uppercase();
                        // Check if this function is allowed in inner queries
                        let is_allowed_inner_function = self
                            .supported_patterns
                            .iter()
                            .any(|pattern| pattern.inner_function == func_name);

                        if is_allowed_inner_function {
                            // Functions like COUNT, MAX, MIN on _timestamp are allowed
                            continue;
                        }
                    }
                    if Self::is_timestamp_related_expr(expr) {
                        return false;
                    }
                }
                _ => {}
            }
        }

        true
    }

    // Detect arithmetic expressions on cached aggregates in outer query
    fn detect_arithmetic_on_aggregates(
        &self,
        main_info: &QueryInfo,
        cached_aliases: &[String],
    ) -> bool {
        for item in &main_info.projections {
            match item {
                SelectItem::UnnamedExpr(expr) => {
                    if Self::is_safe_expression_on_cached_aggregates(expr, cached_aliases) {
                        return true;
                    }
                }
                SelectItem::ExprWithAlias { expr, .. }
                    if Self::is_safe_expression_on_cached_aggregates(expr, cached_aliases) =>
                {
                    return true;
                }
                _ => {}
            }
        }
        false
    }

    // Process all collected queries to detect the pattern
    fn process_query_queue(&mut self) {
        let mut subquery_infos = Vec::new();
        let mut main_query_info = None;

        // Separate subqueries from main query
        while let Some(query_info) = self.query_queue.pop_front() {
            if query_info.is_main_query {
                main_query_info = Some(query_info);
            } else {
                subquery_infos.push(query_info);
            }
        }

        // Check the pattern
        if let Some(main_info) = main_query_info {
            // Handle direct usage in main query (no subqueries)
            let is_direct_approx_topk_pattern = main_info.projections.iter().any(|item| {
                if let SelectItem::UnnamedExpr(Expr::Function(func)) = item {
                    if let Some(name) = func.name.0.first() {
                        let func_name = get_object_name_value(name).to_uppercase();
                        func_name == "APPROX_TOPK" || func_name == "APPROX_TOPK_DISTINCT"
                    } else {
                        false
                    }
                } else {
                    false
                }
            });
            if is_direct_approx_topk_pattern {
                self.matches_pattern = true;
                return;
            }
            for sub_info in &subquery_infos {
                // Special handling for direct approx_topk/approx_topk_distinct usage in subquery
                let is_direct_approx_topk_pattern = sub_info.projections.iter().any(|item| {
                    if let SelectItem::UnnamedExpr(Expr::Function(func)) = item {
                        if let Some(name) = func.name.0.first() {
                            let func_name = get_object_name_value(name).to_uppercase();
                            func_name == "APPROX_TOPK" || func_name == "APPROX_TOPK_DISTINCT"
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                });
                if is_direct_approx_topk_pattern {
                    self.matches_pattern = true;
                    break;
                }
                // Check for standard function patterns OR arithmetic patterns
                if self.check_count_sum_pattern(sub_info, &main_info)
                    || self.check_arithmetic_pattern(sub_info, &main_info)
                {
                    self.matches_pattern = true;
                    break;
                }
            }
        }
    }

    // Check if subquery and main query follow the count-sum pattern - USES CONFIGURABLE PATTERNS
    fn check_count_sum_pattern(&self, sub_info: &QueryInfo, main_info: &QueryInfo) -> bool {
        // Rule1: Subquery must follow Rule1
        if !self.follows_rule1(sub_info) {
            return false;
        }

        // Subquery must have aggregation with alias
        if sub_info.aggregation_aliases.is_empty() {
            return false;
        }

        // Special case for approx_topk and approx_topk_distinct with unnest: no GROUP BY required
        let is_approx_topk_pattern = sub_info.aggregation_aliases.iter().any(|alias| {
            // Check if this alias comes from an APPROX_TOPK or APPROX_TOPK_DISTINCT function
            for item in &sub_info.projections {
                if let SelectItem::ExprWithAlias {
                    expr,
                    alias: item_alias,
                } = item
                    && item_alias.value == *alias
                && let Expr::Function(func) = expr
                            && let Some(name) = func.name.0.first()
                            && get_object_name_value(name).to_lowercase() == "unnest"
                            // Check if unnest contains approx_topk or approx_topk_distinct
                            && let FunctionArguments::List(args) = &func.args
                            && let Some(FunctionArg::Unnamed(FunctionArgExpr::Expr(
                                            Expr::Function(inner_func),
                                            ))) = args.args.first()
                                        && let Some(inner_name) = inner_func.name.0.first()
                {
                    let inner_func_name = get_object_name_value(inner_name).to_uppercase();
                    if inner_func_name == "APPROX_TOPK" || inner_func_name == "APPROX_TOPK_DISTINCT"
                    {
                        return true;
                    }
                }
            }
            false
        });

        // Also check for direct usage of approx_topk and approx_topk_distinct (without alias)
        let is_direct_approx_topk_pattern = sub_info.projections.iter().any(|item| {
            if let SelectItem::UnnamedExpr(Expr::Function(func)) = item {
                if let Some(name) = func.name.0.first() {
                    let func_name = get_object_name_value(name).to_uppercase();
                    func_name == "APPROX_TOPK" || func_name == "APPROX_TOPK_DISTINCT"
                } else {
                    false
                }
            } else {
                false
            }
        });

        let is_approx_topk_pattern = is_approx_topk_pattern || is_direct_approx_topk_pattern;

        // If direct approx_topk/approx_topk_distinct, qualify as a match
        if is_direct_approx_topk_pattern {
            return true;
        }

        // First, identify the subquery function to determine if GROUP BY is required
        let mut sub_function = String::new();

        // First check for aliased functions
        for item in &sub_info.projections {
            if let SelectItem::ExprWithAlias {
                expr: Expr::Function(func),
                alias,
            } = item
                && alias.value == sub_info.aggregation_aliases[0]
                && let Some(name) = func.name.0.first()
            {
                if get_object_name_value(name).to_uppercase() == "UNNEST" {
                    // Check if unnest contains approx_topk or approx_topk_distinct
                    if let FunctionArguments::List(args) = &func.args
                        && let Some(FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Function(
                            inner_func,
                        )))) = args.args.first()
                        && let Some(inner_name) = inner_func.name.0.first()
                    {
                        let inner_func_name = get_object_name_value(inner_name).to_uppercase();
                        if inner_func_name == "APPROX_TOPK"
                            || inner_func_name == "APPROX_TOPK_DISTINCT"
                        {
                            sub_function = inner_func_name;
                            break;
                        }
                    }
                } else {
                    sub_function = get_object_name_value(name).to_uppercase();
                    break;
                }
            }
        }

        // If no aliased function found, check for direct usage
        if sub_function.is_empty() {
            for item in &sub_info.projections {
                if let SelectItem::UnnamedExpr(Expr::Function(func)) = item
                    && let Some(name) = func.name.0.first()
                {
                    let func_name = get_object_name_value(name).to_uppercase();
                    if func_name == "APPROX_TOPK" || func_name == "APPROX_TOPK_DISTINCT" {
                        sub_function = func_name;
                        break;
                    }
                }
            }
        }

        // Define functions that are allowed without GROUP BY when both queries have no GROUP BY
        let allows_no_group_by = matches!(sub_function.as_str(), "SUM" | "MAX" | "MIN");

        // For patterns that allow no GROUP BY: Allow if both have no GROUP BY, or both have same
        // GROUP BY
        if allows_no_group_by {
            // Both queries must have same GROUP BY status (both empty or both same)
            if sub_info.group_by_columns != main_info.group_by_columns {
                return false;
            }
        } else {
            // For other patterns (like COUNT), require GROUP BY and they must match
            if !is_approx_topk_pattern && sub_info.group_by_columns.is_empty() {
                return false;
            }
            if !is_approx_topk_pattern && main_info.group_by_columns != sub_info.group_by_columns {
                return false;
            }
        }

        // Check if this is an unnest approx_topk pattern
        let is_unnest_approx_topk = matches!(
            sub_function.as_str(),
            "APPROX_TOPK" | "APPROX_TOPK_DISTINCT"
        );

        // For approx_topk pattern, allow empty group_by columns
        if is_unnest_approx_topk {
            return true;
        }

        // Check if main query has valid aggregation on subquery's alias
        let sub_alias = &sub_info.aggregation_aliases[0];
        for item in &main_info.projections {
            match item {
                SelectItem::ExprWithAlias {
                    expr: Expr::Function(func),
                    ..
                } => {
                    if let Some(name) = func.name.0.first() {
                        let main_function = get_object_name_value(name).to_uppercase();

                        // CHECK CONFIGURABLE PATTERNS - This is the key validation
                        let is_valid_pair = self.supported_patterns.iter().any(|pattern| {
                            pattern.outer_function == main_function
                                && pattern.inner_function == sub_function
                        });

                        if is_valid_pair
                            && let FunctionArguments::List(args) = &func.args
                            && let Some(FunctionArg::Unnamed(FunctionArgExpr::Expr(
                                Expr::Identifier(ident),
                            ))) = args.args.first()
                            && ident.value == *sub_alias
                        {
                            return true;
                        }
                    }
                }
                SelectItem::ExprWithAlias {
                    expr: Expr::Identifier(ident),
                    ..
                } => {
                    // Special case for approx_topk and approx_topk_distinct: outer query uses alias
                    // directly
                    if ident.value == *sub_alias {
                        let is_approx_topk_pattern =
                            self.supported_patterns.iter().any(|pattern| {
                                pattern.outer_function.is_empty()
                                    && (pattern.inner_function == "APPROX_TOPK"
                                        || pattern.inner_function == "APPROX_TOPK_DISTINCT")
                            });

                        if is_approx_topk_pattern
                            && (sub_function == "APPROX_TOPK"
                                || sub_function == "APPROX_TOPK_DISTINCT")
                        {
                            return true;
                        }
                    }
                }
                SelectItem::ExprWithAlias {
                    expr: Expr::CompoundIdentifier(parts),
                    ..
                } => {
                    // Handle compound identifiers like item.value for approx_topk and
                    // approx_topk_distinct patterns
                    if let Some(first_part) = parts.first()
                        && first_part.value == *sub_alias
                    {
                        let is_approx_topk_pattern =
                            self.supported_patterns.iter().any(|pattern| {
                                pattern.outer_function.is_empty()
                                    && (pattern.inner_function == "APPROX_TOPK"
                                        || pattern.inner_function == "APPROX_TOPK_DISTINCT")
                            });

                        if is_approx_topk_pattern
                            && (sub_function == "APPROX_TOPK"
                                || sub_function == "APPROX_TOPK_DISTINCT")
                        {
                            return true;
                        }
                    }
                }
                _ => {}
            }
        }

        false
    }

    // Check if outer query has arithmetic expressions on cached aggregates from subquery
    fn check_arithmetic_pattern(&self, sub_info: &QueryInfo, main_info: &QueryInfo) -> bool {
        // Rule1: Subquery must follow Rule1 (has aggregation, no timestamp patterns)
        if !self.follows_rule1(sub_info) {
            return false;
        }

        // Subquery must have aggregation with aliases
        if sub_info.aggregation_aliases.is_empty() {
            return false;
        }

        // Check if GROUP BY requirements are met (similar logic to count_sum_pattern)
        // For arithmetic patterns, both queries should have same GROUP BY structure
        if sub_info.group_by_columns != main_info.group_by_columns {
            return false;
        }

        // Main query should contain arithmetic expressions on cached aggregates
        if !self.detect_arithmetic_on_aggregates(main_info, &sub_info.aggregation_aliases) {
            return false;
        }

        true
    }
}

impl Visitor for CacheAggregationVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        let is_outermost = self.query_depth == 0;
        self.query_depth += 1;

        // Handle WITH clause (CTEs) if present
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                self.pre_visit_query(&cte.query)?;
            }
        }

        // Determine if this is the main query
        let is_main_query = query.with.is_some() || (query.with.is_none() && is_outermost);

        if let Some(select) = select_within_parentheses(query) {
            // Process FROM clause first to handle subqueries
            for table in &select.from {
                self.pre_visit_table_factor(&table.relation)?;
            }

            // Analyze this query - handle Option<GroupByExpr>
            let mut query_info =
                self.analyze_query_info(&select.projection, &select.group_by, is_main_query);
            query_info.is_main_query = is_main_query;

            // Add to queue
            if is_main_query {
                self.query_queue.push_back(query_info);
            } else {
                self.query_queue.push_front(query_info);
            }
        }

        self.query_depth -= 1;
        ControlFlow::Continue(())
    }

    fn pre_visit_table_factor(&mut self, table: &TableFactor) -> ControlFlow<Self::Break> {
        if let TableFactor::Derived { subquery, .. } = table {
            self.pre_visit_query(subquery)?;
        }
        ControlFlow::Continue(())
    }
}

/// Returns whether the SQL matches a supported streaming-aggregation pattern.
pub fn matches_streaming_aggregate_pattern(sql: &str) -> Result<bool, String> {
    use sqlparser::{dialect::GenericDialect, parser::Parser};

    let dialect = GenericDialect {};
    let mut statements =
        Parser::parse_sql(&dialect, sql).map_err(|e| format!("Parse error: {e}"))?;

    if statements.len() != 1 {
        return Err("Expected exactly one statement".to_string());
    }

    if let Statement::Query(query) = &mut statements[0] {
        let mut visitor = CacheAggregationVisitor::new();

        // First pass: collect all queries in the queue
        let _ = visitor.pre_visit_query(query);

        // Second pass: process the queue to detect pattern
        visitor.process_query_queue();

        Ok(visitor.matches_pattern)
    } else {
        Err("Expected a query statement".to_string())
    }
}

/// The SELECT this query runs, seen through parentheses that add nothing of their own.
fn select_within_parentheses(query: &Query) -> Option<&Select> {
    let mut body = query.body.as_ref();
    loop {
        match body {
            SetExpr::Select(select) => return Some(select),
            // A CTE declared inside the parentheses would go unanalyzed, and matching the
            // pattern without it could enable the rewrite for a query it does not fit.
            SetExpr::Query(inner) if inner.with.is_none() => body = inner.body.as_ref(),
            _ => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_aggregation_pattern() {
        let sql = r#"
            SELECT k8s_namespace_name, SUM(request_count) as total_requests
            FROM (
                SELECT k8s_namespace_name, count(_timestamp) as request_count
                FROM "default"
                WHERE k8s_namespace_name IS NOT NULL
                GROUP BY k8s_namespace_name
            )
            GROUP BY k8s_namespace_name
            ORDER BY total_requests DESC
            LIMIT 10
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_parenthesized_query_matches_the_same_pattern() {
        let inner = r#"
            SELECT k8s_namespace_name, SUM(request_count) as total_requests
            FROM (
                SELECT k8s_namespace_name, count(_timestamp) as request_count
                FROM "default"
                WHERE k8s_namespace_name IS NOT NULL
                GROUP BY k8s_namespace_name
            )
            GROUP BY k8s_namespace_name
            ORDER BY total_requests DESC
            LIMIT 10
        "#;

        assert!(matches_streaming_aggregate_pattern(inner).unwrap());
        assert!(matches_streaming_aggregate_pattern(&format!("({inner})")).unwrap());
        assert!(matches_streaming_aggregate_pattern(&format!("(({inner}))")).unwrap());
    }

    #[test]
    fn test_parenthesized_cte_is_left_unmatched() {
        // The CTE inside the parentheses is never analyzed, so the pattern must not match.
        let sql = r#"(WITH cte AS (SELECT k8s_namespace_name FROM "default")
                      SELECT k8s_namespace_name FROM cte GROUP BY k8s_namespace_name)"#;

        assert!(!matches_streaming_aggregate_pattern(sql).unwrap());
    }

    #[test]
    fn test_sum_sum_pattern() {
        let sql = r#"
            SELECT SUM(a) as total
            FROM (
                SELECT  SUM(CAST(edgeresponsebytes AS Int)) as a
                FROM "default"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_max_max_pattern() {
        let sql = r#"
            SELECT k8s_namespace_name, MAX(max_value) as highest_value
            FROM (
                SELECT k8s_namespace_name, MAX(cpu_usage) as max_value
                FROM "default"
                WHERE k8s_namespace_name IS NOT NULL
                GROUP BY k8s_namespace_name
            )
            GROUP BY k8s_namespace_name
            ORDER BY highest_value DESC
            LIMIT 10
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_min_min_pattern() {
        let sql = r#"
            SELECT k8s_namespace_name, MIN(min_value) as lowest_value
            FROM (
                SELECT k8s_namespace_name, MIN(memory_usage) as min_value
                FROM "default"
                WHERE k8s_namespace_name IS NOT NULL
                GROUP BY k8s_namespace_name
            )
            GROUP BY k8s_namespace_name
            ORDER BY lowest_value ASC
            LIMIT 10
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_no_pattern_different_group_by() {
        let sql = r#"
            SELECT k8s_namespace_name, SUM(request_count) as total_requests
            FROM (
                SELECT service_name, SUM(_timestamp) as request_count
                FROM "default"
                GROUP BY service_name
            )
            GROUP BY k8s_namespace_name
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_no_pattern_direct_timestamp() {
        let sql = r#"
            SELECT namespace, SUM(cnt) as total
            FROM (
                SELECT namespace, histogram(_timestamp) as cnt
                FROM "default"
                GROUP BY namespace
            )
            GROUP BY namespace
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(!result); // Should fail Rule1 due to histogram(_timestamp)
    }

    #[test]
    fn test_pattern_approx_topk_with_unnest() {
        let sql = r#"
            SELECT item.value as ja3hash, item.count as request_count from
            ( SELECT unnest(approx_topk(testhash, 10)) as item FROM "dummy" WHERE source = 'abcd' AND clientip )
              order by request_count desc
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_pattern_approx_topk_distinct_with_unnest() {
        let sql = r#"
            SELECT item.value as clientuseragent, item.count as cnt from
            ( SELECT unnest(approx_topk_distinct(clientuseragent, clientip, 10)) as item FROM "default" )
              order by cnt desc
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_pattern_approx_topk_distinct_direct() {
        let sql = r#"
            SELECT approx_topk_distinct(clientuseragent, clientip, 10) FROM "default"
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result); // Direct usage without unnest should also match
    }

    // === NEW TESTS FOR ARITHMETIC PATTERNS ===

    #[test]
    fn test_arithmetic_pattern_basic_division() {
        let sql = r#"
            SELECT conversions / impressions as conversion_rate
            FROM (
                SELECT
                    SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END) as conversions,
                    SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) as impressions
                FROM "marketing_events"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_arithmetic_pattern_complex_expression() {
        let sql = r#"
            SELECT
                (revenue - costs) / revenue * 100 as profit_margin_percent
            FROM (
                SELECT
                    SUM(sale_amount) as revenue,
                    SUM(cost_amount) as costs
                FROM "transactions"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_arithmetic_pattern_with_groupby() {
        let sql = r#"
            SELECT
                region,
                errors / total_requests as error_rate
            FROM (
                SELECT
                    region,
                    SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
                    COUNT(*) as total_requests
                FROM "access_logs"
                GROUP BY region
            )
            GROUP BY region
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_arithmetic_pattern_mathematical_functions() {
        let sql = r#"
            SELECT
                SQRT(x_sum * x_sum + y_sum * y_sum) as magnitude
            FROM (
                SELECT
                    SUM(x_coordinate) as x_sum,
                    SUM(y_coordinate) as y_sum
                FROM "coordinates"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_arithmetic_pattern_advanced_math_functions() {
        let sql = r#"
            SELECT
                LOG10(total_count) as log_count,
                CBRT(volume_sum) as cube_root_volume,
                DEGREES(angle_sum) as angle_degrees,
                GREATEST(max_val, min_val, avg_val) as highest_value
            FROM (
                SELECT
                    COUNT(*) as total_count,
                    SUM(volume) as volume_sum,
                    SUM(angle_radians) as angle_sum,
                    MAX(value) as max_val,
                    MIN(value) as min_val,
                    AVG(value) as avg_val
                FROM "measurements"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_arithmetic_pattern_bitwise_and_hash_functions() {
        let sql = r#"
            SELECT
                total_count & 255 as masked_count,
                total_count | status_sum as combined_flags,
                MD5(CAST(user_count AS TEXT)) as user_hash,
                TO_HEX(session_count) as session_hex
            FROM (
                SELECT
                    COUNT(*) as total_count,
                    SUM(status_code) as status_sum,
                    COUNT(DISTINCT user_id) as user_count,
                    COUNT(DISTINCT session_id) as session_count
                FROM "events"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_arithmetic_pattern_case_expression() {
        let sql = r#"
            SELECT
                CASE
                    WHEN total_requests > 0 THEN errors / total_requests * 100
                    ELSE 0
                END as error_percentage
            FROM (
                SELECT
                    SUM(error_count) as errors,
                    SUM(request_count) as total_requests
                FROM "metrics"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    #[test]
    fn test_arithmetic_pattern_multiple_operations() {
        let sql = r#"
            SELECT
                a + b as sum_val,
                a - b as diff_val,
                a * b as product_val,
                CASE WHEN b > 0 THEN a / b ELSE 0 END as ratio_val
            FROM (
                SELECT
                    SUM(value1) as a,
                    SUM(value2) as b
                FROM "data"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }

    // === TESTS FOR FAILING/UNSAFE PATTERNS ===

    #[test]
    fn test_arithmetic_pattern_fails_with_random() {
        let sql = r#"
            SELECT
                total_sales * RANDOM() as randomized_sales
            FROM (
                SELECT SUM(sales_amount) as total_sales FROM "sales"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(!result); // Should fail due to RANDOM()
    }

    #[test]
    fn test_arithmetic_pattern_fails_with_now() {
        let sql = r#"
            SELECT
                daily_revenue / EXTRACT(DAY FROM NOW()) as revenue_per_day
            FROM (
                SELECT SUM(revenue) as daily_revenue FROM "transactions"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(!result); // Should fail due to NOW()
    }

    #[test]
    fn test_arithmetic_pattern_fails_with_subquery() {
        let sql = r#"
            SELECT
                user_count * (SELECT rate FROM "rates" WHERE id = 1) as calculated_value
            FROM (
                SELECT COUNT(*) as user_count FROM "users"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(!result); // Should fail due to subquery in arithmetic
    }

    #[test]
    fn test_arithmetic_pattern_fails_different_groupby() {
        let sql = r#"
            SELECT
                region,
                conversions / impressions as conversion_rate
            FROM (
                SELECT
                    campaign,
                    SUM(conversions) as conversions,
                    SUM(impressions) as impressions
                FROM "marketing"
                GROUP BY campaign
            )
            GROUP BY region
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(!result); // Should fail due to different GROUP BY
    }

    #[test]
    fn test_arithmetic_pattern_fails_with_external_column() {
        let sql = r#"
            SELECT
                total_sales + some_external_column as adjusted_sales
            FROM (
                SELECT SUM(sales_amount) as total_sales FROM "sales"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(!result); // Should fail - references non-cached column
    }

    #[test]
    fn test_arithmetic_pattern_fails_with_timestamp() {
        let sql = r#"
            SELECT
                total_count / histogram(_timestamp) as rate_per_time_bucket
            FROM (
                SELECT COUNT(*) as total_count FROM "events"
            )
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(!result); // Should fail due to histogram(_timestamp)
    }

    #[test]
    fn test_cte_with_arithmetic() {
        let sql = r#"
           WITH namespace_totals AS (
            SELECT
                COUNT(CASE WHEN k8s_namespace_name = 'ingress-nginx' THEN 1 END) as nginx_count,
                COUNT(CASE WHEN k8s_namespace_name = 'ziox' THEN 1 END) as prod_count,
                COUNT(CASE WHEN k8s_namespace_name NOT IN ('ingress-nginx', 'ziox') THEN 1 END) as others_count
            FROM default
            )
            SELECT
            ROUND(nginx_count * 1.0 / prod_count, 4)
            as nginx_to_prod_ratio,
            ROUND(prod_count * 1.0 / others_count, 4)
            as prod_to_others_ratio,
            nginx_count,
            prod_count,
            others_count
            FROM namespace_totals;
        "#;

        let result = matches_streaming_aggregate_pattern(sql).unwrap();
        assert!(result);
    }
}
