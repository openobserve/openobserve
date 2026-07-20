// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Builds a Tantivy warm-up plan from query requirements and optimizer rules.

use std::collections::HashSet;

use config::{TIMESTAMP_COL_NAME, meta::inverted_index::IndexOptimizeMode};
use hashbrown::HashMap;
use tantivy::{
    SegmentReader, Term,
    query::{Query, TermQuery},
    schema::{Field, Schema},
};
use tantivy_utils::puffin_directory::reader::warm_up_terms;

use crate::index::IndexCondition;

#[derive(Default)]
pub(super) struct WarmPlan {
    exact_postings: HashMap<Field, HashMap<Term, bool>>,
    exact_term_info: Option<Term>,
    full_posting_fields: HashSet<Field>,
    dictionary_field: Option<Field>,
    fast_fields: HashSet<String>,
}

impl WarmPlan {
    pub(super) fn build(
        condition: &IndexCondition,
        query: &dyn Query,
        idx_optimize_rule: &Option<IndexOptimizeMode>,
        schema: &Schema,
        file_in_range: bool,
        has_skipped_conditions: bool,
    ) -> Self {
        // Query requirements are fixed and independent of the optimizer.
        let mut plan = Self::from_query(condition, query, schema);

        // The optimizer may replace or extend the query plan.
        plan.apply_optimizer_rule(
            idx_optimize_rule,
            query,
            schema,
            file_in_range,
            has_skipped_conditions,
        );

        plan.normalize();
        plan
    }

    fn from_query(condition: &IndexCondition, query: &dyn Query, schema: &Schema) -> Self {
        // Expansion queries are not exposed by Query::query_terms.
        let full_posting_fields = condition
            .need_all_term_fields()
            .into_iter()
            .filter_map(|field| schema.get_field(&field).ok())
            .collect();

        let mut exact_postings: HashMap<Field, HashMap<Term, bool>> = HashMap::new();
        query.query_terms(&mut |term, need_position| {
            // The same term may be used by both basic and phrase queries.
            exact_postings
                .entry(term.field())
                .or_default()
                .entry(term.clone())
                .and_modify(|position| *position |= need_position)
                .or_insert(need_position);
        });

        Self {
            exact_postings,
            full_posting_fields,
            ..Default::default()
        }
    }

    fn apply_optimizer_rule(
        &mut self,
        rule: &Option<IndexOptimizeMode>,
        query: &dyn Query,
        schema: &Schema,
        file_in_range: bool,
        has_skipped_conditions: bool,
    ) {
        if !file_in_range {
            self.fast_fields.insert(TIMESTAMP_COL_NAME.to_string());
        }

        match rule {
            None => {}
            Some(IndexOptimizeMode::SimpleDistinct(field, ..)) => {
                // This collector reads only the target term dictionary and
                // does not execute the Tantivy query.
                debug_assert!(
                    file_in_range,
                    "SimpleDistinct files must be fully covered by the query time range"
                );
                *self = Self::default();
                if let Ok(field) = schema.get_field(field) {
                    self.dictionary_field = Some(field);
                }
            }
            Some(IndexOptimizeMode::SimpleCount) => {
                // Count(TermQuery) can use doc_freq only for a complete query
                // and a fully covered file.
                if file_in_range
                    && !has_skipped_conditions
                    && let Some(term_query) = query.downcast_ref::<TermQuery>()
                {
                    self.exact_postings.clear();
                    self.exact_term_info = Some(term_query.term().clone());
                }
            }
            Some(IndexOptimizeMode::SimpleHistogram(..)) => {
                self.fast_fields.insert(TIMESTAMP_COL_NAME.to_string());
            }
            Some(IndexOptimizeMode::SimpleMultiHistogram(.., field)) => {
                self.fast_fields.insert(TIMESTAMP_COL_NAME.to_string());
                self.fast_fields.insert(field.clone());
            }
            Some(IndexOptimizeMode::SimpleTopN(fields, ..)) => {
                self.fast_fields.extend(fields.iter().cloned());
            }
            Some(IndexOptimizeMode::SimpleSelect(..)) if !has_skipped_conditions => {
                self.fast_fields.insert(TIMESTAMP_COL_NAME.to_string());
            }
            Some(IndexOptimizeMode::SimpleSelect(..)) => {}
        }
    }

