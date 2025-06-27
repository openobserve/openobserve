// Copyright 2025 OpenObserve Inc.
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

use config::meta::destinations::{Template, TemplateType};

use crate::{
    common::{
        meta::{authz::Authz, organization::DEFAULT_ORG},
        utils::auth::{is_ofga_unsupported, remove_ownership, set_ownership},
    },
    service::db::{self, alerts::templates::TemplateError},
};

pub async fn save(
    name: &str,
    mut template: Template,
    create: bool,
) -> Result<Template, TemplateError> {
    if template.body.is_empty() {
        return Err(TemplateError::EmptyBody);
    }
    if !name.is_empty() {
        template.name = name.to_owned();
    }
    template.name = template.name.trim().to_string();
    if template.name.is_empty() {
        return Err(TemplateError::EmptyName);
    }
    // Don't allow the characters not supported by ofga
    if template.name.contains('/') || is_ofga_unsupported(&template.name) {
        return Err(TemplateError::InvalidName);
    }
    if let TemplateType::Email { title } = &template.template_type
        && title.is_empty()
    {
        return Err(TemplateError::EmptyTitle);
    }

    match db::alerts::templates::get(&template.org_id, &template.name).await {
        Ok(existing) => {
            if create {
                return Err(TemplateError::AlreadyExists);
            } else {
                template.org_id = existing.org_id; // since org can be default
            }
        }
        Err(_) => {
            if !create {
                return Err(TemplateError::NotFound);
            }
        }
    }

    template.is_default = template.org_id.eq(DEFAULT_ORG);
    let saved = db::alerts::templates::set(template).await?;
    if name.is_empty() {
        set_ownership(&saved.name, "templates", Authz::new(&saved.name)).await;
    }
    Ok(saved)
}

pub async fn get(org_id: &str, name: &str) -> Result<Template, TemplateError> {
    db::alerts::templates::get(org_id, name).await
}

pub async fn list(
    org_id: &str,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Template>, TemplateError> {
    Ok(db::alerts::templates::list(org_id)
        .await?
        .into_iter()
        .filter(|template| {
            permitted.is_none()
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("template:{}", template.name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("template:_all_{org_id}"))
        })
        .collect())
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), TemplateError> {
    db::alerts::templates::delete(org_id, name).await?;
    remove_ownership(org_id, "templates", Authz::new(name)).await;
    Ok(())
}
