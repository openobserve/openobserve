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

#![cfg(all(test, feature = "enterprise"))]

use std::collections::HashSet;

use config::meta::stream::{SecuritySourceSetting, StreamType};
use openobserve_core::{
    authz::{
        CheckCalls, FakeStreamChecker, StreamAccessChecker, TypedStream,
        list::{
            AuthzLatch, AuthzUnavailable, CheckerChecks, LegacyChecks, ListMode, OrgWideCheck,
            SMALL_REQUEST_OBJECTS, Scope, StreamSet, UnavailableReason, db_monitoring_query,
            legacy_readable_streams, probe_covers,
        },
        within_budget,
    },
    security::{admit_security_sources_once_with, readable_sources_in_mode},
};

use super::{
    autoobserve, db_monitoring::service::involved_readable, gen_ai::agent_stream_permissions_with,
};

const ORG: &str = "management-authz-error-table";
const VISIBLE: &str = "visible";
const SECURITY_GET: OrgWideCheck<'static> = OrgWideCheck {
    resource: "security",
    permission: "GET",
    use_all_org: true,
    use_self_context: false,
    use_self_parent: false,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Site {
    SecuritySources,
    DbMonitoring,
    AutoObserveStreams,
    GenAi,
}

impl Site {
    fn stream_type(self) -> StreamType {
        match self {
            Self::DbMonitoring => StreamType::Traces,
            Self::SecuritySources | Self::AutoObserveStreams | Self::GenAi => StreamType::Logs,
        }
    }

