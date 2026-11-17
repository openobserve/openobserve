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

//! Internal streams whose rows only one in-process reader may search.

use super::ai_chat::AI_CHAT_EVENTS_STREAM;
use crate::meta::{
    alerts::alert_calibration::DIGEST_STREAM,
    sql::{TableReferenceExt, resolve_stream_names_with_type},
};

tokio::task_local! {
    static READER: ProtectedReader;
}

/// The only code allowed to search a protected stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProtectedReader {
    /// The AI Chat API, which scopes chat history by owner.
    ChatHistory,
    /// The alert calibration API, which filters records by alert visibility (D:L263).
    AlertCalibration,
}

impl ProtectedReader {
    /// The reader that owns `stream_name`, or `None` for an unprotected stream.
    pub fn of(stream_name: &str) -> Option<Self> {
        match stream_name {
            AI_CHAT_EVENTS_STREAM => Some(Self::ChatHistory),
            DIGEST_STREAM => Some(Self::AlertCalibration),
            _ => None,
        }
    }
}

/// Run `fut` as `reader`; a task-local, so nothing a client sends or an object stores can set it.
pub async fn as_reader<F: std::future::Future>(reader: ProtectedReader, fut: F) -> F::Output {
    READER.scope(reader, fut).await
}

/// The reader the current task runs as; a spawned task does not inherit it.
pub fn current_reader() -> Option<ProtectedReader> {
    READER.try_with(|reader| *reader).ok()
}

/// Whether no stored alert or pipeline may see the rows of `stream_name`.
pub fn is_read_protected_stream(stream_name: &str) -> bool {
    ProtectedReader::of(stream_name).is_some()
}

/// The first of `names` that `reader` may not search, with the reader that owns it.
pub fn refused_stream<'a>(
    names: impl IntoIterator<Item = &'a str>,
    reader: Option<ProtectedReader>,
) -> Option<(&'a str, ProtectedReader)> {
    names.into_iter().find_map(|name| {
        ProtectedReader::of(name)
            .filter(|owner| Some(*owner) != reader)
            .map(|owner| (name, owner))
    })
}

/// Whether `sql` reads the calibration digest anywhere; unparsable SQL is left to the caller.
pub fn sql_reads_digest(sql: &str) -> bool {
    resolve_stream_names_with_type(sql).is_ok_and(|tables| {
        tables
            .iter()
            .any(|t| t.stream_name().trim().to_lowercase() == DIGEST_STREAM)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_stream_has_exactly_one_reader() {
        assert_eq!(
            ProtectedReader::of("_o2_ai_chat_events"),
            Some(ProtectedReader::ChatHistory)
        );
        assert_eq!(
            ProtectedReader::of("_o2_alert_calibration_digests"),
            Some(ProtectedReader::AlertCalibration)
        );
        for name in [
            "_o2_service_graph",
            "default",
            "_o2_alert_calibration_digests_x",
            "_O2_ALERT_CALIBRATION_DIGESTS",
        ] {
            assert_eq!(ProtectedReader::of(name), None, "{name}");
            assert!(!is_read_protected_stream(name), "{name}");
        }
        assert!(is_read_protected_stream(DIGEST_STREAM));
        assert!(is_read_protected_stream(AI_CHAT_EVENTS_STREAM));
        assert!(super::super::usage::is_internal_rollup_stream(
            DIGEST_STREAM
        ));
    }

    #[tokio::test]
    async fn a_spawned_task_does_not_inherit_the_reader() {
        assert_eq!(current_reader(), None);
        let (inside, spawned) = as_reader(ProtectedReader::AlertCalibration, async {
            let spawned = tokio::spawn(async { current_reader() }).await.unwrap();
            (current_reader(), spawned)
        })
        .await;
        assert_eq!(inside, Some(ProtectedReader::AlertCalibration));
        assert_eq!(spawned, None);
    }

    #[test]
    fn refused_stream_names_the_first_foreign_owner() {
        let names = ["default", DIGEST_STREAM];
        assert_eq!(
            refused_stream(names, None),
            Some((DIGEST_STREAM, ProtectedReader::AlertCalibration))
        );
        assert_eq!(
            refused_stream(names, Some(ProtectedReader::AlertCalibration)),
            None
        );
        assert_eq!(
            refused_stream(names, Some(ProtectedReader::ChatHistory)),
            Some((DIGEST_STREAM, ProtectedReader::AlertCalibration))
        );
        assert_eq!(
            refused_stream(
                [DIGEST_STREAM, AI_CHAT_EVENTS_STREAM],
                Some(ProtectedReader::AlertCalibration)
            ),
            Some((AI_CHAT_EVENTS_STREAM, ProtectedReader::ChatHistory))
        );
    }

    #[test]
    fn a_digest_read_is_found_wherever_the_sql_names_it() {
        for sql in [
            r#"SELECT count(*) AS n FROM "_o2_alert_calibration_digests""#,
            r#"SELECT * FROM "default" WHERE x IN (SELECT alert_id FROM "_o2_alert_calibration_digests")"#,
            r#"SELECT * FROM "default" d JOIN "_o2_alert_calibration_digests" c ON d.x = c.alert_id"#,
            r#"WITH c AS (SELECT * FROM "_o2_alert_calibration_digests") SELECT count(*) FROM c"#,
            r#"SELECT * FROM "logs"."_O2_ALERT_CALIBRATION_DIGESTS""#,
        ] {
            assert!(sql_reads_digest(sql), "{sql}");
        }
        for sql in [
            r#"SELECT * FROM "default""#,
            r#"SELECT * FROM "_o2_ai_chat_events""#,
            r#"SELECT * FROM "_o2_alert_calibration_digests_x""#,
            "not sql",
        ] {
            assert!(!sql_reads_digest(sql), "{sql}");
        }
    }
}
