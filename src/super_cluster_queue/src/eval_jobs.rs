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

use infra::{
    errors::{Error, Result},
    table::online_eval_jobs,
};
use o2_enterprise::enterprise::super_cluster::queue::{EvalJobMessage, Message, MessageType};
use openobserve_core::service::llm_evaluations::eval_jobs::reconciler;

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::EvalJobPut => {
            let EvalJobMessage::Put { mut job } = msg.try_into()?;
            if online_eval_jobs::exists(&job.id).await? {
                online_eval_jobs::update(&job).await?;
            } else {
                online_eval_jobs::add(&job).await?;
            }

            let pipeline_id = reconciler::reconcile(&job)
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
            if job.pipeline_id != pipeline_id {
                job.pipeline_id = pipeline_id;
                online_eval_jobs::update(&job).await?;
            }
        }
        MessageType::EvalJobDelete => {
            let (org_id, job_id) = parse_job_key(&msg.key)?;
            if let Some(job) = online_eval_jobs::get_by_org(&job_id, &org_id).await? {
                reconciler::tear_down(&job)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
                online_eval_jobs::delete(&job_id).await?;
            }
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:EVAL_JOB] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

fn parse_job_key(key: &str) -> Result<(String, String)> {
    let key_columns: Vec<&str> = key.split('/').collect();
    if key_columns.len() != 5
        || key_columns[1] != "eval"
        || key_columns[2] != "jobs"
        || key_columns[3].is_empty()
        || key_columns[4].is_empty()
    {
        return Err(Error::Message("Invalid eval job key".to_string()));
    }
    Ok((key_columns[3].to_string(), key_columns[4].to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_job_key_valid() {
        assert_eq!(
            parse_job_key("/eval/jobs/org-1/job-1").unwrap(),
            ("org-1".to_string(), "job-1".to_string())
        );
    }

    #[test]
    fn test_parse_job_key_invalid() {
        assert!(parse_job_key("/eval/jobs/org-1/").is_err());
        assert!(parse_job_key("/eval/jobs/org-1/job-1/extra").is_err());
        assert!(parse_job_key("/eval/providers/job-1").is_err());
    }
}