    fn large_budget(self) -> u32 {
        match self {
            Self::SecuritySources => 7,
            Self::DbMonitoring => 6,
            Self::AutoObserveStreams => 1 + 3 * 2,
            Self::GenAi => 1 + 3 * 3 + 3,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Shape {
    Small,
    Large,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ErrorPosition {
    BeforeDeny,
    AfterDeny,
    Unrequested,
    OutOfScope,
    OnAdmitted,
}

#[derive(Clone, Copy)]
enum Expected<'a> {
    Served(&'a [&'a str]),
    Unavailable,
}

#[derive(Clone, Copy)]
enum OnCalls {
    AtMostOff,
    AtMost(u32),
}

type Row<'a> = (Site, Shape, ErrorPosition, Expected<'a>, OnCalls);

pub(super) async fn security_sources(
    checker: &FakeStreamChecker,
    org_id: &str,
    user_id: &str,
    names: &[String],
    scope: &Scope,
    security_source: Option<&str>,
) -> Result<Option<StreamSet>, AuthzUnavailable> {
    let requested: StreamSet = names
        .iter()
        .map(|name| (StreamType::Logs, name.clone()))
        .collect();
    readable_sources_in_mode(
        checker,
        org_id,
        user_id,
        &requested,
        scope,
        |requested| async move {
            let mut readable =
                legacy_readable_streams(checker, user_id, org_id, requested.clone()).await?;
            if let Some(source) = security_source.map(|name| (StreamType::Logs, name.to_string()))
                && requested.contains(&source)
                && !readable.contains(&source)
                && CheckerChecks(checker)
                    .org_wide(org_id, user_id, &SECURITY_GET)
                    .await
            {
                readable.insert(source);
            }
            Some(readable)
        },
        |denied| {
            admit_security_sources_once_with(checker, org_id, user_id, denied, true, |name| {
                std::future::ready((Some(name.as_str()) == security_source).then_some(
                    SecuritySourceSetting {
                        included: Some(true),
                        ..Default::default()
                    },
                ))
            })
        },
    )
    .await
}

fn request(
    site: Site,
    shape: Shape,
    position: ErrorPosition,
    failing: &str,
) -> Vec<(StreamType, String)> {
    let kind = site.stream_type();
    let visible_kind = match site {
        Site::AutoObserveStreams => StreamType::Metrics,
        _ => kind,
    };
    let mut requested = vec![
        (visible_kind, VISIBLE.to_string()),
        (kind, "denied".to_string()),
    ];
    match position {
        ErrorPosition::BeforeDeny | ErrorPosition::OnAdmitted => {
            requested.insert(1, (kind, failing.to_string()));
        }
        ErrorPosition::AfterDeny => requested.push((kind, failing.to_string())),
        ErrorPosition::Unrequested | ErrorPosition::OutOfScope => (),
    }
    if shape == Shape::Large {
        requested.extend(
            (requested.len()..=SMALL_REQUEST_OBJECTS).map(|i| (kind, format!("denied_{i}"))),
        );
    }
    if position == ErrorPosition::OutOfScope {
        requested.push((kind, failing.to_string()));
    }
    requested
}

fn prepare(checker: &FakeStreamChecker, user: &str, row: Row<'_>, mode: ListMode, failing: &str) {
    let (site, shape, position, ..) = row;
    for name in [VISIBLE, failing] {
        checker.grant_read(
            user,
            &TypedStream {
                org_id: ORG.to_string(),
                stream_type: site.stream_type(),
                name: name.to_string(),
            },
        );
    }
    if site == Site::AutoObserveStreams {
        // The metrics grant saves a list call, leaving room for the uncovered Logs Check.
        checker.grant_read_all(user, ORG, StreamType::Metrics);
    }
    if position == ErrorPosition::OnAdmitted {
        checker.grant_org_wide_check(user, ORG, SECURITY_GET.resource);
    }
    let uses_object_check = match site {
        Site::GenAi => position != ErrorPosition::Unrequested,
        _ => shape == Shape::Large && mode == ListMode::On,
    };
    if uses_object_check {
        checker.fail_object_check_of(user, failing, UnavailableReason::Timeout);
    } else {
        checker.fail_stream_read_once(user, failing);
    }
}

async fn read_site(
    checker: &FakeStreamChecker,
    user: &str,
    site: Site,
    requested: &[(StreamType, String)],
    position: ErrorPosition,
    failing: &str,
) -> Result<HashSet<String>, AuthzUnavailable> {
    let names = || {
        requested
            .iter()
            .map(|(_, name)| name.clone())
            .collect::<Vec<_>>()
    };
    let pairs = || {
        requested
            .iter()
            .map(|(kind, name)| (kind.to_string(), name.clone()))
            .collect::<Vec<_>>()
    };
    match site {
        Site::SecuritySources => {
            let scope = if position == ErrorPosition::OutOfScope {
                Scope::requested(
                    requested
                        .iter()
                        .filter(|(_, name)| name != failing)
                        .cloned(),
                )
            } else {
                Scope::every()
            };
            let source = (position != ErrorPosition::Unrequested).then_some(failing);
            let readable = security_sources(checker, ORG, user, &names(), &scope, source).await?;
            Ok(match readable {
                Some(set) => set.into_iter().map(|(_, name)| name).collect(),
                None => requested
                    .iter()
                    .filter(|(kind, name)| scope.shows(*kind, name))
                    .map(|(_, name)| name.clone())
                    .collect(),
            })
        }
        Site::DbMonitoring => {
            let query = db_monitoring_query(ORG, user, &[StreamType::Traces]);
            let readable =
                involved_readable(checker, &CheckerChecks(checker), &query, names(), true).await?;
            Ok(readable.into_iter().collect())
        }
        Site::AutoObserveStreams => {
            let latch = AuthzLatch::default();
            let mask = autoobserve::readable_streams(checker, ORG, user, pairs(), &latch).await;
            match latch.failure() {
                Some(err) => Err(err),
                None => Ok(names()
                    .into_iter()
                    .zip(mask)
                    .filter_map(|(name, allowed)| allowed.then_some(name))
                    .collect()),
            }
        }
        Site::GenAi => {
            let mut pairs = pairs();
            if position == ErrorPosition::Unrequested {
                pairs.push(("unlistable".to_string(), failing.to_string()));
            }
            let readable = agent_stream_permissions_with(
                checker,
                &CheckerChecks(checker),
                ORG,
                user,
                &pairs,
                |_, name| async move {
                    let stream = TypedStream {
                        org_id: ORG.to_string(),
                        stream_type: StreamType::Logs,
                        name: name.to_string(),
                    };
                    checker.can_read_stream(user, &stream).await
                },
            )
            .await?;
            Ok(readable
                .into_iter()
                .filter_map(|((_, name), allowed)| allowed.then_some(name))
                .collect())
        }
    }
}

fn counted_calls(calls: &CheckCalls) -> usize {
    calls.streams
        + calls.org_wide.len()
        + calls.types_access
        + calls.lists
        + calls.object_checks
        + calls.org_wide_checks
}

async fn check_row(row: Row<'_>, failing: &str) {
    let (site, shape, position, expected, on_calls) = row;
    let case = format!("{site:?}/{shape:?}/{position:?}");
    let requested = request(site, shape, position, failing);
    let checker = FakeStreamChecker::default();
    let off_user = "err-table-off";
    let on_user = "err-table-on";
    for (user, mode) in [(off_user, ListMode::Off), (on_user, ListMode::On)] {
        checker.set_list_mode(user, mode);
        checker.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        prepare(&checker, user, row, mode, failing);
    }
    let off = read_site(&checker, off_user, site, &requested, position, failing)
        .await
        .unwrap();
    let cap = match on_calls {
        OnCalls::AtMostOff => counted_calls(&checker.calls(off_user)) as u32,
        OnCalls::AtMost(cap) => cap,
    };
    let on = within_budget(
        cap,
        read_site(&checker, on_user, site, &requested, position, failing),
    )
    .await;
    match expected {
        Expected::Served(names) => {
            assert_eq!(
                on,
                Ok(names.iter().map(|name| name.to_string()).collect()),
                "{case}"
            );
            assert_eq!(on, Ok(off), "{case}");
        }
        Expected::Unavailable => assert_eq!(on, Err(UnavailableReason::Timeout.into()), "{case}"),
    }
    let calls = checker.calls(on_user);
    assert_eq!(
        calls.types_access,
        usize::from(shape == Shape::Large),
        "{case}"
    );
    assert!(counted_calls(&calls) <= cap as usize, "{case}: {calls:?}");
    if position == ErrorPosition::OutOfScope {
        let scoped_count = requested.len() - 1;
        let off_calls = checker.calls(off_user);
        assert_eq!(
            (off_calls.streams, off_calls.object_checks),
            (scoped_count, 0),
            "{case}"
        );
        let on_stream_checks = if shape == Shape::Small {
            scoped_count
        } else {
            0
        };
        assert_eq!(
            (calls.streams, calls.object_checks),
            (on_stream_checks, 0),
            "{case}"
        );
    }
}

#[tokio::test]
async fn an_openfga_error_fails_a_management_site_only_where_it_could_change_the_answer() {
    use ErrorPosition::{AfterDeny, BeforeDeny, OnAdmitted, OutOfScope, Unrequested};
    use Expected::{Served, Unavailable};
    use OnCalls::{AtMost, AtMostOff};
    use Shape::{Large, Small};

    let failing = "f".repeat(220);
    assert!(!probe_covers(&failing));
    let visible = [VISIBLE];
    let admitted = [VISIBLE, failing.as_str()];
    for site in [
        Site::SecuritySources,
        Site::DbMonitoring,
        Site::AutoObserveStreams,
        Site::GenAi,
    ] {
        let large = AtMost(site.large_budget());
        let mut rows = vec![
            (site, Small, BeforeDeny, Unavailable, AtMostOff),
            (site, Small, AfterDeny, Unavailable, AtMostOff),
            (site, Small, Unrequested, Served(&visible), AtMostOff),
            (site, Large, BeforeDeny, Unavailable, large),
            (site, Large, AfterDeny, Unavailable, large),
            (site, Large, Unrequested, Served(&visible), large),
        ];
        if site == Site::SecuritySources {
            rows.extend([
                (site, Small, OnAdmitted, Served(&admitted), AtMostOff),
                (site, Large, OnAdmitted, Served(&admitted), large),
                (site, Small, OutOfScope, Served(&visible), AtMostOff),
                (site, Large, OutOfScope, Served(&visible), large),
            ]);
        }
        for row in rows {
            check_row(row, &failing).await;
        }
    }
}
