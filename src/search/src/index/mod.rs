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

mod condition;
mod physical;

use std::{
    fmt::{self, Debug, Formatter},
    sync::Arc,
};

pub use condition::Condition;
use datafusion::{arrow::datatypes::SchemaRef, physical_plan::PhysicalExpr};
use hashbrown::HashSet;
use physical::conjunction;
use tantivy::{
    query::{BooleanQuery, Occur, Query},
    schema::{Field, Schema},
};

// note the condition in IndexCondition is connection by AND operator
#[derive(Default, Clone, Hash, Eq, PartialEq)]
pub struct IndexCondition {
    pub conditions: Vec<Condition>,
}

impl IndexCondition {
    pub fn new() -> Self {
        IndexCondition {
            conditions: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.conditions.is_empty()
    }

    pub fn add_condition(&mut self, condition: Condition) {
        self.conditions.push(condition);
    }
}

impl Debug for IndexCondition {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_query())
    }
}

impl IndexCondition {
    // this only use for display the query
    pub fn to_query(&self) -> String {
        self.conditions
            .iter()
            .map(|condition| condition.to_query())
            .collect::<Vec<_>>()
            .join(" AND ")
    }

    // get the tantivy query for the index condition
    // Returns (query, has_skipped):
    //   has_skipped = true means some conditions were skipped because the field
    //   does not exist in this tantivy index (e.g., a newly added index field
    //   that has no historical data). The caller must keep the DataFusion filter
    //   so that the skipped predicates are still evaluated.
    pub fn to_tantivy_query(
        &self,
        trace_id: &str,
        schema: Schema,
        default_field: Option<Field>,
    ) -> anyhow::Result<(Box<dyn Query>, bool)> {
        let mut has_skipped = false;
        let mut queries: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(self.conditions.len());
        for condition in &self.conditions {
            match condition.to_tantivy_query(&schema, default_field) {
                Ok(query) => {
                    queries.push((Occur::Must, query));
                }
                Err(e) => {
                    log::info!(
                        "[trace_id {trace_id}] to_tantivy_query: skipping condition due to error: {e}"
                    );
                    has_skipped = true;
                }
            }
        }
        if queries.is_empty() {
            Err(anyhow::anyhow!(
                "All AND conditions are failed to generate tantivy query"
            ))
        } else if queries.len() == 1 {
            Ok((queries.pop().unwrap().1, has_skipped))
        } else {
            Ok((Box::new(BooleanQuery::from(queries)), has_skipped))
        }
    }

    // get the fields use for search in datafusion(for add filter back logical)
    pub fn get_schema_fields(&self, fst_fields: &[String]) -> HashSet<String> {
        self.conditions
            .iter()
            .fold(HashSet::new(), |mut acc, condition| {
                acc.extend(condition.get_schema_fields(fst_fields));
                acc
            })
    }

    pub fn get_schema_projection(&self, schema: SchemaRef, fst_fields: &[String]) -> Vec<usize> {
        let fields = self.get_schema_fields(fst_fields);
        let mut projection = Vec::with_capacity(fields.len());
        for field in fields.iter() {
            if let Ok(index) = schema.index_of(field) {
                projection.push(index);
            }
        }
        projection
    }

    pub fn need_all_term_fields(&self) -> Vec<String> {
        self.conditions
            .iter()
            .flat_map(|condition| condition.need_all_term_fields())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect()
    }

    pub fn to_physical_expr(
        &self,
        schema: &arrow_schema::Schema,
        fst_fields: &[String],
    ) -> Result<Arc<dyn PhysicalExpr>, anyhow::Error> {
        Ok(conjunction(
            self.conditions
                .iter()
                .map(|condition| condition.to_physical_expr(schema, fst_fields))
                .collect::<Result<Vec<_>, _>>()?,
        ))
    }

    pub fn can_remove_filter(&self) -> bool {
        self.conditions
            .iter()
            .all(|condition| condition.can_remove_filter())
    }

    // use for simple distinct optimization
    pub fn get_str_match_condition(&self) -> Option<(String, bool)> {
        match &self.conditions[0] {
            Condition::StrMatch(_, value, case_sensitive) => {
                Some((value.to_string(), *case_sensitive))
            }
            Condition::All() => None, // for the condition that query without filter
            _ => unreachable!("get_str_match_condition only support one str_match condition"),
        }
    }

    // use for check if the index condition is only
    // for the condition that query without filter
    pub fn is_condition_all(&self) -> bool {
        self.conditions.len() == 1 && matches!(self.conditions[0], Condition::All())
    }

    // use for the simple histogram RANK fast path: the single `field = value` term
    pub fn single_equal_term(&self) -> Option<(String, String)> {
        if self.conditions.len() == 1
            && let Condition::Equal(field, value) = &self.conditions[0]
        {
            Some((field.clone(), value.clone()))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_index_condition_new() {
        let condition = IndexCondition::new();
        assert!(condition.conditions.is_empty());
    }

    #[test]
    fn test_index_condition_add_condition() {
        let mut index_condition = IndexCondition::new();
        let condition = Condition::Equal("field1".to_string(), "value1".to_string());

        index_condition.add_condition(condition.clone());

        assert_eq!(index_condition.conditions.len(), 1);
        assert!(matches!(
            index_condition.conditions[0],
            Condition::Equal(ref field, ref value) if field == "field1" && value == "value1"
        ));
    }

    #[test]
    fn test_index_condition_to_query() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        index_condition.add_condition(Condition::Equal("field2".to_string(), "value2".to_string()));

        let query_string = index_condition.to_query();
        assert_eq!(query_string, "field1=value1 AND field2=value2");
    }

    #[test]
    fn test_index_condition_to_query_empty() {
        let index_condition = IndexCondition::new();
        let query_string = index_condition.to_query();
        assert_eq!(query_string, "");
    }

    #[test]
    fn test_index_condition_is_empty() {
        let mut index_condition = IndexCondition::new();
        assert!(index_condition.is_empty());

        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        assert!(!index_condition.is_empty());
    }

    #[test]
    fn test_index_condition_get_str_match_condition() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::StrMatch(
            "field1".to_string(),
            "value1".to_string(),
            true,
        ));

        let result = index_condition.get_str_match_condition();
        assert_eq!(result, Some(("value1".to_string(), true)));
    }

    #[test]
    fn test_index_condition_get_str_match_condition_all() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::All());

        let result = index_condition.get_str_match_condition();
        assert_eq!(result, None);
    }

    #[test]
    fn test_index_condition_is_condition_all() {
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(Condition::All());

        assert!(index_condition.is_condition_all());

        index_condition.add_condition(Condition::Equal("field1".to_string(), "value1".to_string()));
        assert!(!index_condition.is_condition_all());
    }
}
