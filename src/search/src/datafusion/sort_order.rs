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

//! Physical sort order of the files (and in-memory batches) that back a table.
//!
//! Historically every table was either unsorted or sorted by `_timestamp DESC`
//! (`sorted_by_time: bool`). TSID-major metrics files are instead sorted by
//! `(__hash__ ASC, _timestamp ASC)`. This enum is the single place that knows
//! how each order maps to DataFusion logical / physical sort expressions, so
//! the table providers, `NewEmptyExec`, the memtable `SortExec` and the merge
//! `ORDER BY` all stay consistent.

use std::{fmt, sync::Arc};

use arrow_schema::{Schema, SortOptions};
use config::{TIMESTAMP_COL_NAME, meta::promql::HASH_LABEL};
use datafusion::{
    logical_expr::SortExpr,
    physical_expr::{LexOrdering, PhysicalSortExpr},
    physical_plan::expressions::Column,
    prelude::col,
};

const TIMESTAMP_DESC_COLUMNS: &[SortColumn] = &[SortColumn::desc(TIMESTAMP_COL_NAME)];
const HASH_TIMESTAMP_ASC_COLUMNS: &[SortColumn] = &[
    SortColumn::asc(HASH_LABEL),
    SortColumn::asc(TIMESTAMP_COL_NAME),
];

/// One column of a [`FileSortOrder`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SortColumn {
    pub name: &'static str,
    pub descending: bool,
}

impl SortColumn {
    const fn asc(name: &'static str) -> Self {
        Self {
            name,
            descending: false,
        }
    }

    const fn desc(name: &'static str) -> Self {
        Self {
            name,
            descending: true,
        }
    }

    /// Nulls are always placed last, matching the historical `_timestamp DESC`
    /// behavior (`SortOptions { descending, nulls_first: false }`).
    fn sort_options(&self) -> SortOptions {
        SortOptions {
            descending: self.descending,
            nulls_first: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Hash)]
pub enum FileSortOrder {
    /// No ordering guarantee.
    #[default]
    None,
    /// `_timestamp DESC` — the classic layout written by the ingester and the
    /// compactor for logs, traces and (non TSID-major) metrics.
    TimestampDesc,
    /// `__hash__ ASC, _timestamp ASC` — TSID-major metrics layout: all samples of
    /// one series are contiguous and time-ordered inside a file. Only used by
    /// the compactor merge; distributed query plans never carry it.
    HashTimestampAsc,
}

impl FileSortOrder {
    /// Bridge for the legacy `sorted_by_time: bool` flag.
    pub fn from_sorted_by_time(sorted_by_time: bool) -> Self {
        if sorted_by_time {
            Self::TimestampDesc
        } else {
            Self::None
        }
    }

    /// True when the order is exactly `_timestamp DESC`.
    pub fn is_timestamp_desc(&self) -> bool {
        matches!(self, Self::TimestampDesc)
    }

    /// True when the data carries any ordering guarantee.
    pub fn is_sorted(&self) -> bool {
        !matches!(self, Self::None)
    }

    /// Sort columns in lexicographic order; empty for [`FileSortOrder::None`].
    pub fn columns(&self) -> &'static [SortColumn] {
        match self {
            Self::None => &[],
            Self::TimestampDesc => TIMESTAMP_DESC_COLUMNS,
            Self::HashTimestampAsc => HASH_TIMESTAMP_ASC_COLUMNS,
        }
    }

    /// Logical sort expressions, e.g. for `ListingOptions::with_file_sort_order`
    /// (wrapped in an outer `vec![]`) or `DataFrame::sort`.
    pub fn logical_sort_exprs(&self) -> Vec<SortExpr> {
        self.columns()
            .iter()
            .map(|c| col(c.name).sort(!c.descending, false))
            .collect()
    }

    /// `ORDER BY ...` clause (without the keyword) for SQL based merges.
    pub fn order_by_clause(&self) -> Option<String> {
        let columns = self.columns();
        if columns.is_empty() {
            return None;
        }
        Some(
            columns
                .iter()
                .map(|c| format!("{} {}", c.name, if c.descending { "DESC" } else { "ASC" }))
                .collect::<Vec<_>>()
                .join(", "),
        )
    }

