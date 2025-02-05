//! Module that contains a client for performing authorization checks.

#[cfg(feature = "enterprise")]
mod enterprise;
#[cfg(test)]
mod mock;
#[cfg(not(feature = "enterprise"))]
mod not_enterprise;

#[cfg(feature = "enterprise")]
pub use enterprise::AuthorizationClient;
#[cfg(test)]
pub use mock::MockAuthorizationClient;
#[cfg(not(feature = "enterprise"))]
pub use not_enterprise::AuthorizationClient;
use tonic::async_trait;

use super::ObjectType;

/// Trait for a client used for performing authorization checks.
#[async_trait]
pub trait AuthorizationClientTrait: Clone + Send + Sync {
    /// Grants ownership of the object to the organization.
    async fn set_ownership(&self, org_id: &str, obj_type: ObjectType, obj_id: &str);

    /// Grants ownership of the object to the organization if ownership has not been granted yet.
    async fn set_ownership_if_not_exists(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
    ) -> bool;

    /// Sets the parent of the object.
    async fn set_parent(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
        parent_type: ObjectType,
        parent_id: &str,
    );

    /// Grants ownership of the object to the organization and sets the parent of the object.
    async fn set_ownership_and_parent(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
        parent_type: ObjectType,
        parent_id: &str,
    );

    /// Removes ownership of the object from the organization.
    async fn remove_ownership(&self, org_id: &str, obj_type: ObjectType, obj_id: &str);

    /// Removes the object's parent.
    async fn remove_parent(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
        parent_type: ObjectType,
        parent_id: &str,
    );

    /// Removes ownership of the object from the organization and removes the object's parent.
    async fn remove_ownership_and_parent(
        &self,
        org_id: &str,
        obj_type: ObjectType,
        obj_id: &str,
        parent_type: ObjectType,
        parent_id: &str,
    );

    /// Deletes the user with the given email from the organization.
    async fn delete_user_from_org(&self, org_id: &str, user_email: &str, user_role: &str);

    /// Deletes the service account with the given email from the organization.
    async fn delete_service_account_from_org(&self, org_id: &str, account_email: &str);

    async fn update_user_role(
        &self,
        org_id: &str,
        user_email: &str,
        old_role_name: &str,
        new_role_name: &str,
    );

    async fn get_org_creation_tuples(
        &self,
        org_id: &str,
        tuples_to_add: &mut Vec<TupleKey>,
        types: Vec<&str>,
        non_owing_org: Vec<&str>,
    );

    async fn update_tuples(
        &self,
        mut write_tuples: Vec<TupleKey>,
        mut delete_tuples: Vec<TupleKeyWithoutCondition>,
    ) -> Result<(), anyhow::Error>;
}
