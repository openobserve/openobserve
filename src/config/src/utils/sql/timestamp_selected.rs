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

use sqlparser::{dialect::GenericDialect, parser::Parser};

use super::visitors::has_timestamp;

pub fn is_timestamp_selected(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if has_timestamp(statement) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timestamp_selection() -> Result<(), sqlparser::parser::ParserError> {
        let test_cases = vec![
            (
                "SELECT _timestamp FROM table1",
                true,
                "Direct timestamp selection",
            ),
            (
                "SELECT name, _timestamp FROM table1",
                true,
                "Timestamp with other columns",
            ),
            (
                "SELECT * FROM table1",
                true,
                "Wildcard selection includes timestamp",
            ),
            ("SELECT name FROM table1", false, "No timestamp selected"),
            (
                "SELECT MAX(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            (
                "SELECT MAX(_timestamp), MAX(_timestamp) as _timestamp FROM table1",
                true,
                "One of the functions has _timestamp alias",
            ),
            (
                "SELECT MIN(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            (
                "SELECT COUNT(_timestamp) FROM table1",
                false,
                "Function without _timestamp alias",
            ),
            (
                "SELECT MAX(_timestamp) as _timestamp FROM table1",
                true,
                "Function aliased as _timestamp",
            ),
            (
                "SELECT MIN(_timestamp) as other FROM table1",
                false,
                "Function with different alias",
            ),
            (
                "SELECT _timestamp + 1 FROM table1",
                false,
                "Expression without _timestamp alias",
            ),
            (
                "SELECT (_timestamp + 1) as _timestamp FROM table1",
                true,
                "Expression aliased as _timestamp",
            ),
            (
                "SELECT t1._timestamp FROM table1 t1",
                true,
                "Table qualified timestamp",
            ),
            (
                "SELECT t1._timestamp as other FROM table1 t1",
                false,
                "Table qualified timestamp with different alias",
            ),
            (
                "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END FROM table1",
                false,
                "Timestamp in subquery",
            ),
            (
                "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END as _timestamp FROM table1",
                true,
                "CASE expression aliased as _timestamp",
            ),
            (
                "SELECT * FROM (SELECT _timestamp FROM table1) t",
                true,
                "Subquery with wildcard",
            ),
            (
                "SELECT t.other FROM (SELECT _timestamp as other FROM table1) t",
                false,
                "Subquery with renamed timestamp",
            ),
            (
                "SELECT MAX(_timestamp) as ts1, ts1 as _timestamp FROM table1",
                true,
                "Still results a _timestamp field",
            ),
            (
                "SELECT ts, code, request_count FROM ( SELECT histogram(_timestamp) AS ts, code, count(_timestamp) AS request_count, ROW_NUMBER() OVER (PARTITION BY histogram(_timestamp) ORDER BY count(_timestamp) DESC) AS rn FROM drop1 WHERE (code IS NOT NULL) GROUP BY ts, code ) t WHERE rn <= 3 ORDER BY ts DESC, request_count DESC",
                true,
                "Still results a _timestamp field",
            ),
            (
                "SELECT code, request_count FROM ( SELECT histogram(_timestamp) AS ts, code, count(_timestamp) AS request_count, ROW_NUMBER() OVER (PARTITION BY histogram(_timestamp) ORDER BY count(_timestamp) DESC) AS rn FROM drop1 WHERE (code IS NOT NULL) GROUP BY ts, code ) t WHERE rn <= 3 ORDER BY ts DESC, request_count DESC",
                false,
                "Final result does not have _timestamp field",
            ),
            (
                "SELECT histogram(_timestamp) AS ts, count(*) FROM tbl1 WHERE a=b AND c IN(SELECT c FROM tbl2 WHERE c=d) GROUP BY ts ORDER BY ts ASC",
                false,
                "Final result does not have _timestamp field",
            ),
            (
                "SELECT ts, cnt FROM (SELECT histogram(_timestamp) AS ts, count(*) AS cnt GROUP BY ts) LIMIT 10",
                true,
                "Still results a _timestamp field",
            ),
            (
                "SELECT * FROM (SELECT histogram(_timestamp) AS ts, count(*) AS cnt GROUP BY ts) LIMIT 10",
                true,
                "Still results a _timestamp field",
            ),
            (
                "SELECT histogram(_timestamp,'5 minutes') as t1, responsecode, COUNT(_timestamp) as total_count FROM (SELECT _timestamp, array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) AS responsecode FROM tbl WHERE log LIKE '%api/v1/%' and array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) = 200) GROUP BY t1, responsecode ORDER BY t1 DESC",
                true,
                "Still results a _timestamp field",
            ),
            (
                "SELECT histogram(_timestamp,'5 minutes') as t1, responsecode, COUNT(_timestamp) as total_count FROM tbl WHERE responsecode IN(SELECT array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) AS responsecode FROM tbl WHERE log LIKE '%api/v1/%' and array_extract(regexp_match(log,'ResponseCode=(?<responsecode>[^,]+)'),1) = 200) GROUP BY t1, responsecode ORDER BY t1 DESC",
                false,
                "Final result does not have _timestamp field",
            ),
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT * FROM tbl1",
                true,
                "Still results a _timestamp field",
            ),
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT ts, cnt FROM tbl1",
                true,
                "Still results a _timestamp field",
            ),
            (
                "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT cnt FROM tbl1",
                false,
                "Final result does not have _timestamp field",
            ),
            (
                "WITH bucketed_statuses AS (SELECT histogram(_timestamp) AS ts, edgeresponsestatus, COUNT(_timestamp) AS request_count FROM tbl1 WHERE source = 'cloudflare' GROUP BY ts, edgeresponsestatus), ranked_statuses AS (SELECT ts, edgeresponsestatus, request_count, ROW_NUMBER() OVER (PARTITION BY ts ORDER BY request_count DESC) AS rk FROM bucketed_statuses) SELECT ts, edgeresponsestatus, request_count FROM ranked_statuses WHERE rk < 10 ORDER BY ts ASC, request_count DESC",
                true,
                "Still results a _timestamp field",
            ),
            (
                "WITH bucketed_statuses AS (SELECT histogram(_timestamp) AS ts, edgeresponsestatus, COUNT(_timestamp) AS request_count FROM tbl1 WHERE source = 'cloudflare' GROUP BY ts, edgeresponsestatus), ranked_statuses AS (SELECT ts AS ts2, edgeresponsestatus, request_count, ROW_NUMBER() OVER (PARTITION BY ts ORDER BY request_count DESC) AS rk FROM bucketed_statuses) SELECT ts2 AS ts3, edgeresponsestatus, request_count FROM ranked_statuses WHERE rk < 10 ORDER BY ts2 ASC, request_count DESC",
                false,
                "Final result does not have _timestamp field",
            ),
            (
                "SELECT histogram(a._timestamp) AS ts, b.name, count(*) FROM tbl1 AS a LEFT JOIN tbl2 AS b ON a.userid=b.userid GROUP BY ts, name ORDER BY ts ASC",
                false,
                "Final result does not have _timestamp field",
            ),
            (
                "WITH a AS (SELECT histogram(_timestamp) AS ts, userid, count(*) as cnt FROM tbl1 GROUP BY ts, userid HAVING cnt > 40) SELECT ts, SUM(cnt) AS cnt, COUNT(DISTINCT userid) AS user_cnt FROM a GROUP BY ts",
                true,
                "Still results a _timestamp field",
            ),
            (
                "SELECT max(_timestamp) AS _timestamp, log_request_type AS request_type FROM platform WHERE kubernetes_container_name = 'mp' AND log_message = 'Record' GROUP BY log_request_type UNION ALL SELECT max(_timestamp) AS _timestamp, log_request_type AS request_type FROM platform WHERE kubernetes_container_name = 'mp' AND log_message = 'Rest' GROUP BY log_request_type",
                true,
                "UNION ALL with _timestamp aliased in both sides",
            ),
            (
                "SELECT name FROM table1 UNION ALL SELECT name FROM table2",
                false,
                "UNION ALL without _timestamp on either side",
            ),
            (
                "SELECT max(_timestamp) AS _timestamp FROM table1 UNION ALL SELECT name FROM table2",
                true,
                "UNION ALL with _timestamp aliased on one side (left)",
            ),
            (
                "SELECT name FROM table1 UNION ALL SELECT max(_timestamp) AS _timestamp FROM table2",
                false,
                "UNION ALL with _timestamp aliased on one side (right)",
            ),
            (
                "SELECT _timestamp FROM table1 UNION ALL SELECT _timestamp FROM table2",
                true,
                "UNION ALL with direct _timestamp selection on both sides",
            ),
            (
                "SELECT * FROM table1 UNION ALL SELECT * FROM table2",
                true,
                "UNION ALL with wildcard on both sides",
            ),
            (
                "SELECT name FROM table1 UNION ALL SELECT * FROM table2",
                false,
                "UNION ALL with wildcard on one side",
            ),
            (
                "SELECT MAX(_timestamp) AS ts, COUNT(*) AS cnt, ts AS _timestamp FROM table1 UNION ALL SELECT MAX(_timestamp) AS ts, COUNT(*) AS cnt, ts AS _timestamp FROM table2",
                true,
                "UNION ALL with alias chain leading to _timestamp",
            ),
            (
                "SELECT MAX(_timestamp) AS ts, COUNT(*) AS cnt FROM table1 UNION ALL SELECT MAX(_timestamp) AS ts, COUNT(*) AS cnt FROM table2",
                false,
                "UNION ALL without _timestamp alias in final output",
            ),
            (
                "SELECT _timestamp FROM table1 UNION ALL (SELECT _timestamp FROM table2 UNION ALL SELECT _timestamp FROM table3)",
                true,
                "Nested UNION ALL with _timestamp",
            ),
            (
                "SELECT max(_timestamp) AS _timestamp FROM table1 UNION SELECT name FROM table2",
                true,
                "UNION with _timestamp on one side",
            ),
            (
                "SELECT t._timestamp FROM (SELECT _timestamp FROM table1) t UNION ALL SELECT t._timestamp FROM (SELECT _timestamp FROM table2) t",
                true,
                "UNION ALL with subquery in FROM",
            ),
        ];

        for (sql, expected, test_name) in test_cases {
            let result = is_timestamp_selected(sql)?;
            assert_eq!(
                result, expected,
                "Failed test case '{test_name}': expected {expected}, got {result}"
            );
        }

        Ok(())
    }
}
