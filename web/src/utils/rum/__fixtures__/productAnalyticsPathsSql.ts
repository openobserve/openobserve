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

// pathsSql and branchSessionsSql output captured before the Paths drawer gained user_label (o2-enterprise#2851).
export const PATHS_ANCHOR_PAGE = String.raw`WITH e0 AS (SELECT session_id AS sid, type AS ty, MIN(date) AS t, MIN(view_url) AS url, MIN(action_target_name) AS atn, MAX(CASE WHEN session_has_replay IS NOT NULL THEN 1 ELSE 0 END) AS hr FROM "_rumdata" WHERE {scope} AND (type = 'view' OR (type = 'action' AND action_target_name <> '')) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN COALESCE(action_id, CAST(date AS VARCHAR)) ELSE CAST(date AS VARCHAR) END),
e AS (SELECT sid, t, ty, hr, CASE WHEN ty = 'view' THEN 'p:' || {PK(url)} WHEN ty = 'action' THEN 'c:' || {CK(atn)} END AS key FROM e0),
d AS (SELECT *, LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk FROM e),
sq AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t, key) AS n FROM d WHERE key IS NOT NULL AND (pk IS NULL OR pk <> key)),
an AS (SELECT *, MIN(CASE WHEN key = 'p:/web/logs' THEN n END) OVER (PARTITION BY sid) AS n0 FROM sq),
pa AS (SELECT sid, MAX(CASE WHEN n = n0 + 1 THEN key END) AS s1, MAX(CASE WHEN n = n0 + 2 THEN key END) AS s2, MAX(CASE WHEN n = n0 + 3 THEN key END) AS s3, MAX(CASE WHEN n = n0 + 1 THEN t END) AS t1, MAX(CASE WHEN n = n0 + 2 THEN t END) AS t2, MAX(CASE WHEN n = n0 + 3 THEN t END) AS t3 FROM an WHERE n BETWEEN n0 AND n0 + 3 GROUP BY sid)
SELECT s1, s2, s3, COUNT(*) AS sessions, SUM(COUNT(*)) OVER () AS anchor_sessions, COUNT(*) OVER () AS path_count FROM pa GROUP BY s1, s2, s3 ORDER BY sessions DESC, s1, s2, s3 LIMIT 5000`;

export const PATHS_ANCHOR_CLICK = String.raw`WITH e0 AS (SELECT session_id AS sid, type AS ty, MIN(date) AS t, MIN(view_url) AS url, MIN(action_target_name) AS atn, MAX(CASE WHEN session_has_replay IS NOT NULL THEN 1 ELSE 0 END) AS hr FROM "_rumdata" WHERE {scope} AND (type = 'view' OR (type = 'action' AND action_target_name <> '')) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN COALESCE(action_id, CAST(date AS VARCHAR)) ELSE CAST(date AS VARCHAR) END),
e AS (SELECT sid, t, ty, hr, CASE WHEN ty = 'view' THEN 'p:' || {PK(url)} WHEN ty = 'action' THEN 'c:' || {CK(atn)} END AS key FROM e0),
d AS (SELECT *, LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk FROM e),
sq AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t, key) AS n FROM d WHERE key IS NOT NULL AND (pk IS NULL OR pk <> key)),
an AS (SELECT *, MIN(CASE WHEN key = 'c:menu-link-/logs-item' THEN n END) OVER (PARTITION BY sid) AS n0 FROM sq),
pa AS (SELECT sid, MAX(CASE WHEN n = n0 + 1 THEN key END) AS s1, MAX(CASE WHEN n = n0 + 2 THEN key END) AS s2, MAX(CASE WHEN n = n0 + 3 THEN key END) AS s3, MAX(CASE WHEN n = n0 + 1 THEN t END) AS t1, MAX(CASE WHEN n = n0 + 2 THEN t END) AS t2, MAX(CASE WHEN n = n0 + 3 THEN t END) AS t3 FROM an WHERE n BETWEEN n0 AND n0 + 3 GROUP BY sid)
SELECT s1, s2, s3, COUNT(*) AS sessions, SUM(COUNT(*)) OVER () AS anchor_sessions, COUNT(*) OVER () AS path_count FROM pa GROUP BY s1, s2, s3 ORDER BY sessions DESC, s1, s2, s3 LIMIT 5000`;

