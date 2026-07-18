// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

pub mod ports;
pub mod types;
pub mod writer;

pub use ports::{
    AutomationHook, IngestionCommand, IngestionContext, IngestionPorts, OrgIngestionPolicy,
    TelemetrySink,
};
pub use types::*;
pub use writer::{get_stream_partition_keys, get_thread_id, get_write_partition_key, write_file};
