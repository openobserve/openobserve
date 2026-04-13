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

use infra::errors::Result;
use o2_enterprise::enterprise::super_cluster::queue::{EvalTemplateMessage, Message};

use crate::common::{meta::authz::Authz, utils::auth::set_ownership};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let eval_msg: EvalTemplateMessage = msg.try_into()?;
    match eval_msg {
        EvalTemplateMessage::Put { template } => {
            infra::table::eval_templates::add(&template).await?;
            set_ownership(&template.org_id, "eval_templates", Authz::new(&template.id)).await;
            log::debug!(
                "[SUPER_CLUSTER:EVAL_TEMPLATE] Added eval template: {}",
                template.id
            );
        }
        EvalTemplateMessage::Update { template } => {
            infra::table::eval_templates::update(&template).await?;
            log::debug!(
                "[SUPER_CLUSTER:EVAL_TEMPLATE] Updated eval template: {}",
                template.id
            );
        }
        EvalTemplateMessage::Delete { id } => {
            infra::table::eval_templates::delete(&id).await?;
            log::debug!(
                "[SUPER_CLUSTER:EVAL_TEMPLATE] Deleted eval template: {}",
                id
            );
        }
    }
    Ok(())
}
