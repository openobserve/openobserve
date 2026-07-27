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

//! Coverage, and the refusal to fabricate uptime — §6b.4b, S-8, SA-17, SA-18.
//!
//! This is the module that decides whether an SLO alert may change state at
//! all. Its single job is to distinguish **"we measured, and it was fine"**
//! from **"we did not measure"**, because collapsing those two is the worst
//! failure this feature can have: a search outage would read as "no errors
//! observed" and recover every burn-rate alert in the org.
//!
//! Deliberate divergence from Datadog, which counts missing data in a Time
//! Slice SLO as uptime (D34).

/// Coverage as a fraction in `[0, 1]`: observed slices over *expected* slices,
/// where expected comes from the aligned grid — never from what a query
/// happened to return.
pub fn coverage(observed_slices: i64, expected_slices: i64) -> f64 {
    let _ = (observed_slices, expected_slices);
    todo!("coverage::coverage")
}

/// One window's worth of aggregated slices, as read from the status row.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowRead {
    pub good: f64,
    pub total: f64,
    pub observed_slices: i64,
    pub expected_slices: i64,
}

/// Why an evaluation could not observe anything. Each maps to "freeze the
/// level" — never to a recovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnobservedReason {
    /// Coverage for this window is under the floor (S-8).
    BelowCoverageFloor,
    /// The window is covered but carries no events, so the SLI is undefined
    /// (SA-18). Usually itself an incident.
    ZeroTotal,
    /// The SLO's watermark has not advanced recently enough to trust (SA-14).
    StaleWatermark,
}

/// The result of trying to observe a window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Observation {
    /// A real measurement — the SLI over the window.
    Observed { sli: f64 },
    /// Nothing was measured. The caller must leave `level`, `level_since` and
    /// `level_at` untouched (§7.6).
    Unobserved(UnobservedReason),
}

impl Observation {
    pub fn is_observed(&self) -> bool {
        matches!(self, Self::Observed { .. })
    }

    pub fn sli(&self) -> Option<f64> {
        match self {
            Self::Observed { sli } => Some(*sli),
            Self::Unobserved(_) => None,
        }
    }
}

/// Decide whether a window read is a measurement.
///
/// `watermark_stale` is computed by [`super::window::watermark_is_stale`] and
/// passed in so this stays a pure decision over already-gathered facts.
pub fn observe(read: WindowRead, coverage_floor: f64, watermark_stale: bool) -> Observation {
    let _ = (read, coverage_floor, watermark_stale);
    todo!("coverage::observe")
}

/// Whether an SLO's overall status should read as `NoData` (S-8).
pub fn is_no_data(read: WindowRead, coverage_floor: f64) -> bool {
    let _ = (read, coverage_floor);
    todo!("coverage::is_no_data")
}

#[cfg(test)]
mod tests {
    use super::*;

    const FLOOR: f64 = 0.8;

    fn full(good: f64, total: f64) -> WindowRead {
        WindowRead {
            good,
            total,
            observed_slices: 100,
            expected_slices: 100,
        }
    }

    // ---- coverage arithmetic ----------------------------------------------

    #[test]
    fn full_coverage_is_one() {
        assert_eq!(coverage(100, 100), 1.0);
    }

    #[test]
    fn no_observations_is_zero_coverage() {
        assert_eq!(coverage(0, 100), 0.0);
    }

    #[test]
    fn partial_coverage_is_the_fraction() {
        assert!((coverage(71, 100) - 0.71).abs() < 1e-9);
    }

    #[test]
    fn coverage_of_an_empty_window_is_zero_not_a_divide_by_zero() {
        assert_eq!(coverage(0, 0), 0.0);
    }

    #[test]
    fn coverage_is_clamped_at_one() {
        // Defensive: duplicate rows must never report >100% covered.
        assert_eq!(coverage(150, 100), 1.0);
    }

    // ---- the floor ---------------------------------------------------------

    #[test]
    fn a_well_covered_window_is_observed() {
        let obs = observe(full(999.0, 1000.0), FLOOR, false);
        assert!(obs.is_observed());
        assert!((obs.sli().unwrap() - 99.9).abs() < 1e-9);
    }

    #[test]
    fn coverage_exactly_at_the_floor_is_observed() {
        let read = WindowRead {
            observed_slices: 80,
            expected_slices: 100,
            ..full(999.0, 1000.0)
        };
        assert!(observe(read, FLOOR, false).is_observed());
    }

