// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Composite-alert service and evaluator.
//!
//! The executable contracts below deliberately precede the implementation.
//! `test_support::CompositeHarness` must drive the real service/repository/
//! scheduler seams with deterministic time and injected delivery sinks; it
//! must not reimplement the evaluator as a parallel fake.

mod runtime;
mod service;

pub use runtime::{
    CompositeEvaluation, CompositeEvaluator, CompositeStateInput, EvaluatedChild, EvaluationFailure,
};
pub use service::{
    CompositeCreate, CompositeServiceError, StartupPreflightError, clone_composite,
    create_composite, delete_composite, evaluate_definition, evaluate_expression, get_composite,
    move_composite, set_composite_enabled, startup_preflight, trigger_composite, update_composite,
    validate_composite_graph,
};

#[cfg(test)]
pub mod test_support;

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use config::meta::alerts::level::AlertLevel;

    use super::test_support::{
        ChildKind, ChildSpec, CompositeHarness, CompositeSpec, DeleteOrigin, EvalErrorCode,
        GateMode, Mutation, NudgeReason, RunOutcome, SchedulerOperation, StalePolicy,
    };

    const NOW: i64 = 1_786_500_000_000_000;

    fn child(name: &str) -> ChildSpec {
        ChildSpec::frequency(name, 60).enabled(true)
    }

    fn composite(expression: &str) -> CompositeSpec {
        CompositeSpec::new(expression)
            .warning_counts_as_firing(true)
            .stale_policy(StalePolicy::UseLastState)
            .enabled(true)
    }

    #[tokio::test]
    async fn evaluator_batch_preflights_every_reference_before_boolean_short_circuit() {
        let mut h = CompositeHarness::at(NOW).await;
        let truthy = h.add_child(child("truthy")).await;
        let missing = h.reserve_missing_child_id();
        h.write_rollup(&truthy, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(composite(&format!("{{{truthy}}} || {{{missing}}}")))
            .await;

        let before = h.state(&parent).await;
        let result = h.evaluate(&parent).await;

        assert_eq!(result.outcome, RunOutcome::Error);
        assert_eq!(result.error_code, Some(EvalErrorCode::ChildMissing));
        assert_eq!(
            h.state(&parent).await,
            before,
            "an error preserves the last level"
        );
        assert_eq!(h.delivery_attempts(&parent), 0);
        assert_eq!(h.definition_batch_reads(), 1);
        assert_eq!(h.rollup_state_batch_reads(), 1);
        assert_eq!(
            h.single_child_reads(),
            0,
            "child loading must not become N+1"
        );
    }

    #[tokio::test]
    async fn definition_and_child_index_commit_or_roll_back_as_one_graph_mutation() {
        for failpoint in ["after_definition", "after_first_child", "before_commit"] {
            let mut h = CompositeHarness::at(NOW).await;
            let a = h.add_child(child("a")).await;
            let b = h.add_child(child("b")).await;
            h.fail_graph_transaction_at(failpoint);

            let result = h
                .try_add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
                .await;

            assert!(
                result.is_err(),
                "failpoint {failpoint} must abort the mutation"
            );
            assert_eq!(h.composite_definition_count().await, 0);
            assert_eq!(h.composite_child_index_count().await, 0);
            assert_eq!(h.graph_lock_acquisitions(), 1);
            assert!(!h.graph_lock_is_held());
        }
    }

    #[tokio::test]
    async fn concurrent_updates_cannot_commit_a_cycle() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        let c = h.add_child(child("c")).await;
        let first = h
            .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;
        let second = h
            .add_composite(composite(&format!("{{{b}}} && {{{c}}}")))
            .await;

        let (left, right) = h
            .race_graph_mutations(
                Mutation::UpdateExpression {
                    composite_id: first.clone(),
                    expression: format!("{{{second}}} && {{{a}}}"),
                },
                Mutation::UpdateExpression {
                    composite_id: second,
                    expression: format!("{{{first}}} && {{{c}}}"),
                },
            )
            .await;

        assert_ne!(
            left.is_ok(),
            right.is_ok(),
            "each edit is valid alone, but exactly one may win the graph lock"
        );
        assert!(h.persisted_graph_is_acyclic().await);
        assert!(h.persisted_graph_max_depth().await <= 2);
        assert_eq!(h.max_simultaneous_graph_critical_sections(), 1);
    }

    #[tokio::test]
    async fn concurrent_child_delete_and_composite_create_cannot_leave_a_dangling_reference() {
        let mut h = CompositeHarness::at(NOW).await;
        let child_to_delete = h.add_child(child("delete-race")).await;
        let peer = h.add_child(child("peer")).await;

        let (created, deleted) = h
            .race_composite_create_and_child_delete(
                composite(&format!("{{{child_to_delete}}} && {{{peer}}}")),
                &child_to_delete,
            )
            .await;

        assert_ne!(
            created.is_ok(),
            deleted.is_ok(),
            "create-first blocks delete; delete-first makes create inaccessible"
        );
        assert_eq!(h.definition_exists(&child_to_delete).await, created.is_ok());
        assert!(h.has_no_dangling_child_index().await);
        assert_eq!(h.max_simultaneous_graph_critical_sections(), 1);
    }

    #[tokio::test]
    async fn graph_lock_failure_returns_503_without_reading_or_writing_the_graph() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.fail_next_graph_lock();
        let error = h
            .try_add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await
            .unwrap_err();
        assert_eq!(
            (error.status, error.code.as_str()),
            (503, "composite_graph_lock_unavailable")
        );
        assert_eq!(h.graph_reads_after_failed_lock(), 0);
        assert_eq!(h.graph_writes_after_failed_lock(), 0);
        assert_eq!(h.scheduler_operations().len(), 0);
    }

    #[tokio::test]
    async fn every_delete_origin_uses_the_reverse_reference_guard() {
        let origins = [
            DeleteOrigin::Single,
            DeleteOrigin::Bulk,
            DeleteOrigin::StreamDeleteAll,
            DeleteOrigin::StreamDeleteByName,
            DeleteOrigin::SloCascade,
            DeleteOrigin::ImportReplacement,
            DeleteOrigin::AdminCleanup,
            DeleteOrigin::MigrationCleanup,
            DeleteOrigin::RetentionCleanup,
        ];
        for origin in origins {
            let mut h = CompositeHarness::at(NOW).await;
            let protected = h.add_child(child("protected")).await;
            let sibling = h.add_child(child("sibling")).await;
            let parent = h
                .add_composite(composite(&format!("{{{protected}}} && {{{sibling}}}")))
                .await;

            let error = h
                .delete_from(origin, [protected.clone(), sibling.clone()])
                .await
                .unwrap_err();
            assert_eq!(
                (error.status, error.code.as_str()),
                (409, "child_referenced")
            );
            assert_eq!(error.visible_parents, [parent]);
            assert_eq!(error.hidden_reference_count, 0);
            if origin.is_atomic_cascade() {
                assert!(
                    h.definition_exists(&sibling).await,
                    "{origin:?} preflights every sibling"
                );
            }
            assert!(h.definition_exists(&protected).await);
            assert_eq!(h.reverse_guard_calls(origin), 1);
            assert_eq!(h.unguarded_repository_delete_calls(), 0);
        }
    }

    #[tokio::test]
    async fn only_org_teardown_has_an_explicit_guard_bypass_and_deletes_index_first() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;

        assert!(h.public_force_delete_parameter_is_absent());
        h.organization_teardown().await.unwrap();

        assert_eq!(
            h.teardown_order(),
            ["alert_composite_children", "alert_composites", "alerts"]
        );
        assert_eq!(h.composite_child_index_count().await, 0);
        assert_eq!(h.composite_definition_count().await, 0);
        assert_eq!(h.ordinary_alert_count().await, 0);
    }

    #[tokio::test]
    async fn generic_resolver_rejects_cross_table_id_collision_instead_of_selecting_one() {
        let mut h = CompositeHarness::at(NOW).await;
        let collision = h.insert_corrupt_cross_table_collision().await;
        let error = h.resolve_definition(&collision).await.unwrap_err();
        assert_eq!(error.code, "alert_definition_collision");
        assert_eq!(error.status, 500);
        assert!(!error.selected_ordinary);
        assert!(!error.selected_composite);
        assert_eq!(h.internal_integrity_error_count(), 1);
    }

    #[tokio::test]
    async fn child_access_errors_are_aggregated_and_non_disclosing() {
        let mut h = CompositeHarness::at(NOW).await;
        let readable = h.add_child(child("readable")).await;
        let missing = h.reserve_missing_child_id();
        let cross_org = h.add_child(child("cross-org").org("other")).await;
        let unreadable = h.add_child(child("classified-name")).await;
        h.deny_child_read(&unreadable);

        let error = h
            .validate_as_user(&format!(
                "{{{readable}}} || {{{missing}}} || {{{cross_org}}} || {{{unreadable}}}"
            ))
            .await
            .unwrap_err();

        assert_eq!(
            (error.status, error.code.as_str()),
            (403, "child_not_accessible")
        );
        assert_eq!(error.children.len(), 3);
        assert_eq!(
            error
                .children
                .iter()
                .map(|c| c.alert_id.clone())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([missing, cross_org, unreadable])
        );
        assert!(error.children.iter().all(|c| !c.accessible));
        assert!(error.children.iter().all(|c| c.name.is_none()));
        assert!(error.children.iter().all(|c| c.kind.is_none()));
        assert!(error.children.iter().all(|c| c.state.is_none()));
    }

    #[tokio::test]
    async fn permission_loss_masks_user_reads_but_bounded_system_delivery_continues() {
        let mut h = CompositeHarness::at(NOW).await;
        let visible = h.add_child(child("visible")).await;
        let later_hidden = h
            .add_child(child("classified-name").sensitive_query("select classified"))
            .await;
        h.write_rollup(&visible, AlertLevel::Critical, NOW).await;
        h.write_rollup(&later_hidden, AlertLevel::Critical, NOW)
            .await;
        let parent = h
            .add_composite(
                composite(&format!("{{{visible}}} && {{{later_hidden}}}"))
                    .destinations(["existing-destination"])
                    .workflows(["existing-workflow"]),
            )
            .await;
        h.deny_child_read(&later_hidden);

        for snapshot in [
            h.detail_as_user(&parent).await,
            h.preview_as_user(&parent).await,
            h.history_snapshot_as_user(&parent).await,
            h.workflow_run_snapshot_as_user(&parent).await,
        ] {
            let hidden = snapshot.child(&later_hidden).expect("ID remains removable");
            assert!(!hidden.accessible);
            assert!(hidden.name.is_none());
            assert!(hidden.config.is_none());
            assert!(hidden.state.is_none());
        }

        h.evaluate(&parent).await;
        let delivered = h.last_payload_for("existing-destination").unwrap();
        assert_eq!(delivered["child_states"][1]["alert_id"], later_hidden);
        assert!(delivered["child_states"][1].get("query").is_none());
        assert!(!delivered.to_string().contains("select classified"));
        assert_eq!(h.workflow_invocations("existing-workflow"), 1);

        let error = h
            .change_targets(&parent, ["new-destination"], ["new-workflow"])
            .await
            .unwrap_err();
        assert_eq!(
            (error.status, error.code.as_str()),
            (403, "child_not_accessible")
        );
        let definition = h.composite_definition(&parent).await.unwrap();
        assert_eq!(definition.destinations, ["existing-destination"]);
        assert_eq!(definition.workflows, ["existing-workflow"]);
    }

    #[tokio::test]
    async fn update_and_delete_failpoints_leave_definition_index_state_and_job_consistent() {
        for mutation in [Mutation::Update, Mutation::Delete] {
            for failpoint in [
                "after_definition",
                "after_child_index",
                "after_state_cleanup",
            ] {
                let mut h = CompositeHarness::at(NOW).await;
                let a = h.add_child(child("a")).await;
                let b = h.add_child(child("b")).await;
                let parent = h
                    .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
                    .await;
                h.seed_composite_state(&parent, AlertLevel::Critical, NOW)
                    .await;
                let before = h.graph_lifecycle_snapshot(&parent).await;
                h.fail_graph_transaction_at(failpoint);

                assert!(
                    h.apply_definition_mutation(&parent, &mutation)
                        .await
                        .is_err()
                );
                assert_eq!(h.graph_lifecycle_snapshot(&parent).await, before);
                assert!(h.has_no_dangling_child_index().await);
                assert_eq!(
                    h.scheduler_operations_since(&before),
                    0,
                    "scheduler runs after commit only"
                );
            }
        }
    }

    #[tokio::test]
    async fn scheduler_crud_failures_match_ordinary_alert_parity_and_later_edit_repairs_missing_job()
     {
        for operation in [
            SchedulerOperation::Push,
            SchedulerOperation::Update,
            SchedulerOperation::Delete,
        ] {
            let mut h = CompositeHarness::at(NOW).await;
            let a = h.add_child(child("a")).await;
            let b = h.add_child(child("b")).await;
            h.fail_scheduler_operation(operation);
            let result = h
                .run_definition_lifecycle_operation(
                    operation,
                    composite(&format!("{{{a}}} && {{{b}}}")),
                )
                .await;
            assert_eq!(
                result.http_status,
                h.ordinary_alert_scheduler_failure_status(operation)
            );
            assert_eq!(
                result.log_code,
                h.ordinary_alert_scheduler_failure_log_code(operation)
            );
            assert!(!h.composite_reconciler_or_outbox_created());
        }

        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.fail_scheduler_operation(SchedulerOperation::Push);
        let parent = h
            .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;
        assert!(h.job(&parent).await.is_none());
        assert!(!h.detail(&parent).await.scheduler_job_present);
        h.clear_scheduler_failures();
        h.edit_description(&parent, "repair push").await.unwrap();
        assert!(h.job(&parent).await.is_some());
        assert!(h.detail(&parent).await.scheduler_job_present);
    }

    #[tokio::test]
    async fn stale_post_delete_job_completes_without_state_delivery_or_definition_resurrection() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW).await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;
        let stale_job = h.clone_job_for_stale_delivery(&parent).await;
        h.delete_composite(&parent).await.unwrap();

        let result = h.run_stale_job(stale_job).await;
        assert!(result.completed);
        assert!(!result.evaluated);
        assert!(!result.state_written);
        assert!(!result.delivery_started);
        assert!(!h.definition_exists(&parent).await);
        assert!(h.state(&parent).await.is_none());
    }

    #[tokio::test]
    async fn and_truth_warning_mapping_and_multi_alert_rollup_are_exact() {
        let cases = [
            (AlertLevel::Critical, AlertLevel::Critical, true, true),
            (AlertLevel::Critical, AlertLevel::Ok, true, false),
            (AlertLevel::Warning, AlertLevel::Critical, true, true),
            (AlertLevel::Warning, AlertLevel::Critical, false, false),
            (AlertLevel::NoData, AlertLevel::Critical, true, false),
        ];
        for (left_level, right_level, warning_fires, expected) in cases {
            let mut h = CompositeHarness::at(NOW).await;
            let left = h.add_child(child("left").multi_alert(true)).await;
            let right = h.add_child(child("right")).await;
            // A firing group must be ignored; only group_key='' contributes.
            h.write_group(&left, "region=us", AlertLevel::Critical, NOW)
                .await;
            h.write_rollup(&left, left_level, NOW).await;
            h.write_rollup(&right, right_level, NOW).await;
            let parent = h
                .add_composite(
                    composite(&format!("{{{left}}} && {{{right}}}"))
                        .warning_counts_as_firing(warning_fires),
                )
                .await;

            let result = h.evaluate(&parent).await;
            assert_eq!(result.result, Some(expected));
            assert_eq!(
                result.level,
                Some(if expected {
                    AlertLevel::Critical
                } else {
                    AlertLevel::Ok
                })
            );
            assert_eq!(
                result.outcome,
                if expected {
                    RunOutcome::Firing
                } else {
                    RunOutcome::Normal
                }
            );
            assert_eq!(h.queried_group_keys(), [String::new()].into());
        }
    }

    #[tokio::test]
    async fn stale_disabled_erroring_and_never_evaluated_children_follow_all_policies() {
        let cases = [
            (StalePolicy::UseLastState, Some(AlertLevel::Critical), true),
            (StalePolicy::UseLastState, None, false),
            (StalePolicy::TreatAsFalse, Some(AlertLevel::Critical), false),
            (StalePolicy::TreatAsTrue, Some(AlertLevel::Ok), true),
            (StalePolicy::TreatAsTrue, None, true),
        ];
        for (policy, stored_level, expected_truth) in cases {
            let mut h = CompositeHarness::at(NOW).await;
            let stale = h.add_child(child("stale").enabled(false)).await;
            let fresh = h.add_child(child("fresh")).await;
            if let Some(level) = stored_level {
                h.write_rollup(&stale, level, NOW - 181_000_000).await;
                h.write_error_outcome(&stale, NOW - 1_000_000).await;
            }
            h.write_rollup(&fresh, AlertLevel::Critical, NOW).await;
            let parent = h
                .add_composite(
                    composite(&format!("{{{stale}}} && {{{fresh}}}")).stale_policy(policy),
                )
                .await;

            let result = h.evaluate(&parent).await;
            assert!(result.children[0].stale);
            assert_eq!(result.children[0].truth, expected_truth);
            assert_eq!(result.result, Some(expected_truth));
            assert_eq!(
                result.children[0].level_at,
                stored_level.map(|_| NOW - 181_000_000),
                "last_outcome_at must never refresh the freshness clock"
            );
        }
    }

    #[tokio::test]
    async fn cadence_errors_and_graph_corruption_preserve_level_and_send_nothing() {
        let corruptions = [
            EvalErrorCode::ChildCrossOrg,
            EvalErrorCode::ExpressionIndexMismatch,
            EvalErrorCode::ChildRead,
            EvalErrorCode::InvalidCadence,
            EvalErrorCode::GraphCorrupt,
        ];
        for corruption in corruptions {
            let mut h = CompositeHarness::at(NOW).await;
            let a = h.add_child(child("a")).await;
            let b = h.add_child(child("b")).await;
            let parent = h
                .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
                .await;
            h.seed_composite_state(&parent, AlertLevel::Critical, NOW - 10_000_000)
                .await;
            h.inject_evaluation_error(&parent, corruption);

            let result = h.evaluate(&parent).await;
            assert_eq!(result.outcome, RunOutcome::Error);
            assert_eq!(result.error_code, Some(corruption));
            let state = h.state(&parent).await.expect("seeded state remains");
            assert_eq!(state.level, AlertLevel::Critical);
            assert_eq!(state.level_at, NOW - 10_000_000);
            assert_eq!(h.delivery_attempts(&parent), 0);
            assert_eq!(h.parent_nudges(&parent), 0);
        }
    }

    #[tokio::test]
    async fn stale_deadline_is_earlier_than_sweep_and_strict_boundary_adds_one_microsecond() {
        let mut h = CompositeHarness::at(NOW)
            .sweep_seconds(300)
            .stale_k(3)
            .await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW - 60_000_000)
            .await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;

        let result = h.evaluate(&parent).await;
        assert_eq!(result.children[0].stale_deadline, NOW + 120_000_000);
        assert_eq!(result.next_run_at, NOW + 120_000_001);
        h.set_now(NOW + 120_000_000);
        assert!(
            !h.preview(&parent).await.children[0].stale,
            "equality is fresh"
        );
        h.set_now(NOW + 120_000_001);
        assert!(h.preview(&parent).await.children[0].stale);
    }

    #[tokio::test]
    async fn rollup_state_change_propagates_through_depth_two_exactly_once() {
        let mut h = CompositeHarness::at(NOW).debounce_seconds(15).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        let c = h.add_child(child("c")).await;
        let depth_one = h
            .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;
        let depth_two = h
            .add_composite(composite(&format!("{{{depth_one}}} || {{{c}}}")))
            .await;
        h.write_rollup_and_nudge(&a, AlertLevel::Critical, NOW)
            .await;
        h.write_rollup_and_nudge(&b, AlertLevel::Critical, NOW)
            .await;
        h.write_rollup_and_nudge(&c, AlertLevel::Ok, NOW).await;

        h.run_due_jobs_until_idle(NOW + 30_000_000).await;

        assert_eq!(
            h.state(&depth_one).await.unwrap().level,
            AlertLevel::Critical
        );
        assert_eq!(
            h.state(&depth_two).await.unwrap().level,
            AlertLevel::Critical
        );
        assert_eq!(h.evaluation_count(&depth_one), 1);
        assert_eq!(h.evaluation_count(&depth_two), 1);
        assert_eq!(h.child_query_count(), 0, "composites consume state only");
    }

    #[tokio::test]
    async fn simultaneous_child_nudges_coalesce_but_each_advances_generation() {
        let mut h = CompositeHarness::at(NOW).debounce_seconds(15).await;
        let children = h
            .add_children((0..10).map(|n| child(&format!("c{n}"))))
            .await;
        let expression = children
            .iter()
            .map(|id| format!("{{{id}}}"))
            .collect::<Vec<_>>()
            .join(" && ");
        let parent = h.add_composite(composite(&expression)).await;

        for _ in &children {
            h.nudge(&parent, NudgeReason::ChildState).await;
        }

        let job = h.job(&parent).await.unwrap();
        assert_eq!(job.next_run_at, NOW + 15_000_000);
        assert_eq!(h.generation(&parent).await, 10);
        assert_eq!(
            h.metric("alert_composite_nudges_total", "reason", "child_state"),
            10
        );
        assert_eq!(h.metric_value("alert_composite_nudges_coalesced_total"), 9);
    }

    #[tokio::test]
    async fn child_nudge_and_manual_trigger_during_processing_each_force_a_second_cycle() {
        for mutation in [Mutation::ChildNudge, Mutation::ManualTrigger] {
            let mut h = CompositeHarness::at(NOW).debounce_seconds(15).await;
            let a = h.add_child(child("a")).await;
            let b = h.add_child(child("b")).await;
            h.write_rollup(&a, AlertLevel::Ok, NOW).await;
            h.write_rollup(&b, AlertLevel::Critical, NOW).await;
            let parent = h
                .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
                .await;
            let claim = h.claim(&parent).await;
            let evaluation = h.evaluate_claim(&claim).await;

            h.write_rollup(&a, AlertLevel::Critical, NOW + 1).await;
            h.mutate_during_processing(&parent, &mutation).await;
            let completion = h.commit_and_complete(claim, evaluation).await;

            assert!(
                !completion.state_written,
                "generation changed before commit"
            );
            assert!(!completion.delivery_started);
            assert!(completion.next_run_at <= NOW + 15_000_000);
            h.run_due_jobs_until_idle(NOW + 15_000_000).await;
            assert_eq!(h.state(&parent).await.unwrap().level, AlertLevel::Critical);
            assert_eq!(h.evaluation_count(&parent), 2);
        }
    }

    #[tokio::test]
    async fn claim_epoch_fences_state_delivery_keep_alive_and_completion_after_reclaim() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW).await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;
        let claim_one = h.claim(&parent).await;
        let stale_result = h.evaluate_claim(&claim_one).await;
        h.timeout_and_requeue(&claim_one).await;
        let claim_two = h.claim(&parent).await;
        assert!(claim_two.epoch > claim_one.epoch);

        assert!(!h.keep_alive(&claim_one).await);
        let stale_commit = h.commit_claim(&claim_one, stale_result).await;
        assert!(!stale_commit.state_written);
        assert!(!stale_commit.transition_written);
        assert!(!stale_commit.delivery_authorized);
        assert!(!h.complete_claim(&claim_one).await);
        assert_eq!(h.delivery_attempts(&parent), 0);

        let current = h.evaluate_claim(&claim_two).await;
        assert!(h.keep_alive(&claim_two).await);
        let current_commit = h.commit_claim(&claim_two, current).await;
        assert!(current_commit.state_written);
        assert!(current_commit.transition_written);
        assert!(current_commit.delivery_authorized);
        assert!(h.complete_claim(&claim_two).await);
    }

    #[tokio::test]
    async fn update_disable_and_delete_supersede_an_inflight_result() {
        for mutation in [Mutation::Update, Mutation::Disable, Mutation::Delete] {
            let mut h = CompositeHarness::at(NOW).await;
            let a = h.add_child(child("a")).await;
            let b = h.add_child(child("b")).await;
            h.write_rollup(&a, AlertLevel::Critical, NOW).await;
            h.write_rollup(&b, AlertLevel::Critical, NOW).await;
            let parent = h
                .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
                .await;
            let claim = h.claim(&parent).await;
            let result = h.evaluate_claim(&claim).await;

            h.mutate_during_processing(&parent, &mutation).await;
            let commit = h.commit_claim(&claim, result).await;
            assert!(!commit.state_written);
            assert!(!commit.transition_written);
            assert!(!commit.delivery_authorized);
            assert_eq!(h.delivery_attempts(&parent), 0);
            if mutation == Mutation::Delete {
                assert!(h.state(&parent).await.is_none());
                assert!(h.job(&parent).await.is_none());
            }
        }
    }

    #[tokio::test]
    async fn sweep_recovers_dropped_nudge_and_freshness_significance_is_not_level_only() {
        let mut h = CompositeHarness::at(NOW).sweep_seconds(300).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW - 181_000_000)
            .await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;
        h.evaluate(&parent).await;
        let generation = h.generation(&parent).await;

        h.drop_next_scheduler_advance();
        h.write_rollup_and_nudge(&a, AlertLevel::Critical, NOW + 1)
            .await;
        assert_eq!(h.generation(&parent).await, generation + 1);
        h.run_sweep().await;
        h.run_due_jobs_until_idle(NOW + 300_000_000).await;
        assert_eq!(h.state(&parent).await.unwrap().level, AlertLevel::Critical);
        assert_eq!(
            h.parent_nudges(&a),
            1,
            "stale-to-fresh same-level is significant"
        );

        h.write_rollup_and_nudge(&a, AlertLevel::Critical, NOW + 2)
            .await;
        assert_eq!(
            h.parent_nudges(&a),
            1,
            "fresh same-level repeat is not significant"
        );
    }

    #[tokio::test]
    async fn silence_suppresses_delivery_not_evaluation_or_parent_propagation() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW).await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(
                composite(&format!("{{{a}}} && {{{b}}}"))
                    .delivery_silenced_until(NOW + 600_000_000),
            )
            .await;

        let result = h.evaluate(&parent).await;
        assert_eq!(result.outcome, RunOutcome::Firing);
        assert_eq!(h.state(&parent).await.unwrap().level, AlertLevel::Critical);
        assert_eq!(h.delivery_attempts(&parent), 0);
        assert_eq!(h.committed_state_writes(&parent), 1);
        assert_eq!(h.parent_nudges(&parent), 1);
    }

    #[tokio::test]
    async fn state_transaction_failure_never_delivers_or_nudges_and_uses_scheduler_retry() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW).await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(composite(&format!("{{{a}}} && {{{b}}}")))
            .await;
        h.fail_next_state_transaction();

        let result = h.evaluate(&parent).await;

        assert_eq!(result.outcome, RunOutcome::Error);
        assert!(h.state(&parent).await.is_none());
        assert_eq!(h.delivery_attempts(&parent), 0);
        assert_eq!(h.parent_nudges(&parent), 0);
        assert!(h.job(&parent).await.unwrap().is_retry_scheduled);
    }

    #[tokio::test]
    async fn delivery_failure_reuses_notify_failed_state_and_retry_ledger() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW).await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(
                composite(&format!("{{{a}}} && {{{b}}}")).destinations(["first", "retry-once"]),
            )
            .await;
        h.fail_destination_once("retry-once");

        let result = h.evaluate(&parent).await;
        assert_eq!(result.outcome, RunOutcome::NotifyFailed);
        let state = h.state(&parent).await.unwrap();
        assert_eq!(state.level, AlertLevel::Critical);
        assert_eq!(state.level_at, NOW);
        assert_eq!(h.destination_attempts("first"), 1);
        assert_eq!(h.destination_attempts("retry-once"), 1);

        h.retry(&parent).await;
        assert_eq!(h.destination_attempts("first"), 1);
        assert_eq!(h.destination_attempts("retry-once"), 2);
    }

    #[tokio::test]
    async fn synthetic_payload_is_bounded_and_retry_uses_current_names_but_skips_successes() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h
            .add_child(child("High error rate").sensitive_query("select secret"))
            .await;
        let b = h.add_child(child("High latency")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW).await;
        h.write_rollup(&b, AlertLevel::Critical, NOW - 181_000_000)
            .await;
        let parent = h
            .add_composite(
                composite(&format!("{{{a}}} && {{{b}}}"))
                    .description("Correlated checkout symptoms")
                    .destinations(["slack", "pagerduty"])
                    .priority(1)
                    .tags(["service:checkout", "env:prod"])
                    .owner("checkout-oncall")
                    .context_attribute("service", "checkout"),
            )
            .await;
        h.fail_destination_once("pagerduty");

        h.evaluate(&parent).await;
        let first = h.last_payload_for("slack").expect("slack succeeded");
        assert_eq!(first["composite_result"], true);
        assert_eq!(
            first["composite_expression_ids"],
            format!("{{{a}}} && {{{b}}}")
        );
        assert!(
            first["composite_expression"]
                .as_str()
                .unwrap()
                .contains("High error rate")
        );
        assert_eq!(
            first["firing_children"],
            serde_json::json!(["High error rate", "High latency"])
        );
        assert_eq!(first["stale_children"], serde_json::json!(["High latency"]));
        assert_eq!(first["child_states"].as_array().unwrap().len(), 2);
        assert_eq!(first["child_states"][0]["alert_id"], a);
        assert_eq!(first["child_states"][0]["name"], "High error rate");
        assert_eq!(first["child_states"][0]["alert_type"], "scheduled");
        assert_eq!(first["child_states"][0]["enabled"], true);
        assert_eq!(first["child_states"][0]["level"], "critical");
        assert_eq!(first["child_states"][0]["level_at"], NOW);
        assert_eq!(first["child_states"][0]["stale"], false);
        assert_eq!(first["child_states"][0]["truth"], true);
        assert_eq!(first["child_states"][1]["alert_id"], b);
        assert_eq!(first["child_states"][1]["name"], "High latency");
        assert_eq!(first["child_states"][1]["level"], "critical");
        assert_eq!(first["child_states"][1]["level_at"], NOW - 181_000_000);
        assert_eq!(first["child_states"][1]["stale"], true);
        assert_eq!(first["child_states"][1]["truth"], true);
        assert!(first.get("query").is_none());
        assert!(first.get("threshold").is_none());
        assert!(!first.to_string().contains("select secret"));

        let context = h.last_notification_context_for("slack").unwrap();
        assert_eq!(context.alert_name, h.composite_name(&parent).await);
        assert_eq!(context.alert_type, "composite");
        assert_eq!(context.alert_level, "critical");
        assert_eq!(context.alert_priority, "P1");
        assert_eq!(context.alert_tags, "service:checkout,env:prod");
        assert_eq!(context.alert_description, "Correlated checkout symptoms");
        assert_eq!(context.owner, "checkout-oncall");
        assert_eq!(context.context_attribute("service"), Some("checkout"));
        assert!(context.alert_url.contains(&parent));
        assert_eq!(context.stream_name, "");
        assert_eq!(context.alert_threshold, "");

        h.rename_child(&b, "Latency renamed").await;
        h.retry(&parent).await;
        assert_eq!(h.destination_attempts("slack"), 1);
        assert_eq!(h.destination_attempts("pagerduty"), 2);
        let retry = h.last_payload_for("pagerduty").unwrap();
        assert!(
            retry["firing_children"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "Latency renamed")
        );
    }

    #[tokio::test]
    async fn incidents_workflows_and_history_keep_existing_enums_and_shared_resolution() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("a")).await;
        let b = h.add_child(child("b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW).await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let parent = h
            .add_composite(
                composite(&format!("{{{a}}} && {{{b}}}"))
                    .creates_incident(true)
                    .workflows(["page-owner"]),
            )
            .await;
        h.evaluate(&parent).await;

        let incident = h.incident_for(&parent).await.unwrap();
        assert_eq!(incident.alert_kind, "internal");
        assert_eq!(incident.live_definition.alert_type, "composite");
        let workflow = h.workflow_run_for(&parent).await.unwrap();
        assert_eq!(workflow.entity_type, "alert");
        assert_eq!(workflow.trigger_type, "alert_fired");
        let history = h.history_for(&parent).await;
        assert_eq!(history[0].alert_type, "composite");
        assert!(history[0].threshold.is_none());

        h.delete_composite(&parent).await.unwrap();
        let after_delete = h.incident(incident.id).await.unwrap();
        assert!(after_delete.live_definitions.is_empty());
        assert_eq!(after_delete.triggers[0].alert_id, parent);
        assert!(after_delete.triggers[0].definition_unavailable);
        assert!(after_delete.triggers[0].live_link.is_none());
        assert!(h.workflow_associations(&parent).await.is_empty());
        assert!(h.transition_rows(&parent).await.is_empty());
    }

    #[tokio::test]
    async fn public_mutation_gates_are_distinct_and_cleanup_always_remains_possible() {
        let mutations = [
            Mutation::Create,
            Mutation::Update,
            Mutation::Clone,
            Mutation::Enable,
            Mutation::Move,
            Mutation::ManualTrigger,
            Mutation::Disable,
            Mutation::Delete,
        ];
        for mode in [GateMode::WritesDisabled, GateMode::SuperCluster] {
            let h = CompositeHarness::gate_only(mode);
            assert_eq!(
                h.capabilities().composite_alerts_available,
                mode != GateMode::SuperCluster
            );
            for mutation in &mutations {
                let decision = h.gate(mutation);
                if matches!(mutation, Mutation::Disable | Mutation::Delete) {
                    assert!(
                        decision.is_ok(),
                        "{mode:?} must permit cleanup {mutation:?}"
                    );
                } else {
                    let error = decision.unwrap_err();
                    let expected = match mode {
                        GateMode::WritesDisabled => (503, "composite_writes_disabled"),
                        GateMode::SuperCluster => (409, "composite_super_cluster_unsupported"),
                        GateMode::Supported => unreachable!(),
                    };
                    assert_eq!((error.status, error.code.as_str()), expected);
                    assert!(!error.graph_lock_attempted);
                    assert!(!error.write_attempted);
                }
            }
        }
    }

    #[tokio::test]
    async fn super_cluster_startup_preflight_requires_zero_definitions_and_jobs() {
        for (definitions, jobs, allowed) in
            [(0, 0, true), (1, 0, false), (0, 1, false), (1, 1, false)]
        {
            let h = CompositeHarness::startup_preflight(definitions, jobs);
            assert_eq!(h.is_ok(), allowed);
            if let Err(error) = h {
                assert_eq!(error.code, "composite_super_cluster_startup_blocked");
                assert_eq!(error.definition_count, definitions);
                assert_eq!(error.job_count, jobs);
            }
        }
    }

    #[tokio::test]
    async fn observability_labels_are_bounded_and_logs_keep_sensitive_text_at_debug() {
        let mut h = CompositeHarness::at(NOW).await;
        let a = h.add_child(child("secret-service-a")).await;
        let b = h.add_child(child("secret-service-b")).await;
        h.write_rollup(&a, AlertLevel::Critical, NOW).await;
        h.write_rollup(&b, AlertLevel::Critical, NOW).await;
        let expression = format!("{{{a}}} && {{{b}}}");
        let parent = h.add_composite(composite(&expression)).await;
        h.evaluate(&parent).await;

        let metric_names = h
            .composite_metrics()
            .iter()
            .map(|metric| metric.name.as_str())
            .collect::<BTreeSet<_>>();
        for required in [
            "alert_composite_evaluations_total",
            "alert_composite_evaluation_duration_seconds",
            "alert_composite_children_per_evaluation",
            "alert_composite_nudges_total",
            "alert_composite_nudges_coalesced_total",
            "alert_composite_evaluation_errors_total",
            "alert_composite_stale_children_total",
            "alert_composite_sweep_lag_seconds",
            "alert_composite_graph_mutation_seconds",
        ] {
            assert!(metric_names.contains(required), "missing metric {required}");
        }

        let forbidden = BTreeSet::from([
            "org",
            "org_id",
            "alert_id",
            "composite_id",
            "name",
            "expression",
        ]);
        for metric in h.composite_metrics() {
            assert!(forbidden.is_disjoint(&metric.labels.keys().map(String::as_str).collect()));
        }
        let info = h.structured_logs_at("info");
        for field in [
            "trace_id",
            "composite_id",
            "generation_start",
            "generation_end",
            "child_count",
            "result",
            "stale_count",
            "nudge_reason",
            "error_code",
        ] {
            assert!(
                info.iter().any(|entry| entry.fields.contains_key(field)),
                "missing structured log field {field}"
            );
        }
        assert!(
            !info
                .iter()
                .any(|entry| entry.message.contains("secret-service"))
        );
        assert!(!info.iter().any(|entry| entry.message.contains(&expression)));
        assert!(
            h.structured_logs_at("debug")
                .iter()
                .any(|entry| entry.message.contains(&expression))
        );
    }

    #[tokio::test]
    async fn scale_and_recovery_contracts_do_not_starve_other_scheduler_modules() {
        let mut h = CompositeHarness::at(NOW)
            .sweep_seconds(300)
            .with_ordinary_alert_lane_probe()
            .await;
        let shared = h.add_child(child("shared")).await;
        let other = h.add_child(child("other")).await;
        h.write_rollup(&shared, AlertLevel::Critical, NOW).await;
        h.write_rollup(&other, AlertLevel::Critical, NOW).await;
        let parents = h
            .add_many_composites(10_000, |n| {
                composite(&format!("{{{shared}}} && {{{other}}}")).name(format!("scale-{n}"))
            })
            .await;

        h.write_rollup_and_nudge(&shared, AlertLevel::Ok, NOW + 1)
            .await;
        h.fail_scheduler_node_after_state_commit_once();
        h.run_sweep_with_fairness_budget().await;

        assert_eq!(h.reverse_parent_count(&shared).await, 10_000);
        assert_eq!(h.unique_jobs_for(&parents).await, 10_000);
        assert!(h.ordinary_alert_lane_probe_ran());
        assert_eq!(h.duplicate_transition_count(), 0);
        assert!(h.all_jobs_recoverable_by_existing_timeout_path());
        assert!(!h.composite_reconciler_or_outbox_created());
    }

    #[test]
    fn eligible_child_kind_contract_is_explicit() {
        let cases = [
            (ChildKind::Scheduled, true),
            (ChildKind::Slo, true),
            (ChildKind::MultiAlert, true),
            (ChildKind::Composite, true),
            (ChildKind::Realtime, false),
            (ChildKind::AnomalyDetection, false),
            (ChildKind::External, false),
        ];
        for (kind, expected) in cases {
            assert_eq!(kind.is_composite_eligible(), expected, "{kind:?}");
        }
    }
}