export const PATHS_ANCHOR_EVENT = String.raw`WITH e0 AS (SELECT session_id AS sid, type AS ty, MIN(date) AS t, MIN(view_url) AS url, MIN(action_target_name) AS atn, MAX(CASE WHEN session_has_replay IS NOT NULL THEN 1 ELSE 0 END) AS hr FROM "_rumdata" WHERE {scope} AND (type = 'view' OR (type = 'action' AND action_target_name <> '')) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN COALESCE(action_id, CAST(date AS VARCHAR)) ELSE CAST(date AS VARCHAR) END),
e1 AS (SELECT sid, t, ty, hr, url, CASE WHEN ty = 'view' THEN {PK(url)} WHEN ty = 'action' THEN {CK(atn)} END AS k FROM e0),
e AS (SELECT sid, t, ty, hr, CASE WHEN ty = 'view' THEN 'p:' || k WHEN ty = 'action' THEN 'c:' || k END AS key, CASE WHEN ((ty = 'view' AND starts_with(k, '/web/l'))) THEN 1 ELSE 0 END AS am FROM e1),
d AS (SELECT *, LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk FROM e),
sq AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t, key) AS n FROM d WHERE key IS NOT NULL AND (pk IS NULL OR pk <> key)),
an AS (SELECT *, MIN(CASE WHEN am = 1 THEN n END) OVER (PARTITION BY sid) AS n0 FROM sq),
pa AS (SELECT sid, MAX(CASE WHEN n = n0 + 1 THEN key END) AS s1, MAX(CASE WHEN n = n0 + 2 THEN key END) AS s2, MAX(CASE WHEN n = n0 + 3 THEN key END) AS s3, MAX(CASE WHEN n = n0 + 1 THEN t END) AS t1, MAX(CASE WHEN n = n0 + 2 THEN t END) AS t2, MAX(CASE WHEN n = n0 + 3 THEN t END) AS t3 FROM an WHERE n BETWEEN n0 AND n0 + 3 GROUP BY sid)
SELECT s1, s2, s3, COUNT(*) AS sessions, SUM(COUNT(*)) OVER () AS anchor_sessions, COUNT(*) OVER () AS path_count FROM pa GROUP BY s1, s2, s3 ORDER BY sessions DESC, s1, s2, s3 LIMIT 5000`;

