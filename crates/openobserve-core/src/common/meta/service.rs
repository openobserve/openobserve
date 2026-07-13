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

pub const LOGS: &str = "logs";
pub const METRICS: &str = "metrics";
pub const TRACES: &str = "traces";

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn test_service_constants_are_unique() {
        let services = [LOGS, METRICS, TRACES];
        assert!(HashSet::from(services).len() == services.len());
    }

    #[test]
    fn test_logs_constant_value() {
        assert_eq!(LOGS, "logs");
    }

    #[test]
    fn test_metrics_constant_value() {
        assert_eq!(METRICS, "metrics");
    }

    #[test]
    fn test_traces_constant_value() {
        assert_eq!(TRACES, "traces");
    }
}