    fn normalize(&mut self) {
        for (field, terms) in &mut self.exact_postings {
            if self.full_posting_fields.contains(field) {
                // Full warm-up excludes positions, so phrase terms remain.
                terms.retain(|_, need_positions| *need_positions);
            }
        }
        self.exact_postings.retain(|_, terms| !terms.is_empty());
    }

    pub(super) async fn execute(self, segment_reader: &SegmentReader) -> anyhow::Result<()> {
        let exact_postings = self.exact_postings;
        let base_warmup = warm_up_terms(
            segment_reader,
            &exact_postings,
            self.full_posting_fields,
            self.fast_fields,
        );
        let dictionary_warmup = warm_dictionary(segment_reader, self.dictionary_field);
        let term_info_warmup = warm_term_info(segment_reader, self.exact_term_info);
        tokio::try_join!(base_warmup, dictionary_warmup, term_info_warmup)?;
        Ok(())
    }
}

async fn warm_dictionary(
    segment_reader: &SegmentReader,
    field: Option<Field>,
) -> anyhow::Result<()> {
    if let Some(field) = field {
        let inverted_index = segment_reader.inverted_index(field)?;
        inverted_index.terms().warm_up_dictionary().await?;
    }
    Ok(())
}

async fn warm_term_info(segment_reader: &SegmentReader, term: Option<Term>) -> anyhow::Result<()> {
    if let Some(term) = term {
        // Immutable .ttv files have no deletes, so doc_freq is the exact count.
        let inverted_index = segment_reader.inverted_index(term.field())?;
        inverted_index.doc_freq_async(&term).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::INDEX_FIELD_NAME_FOR_ALL;
    use tantivy::{
        Index, Searcher,
        collector::Count,
        doc,
        query::PhraseQuery,
        schema::{FAST, Schema, TEXT},
    };

    use super::*;
    use crate::index::Condition;

    fn schema() -> Schema {
        let mut builder = Schema::builder();
        builder.add_text_field("tag", TEXT);
        builder.add_text_field(INDEX_FIELD_NAME_FOR_ALL, TEXT);
        builder.add_i64_field(TIMESTAMP_COL_NAME, FAST);
        builder.build()
    }

    fn build_plan(
        condition: Condition,
        optimize_rule: Option<IndexOptimizeMode>,
        file_in_range: bool,
        has_skipped_conditions: bool,
    ) -> (WarmPlan, Schema) {
        let schema = schema();
        let default_field = schema.get_field(INDEX_FIELD_NAME_FOR_ALL).ok();
        let mut index_condition = IndexCondition::new();
        index_condition.add_condition(condition);
        let (query, _) = index_condition
            .to_tantivy_query("test", schema.clone(), default_field)
            .unwrap();
        let plan = WarmPlan::build(
            &index_condition,
            query.as_ref(),
            &optimize_rule,
            &schema,
            file_in_range,
            has_skipped_conditions,
        );
        (plan, schema)
    }

    fn exact_terms(plan: &WarmPlan) -> HashSet<Term> {
        plan.exact_postings
            .values()
            .flat_map(|terms| terms.keys().cloned())
            .collect()
    }

    fn build_searcher() -> Searcher {
        let schema = schema();
        let tag = schema.get_field("tag").unwrap();
        let index = Index::create_in_ram(schema);
        let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
        writer.add_document(doc!(tag => "a")).unwrap();
        writer.add_document(doc!(tag => "b")).unwrap();
        writer.commit().unwrap();
        drop(writer);
        index.reader().unwrap().searcher()
    }

    #[test]
    fn str_match_preserves_full_posting_warmup() {
        let (plan, schema) = build_plan(
            Condition::StrMatch("tag".into(), "needle".into(), true),
            None,
            true,
            false,
        );
        assert_eq!(
            plan.full_posting_fields,
            HashSet::from([schema.get_field("tag").unwrap()])
        );
        assert!(plan.exact_postings.is_empty());
    }

    #[test]
    fn not_equal_warms_only_exact_posting() {
        let (plan, schema) = build_plan(
            Condition::NotEqual("tag".into(), "value".into()),
            None,
            true,
            false,
        );
        let tag = schema.get_field("tag").unwrap();
        assert!(plan.full_posting_fields.is_empty());
        assert_eq!(
            plan.exact_postings.get(&tag),
            Some(&HashMap::from([(
                Term::from_field_text(tag, "value"),
                false
            )]))
        );
    }

    #[test]
    fn negative_exact_queries_do_not_warm_full_fields() {
        let (not_in, schema) = build_plan(
            Condition::In("tag".into(), vec!["a".into(), "b".into(), "a".into()], true),
            None,
            true,
            false,
        );
        let tag = schema.get_field("tag").unwrap();
        assert_eq!(
            exact_terms(&not_in),
            HashSet::from([
                Term::from_field_text(tag, "a"),
                Term::from_field_text(tag, "b"),
            ])
        );
        assert!(not_in.full_posting_fields.is_empty());

        let (not_equal, _) = build_plan(
            Condition::Not(Box::new(Condition::Equal("tag".into(), "a".into()))),
            None,
            true,
            false,
        );
        assert_eq!(exact_terms(&not_equal).len(), 1);
        assert!(not_equal.full_posting_fields.is_empty());
    }

    #[test]
    fn simple_distinct_is_dictionary_only() {
        let (plan, schema) = build_plan(
            Condition::StrMatch("tag".into(), "needle".into(), true),
            Some(IndexOptimizeMode::SimpleDistinct("tag".into(), 10, true)),
            true,
            false,
        );
        assert_eq!(
            plan.dictionary_field,
            Some(schema.get_field("tag").unwrap())
        );
        assert!(plan.exact_postings.is_empty());
        assert!(plan.exact_term_info.is_none());
        assert!(plan.full_posting_fields.is_empty());
        assert!(plan.fast_fields.is_empty());
    }

    #[test]
    fn full_postings_drop_basic_exact_terms_but_keep_positions() {
        let schema = schema();
        let all = schema.get_field(INDEX_FIELD_NAME_FOR_ALL).unwrap();
        let basic = Term::from_field_text(all, "basic");
        let first = Term::from_field_text(all, "first");
        let second = Term::from_field_text(all, "second");
        let query = PhraseQuery::new(vec![first.clone(), second.clone()]);
        let mut condition = IndexCondition::new();
        condition.add_condition(Condition::StrMatch(
            INDEX_FIELD_NAME_FOR_ALL.into(),
            "needle".into(),
            true,
        ));
        let basic_query =
            tantivy::query::TermQuery::new(basic, tantivy::schema::IndexRecordOption::Basic);
        let combined = tantivy::query::BooleanQuery::intersection(vec![
            Box::new(query),
            Box::new(basic_query),
        ]);
        let plan = WarmPlan::build(&condition, &combined, &None, &schema, true, false);
        assert_eq!(
            plan.exact_postings.get(&all),
            Some(&HashMap::from([(first, true), (second, true)]))
        );
    }

    #[test]
    fn duplicate_exact_term_preserves_position_requirement() {
        let schema = schema();
        let tag = schema.get_field("tag").unwrap();
        let term = Term::from_field_text(tag, "value");
        let other = Term::from_field_text(tag, "other");
        let basic =
            tantivy::query::TermQuery::new(term.clone(), tantivy::schema::IndexRecordOption::Basic);
        let positioned = PhraseQuery::new(vec![term.clone(), other.clone()]);
        let query =
            tantivy::query::BooleanQuery::intersection(vec![Box::new(basic), Box::new(positioned)]);
        let mut condition = IndexCondition::new();
        condition.add_condition(Condition::Equal("tag".into(), "value".into()));
        let plan = WarmPlan::build(&condition, &query, &None, &schema, true, false);
        assert_eq!(
            plan.exact_postings.get(&tag),
            Some(&HashMap::from([(term, true), (other, true)]))
        );
    }

    #[test]
    fn simple_count_term_uses_term_info_only() {
        let (plan, schema) = build_plan(
            Condition::Equal("tag".into(), "a".into()),
            Some(IndexOptimizeMode::SimpleCount),
            true,
            false,
        );
        let tag = schema.get_field("tag").unwrap();
        assert_eq!(plan.exact_term_info, Some(Term::from_field_text(tag, "a")));
        assert!(plan.exact_postings.is_empty());
    }

    #[test]
    fn regular_equal_still_warms_exact_posting() {
        let (plan, _) = build_plan(
            Condition::Equal("tag".into(), "a".into()),
            None,
            true,
            false,
        );
        assert_eq!(exact_terms(&plan).len(), 1);
        assert!(plan.exact_term_info.is_none());
    }

    #[test]
    fn simple_count_all_needs_no_warmup() {
        let (plan, _) = build_plan(
            Condition::All(),
            Some(IndexOptimizeMode::SimpleCount),
            true,
            false,
        );
        assert!(plan.exact_postings.is_empty());
        assert!(plan.exact_term_info.is_none());
        assert!(plan.full_posting_fields.is_empty());
        assert!(plan.dictionary_field.is_none());
        assert!(plan.fast_fields.is_empty());
    }

    #[test]
    fn compound_simple_count_keeps_postings() {
        let schema = schema();
        let tag = schema.get_field("tag").unwrap();
        let left = tantivy::query::TermQuery::new(
            Term::from_field_text(tag, "a"),
            tantivy::schema::IndexRecordOption::Basic,
        );
        let right = tantivy::query::TermQuery::new(
            Term::from_field_text(tag, "b"),
            tantivy::schema::IndexRecordOption::Basic,
        );
        let query =
            tantivy::query::BooleanQuery::intersection(vec![Box::new(left), Box::new(right)]);
        let mut condition = IndexCondition::new();
        condition.add_condition(Condition::And(
            Box::new(Condition::Equal("tag".into(), "a".into())),
            Box::new(Condition::Equal("tag".into(), "b".into())),
        ));
        let plan = WarmPlan::build(
            &condition,
            &query,
            &Some(IndexOptimizeMode::SimpleCount),
            &schema,
            true,
            false,
        );
        assert_eq!(exact_terms(&plan).len(), 2);
        assert!(plan.exact_term_info.is_none());
    }

    #[test]
    fn simple_count_falls_back_for_partial_or_skipped_queries() {
        let (partial, _) = build_plan(
            Condition::Equal("tag".into(), "a".into()),
            Some(IndexOptimizeMode::SimpleCount),
            false,
            false,
        );
        assert_eq!(exact_terms(&partial).len(), 1);
        assert!(partial.exact_term_info.is_none());
        assert_eq!(
            partial.fast_fields,
            HashSet::from([TIMESTAMP_COL_NAME.to_string()])
        );

        let (skipped, _) = build_plan(
            Condition::Equal("tag".into(), "a".into()),
            Some(IndexOptimizeMode::SimpleCount),
            true,
            true,
        );
        assert_eq!(exact_terms(&skipped).len(), 1);
        assert!(skipped.exact_term_info.is_none());
    }

    #[tokio::test]
    async fn simple_count_executes_from_term_info() {
        let searcher = build_searcher();
        let schema = searcher.schema().clone();
        let tag = schema.get_field("tag").unwrap();
        let query = tantivy::query::TermQuery::new(
            Term::from_field_text(tag, "a"),
            tantivy::schema::IndexRecordOption::Basic,
        );
        let mut condition = IndexCondition::new();
        condition.add_condition(Condition::Equal("tag".into(), "a".into()));
        let plan = WarmPlan::build(
            &condition,
            &query,
            &Some(IndexOptimizeMode::SimpleCount),
            &schema,
            true,
            false,
        );
        plan.execute(searcher.segment_reader(0)).await.unwrap();
        assert_eq!(searcher.search(&query, &Count).unwrap(), 1);
    }

    #[test]
    fn collector_fast_fields_are_preserved() {
        let (histogram, _) = build_plan(
            Condition::All(),
            Some(IndexOptimizeMode::SimpleHistogram(0, 100, 10, 0)),
            true,
            false,
        );
        assert_eq!(
            histogram.fast_fields,
            HashSet::from([TIMESTAMP_COL_NAME.to_string()])
        );

        let (top_n, _) = build_plan(
            Condition::All(),
            Some(IndexOptimizeMode::SimpleTopN(vec!["tag".into()], 10, true)),
            true,
            false,
        );
        assert_eq!(top_n.fast_fields, HashSet::from(["tag".to_string()]));
    }

    #[test]
    fn partial_file_preserves_timestamp_warmup() {
        let (plan, _) = build_plan(Condition::All(), None, false, false);
        assert_eq!(
            plan.fast_fields,
            HashSet::from([TIMESTAMP_COL_NAME.to_string()])
        );
    }

    #[test]
    fn skipped_simple_select_preserves_existing_fast_field_behavior() {
        let (skipped, _) = build_plan(
            Condition::All(),
            Some(IndexOptimizeMode::SimpleSelect(10, true)),
            true,
            true,
        );
        assert!(skipped.fast_fields.is_empty());

        let (complete, _) = build_plan(
            Condition::All(),
            Some(IndexOptimizeMode::SimpleSelect(10, true)),
            true,
            false,
        );
        assert_eq!(
            complete.fast_fields,
            HashSet::from([TIMESTAMP_COL_NAME.to_string()])
        );
    }
}
