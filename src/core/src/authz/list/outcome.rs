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

//! The one rule every list-authz site follows when OpenFGA fails. An object is `Allow`, `Deny` or
//! `Error`. A request fails only when an `Error` could change what it shows.

use std::{cell::RefCell, collections::HashMap};

use config::meta::stream::StreamType;

use super::{AuthzUnavailable, StreamSet, UnavailableReason};

tokio::task_local! {
    static ERROR_DENIALS: RefCell<ErrorDenials>;
}

/// One object's answer; `Error` is an OpenFGA failure that left the object denied.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Allow,
    Deny,
    Error(UnavailableReason),
}

impl Outcome {
    pub fn of(result: Result<bool, AuthzUnavailable>) -> Self {
        match result {
            Ok(true) => Self::Allow,
            Ok(false) => Self::Deny,
            Err(err) => Self::Error(err.reason),
        }
    }

    pub fn into_result(self) -> Result<bool, AuthzUnavailable> {
        match self {
            Self::Allow => Ok(true),
            Self::Deny => Ok(false),
            Self::Error(reason) => Err(reason.into()),
        }
    }

    /// The `off` answer: an error denies.
    pub fn allowed(self) -> bool {
        self == Self::Allow
    }
}

/// Whether a part may send a call. After an error a unit reads only the answers already held.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Calls {
    Send,
    HeldOnly,
}

/// An all-of unit's outcome, `None` when a held-only unit lacks an answer, and the parts read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Folded {
    pub outcome: Option<Outcome>,
    pub decided: usize,
}

/// The objects a response can show: those it asked for, less those a local filter drops. Every
/// path decides only these, so an error on any other object never reaches the response.
#[derive(Clone, Debug, Default)]
pub struct Scope {
    /// `None` asks for every object the site lists.
    requested: Option<StreamSet>,
    filtered: StreamSet,
}

impl Scope {
    pub fn every() -> Self {
        Self::default()
    }

    pub fn requested(objects: impl IntoIterator<Item = (StreamType, String)>) -> Self {
        Self {
            requested: Some(objects.into_iter().collect()),
            filtered: StreamSet::new(),
        }
    }

    /// Drops objects the response leaves out whatever their answer.
    pub fn filtered(mut self, objects: impl IntoIterator<Item = (StreamType, String)>) -> Self {
        self.filtered.extend(objects);
        self
    }

    pub fn shows(&self, stream_type: StreamType, name: &str) -> bool {
        if self.requested.is_none() && self.filtered.is_empty() {
            return true;
        }
        let key = (stream_type, name.to_string());
        self.requested
            .as_ref()
            .is_none_or(|requested| requested.contains(&key))
            && !self.filtered.contains(&key)
    }

    pub fn narrow(&self, mut objects: StreamSet) -> StreamSet {
        objects.retain(|(kind, name)| self.shows(*kind, name));
        objects
    }

    /// A readable answer cut to the scope; `None` still reads every object.
    pub fn narrow_answer(&self, answer: Option<StreamSet>) -> Option<StreamSet> {
        answer.map(|readable| self.narrow(readable))
    }
}

/// The objects a pass denied because OpenFGA failed, so a set answer can tell which errors matter.
#[derive(Clone, Debug, Default)]
pub struct ErrorDenials {
    objects: HashMap<(StreamType, String), UnavailableReason>,
    /// A failure that names no object, such as a prelude or an admission Check.
    unattributed: Option<UnavailableReason>,
    first: Option<UnavailableReason>,
}

impl ErrorDenials {
    pub fn object(&mut self, stream_type: StreamType, name: &str, reason: UnavailableReason) {
        self.first.get_or_insert(reason);
        self.objects
            .entry((stream_type, name.to_string()))
            .or_insert(reason);
    }

    pub fn unattributed(&mut self, reason: UnavailableReason) {
        self.first.get_or_insert(reason);
        self.unattributed.get_or_insert(reason);
    }

