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

use std::collections::HashSet;

use crate::models::resources::ResourceHit;

const SCORE_NAME_EXACT: u32 = 80;
const SCORE_ID_EXACT: u32 = 70;
const SCORE_NAME_PREFIX: u32 = 60;
const SCORE_WORD_PREFIX: u32 = 40;
const SCORE_NAME_CONTAINS: u32 = 20;
const SCORE_OTHER_CONTAINS: u32 = 10;

/// Permitted-object set for one resource type, resolved once per source.
pub struct Permit {
    /// `None` means unrestricted (root user, OpenFGA off, or list-only off).
    ids: Option<HashSet<String>>,
    /// True when the org-wide `{key}:_all_{org}` grant is present.
    all: bool,
}

/// Lowercases and collapses whitespace, mirroring the palette's client-side fold.
///
/// The client additionally strips NFD diacritics; this does not, so an accented entity
/// name matches an accented query but not its unaccented form. Diacritic parity is deferred.
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
/// cut. Each name is folded once for the ordering rather than on every comparison.
pub fn rank(hits: Vec<ResourceHit>, q: &str, limit: usize) -> (Vec<ResourceHit>, bool) {
    let mut scored: Vec<(String, ResourceHit)> = if q.is_empty() {
        hits.into_iter().map(|hit| (fold(&hit.name), hit)).collect()
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
                    (fold(&hit.name), hit)
                })
            })
            .collect()
    };
    scored.sort_by(|a, b| b.1.score.cmp(&a.1.score).then_with(|| a.0.cmp(&b.0)));
    let truncated = scored.len() > limit;
    scored.truncate(limit);
    (scored.into_iter().map(|(_, hit)| hit).collect(), truncated)
}

impl Permit {
    /// `key` is the resolved OpenFGA object key, the same one the list call was made with.
    pub fn new(permitted: Option<Vec<String>>, key: &str, org_id: &str) -> Self {
        let Some(list) = permitted else {
            return Self {
                ids: None,
                all: true,
            };
        };
        let prefix = format!("{key}:");
        let all_object = format!("{key}:_all_{org_id}");
        let mut all = false;
        // Store bare ids so membership is one hash lookup with no per-row allocation.
        let ids = list
            .into_iter()
            .filter_map(|object| {
                if object == all_object {
                    all = true;
                    return None;
                }
                object.strip_prefix(&prefix).map(str::to_owned)
            })
            .collect();
        Self {
            ids: Some(ids),
            all,
        }
    }

    pub fn allows(&self, id: &str) -> bool {
        match &self.ids {
            None => true,
            Some(ids) => self.all || ids.contains(id),
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
    fn permit_none_is_unrestricted() {
        assert!(Permit::new(None, "function", "org").allows("anything"));
    }

    #[test]
    fn permit_honours_object_and_org_wide_grants() {
        let object = Permit::new(Some(vec!["function:f1".to_string()]), "function", "org");
        assert!(object.allows("f1"));
        assert!(!object.allows("f2"));

        let all = Permit::new(
            Some(vec!["function:_all_org".to_string()]),
            "function",
            "org",
        );
        assert!(all.allows("f2"));

        assert!(!Permit::new(Some(vec![]), "function", "org").allows("f1"));
    }
}