export const PATHS_COHORT_SESSIONS = String.raw`WITH x00 AS (SELECT session_id AS sid, type AS ty, MIN(date) AS t, MIN(view_url) AS url, MIN(action_target_name) AS atn, MAX(CASE WHEN session_has_replay IS NOT NULL THEN 1 ELSE 0 END) AS hr FROM "_rumdata" WHERE {scope} AND (type IN ('view') OR (type = 'action' AND action_target_name <> '')) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN COALESCE(action_id, CAST(date AS VARCHAR)) WHEN type = 'error' THEN CAST(date AS VARCHAR) ELSE type END),
x0 AS (SELECT sid, ty, t, hr, CASE WHEN ty = 'view' THEN {PK(url)} WHEN ty = 'action' THEN {CK(atn)} END AS k FROM x00 WHERE ty IN ('view', 'action', 'error')),
x1 AS (SELECT sid, ty, t, hr, k, CASE WHEN ty = 'view' AND k = '/a' THEN 1 ELSE 0 END AS m1, CASE WHEN ty = 'action' AND k = 'b' THEN 1 ELSE 0 END AS m2, CAST(NULL AS VARCHAR) AS uid FROM x0),
x2 AS (SELECT * FROM (SELECT *, MAX(m1) OVER (PARTITION BY sid) AS h1 FROM x1) q WHERE h1 = 1 AND ty IN ('view', 'action', 'error')),
w AS (SELECT *, sequence_depth(0, t, m1 = 1, m2 = 1) OVER (PARTITION BY sid) AS wr, sequence_step_match(0, 1, t, m1 = 1, m2 = 1) OVER (PARTITION BY sid) AS wv FROM x2),
v AS (SELECT *, CASE WHEN wv THEN 1 ELSE 0 END AS v1, CASE WHEN wr >= 2 THEN 1 ELSE 0 END AS v2 FROM w),
r AS (SELECT *, MIN(CASE WHEN v1 = 1 THEN t END) OVER (PARTITION BY sid) AS tk, substr(MIN(CASE WHEN v1 = 1 THEN CAST(t AS VARCHAR) || sid END) OVER (PARTITION BY sid), 14) AS sk, MAX(v1) OVER (PARTITION BY sid) AS rk, MAX(v2) OVER (PARTITION BY sid) AS rk1 FROM v WHERE sid IS NOT NULL),
cr AS (SELECT sid, t, ty, hr, k, tk AS step_t FROM r WHERE rk = 1 AND rk1 = 0),
e AS (SELECT sid, t, ty, hr, step_t, CASE WHEN ty = 'view' THEN 'p:' || k WHEN ty = 'action' THEN 'c:' || k END AS key FROM cr WHERE step_t IS NOT NULL AND ty IN ('view', 'action')),
d AS (SELECT *, LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk FROM e),
sq AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t, key) AS n FROM d WHERE key IS NOT NULL AND (pk IS NULL OR pk <> key)),
an AS (SELECT *, MAX(CASE WHEN t <= step_t THEN n END) OVER (PARTITION BY sid) AS n0 FROM sq),
pa AS (SELECT sid, MAX(CASE WHEN n = n0 + 1 THEN key END) AS s1, MAX(CASE WHEN n = n0 + 2 THEN key END) AS s2, MAX(CASE WHEN n = n0 + 3 THEN key END) AS s3, MAX(CASE WHEN n = n0 + 1 THEN t END) AS t1, MAX(CASE WHEN n = n0 + 2 THEN t END) AS t2, MAX(CASE WHEN n = n0 + 3 THEN t END) AS t3 FROM an WHERE n BETWEEN n0 AND n0 + 3 GROUP BY sid)
SELECT s1, s2, s3, COUNT(*) AS sessions, SUM(COUNT(*)) OVER () AS anchor_sessions, COUNT(*) OVER () AS path_count FROM pa GROUP BY s1, s2, s3 ORDER BY sessions DESC, s1, s2, s3 LIMIT 5000`;

