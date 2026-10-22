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

//! Admission of one persisted turn: the chat's lease, registry slot under the caps, turn record and
//! new epoch.

use infra::table::{
    ai_chat_sessions::{self, Model, STATUS_ACTIVE},
    ai_chat_turns::{self, Admission, TURN_FAILED},
};
use o2_enterprise::enterprise::{
    ai::{
        chat::{
            lease::{self, LeaseError, TurnLease},
            registry::{self, Registration, TurnCaps},
        },
        client::{QueryRequest, RCA_AGENT_TYPE},
    },
    common::config::get_config as get_o2_config,
};
use sea_orm::prelude::Uuid;

/// Turn result label and error code of a turn refused by an active-turn cap.
pub const TURN_LIMIT: &str = "turn_limit";
const EPOCH_CONFLICT: &str = "epoch_conflict";
const PROMPT_TITLE_CHARS: usize = 80;
const PERSISTENCE_UNAVAILABLE: &str = "Chat persistence is unavailable; please retry";

/// Why a turn was not admitted; each variant's message is what the caller is told.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmitError {
    /// A missing or malformed session or turn id.
    InvalidSession(&'static str),
    /// The email has no user record.
    NotRegistered,
    /// Another user's or a deleted chat; the two are not told apart from an unknown one.
    NotFound(&'static str),
    /// Another turn holds the chat's lease.
    Busy,
    /// An active-turn cap is reached; the scope is `user`, `org` or `node`.
    TurnLimit(&'static str),
    /// This turn id already ran.
    AlreadySubmitted,
    /// The session index or the lease backend failed.
    Unavailable(&'static str),
}

/// Everything a persisted turn needs once admitted.
pub struct AdmittedTurn {
    /// The index row as this turn continues it, `session_epoch` being the turn's own epoch.
    pub row: Model,
    pub owner: String,
    pub turn_id: String,
    pub lease: TurnLease,
    pub registration: Registration,
}

/// The request [`admit_under_lease`] records.
struct NewTurn<'a> {
    org_id: &'a str,
    session_id: &'a str,
    turn_id: &'a str,
    owner: &'a str,
    user_email: &'a str,
    agent_type: &'a str,
    prompt: &'a str,
    trace_id: &'a str,
}

pub fn is_uuid(value: &str) -> bool {
    value.len() == 36 && Uuid::try_parse(value).is_ok()
}

/// Lowercased hyphenated UUID, so both spellings name the same chat; `None` for anything else.
pub fn normalize_uuid(value: &str) -> Option<String> {
    is_uuid(value).then(|| value.to_ascii_lowercase())
}

/// A new chat's provisional title: the first line of its first prompt, bounded.
pub fn prompt_title(prompt: &str) -> Option<String> {
    let line = prompt.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut title: String = line.chars().take(PROMPT_TITLE_CHARS).collect();
    if line.chars().count() > PROMPT_TITLE_CHARS {
        title.push('…');
    }
    Some(title)
}

/// A new session's first title: an RCA run's whole rendered prompt, else the bounded first prompt
/// line.
fn initial_title(agent_type: &str, user_email: &str, prompt: &str) -> Option<String> {
    let rca_run =
        agent_type == RCA_AGENT_TYPE && crate::organization::is_system_service_account(user_email);
    if !rca_run {
        return prompt_title(prompt);
    }
    let prompt = prompt.trim();
    (!prompt.is_empty()).then(|| prompt.to_string())
}

/// The stable owner id for an authenticated email.
pub async fn resolve_owner(user_email: &str) -> Result<String, AdmitError> {
    match infra::table::users::get_id_by_email(user_email).await {
        Ok(Some(id)) => Ok(id),
        Ok(None) => Err(AdmitError::NotRegistered),
        Err(e) => {
            log::error!("[AI-CHAT] cannot resolve user id for {user_email}: {e}");
            Err(AdmitError::Unavailable(PERSISTENCE_UNAVAILABLE))
        }
    }
}

/// Admit one persisted turn under the chat's lease, as a new ownership epoch.
#[allow(clippy::too_many_arguments)]
pub async fn admit_turn(
    org_id: &str,
    session_id: Option<&str>,
    turn_id: Option<&str>,
    user_email: &str,
    agent_type: &str,
    prompt: &str,
    trace_id: &str,
    caps: TurnCaps,
) -> Result<AdmittedTurn, AdmitError> {
    admit_signed_in_turn(
        org_id, session_id, turn_id, user_email, None, agent_type, prompt, trace_id, caps,
    )
    .await
}

/// [`admit_turn`] for a turn a browser sign-in started; `auth_session_id` scopes its registration.
#[allow(clippy::too_many_arguments)]
pub async fn admit_signed_in_turn(
    org_id: &str,
    session_id: Option<&str>,
    turn_id: Option<&str>,
    user_email: &str,
    auth_session_id: Option<&str>,
    agent_type: &str,
    prompt: &str,
    trace_id: &str,
    caps: TurnCaps,
) -> Result<AdmittedTurn, AdmitError> {
    let Some(session_id) = session_id.and_then(normalize_uuid) else {
        return Err(AdmitError::InvalidSession(
            "A valid session id is required while chat persistence is enabled",
        ));
    };
    let session_id = session_id.as_str();
    let turn_id = match turn_id {
        Some(id) => normalize_uuid(id).ok_or(AdmitError::InvalidSession("Invalid turn id"))?,
        None => config::ider::uuid(),
    };
    let owner = resolve_owner(user_email).await?;
    // Another user's or a deleted chat is refused before anything is created or locked.
    let existing = ai_chat_sessions::get(org_id, session_id)
        .await
        .map_err(|e| {
            log::error!(
                "[AI-CHAT] [trace_id:{trace_id}] cannot admit a turn of {org_id}/{session_id}: {e}"
            );
            AdmitError::Unavailable(PERSISTENCE_UNAVAILABLE)
        })?;
    if let Some(row) = existing {
        check_turn_owner(&row, &owner, user_email, trace_id)?;
    }
    let lease = acquire_lease(org_id, session_id, trace_id).await?;
    let registration = match registry::register_capped(
        org_id,
        session_id,
        &turn_id,
        &owner,
        auth_session_id,
        caps,
    ) {
        Ok(registration) => registration,
        Err(scope) => {
            lease.release().await;
            config::metrics::AI_CHAT_TURN_RESULT_TOTAL
                .with_label_values(&[org_id, TURN_LIMIT])
                .inc();
            log::warn!(
                "[AI-CHAT] [trace_id:{trace_id}] {org_id}/{session_id} refused: {scope} \
                 active-turn limit reached"
            );
            return Err(AdmitError::TurnLimit(scope));
        }
    };
    let new_turn = NewTurn {
        org_id,
        session_id,
        turn_id: &turn_id,
        owner: &owner,
        user_email,
        agent_type,
        prompt,
        trace_id,
    };
    match admit_under_lease(&new_turn).await {
        Ok(row) => Ok(AdmittedTurn {
            row,
            owner,
            turn_id,
            lease,
            registration,
        }),
        Err(e) => {
            drop(registration);
            lease.release().await;
            Err(e)
        }
    }
}

/// Ends a turn that never started as `failed` with nothing stored, so its id may be resubmitted.
pub async fn abandon_turn(admitted: AdmittedTurn, error_code: &str) {
    let AdmittedTurn {
        row,
        turn_id,
        lease,
        registration,
        ..
    } = admitted;
    drop(registration);
    fail_turn(&row.org_id, &row.session_id, &turn_id, error_code).await;
    lease.release().await;
}

/// Points the agent request at the admitted turn; o2-ai forwards only events past `known_seq`.
pub fn apply_admission(request: &mut QueryRequest, admitted: &AdmittedTurn) {
    request.turn_id = Some(admitted.turn_id.clone());
    request.known_seq = Some(admitted.row.last_committed_seq);
    request.known_opencode_session_id = admitted.row.opencode_session_id.clone();
    request.session_epoch = Some(admitted.row.session_epoch);
}

/// Refuses a turn on another user's chat (the id is client-supplied) or on a deleted one.
fn check_turn_owner(
    row: &Model,
    owner: &str,
    user_email: &str,
    trace_id: &str,
) -> Result<(), AdmitError> {
    if row.user_id != owner {
        log::warn!(
            "[AI-CHAT] [trace_id:{trace_id}] {user_email} tried to continue session {} owned by \
             another user",
            row.session_id
        );
        return Err(AdmitError::NotFound("Unknown conversation"));
    }
    if row.status != STATUS_ACTIVE {
        return Err(AdmitError::NotFound("This conversation has been deleted"));
    }
    Ok(())
}

/// Records the turn and takes its epoch; runs under the lease, so the row read here is current.
async fn admit_under_lease(turn: &NewTurn<'_>) -> Result<Model, AdmitError> {
    let NewTurn {
        org_id,
        session_id,
        turn_id,
        owner,
        trace_id,
        ..
    } = *turn;
    let unavailable = |what: &str, e: &dyn std::fmt::Display| {
        log::error!("[AI-CHAT] [trace_id:{trace_id}] {what} {org_id}/{session_id}: {e}");
        AdmitError::Unavailable(PERSISTENCE_UNAVAILABLE)
    };
    let now = config::utils::time::now_micros();
    let row = ai_chat_sessions::get_or_create(
        org_id,
        session_id,
        owner,
        turn.user_email,
        turn.agent_type,
        now,
    )
    .await
    .map_err(|e| unavailable("cannot read/create the index row of", &e))?;
    check_turn_owner(&row, owner, turn.user_email, trace_id)?;
    match ai_chat_turns::admit(org_id, session_id, turn_id, row.last_committed_seq + 1, now).await {
        Ok(Admission::Admitted | Admission::Retried) => {}
        Ok(Admission::AlreadySubmitted) => return Err(AdmitError::AlreadySubmitted),
        Err(e) => return Err(unavailable(&format!("cannot record turn {turn_id} of"), &e)),
    }
    // Every admitted turn is a new epoch, so a writer of an earlier turn is fenced.
    let epoch = match ai_chat_sessions::bump_epoch(org_id, session_id, row.session_epoch, now).await
    {
        Ok(Some(epoch)) => epoch,
        outcome => {
            let reason = match outcome {
                Err(e) => e.to_string(),
                _ => "the epoch moved under the lease".to_string(),
            };
            fail_turn(org_id, session_id, turn_id, EPOCH_CONFLICT).await;
            return Err(unavailable("cannot start a new epoch of", &reason));
        }
    };
    if let Err(e) = ai_chat_sessions::begin_turn(org_id, session_id, turn_id, now).await {
        log::warn!("[AI-CHAT] cannot record the last turn of {session_id}: {e}");
    }
    let (typed, _) = crate::ai_chat::projection::split_attachment_blocks(turn.prompt);
    if !typed.is_empty()
        && let Err(e) = ai_chat_sessions::append_search_text(org_id, session_id, &typed).await
    {
        // Search misses this prompt; the title still matches.
        log::warn!("[AI-CHAT] cannot index the prompt of {session_id}: {e}");
    }
    if row.title_source.is_empty()
        && let Some(title) = initial_title(turn.agent_type, turn.user_email, turn.prompt)
        && let Err(e) = ai_chat_sessions::set_prompt_title(org_id, session_id, &title, now).await
    {
        // Cosmetic: the generated title replaces it shortly anyway.
        log::warn!("[AI-CHAT] cannot set the initial title of {session_id}: {e}");
    }
    Ok(Model {
        session_epoch: epoch,
        ..row
    })
}

async fn fail_turn(org_id: &str, session_id: &str, turn_id: &str, error_code: &str) {
    let now = config::utils::time::now_micros();
    if let Err(e) = ai_chat_turns::finish(
        org_id,
        session_id,
        turn_id,
        TURN_FAILED,
        Some(error_code),
        None,
        None,
        now,
    )
    .await
    {
        log::error!("[AI-CHAT] cannot release turn {turn_id} of {org_id}/{session_id}: {e}");
    }
}

async fn acquire_lease(
    org_id: &str,
    session_id: &str,
    trace_id: &str,
) -> Result<TurnLease, AdmitError> {
    match lease::acquire(
        org_id,
        session_id,
        get_o2_config().ai.chat_turn_lease_wait_secs,
    )
    .await
    {
        Ok(lease) => Ok(lease),
        Err(LeaseError::Busy) => {
            config::metrics::AI_CHAT_TURN_LEASE_CONFLICTS_TOTAL
                .with_label_values(&[org_id])
                .inc();
            config::metrics::AI_CHAT_TURN_RESULT_TOTAL
                .with_label_values(&[org_id, "busy"])
                .inc();
            Err(AdmitError::Busy)
        }
        Err(LeaseError::Backend(e)) => {
            log::error!(
                "[AI-CHAT] [trace_id:{trace_id}] turn lease unavailable for \
                 {org_id}/{session_id}: {e}"
            );
            Err(AdmitError::Unavailable(
                "Chat coordination is unavailable; please retry",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_titles_take_the_first_line_and_are_bounded() {
        assert_eq!(
            prompt_title("\n  why is p99 up?\nmore"),
            Some("why is p99 up?".into())
        );
        assert_eq!(prompt_title("   \n"), None);
        let long = "x".repeat(200);
        let title = prompt_title(&long).unwrap();
        assert_eq!(title.chars().count(), PROMPT_TITLE_CHARS + 1);
        assert!(title.ends_with('…'));
    }

    /// A turn id is a hyphenated UUID in either case; anything else is refused.
    #[test]
    fn only_hyphenated_uuids_are_session_ids() {
        assert!(is_uuid("0195a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"));
        assert_eq!(
            normalize_uuid("0195A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B").as_deref(),
            Some("0195a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
        );
        assert!(!is_uuid("0195a1b2c3d47e5f8a9b0c1d2e3f4a5b"));
        assert!(normalize_uuid("../etc").is_none());
    }

    /// Admits one turn of a new session under the lease and returns the stored session title.
    async fn admitted_title(agent_type: &str, user_email: &str, prompt: &str) -> String {
        let org_id = format!(
            "adm_{}",
            infra::table::rca_runs::new_run_id().to_lowercase()
        );
        let session_id = config::ider::uuid();
        let turn_id = config::ider::uuid();
        let turn = NewTurn {
            org_id: &org_id,
            session_id: &session_id,
            turn_id: &turn_id,
            owner: "owner-1",
            user_email,
            agent_type,
            prompt,
            trace_id: "trace",
        };
        admit_under_lease(&turn).await.expect("admitted");
        ai_chat_sessions::get(&org_id, &session_id)
            .await
            .unwrap()
            .expect("the session row exists")
            .title
    }

    /// An RCA run's session title is its whole rendered prompt, trimmed; any chat's is the bounded
    /// first line.
    #[tokio::test]
    async fn an_rca_session_is_titled_with_its_whole_prompt() {
        let _db = crate::alerts::rca_runs::tests::db().await;
        let prompt = format!(
            "  Analyze incident 2nV \"{}\" (6 alerts, P2). Trigger: new incident.\n",
            "checkout-api 5xx ".repeat(6)
        );
        assert!(prompt.trim().chars().count() > PROMPT_TITLE_CHARS);
        let agent = format!(
            "{}acme{}",
            config::meta::user::SRE_AGENT_EMAIL_PREFIX,
            config::meta::user::SRE_AGENT_EMAIL_SUFFIX
        );

        assert_eq!(
            admitted_title(RCA_AGENT_TYPE, &agent, &prompt).await,
            prompt.trim()
        );
        assert_eq!(
            admitted_title(RCA_AGENT_TYPE, "dana@acme.io", &prompt).await,
            prompt_title(&prompt).unwrap()
        );
        assert_eq!(
            admitted_title("o2-ai", &agent, &prompt).await,
            prompt_title(&prompt).unwrap()
        );
        assert_eq!(
            admitted_title("o2-ai", "dana@acme.io", "\n  why is p99 up?\nmore").await,
            "why is p99 up?"
        );
    }
}
