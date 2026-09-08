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

use crate::models::resources::ResourceHit;

const SCORE_NAME_EXACT: u32 = 80;
const SCORE_ID_EXACT: u32 = 70;
const SCORE_NAME_PREFIX: u32 = 60;
const SCORE_WORD_PREFIX: u32 = 40;
const SCORE_NAME_CONTAINS: u32 = 20;
const SCORE_OTHER_CONTAINS: u32 = 10;

/// Lowercases and collapses whitespace, mirroring the palette's client-side fold.
pub fn fold(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Cheap pre-filter for in-memory sources; `q` must already be folded.
pub fn is_candidate(name: &str, id: &str, description: &str, q: &str) -> bool {
    q.is_empty()
        || fold(name).contains(q)
        || fold(id).contains(q)
        || (!description.is_empty() && fold(description).contains(q))
}

/// First matching rule wins, same ladder as the browser ranker; 0 means no match.
pub fn score(name: &str, id: &str, description: &str, q: &str) -> u32 {
    let name = fold(name);
    let id = fold(id);
    if name == q {
        return SCORE_NAME_EXACT;
    }
    if id == q {
        return SCORE_ID_EXACT;
    }
    if name.starts_with(q) {
        return SCORE_NAME_PREFIX;
    }
    if name.split(' ').any(|w| w.starts_with(q)) {
        return SCORE_WORD_PREFIX;
    }
    if name.contains(q) {
        return SCORE_NAME_CONTAINS;
    }
    if id.contains(q) || (!description.is_empty() && fold(description).contains(q)) {
        return SCORE_OTHER_CONTAINS;
    }
    0
}

/// Scores, drops non-matches, orders by score then name, cuts to `limit`; the flag says rows were
/// cut.
pub fn rank(hits: Vec<ResourceHit>, q: &str, limit: usize) -> (Vec<ResourceHit>, bool) {
    let mut kept: Vec<ResourceHit> = if q.is_empty() {
        hits
    } else {
        hits.into_iter()
            .filter_map(|mut hit| {
                let s = score(
                    &hit.name,
                    &hit.id,
                    hit.description.as_deref().unwrap_or(""),
                    q,
                );
                (s > 0).then(|| {
                    hit.score = s;
                    hit
                })
            })
            .collect()
    };
    kept.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| fold(&a.name).cmp(&fold(&b.name)))
    });
    let truncated = kept.len() > limit;
    kept.truncate(limit);
    (kept, truncated)
}

/// OpenFGA list semantics: `None` is unrestricted, otherwise the object or the org-wide entry must
/// be listed.
pub fn is_permitted(permitted: Option<&[String]>, key: &str, id: &str, org_id: &str) -> bool {
    match permitted {
        None => true,
        Some(list) => {
            let object = format!("{key}:{id}");
            let all = format!("{key}:_all_{org_id}");
            list.iter().any(|o| *o == object || *o == all)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::resources::ResourceType;

    fn hit(name: &str, id: &str) -> ResourceHit {
        ResourceHit::new(ResourceType::Dashboard, id, name)
    }

    #[test]
    fn fold_lowercases_and_collapses_whitespace() {
        assert_eq!(
            fold("  Checkout   Service\tOverview "),
            "checkout service overview"
        );
    }

    #[test]
    fn score_follows_the_ladder() {
        assert_eq!(score("Logs", "x", "", "logs"), 80);
        assert_eq!(score("Checkout", "7ab9", "", "7ab9"), 70);
        assert_eq!(score("Dashboards", "x", "", "dash"), 60);
        assert_eq!(score("All Alerts", "x", "", "alert"), 40);
        assert_eq!(score("Catalog", "x", "", "log"), 20);
        assert_eq!(score("Payments", "7ab9xq", "", "b9x"), 10);
        assert_eq!(score("Payments", "x", "p99 latency for SRE", "sre"), 10);
        assert_eq!(score("Payments", "x", "", "zzz"), 0);
    }

    #[test]
    fn rank_orders_by_score_then_name_and_reports_truncation() {
        let hits = vec![
            hit("Catalog", "1"),
            hit("Logs", "2"),
            hit("Log Configuration", "3"),
            hit("Login", "4"),
        ];
        let (ranked, truncated) = rank(hits, "log", 3);
        let names: Vec<&str> = ranked.iter().map(|h| h.name.as_str()).collect();
        // "Logs", "Log Configuration", "Login" all score 60 (prefix), so order is alphabetical.
        assert_eq!(names, ["Log Configuration", "Login", "Logs"]);
        assert_eq!(ranked[0].score, 60);
        assert!(truncated);
    }

    #[test]
    fn rank_with_empty_query_is_alphabetical_and_unscored() {
        let hits = vec![hit("beta", "1"), hit("Alpha", "2")];
        let (ranked, truncated) = rank(hits, "", 10);
        let names: Vec<&str> = ranked.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "beta"]);
        assert_eq!(ranked[0].score, 0);
        assert!(!truncated);
    }

    #[test]
    fn is_candidate_matches_any_field_when_query_present() {
        assert!(is_candidate("Anything", "", "", ""));
        assert!(is_candidate("Nginx Access", "", "", "acc"));
        assert!(is_candidate("x", "7Ab9", "", "7ab"));
        assert!(is_candidate("x", "y", "for the SRE team", "sre"));
        assert!(!is_candidate("x", "y", "", "zz"));
    }

    #[test]
    fn is_permitted_honours_none_object_and_org_wide_entries() {
        assert!(is_permitted(None, "function", "f1", "org"));
        let list = vec!["function:f1".to_string()];
        assert!(is_permitted(Some(&list), "function", "f1", "org"));
        assert!(!is_permitted(Some(&list), "function", "f2", "org"));
        let all = vec!["function:_all_org".to_string()];
        assert!(is_permitted(Some(&all), "function", "f2", "org"));
        assert!(!is_permitted(Some(&[]), "function", "f1", "org"));
    }
}