    /// Physical ordering against `schema`. Returns `None` for
    /// [`FileSortOrder::None`] or when any sort column is missing from the
    /// schema (the ordering cannot be expressed, so no guarantee is declared).
    pub fn physical_ordering(&self, schema: &Schema) -> Option<LexOrdering> {
        let columns = self.columns();
        if columns.is_empty() {
            return None;
        }
        let mut exprs = Vec::with_capacity(columns.len());
        for column in columns {
            let index = schema.index_of(column.name).ok()?;
            exprs.push(PhysicalSortExpr {
                expr: Arc::new(Column::new(column.name, index)),
                options: column.sort_options(),
            });
        }
        LexOrdering::new(exprs)
    }
}

impl fmt::Display for FileSortOrder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::None => write!(f, "none"),
            Self::TimestampDesc => write!(f, "timestamp_desc"),
            Self::HashTimestampAsc => write!(f, "hash_timestamp_asc"),
        }
    }
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field};

    use super::*;

    fn schema() -> Schema {
        Schema::new(vec![
            Field::new("a", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(HASH_LABEL, DataType::UInt64, false),
        ])
    }

    #[test]
    fn test_from_sorted_by_time() {
        assert_eq!(
            FileSortOrder::from_sorted_by_time(true),
            FileSortOrder::TimestampDesc
        );
        assert_eq!(
            FileSortOrder::from_sorted_by_time(false),
            FileSortOrder::None
        );
        assert!(FileSortOrder::TimestampDesc.is_timestamp_desc());
        assert!(!FileSortOrder::HashTimestampAsc.is_timestamp_desc());
        assert!(FileSortOrder::HashTimestampAsc.is_sorted());
        assert!(!FileSortOrder::None.is_sorted());
    }

    #[test]
    fn test_order_by_clause() {
        assert_eq!(FileSortOrder::None.order_by_clause(), None);
        assert_eq!(
            FileSortOrder::TimestampDesc.order_by_clause().as_deref(),
            Some("_timestamp DESC")
        );
        assert_eq!(
            FileSortOrder::HashTimestampAsc.order_by_clause().as_deref(),
            Some("__hash__ ASC, _timestamp ASC")
        );
    }

    #[test]
    fn test_logical_sort_exprs() {
        let exprs = FileSortOrder::HashTimestampAsc.logical_sort_exprs();
        assert_eq!(exprs.len(), 2);
        assert!(exprs[0].asc && !exprs[0].nulls_first);
        assert!(exprs[1].asc && !exprs[1].nulls_first);
        let exprs = FileSortOrder::TimestampDesc.logical_sort_exprs();
        assert_eq!(exprs.len(), 1);
        assert!(!exprs[0].asc && !exprs[0].nulls_first);
        assert!(FileSortOrder::None.logical_sort_exprs().is_empty());
    }

    #[test]
    fn test_physical_ordering() {
        let schema = schema();
        assert!(FileSortOrder::None.physical_ordering(&schema).is_none());

        let ordering = FileSortOrder::TimestampDesc
            .physical_ordering(&schema)
            .unwrap();
        assert_eq!(ordering.len(), 1);
        let column = ordering[0].expr.downcast_ref::<Column>().unwrap();
        assert_eq!(column.name(), TIMESTAMP_COL_NAME);
        assert_eq!(column.index(), 1);
        assert!(ordering[0].options.descending);
        assert!(!ordering[0].options.nulls_first);

        let ordering = FileSortOrder::HashTimestampAsc
            .physical_ordering(&schema)
            .unwrap();
        assert_eq!(ordering.len(), 2);
        let hash = ordering[0].expr.downcast_ref::<Column>().unwrap();
        assert_eq!(hash.name(), HASH_LABEL);
        assert_eq!(hash.index(), 2);
        assert!(!ordering[0].options.descending);
        let ts = ordering[1].expr.downcast_ref::<Column>().unwrap();
        assert_eq!(ts.name(), TIMESTAMP_COL_NAME);
        assert_eq!(ts.index(), 1);
        assert!(!ordering[1].options.descending);
    }

    #[test]
    fn test_physical_ordering_missing_column() {
        // no __hash__ column: the hash order cannot be declared at all
        let schema = Schema::new(vec![Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)]);
        assert!(
            FileSortOrder::HashTimestampAsc
                .physical_ordering(&schema)
                .is_none()
        );
        assert!(
            FileSortOrder::TimestampDesc
                .physical_ordering(&schema)
                .is_some()
        );
    }
}
