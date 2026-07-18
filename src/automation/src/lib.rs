// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

pub mod backfill;
pub mod hook;
pub mod pipeline_errors;
pub mod ports;
pub mod scheduler;

pub use hook::{AutomationHookAdapter, AutomationProcessor};
pub use ports::{AutomationRuntime, DerivedStreamWriter, OrganizationPolicy, QueryExecutor};
