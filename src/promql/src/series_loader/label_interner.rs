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

//! Reading label values out of Arrow string columns and interning them into shared `Label`s.

use std::sync::Arc;

use config::meta::promql::value::Label;
use datafusion::arrow::{
    array::{Array, StringArray, StringViewArray},
    datatypes::DataType,
};
use hashbrown::HashMap;

const LABEL_INTERNER_OBSERVATION_WINDOW: usize = 4096;
const LABEL_INTERNER_MIN_HIT_PERCENT: usize = 10;
const LABEL_INTERNER_MAX_VALUES: usize = 16_384;

/// Query-local cache for immutable labels from one DataFusion column.
///
/// Label values are looked up by borrowed `&str`, so cache hits only clone the
/// `Arc`. A low-reuse column disables and releases its cache after an observation
/// window instead of retaining one map entry per series.
pub(crate) struct LabelInterner {
    name: String,
    values: Option<HashMap<String, Arc<Label>>>,
    window_lookups: usize,
    window_hits: usize,
}

pub(crate) enum LabelColumn<'a> {
    Utf8(&'a StringArray),
    Utf8View(&'a StringViewArray),
}

impl LabelInterner {
    pub(crate) fn new(name: String) -> Self {
        Self {
            name,
            values: Some(HashMap::new()),
            window_lookups: 0,
            window_hits: 0,
        }
    }

    pub(crate) fn intern(&mut self, value: &str) -> Arc<Label> {
        let Some(values) = self.values.as_mut() else {
            return Arc::new(Label {
                name: self.name.clone(),
                value: value.to_string(),
            });
        };

        self.window_lookups += 1;
        let label = if let Some(label) = values.get(value) {
            self.window_hits += 1;
            Arc::clone(label)
        } else {
            let label = Arc::new(Label {
                name: self.name.clone(),
                value: value.to_string(),
            });
            if values.len() < LABEL_INTERNER_MAX_VALUES {
                values.insert(value.to_string(), Arc::clone(&label));
            }
            label
        };

        if self.window_lookups == LABEL_INTERNER_OBSERVATION_WINDOW {
            let keep_cache =
                self.window_hits * 100 >= self.window_lookups * LABEL_INTERNER_MIN_HIT_PERCENT;
            self.window_lookups = 0;
            self.window_hits = 0;
            if !keep_cache {
                self.values = None;
            }
        }

        label
    }

    #[cfg(test)]
    fn is_enabled(&self) -> bool {
        self.values.is_some()
    }
}

impl<'a> LabelColumn<'a> {
    pub(crate) fn try_from_array(column: &'a dyn Array) -> Option<Self> {
        match column.data_type() {
            DataType::Utf8 => column
                .as_any()
                .downcast_ref::<StringArray>()
                .map(Self::Utf8),
            DataType::Utf8View => column
                .as_any()
                .downcast_ref::<StringViewArray>()
                .map(Self::Utf8View),
            _ => None,
        }
    }

    pub(crate) fn is_null(&self, row: usize) -> bool {
        match self {
            Self::Utf8(values) => values.is_null(row),
            Self::Utf8View(values) => values.is_null(row),
        }
    }

    pub(crate) fn value(&self, row: usize) -> &str {
        match self {
            Self::Utf8(values) => values.value(row),
            Self::Utf8View(values) => values.value(row),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_label_interner_disables_low_reuse_columns() {
        let mut unique_interner = LabelInterner::new("instance".to_string());
        for value in 0..LABEL_INTERNER_OBSERVATION_WINDOW {
            unique_interner.intern(&format!("unique-{value}"));
        }
        assert!(!unique_interner.is_enabled());
        let first = unique_interner.intern("tail-repeat");
        let second = unique_interner.intern("tail-repeat");
        assert!(!Arc::ptr_eq(&first, &second));

        let mut repeated_interner = LabelInterner::new("instance".to_string());
        let first = repeated_interner.intern("shared");
        for _ in 1..LABEL_INTERNER_OBSERVATION_WINDOW {
            repeated_interner.intern("shared");
        }
        assert!(repeated_interner.is_enabled());
        let last = repeated_interner.intern("shared");
        assert!(Arc::ptr_eq(&first, &last));

        // Do not disable a column just because the first window starts with a
        // few thousand distinct values. The bounded cache still pays off when
        // those values repeat over the rest of a large query.
        let mut moderately_reused_interner = LabelInterner::new("instance".to_string());
        for value in 0..3000 {
            moderately_reused_interner.intern(&format!("value-{value}"));
        }
        let cached = moderately_reused_interner.intern("value-0");
        for _ in 3001..LABEL_INTERNER_OBSERVATION_WINDOW {
            moderately_reused_interner.intern("value-0");
        }
        assert!(moderately_reused_interner.is_enabled());
        let reused = moderately_reused_interner.intern("value-0");
        assert!(Arc::ptr_eq(&cached, &reused));
    }
}