    pub fn merge(&mut self, other: Self) {
        if let Some(reason) = other.first {
            self.first.get_or_insert(reason);
        }
        if let Some(reason) = other.unattributed {
            self.unattributed.get_or_insert(reason);
        }
        for (key, reason) in other.objects {
            self.objects.entry(key).or_insert(reason);
        }
    }

    pub fn first(&self) -> Option<UnavailableReason> {
        self.first
    }

    /// The failure that could reveal a requested object the answer hides; `None` serves the answer.
    pub fn hidden_error<'a>(
        &self,
        readable: &Option<StreamSet>,
        requested: impl IntoIterator<Item = (StreamType, &'a str)>,
    ) -> Option<UnavailableReason> {
        let readable = readable.as_ref()?;
        let mut hidden = requested
            .into_iter()
            .filter(|(kind, name)| !readable.contains(&(*kind, name.to_string())));
        hidden.find_map(|(kind, name)| {
            self.objects
                .get(&(kind, name.to_string()))
                .copied()
                .or(self.unattributed)
        })
    }
}

/// Folds a unit that holds only when every part does: a deny decides it, even after an error.
/// After the first error no part may send a call, so `on` never sends more than `off`.
pub async fn all_of<T, F: Future<Output = Option<Outcome>>>(
    calls: Calls,
    parts: impl IntoIterator<Item = T>,
    mut part: impl FnMut(T, Calls) -> F,
) -> Folded {
    let mut error = None;
    let mut unknown = false;
    let mut decided = 0;
    for item in parts {
        decided += 1;
        let calls = if error.is_some() {
            Calls::HeldOnly
        } else {
            calls
        };
        match part(item, calls).await {
            Some(Outcome::Deny) => {
                return Folded {
                    outcome: Some(Outcome::Deny),
                    decided,
                };
            }
            Some(Outcome::Error(reason)) => {
                error.get_or_insert(reason);
            }
            Some(Outcome::Allow) => (),
            None => unknown = true,
        }
    }
    let outcome = match error {
        Some(reason) => Some(Outcome::Error(reason)),
        None if unknown => None,
        None => Some(Outcome::Allow),
    };
    Folded { outcome, decided }
}

/// Records a failure that denied without naming an object.
pub(crate) fn record_error_denial(reason: UnavailableReason) {
    let _ = ERROR_DENIALS.try_with(|denials| denials.borrow_mut().unattributed(reason));
}

/// Runs one object's own Check and charges any failure that denied it to that object.
pub(crate) async fn object_outcome<F: Future<Output = bool>>(
    stream_type: StreamType,
    name: &str,
    check: F,
) -> Outcome {
    let (allowed, denials) = ERROR_DENIALS
        .scope(RefCell::default(), async {
            let allowed = check.await;
            (allowed, ERROR_DENIALS.with(|d| d.take()))
        })
        .await;
    match (allowed, denials.first()) {
        (true, _) => Outcome::Allow,
        (false, None) => Outcome::Deny,
        (false, Some(reason)) => {
            let _ = ERROR_DENIALS
                .try_with(|outer| outer.borrow_mut().object(stream_type, name, reason));
            Outcome::Error(reason)
        }
    }
}

/// The failures that denied objects inside `fut`; an enclosing pass sees them too.
pub async fn error_denials_of<F: Future>(fut: F) -> (F::Output, ErrorDenials) {
    let (output, denials) = ERROR_DENIALS
        .scope(RefCell::default(), async {
            let output = fut.await;
            (output, ERROR_DENIALS.with(|d| d.take()))
        })
        .await;
    let _ = ERROR_DENIALS.try_with(|outer| outer.borrow_mut().merge(denials.clone()));
    (output, denials)
}

