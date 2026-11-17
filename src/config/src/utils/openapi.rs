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

use utoipa::openapi::{
    RefOr,
    schema::{AnyOfBuilder, Schema},
};

/// Declares `$name` as a component whose schema is `$variants`' untagged-enum schema as `anyOf`.
#[macro_export]
macro_rules! any_of_schema {
    ($name:ident, $variants:ty) => {
        struct $name;

        impl utoipa::PartialSchema for $name {
            fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
                $crate::utils::openapi::any_of(<$variants as utoipa::PartialSchema>::schema())
            }
        }

        impl utoipa::ToSchema for $name {
            fn schemas(
                schemas: &mut Vec<(
                    String,
                    utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>,
                )>,
            ) {
                <$variants as utoipa::ToSchema>::schemas(schemas);
            }
        }
    };
}

pub fn any_of(schema: RefOr<Schema>) -> RefOr<Schema> {
    let RefOr::T(Schema::OneOf(one_of)) = schema else {
        return schema;
    };
    let any_of = one_of
        .items
        .into_iter()
        .fold(AnyOfBuilder::new(), |builder, item| builder.item(item))
        .description(one_of.description)
        .build();
    RefOr::T(Schema::AnyOf(any_of))
}

#[cfg(test)]
mod tests {
    use utoipa::{
        PartialSchema,
        openapi::schema::{ObjectBuilder, OneOfBuilder},
    };

    use super::*;

    #[derive(serde::Serialize, utoipa::ToSchema)]
    #[serde(untagged)]
    #[allow(dead_code)]
    enum Pair {
        Text(String),
        Number(i64),
    }

    crate::any_of_schema!(PairAnswer, Pair);

    #[test]
    fn a_one_of_becomes_an_any_of_with_the_same_items() {
        let one_of = OneOfBuilder::new()
            .item(ObjectBuilder::new().build())
            .item(ObjectBuilder::new().build())
            .description(Some("either"))
            .build();
        let RefOr::T(Schema::AnyOf(any_of)) = any_of(RefOr::T(Schema::OneOf(one_of))) else {
            panic!("expected anyOf");
        };
        assert_eq!(any_of.items.len(), 2);
        assert_eq!(any_of.description.as_deref(), Some("either"));
    }

    #[test]
    fn other_schemas_pass_through() {
        let object = RefOr::T(Schema::Object(ObjectBuilder::new().build()));
        assert!(matches!(any_of(object), RefOr::T(Schema::Object(_))));
    }

    #[test]
    fn the_macro_publishes_the_variants_as_any_of_under_its_own_name() {
        assert_eq!(<PairAnswer as utoipa::ToSchema>::name(), "PairAnswer");
        let RefOr::T(Schema::AnyOf(any_of)) = PairAnswer::schema() else {
            panic!("expected anyOf");
        };
        assert_eq!(any_of.items.len(), 2);
    }
}
