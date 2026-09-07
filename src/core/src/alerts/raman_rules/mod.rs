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

//! Pure hygiene rules over pre-aggregated alert facts: no I/O, clock or config.

pub mod context;
pub mod engine;
pub mod failure;
pub mod finding;
mod gate;
pub mod no_destination;
pub mod noise;
pub mod notify_failed;
pub mod silent;

pub use context::{AlertFacts, AlertRef, AnalysisContext, ErrorCluster, MICROS_PER_SEC, TimeRange};
pub use engine::{EngineReport, default_rules, run};
pub use failure::{FailureRule, FailureThresholds};
pub use finding::{
    Confidence, Evidence, Finding, HygieneRule, ProposedAction, RuleOutcome, Severity, Skip,
    SkipReason,
};
pub use no_destination::{NoDestinationRule, NoDestinationThresholds};
pub use noise::{NoiseRule, NoiseThresholds};
pub use notify_failed::{NotifyFailedRule, NotifyFailedThresholds};
pub use silent::{SilentRule, SilentThresholds};
