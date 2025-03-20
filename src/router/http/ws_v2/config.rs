// Copyright 2025 OpenObserve Inc.
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

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct WsConfig {
    pool_size: usize,
    connection_timeout_secs: u64,
    max_connections_per_querier: usize,
    retry_config: RetryConfig,
    circuit_breaker_config: CircuitBreakerConfig,
    pub health_check_config: HealthCheckConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RetryConfig {
    max_retries: u32,
    initial_retry_delay_ms: u64,
    max_retry_delay_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CircuitBreakerConfig {
    failure_threshold: u32,
    reset_timeout_secs: u64,
    half_open_timeout_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HealthCheckConfig {
    pub interval_secs: u64,
    timeout_secs: u64,
}

impl Default for WsConfig {
    fn default() -> Self {
        Self {
            pool_size: 100,
            connection_timeout_secs: 30,
            max_connections_per_querier: 10,
            retry_config: RetryConfig {
                max_retries: 3,
                initial_retry_delay_ms: 100,
                max_retry_delay_ms: 5000,
            },
            circuit_breaker_config: CircuitBreakerConfig {
                failure_threshold: 5,
                reset_timeout_secs: 60,
                half_open_timeout_secs: 30,
            },
            health_check_config: HealthCheckConfig {
                interval_secs: 15,
                timeout_secs: 5,
            },
        }
    }
}