export const PATHS_COHORT_USERS = String.raw`WITH x00 AS (SELECT session_id AS sid, type AS ty, MIN(date) AS t, MIN(view_url) AS url, MIN(action_target_name) AS atn, MAX(CASE WHEN session_has_replay IS NOT NULL THEN 1 ELSE 0 END) AS hr, first_value(CASE WHEN NULLIF(usr_email, '') IN ('bot@x.com') THEN NULL ELSE NULLIF(usr_email, '') END ORDER BY CASE WHEN CASE WHEN NULLIF(usr_email, '') IN ('bot@x.com') THEN NULL ELSE NULLIF(usr_email, '') END IS NULL THEN 1 ELSE 0 END, date) AS u0, MIN(CASE WHEN CASE WHEN NULLIF(usr_email, '') IN ('bot@x.com') THEN NULL ELSE NULLIF(usr_email, '') END IS NOT NULL THEN date END) AS ut FROM "_rumdata" WHERE {scope} AND (type IN ('view') OR (type = 'action' AND action_target_name <> '') OR CASE WHEN NULLIF(usr_email, '') IN ('bot@x.com') THEN NULL ELSE NULLIF(usr_email, '') END IS NOT NULL) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN COALESCE(action_id, CAST(date AS VARCHAR)) WHEN type = 'error' THEN CAST(date AS VARCHAR) ELSE type END),
x0 AS (SELECT sid, ty, t, hr, u0, ut, CASE WHEN ty = 'view' THEN {PK(url)} WHEN ty = 'action' THEN {CK(atn)} END AS k FROM x00),
x1 AS (SELECT sid, ty, t, hr, k, CASE WHEN ty = 'view' AND k = '/a' THEN 1 ELSE 0 END AS m1, CASE WHEN ty = 'action' AND k = 'b' THEN 1 ELSE 0 END AS m2, FIRST_VALUE(u0) OVER (PARTITION BY sid ORDER BY CASE WHEN u0 IS NULL THEN 1 ELSE 0 END, ut) AS uid FROM x0),
x2 AS (SELECT * FROM (SELECT *, MAX(m1) OVER (PARTITION BY COALESCE(uid, 's:' || sid)) AS h1 FROM x1) q WHERE h1 = 1 AND ty IN ('view', 'action', 'error')),
w AS (SELECT *, sequence_depth(86400000, t, m1 = 1, m2 = 1) OVER (PARTITION BY COALESCE(uid, 's:' || sid)) AS wr, sequence_step_match(86400000, 1, t, m1 = 1, m2 = 1) OVER (PARTITION BY COALESCE(uid, 's:' || sid)) AS wv FROM x2),
v AS (SELECT *, CASE WHEN wv THEN 1 ELSE 0 END AS v1, CASE WHEN wr >= 2 THEN 1 ELSE 0 END AS v2 FROM w),
r AS (SELECT *, MIN(CASE WHEN v1 = 1 THEN t END) OVER (PARTITION BY uid) AS tk, substr(MIN(CASE WHEN v1 = 1 THEN CAST(t AS VARCHAR) || sid END) OVER (PARTITION BY uid), 14) AS sk, MAX(v1) OVER (PARTITION BY uid) AS rk, MAX(v2) OVER (PARTITION BY uid) AS rk1 FROM v WHERE uid IS NOT NULL),
cr AS (SELECT sid, t, ty, hr, k, MIN(CASE WHEN v1 = 1 THEN t END) OVER (PARTITION BY sid) AS step_t FROM r WHERE rk = 1 AND rk1 = 0),
e AS (SELECT sid, t, ty, hr, step_t, CASE WHEN ty = 'view' THEN 'p:' || k WHEN ty = 'action' THEN 'c:' || k END AS key FROM cr WHERE step_t IS NOT NULL AND ty IN ('view', 'action')),
d AS (SELECT *, LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk FROM e),
sq AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t, key) AS n FROM d WHERE key IS NOT NULL AND (pk IS NULL OR pk <> key)),
an AS (SELECT *, MAX(CASE WHEN t <= step_t THEN n END) OVER (PARTITION BY sid) AS n0 FROM sq),
pa AS (SELECT sid, MAX(CASE WHEN n = n0 + 1 THEN key END) AS s1, MAX(CASE WHEN n = n0 + 2 THEN key END) AS s2, MAX(CASE WHEN n = n0 + 3 THEN key END) AS s3, MAX(CASE WHEN n = n0 + 1 THEN t END) AS t1, MAX(CASE WHEN n = n0 + 2 THEN t END) AS t2, MAX(CASE WHEN n = n0 + 3 THEN t END) AS t3 FROM an WHERE n BETWEEN n0 AND n0 + 3 GROUP BY sid)
SELECT s1, s2, s3, COUNT(*) AS sessions, SUM(COUNT(*)) OVER () AS anchor_sessions, COUNT(*) OVER () AS path_count FROM pa GROUP BY s1, s2, s3 ORDER BY sessions DESC, s1, s2, s3 LIMIT 5000`;