    #[test]
    fn coverage_below_the_floor_is_unobserved() {
        let read = WindowRead {
            observed_slices: 71,
            expected_slices: 100,
            ..full(999.0, 1000.0)
        };
        assert_eq!(
            observe(read, FLOOR, false),
            Observation::Unobserved(UnobservedReason::BelowCoverageFloor)
        );
    }

    /// The headline failure mode. A search outage leaves a window that looks
    /// perfect — every slice it *did* see was good — and must NOT be read as a
    /// recovery.
    #[test]
    fn a_search_outage_never_reads_as_a_healthy_window() {
        let outage = WindowRead {
            good: 50.0,
            total: 50.0, // everything observed was perfect
            observed_slices: 5,
            expected_slices: 100,
        };
        let obs = observe(outage, FLOOR, false);
        assert!(
            !obs.is_observed(),
            "a 5%-covered window must never report a 100% SLI"
        );
    }

    // ---- zero total (SA-18) ------------------------------------------------

    #[test]
    fn a_covered_window_with_no_events_is_unobserved_not_healthy() {
        let idle = WindowRead {
            good: 0.0,
            total: 0.0,
            observed_slices: 100,
            expected_slices: 100,
        };
        assert_eq!(
            observe(idle, FLOOR, false),
            Observation::Unobserved(UnobservedReason::ZeroTotal),
            "traffic stopping is usually the incident, not a recovery"
        );
    }

    #[test]
    fn zero_total_is_never_reported_as_a_zero_burn_rate() {
        let idle = WindowRead {
            good: 0.0,
            total: 0.0,
            observed_slices: 100,
            expected_slices: 100,
        };
        assert_eq!(observe(idle, FLOOR, false).sli(), None);
    }

    // ---- stale watermark (SA-14) -------------------------------------------

    #[test]
    fn a_stale_watermark_makes_the_window_unobserved() {
        assert_eq!(
            observe(full(999.0, 1000.0), FLOOR, true),
            Observation::Unobserved(UnobservedReason::StaleWatermark)
        );
    }

    #[test]
    fn staleness_wins_over_good_coverage() {
        // Perfect coverage but a frozen watermark: the data is stale, so
        // nothing about it is a current measurement.
        let obs = observe(full(1000.0, 1000.0), FLOOR, true);
        assert!(!obs.is_observed());
    }

    // ---- precedence --------------------------------------------------------

    /// When several reasons apply the caller only needs "unobserved", but the
    /// reason drives the UI copy, so the precedence must be stable.
    #[test]
    fn unobserved_reasons_have_a_deterministic_precedence() {
        let bad = WindowRead {
            good: 0.0,
            total: 0.0,
            observed_slices: 1,
            expected_slices: 100,
        };
        // Stale watermark is the most fundamental: the data is not current at
        // all, so it outranks coverage and emptiness.
        assert_eq!(
            observe(bad, FLOOR, true),
            Observation::Unobserved(UnobservedReason::StaleWatermark)
        );
        // Without staleness, coverage outranks zero-total: we cannot even say
        // the window was empty if we did not measure it.
        assert_eq!(
            observe(bad, FLOOR, false),
            Observation::Unobserved(UnobservedReason::BelowCoverageFloor)
        );
    }

    // ---- NoData status -----------------------------------------------------

    #[test]
    fn no_data_tracks_the_coverage_floor() {
        assert!(!is_no_data(full(1.0, 1.0), FLOOR));
        assert!(is_no_data(
            WindowRead {
                observed_slices: 10,
                expected_slices: 100,
                ..full(1.0, 1.0)
            },
            FLOOR
        ));
    }

    // ---- per-window independence (SA-17) -----------------------------------

    /// A 30-day window can be well covered while the last hour is a hole — and
    /// the last hour is exactly what a burn-rate alert is about. Each window is
    /// therefore gated on its OWN coverage.
    #[test]
    fn a_well_covered_long_window_does_not_vouch_for_a_broken_short_one() {
        let long = WindowRead {
            good: 43_000.0,
            total: 43_200.0,
            observed_slices: 43_100,
            expected_slices: 43_200,
        };
        let short = WindowRead {
            good: 4.0,
            total: 4.0,
            observed_slices: 1,
            expected_slices: 5,
        };
        assert!(observe(long, FLOOR, false).is_observed());
        assert!(
            !observe(short, FLOOR, false).is_observed(),
            "the short window must be judged on its own coverage"
        );
    }
}
