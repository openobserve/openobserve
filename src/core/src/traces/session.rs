// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Shared session-to-trace query contract.

pub use config::meta::traces::session::{
    SESSION_ID_COLUMNS, escape_sql_string, quote_identifier, session_id_columns, span_rows_sql,
    trace_id_predicate, trace_ids_from_hits, trace_ids_sql,
};
