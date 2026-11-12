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

//! OpenAPI schemas written by hand to match the hand-written PromQL serializers in `value.rs`.

use std::borrow::Cow;

use utoipa::{
    PartialSchema, ToSchema,
    openapi::{
        RefOr,
        schema::{AnyOfBuilder, ArrayBuilder, ArrayItems, ObjectBuilder, Schema, Type},
    },
};

/// The 200 body of instant and range queries: `ApiFuncResponse::Success` around a `QueryResult`.
pub struct QueryResponseSchema;

impl PartialSchema for QueryResponseSchema {
    fn schema() -> RefOr<Schema> {
        let result = ObjectBuilder::new()
            .schema_type(Type::Object)
            .property(
                "resultType",
                ObjectBuilder::new()
                    .schema_type(Type::String)
                    .enum_values(Some(["vector", "matrix", "scalar", "string"])),
            )
            .required("resultType")
            .property("result", value())
            .required("result");
        success(result.into())
    }
}

impl ToSchema for QueryResponseSchema {
    fn name() -> Cow<'static, str> {
        Cow::Borrowed("PrometheusQueryResponse")
    }
}

/// The 200 body of exemplar queries: `ApiFuncResponse::Success` around the bare `value::Value`.
pub struct ExemplarsResponseSchema;

impl PartialSchema for ExemplarsResponseSchema {
    fn schema() -> RefOr<Schema> {
        success(value())
    }
}

impl ToSchema for ExemplarsResponseSchema {
    fn name() -> Cow<'static, str> {
        Cow::Borrowed("PrometheusExemplarsResponse")
    }
}

fn success(data: RefOr<Schema>) -> RefOr<Schema> {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .property(
            "status",
            ObjectBuilder::new()
                .schema_type(Type::String)
                .enum_values(Some(["success"])),
        )
        .required("status")
        .property("data", data)
        .required("data")
        .property("warnings", ArrayBuilder::new().items(typed(Type::String)))
        .property("trace_id", typed(Type::String))
        .into()
}

// value::Value is untagged, so its alternatives are the variants' wire forms; None is null.
fn value() -> RefOr<Schema> {
    AnyOfBuilder::new()
        .item(instant())
        .item(series())
        .item(ArrayBuilder::new().items(instant()))
        .item(ArrayBuilder::new().items(series()))
        .item(sample())
        .item(typed(Type::Number))
        .item(typed(Type::String))
        .item(typed(Type::Null))
        .into()
}

fn instant() -> ObjectBuilder {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .property("metric", labels())
        .required("metric")
        .property("value", sample())
        .required("value")
}

// A RangeValue carries its samples, or its exemplars when the query asked for them.
fn series() -> AnyOfBuilder {
    let samples = ObjectBuilder::new()
        .schema_type(Type::Object)
        .property("metric", labels())
        .required("metric")
        .property("values", ArrayBuilder::new().items(sample()))
        .required("values");
    let exemplar = ObjectBuilder::new()
        .schema_type(Type::Object)
        .property("timestamp", typed(Type::Number))
        .required("timestamp")
        .property("value", typed(Type::String))
        .required("value")
        .property("labels", labels())
        .required("labels");
    let exemplars = ObjectBuilder::new()
        .schema_type(Type::Object)
        .property("seriesLabels", labels())
        .required("seriesLabels")
        .property("exemplars", ArrayBuilder::new().items(exemplar))
        .required("exemplars");
    AnyOfBuilder::new().item(samples).item(exemplars)
}

// Sample serializes as [unix seconds, value as a string], the Prometheus pair.
fn sample() -> ArrayBuilder {
    ArrayBuilder::new()
        .prefix_items([typed(Type::Number), typed(Type::String)])
        .items(ArrayItems::False)
        .min_items(Some(2))
        .max_items(Some(2))
}

fn labels() -> ObjectBuilder {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(typed(Type::String)))
}

fn typed(schema_type: Type) -> ObjectBuilder {
    ObjectBuilder::new().schema_type(schema_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn components_are_named_for_the_spec() {
        assert_eq!(QueryResponseSchema::name(), "PrometheusQueryResponse");
        assert_eq!(
            ExemplarsResponseSchema::name(),
            "PrometheusExemplarsResponse"
        );
    }

    #[test]
    fn a_sample_is_a_closed_pair() {
        let sample = serde_json::to_value(Schema::from(sample())).unwrap();
        assert_eq!(sample["prefixItems"].as_array().map(Vec::len), Some(2));
        assert_eq!(sample["items"], serde_json::json!(false));
    }
}