export const BRANCH_COHORT_SESSIONS = String.raw`WITH x00 AS (SELECT session_id AS sid, type AS ty, MIN(date) AS t, MIN(view_url) AS url, MIN(action_target_name) AS atn, MAX(CASE WHEN session_has_replay IS NOT NULL THEN 1 ELSE 0 END) AS hr FROM "_rumdata" WHERE {scope} AND (type IN ('view', 'error') OR (type = 'action' AND action_target_name <> '')) GROUP BY session_id, type, CASE WHEN type = 'view' THEN view_id WHEN type = 'action' THEN COALESCE(action_id, CAST(date AS VARCHAR)) WHEN type = 'error' THEN CAST(date AS VARCHAR) ELSE type END),
x0 AS (SELECT sid, ty, t, hr, CASE WHEN ty = 'view' THEN {PK(url)} WHEN ty = 'action' THEN {CK(atn)} END AS k FROM x00 WHERE ty IN ('view', 'action', 'error')),
x1 AS (SELECT sid, ty, t, hr, k, CASE WHEN ty = 'view' AND k = '/a' THEN 1 ELSE 0 END AS m1, CASE WHEN ty = 'action' AND k = 'b' THEN 1 ELSE 0 END AS m2, CAST(NULL AS VARCHAR) AS uid FROM x0),
x2 AS (SELECT * FROM (SELECT *, MAX(m1) OVER (PARTITION BY sid) AS h1 FROM x1) q WHERE h1 = 1 AND ty IN ('view', 'action', 'error')),
w AS (SELECT *, sequence_depth(0, t, m1 = 1, m2 = 1) OVER (PARTITION BY sid) AS wr, sequence_step_match(0, 1, t, m1 = 1, m2 = 1) OVER (PARTITION BY sid) AS wv FROM x2),
v AS (SELECT *, CASE WHEN wv THEN 1 ELSE 0 END AS v1, CASE WHEN wr >= 2 THEN 1 ELSE 0 END AS v2 FROM w),
r AS (SELECT *, MIN(CASE WHEN v1 = 1 THEN t END) OVER (PARTITION BY sid) AS tk, substr(MIN(CASE WHEN v1 = 1 THEN CAST(t AS VARCHAR) || sid END) OVER (PARTITION BY sid), 14) AS sk, MAX(v1) OVER (PARTITION BY sid) AS rk, MAX(v2) OVER (PARTITION BY sid) AS rk1 FROM v WHERE sid IS NOT NULL),
cr AS (SELECT sid, t, ty, hr, k, tk AS step_t FROM r WHERE rk = 1 AND rk1 = 0),
e AS (SELECT sid, t, ty, hr, step_t, CASE WHEN ty = 'view' THEN 'p:' || k WHEN ty = 'action' THEN 'c:' || k END AS key FROM cr WHERE step_t IS NOT NULL AND (ty IN ('view', 'action') OR ty = 'error')),
d AS (SELECT *, LAG(key) OVER (PARTITION BY sid, CASE WHEN ty = 'error' THEN 1 ELSE 0 END ORDER BY t, key) AS pk, SUM(CASE WHEN ty = 'error' THEN 1 ELSE 0 END) OVER (PARTITION BY sid ORDER BY t, key ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS errors, MIN(t) OVER (PARTITION BY sid ORDER BY t, key ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS started, MAX(t) OVER (PARTITION BY sid ORDER BY t, key ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS ended, MAX(hr) OVER (PARTITION BY sid ORDER BY t, key ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS has_replay FROM e),
sq AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t, key) AS n FROM d WHERE key IS NOT NULL AND (pk IS NULL OR pk <> key)),
an AS (SELECT *, MAX(CASE WHEN t <= step_t THEN n END) OVER (PARTITION BY sid) AS n0 FROM sq),
pa AS (SELECT sid, MAX(CASE WHEN n = n0 + 1 THEN key END) AS s1, MAX(CASE WHEN n = n0 + 2 THEN key END) AS s2, MAX(CASE WHEN n = n0 + 3 THEN key END) AS s3, MAX(CASE WHEN n = n0 + 1 THEN t END) AS t1, MAX(CASE WHEN n = n0 + 2 THEN t END) AS t2, MAX(CASE WHEN n = n0 + 3 THEN t END) AS t3, MAX(errors) AS errors, MAX(started) AS started, MAX(ended) AS ended, MAX(has_replay) AS has_replay, MAX(CASE WHEN n = n0 THEN t END) AS t0 FROM an WHERE n BETWEEN n0 AND n0 + 3 GROUP BY sid)
SELECT sid, t1 AS step_t, errors, 0 AS frustrations, has_replay, started, ended, COUNT(*) OVER () AS total FROM pa WHERE s1 = 'x' ORDER BY has_replay DESC, step_t DESC, sid LIMIT 200 OFFSET 0`;
