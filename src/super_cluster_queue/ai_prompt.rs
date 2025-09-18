// Copyright 2025 Zinc Labs Inc.
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

use config::meta::ai::AIPrompt;
use infra::{errors::Result, table};
use o2_enterprise::enterprise::super_cluster::queue::{AiPromptMessage, Message, MessageType};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::AiPromptsPut => {
            let msg = msg.try_into()?;
            process_msg(msg).await?;
        }
        _ => {
            // Try to process the message as an old event for the meta table for backward
            // compatability. This logic can be removed after all logic reading and writing alerts
            // to the meta table is removed from the application.
            super::meta::process(msg).await?;
        }
    }

    Ok(())
}

pub(crate) async fn process_msg(msg: AiPromptMessage) -> Result<()> {
    match msg {
        AiPromptMessage::Update { content } => {
            // Check if the prompt exists in the DB, if it does, return early
            if table::system_prompts::get(config::meta::ai::PromptType::User)
                .await?
                .is_some()
            {
                return Ok(());
            }

            let prompt = AIPrompt::user(content);

            // Add to database
            table::system_prompts::add(&prompt).await?;

            // Emit cluster coordinator event to notify nodes in current cluster
            infra::coordinator::ai_prompts::emit_put_event().await?;

            log::info!("[SUPER_CLUSTER:AI_PROMPT] Created system prompt");
        }
        AiPromptMessage::Rollback => {
            // Rollback to default system prompt
            table::system_prompts::remove("", config::meta::ai::PromptType::User).await?;

            // Emit cluster coordinator event to notify nodes in current cluster
            infra::coordinator::ai_prompts::emit_rollback_event().await?;
        }
    };
    Ok(())
}