/// Runs Checks whose failures cannot change the answer, such as objects the list path never asks.
pub async fn without_error_denials<F: Future>(fut: F) -> F::Output {
    ERROR_DENIALS.scope(RefCell::default(), fut).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn held(
        answers: &[Option<Outcome>],
    ) -> impl FnMut(usize, Calls) -> std::future::Ready<Option<Outcome>> + '_ {
        move |i, calls| {
            std::future::ready(match calls {
                Calls::Send => answers[i].or(Some(Outcome::Allow)),
                Calls::HeldOnly => answers[i],
            })
        }
    }

    #[tokio::test]
    async fn a_deny_decides_a_unit_before_or_after_an_error() {
        let error = Some(Outcome::Error(UnavailableReason::Timeout));
        let deny = Some(Outcome::Deny);
        for answers in [[deny, error], [error, deny]] {
            let folded = all_of(Calls::Send, 0..2, held(&answers)).await;
            assert_eq!(folded.outcome, Some(Outcome::Deny), "{answers:?}");
        }
        let folded = all_of(Calls::Send, 0..2, held(&[error, None])).await;
        assert_eq!(folded.outcome, error);
    }

    #[tokio::test]
    async fn no_part_sends_a_call_after_an_error() {
        let mut sent = Vec::new();
        let folded = all_of(Calls::Send, 0..3, |i, calls| {
            sent.push((i, calls));
            std::future::ready(Some(if i == 0 {
                Outcome::Error(UnavailableReason::Transport)
            } else {
                Outcome::Allow
            }))
        })
        .await;
        assert_eq!(
            sent,
            [(0, Calls::Send), (1, Calls::HeldOnly), (2, Calls::HeldOnly)]
        );
        assert_eq!(
            folded.outcome,
            Some(Outcome::Error(UnavailableReason::Transport))
        );
        let unknown = all_of(Calls::HeldOnly, 0..1, |_, _| std::future::ready(None)).await;
        assert_eq!(unknown.outcome, None);
    }

    #[test]
    fn a_scope_shows_only_requested_objects_a_filter_keeps() {
        let logs = |name: &str| (StreamType::Logs, name.to_string());
        let every = Scope::every();
        assert!(every.shows(StreamType::Logs, "a"));
        assert_eq!(every.narrow_answer(None), None);
        let scope = Scope::requested([logs("a"), logs("b")]).filtered([logs("b")]);
        assert!(scope.shows(StreamType::Logs, "a"));
        assert!(!scope.shows(StreamType::Logs, "b"));
        assert!(!scope.shows(StreamType::Logs, "c"));
        assert!(!scope.shows(StreamType::Traces, "a"));
        assert_eq!(
            scope.narrow_answer(Some(StreamSet::from([logs("a"), logs("b"), logs("c")]))),
            Some(StreamSet::from([logs("a")]))
        );
        let filtered = Scope::every().filtered([logs("_rumdata")]);
        assert!(filtered.shows(StreamType::Traces, "_rumdata"));
        assert!(!filtered.shows(StreamType::Logs, "_rumdata"));
    }

    #[tokio::test]
    async fn only_an_error_on_a_hidden_requested_object_fails_a_set() {
        let (outcomes, denials) = error_denials_of(async {
            (
                object_outcome(StreamType::Logs, "a", async {
                    record_error_denial(UnavailableReason::Timeout);
                    false
                })
                .await,
                object_outcome(StreamType::Logs, "b", async { false }).await,
            )
        })
        .await;
        assert_eq!(
            outcomes,
            (Outcome::Error(UnavailableReason::Timeout), Outcome::Deny)
        );
        let requested = [(StreamType::Logs, "a"), (StreamType::Logs, "b")];
        let admitted = Some(StreamSet::from([(StreamType::Logs, "a".to_string())]));
        assert_eq!(denials.hidden_error(&admitted, requested), None);
        assert_eq!(
            denials.hidden_error(&Some(StreamSet::new()), requested),
            Some(UnavailableReason::Timeout)
        );
        assert_eq!(denials.hidden_error(&None, requested), None);
        let mut prelude = ErrorDenials::default();
        prelude.unattributed(UnavailableReason::Server(500));
        assert_eq!(
            prelude.hidden_error(&admitted, requested),
            Some(UnavailableReason::Server(500))
        );
    }
}
