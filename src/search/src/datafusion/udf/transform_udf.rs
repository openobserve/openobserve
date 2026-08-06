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

use std::{collections::BTreeMap, sync::Arc};

use config::utils::json;
use datafusion::{
    arrow::{
        array::{Array, ArrayRef, StringArray},
        datatypes::DataType,
    },
    common::cast::as_string_array,
    error::Result,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
};
use transform::{QUERY_FUNCTIONS, compile_vrl_function};
use vector_enrichment::TableRegistry;
use vrl::compiler::{TargetValueRef, VrlRuntime, runtime::Runtime};

type FnType = Arc<dyn Fn(&[ColumnarValue]) -> Result<ColumnarValue> + Sync + Send>;

fn create_user_df(fn_name: &str, num_args: u8, pow_scalar: FnType) -> ScalarUDF {
    let mut input_vec = vec![];
    for _i in 0..num_args {
        input_vec.push(DataType::Utf8);
    }
    create_udf(
        fn_name,
        input_vec,
        DataType::Utf8,
        Volatility::Immutable,
        pow_scalar,
    )
}

pub fn get_all_transform(org_id: &str) -> Result<Vec<ScalarUDF>> {
    // Keys are "{org_id}/{fn_name}" (see get_transforms in pipeline execution),
    // so the org must be matched as a PREFIX up to the separator.
    //
    // This previously used `key().contains(org_id)`, a substring match that
    // collided three ways: an org whose id prefixed another's ("acme" matching
    // "acme-prod/..."), an org whose id appeared mid-key ("prod" matching
    // "acme-prod/..."), and — because the match was not confined to the org
    // segment at all — an org whose id appeared in any FUNCTION name anywhere
    // ("parse" matching "otherorg/parse_json"). The result was another
    // tenant's VRL functions being registered into this org's query context,
    // and same-named functions from two orgs shadowing each other in
    // DashMap-iteration order. Mirrors get_all_transform_keys, which was
    // already correct.
    let org_prefix = format!("{org_id}/");
    let mut udf_list = Vec::new();
    for transform in QUERY_FUNCTIONS.iter() {
        if transform.key().starts_with(&org_prefix) {
            udf_list.push(get_udf_vrl(
                transform.name.clone(),
                transform.function.as_str(),
                &transform.params,
                transform.num_args,
                org_id,
            )?);
        }
    }
    Ok(udf_list)
}

fn get_udf_vrl(
    fn_name: String,
    source: &str,
    params: &str,
    num_args: u8,
    org_id: &str,
) -> Result<ScalarUDF> {
    let local_func = source.trim().to_owned();
    let local_fn_params = params.to_owned();
    let local_org_id = org_id.to_owned();

    let vrl_calc = Arc::new(move |args: &[ColumnarValue]| {
        let args = ColumnarValue::values_to_arrays(args)?;
        let len = args[0].len();
        let in_params = local_fn_params.split(',').collect::<Vec<&str>>();
        let mut res_data_vec = vec![];
        let mut runtime = Runtime::new(vrl::prelude::state::RuntimeState::default());

        for i in 0..len {
            let mut obj_str = String::from("");
            for (j, arg) in args.iter().enumerate() {
                let col = as_string_array(&arg)?;
                obj_str.push_str(&format!(
                    " .{} = \"{}\" \n",
                    in_params.get(j).unwrap(),
                    col.value(i).replace("\"", "\\\"")
                ));
            }
            obj_str.push_str(&format!(" \n {}", local_func));
            match compile_vrl_function(&obj_str, &local_org_id) {
                Ok(result) => {
                    let registry = result.config.get_custom::<TableRegistry>().unwrap();
                    registry.finish_load();
                    let result = apply_vrl_fn(&mut runtime, result.program);
                    if result != json::Value::Null {
                        res_data_vec.insert(i, json::get_string_value(&result));
                    } else {
                        res_data_vec.insert(i, "".to_string());
                    }
                }
                Err(e) => {
                    log::error!("Error in vrl_transform UDF: {e}");
                    res_data_vec.insert(i, "".to_string());
                }
            }
        }
        let result = StringArray::from(res_data_vec);
        Ok(ColumnarValue::from(Arc::new(result) as ArrayRef))
    });

    Ok(create_user_df(fn_name.as_str(), num_args, vrl_calc))
}

pub fn apply_vrl_fn(runtime: &mut Runtime, program: vrl::compiler::Program) -> json::Value {
    let obj_str = String::from("");

    let mut metadata = vrl::value::Value::from(BTreeMap::new());
    let mut target = TargetValueRef {
        value: &mut vrl::value::Value::from(obj_str),
        metadata: &mut metadata,
        secrets: &mut vrl::value::Secrets::new(),
    };
    let timezone = vrl::compiler::TimeZone::Local;
    let result = match VrlRuntime::default() {
        VrlRuntime::Ast => runtime.resolve(&mut target, &program, &timezone),
    };
    match result {
        Ok(res) => res.try_into().unwrap(),
        Err(err) => {
            log::error!("vrl_transform execute error: {err}");
            json::Value::Null
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::function::Transform;

    fn seed(key: &str, name: &str) {
        QUERY_FUNCTIONS.insert(
            key.to_string(),
            Transform {
                function: ".".to_string(),
                name: name.to_string(),
                params: "row".to_string(),
                num_args: 1,
                trans_type: Some(0),
                streams: None,
            },
        );
    }

    #[test]
    fn get_all_transform_matches_the_org_prefix_not_a_substring() {
        seed("acme/acme_fn", "acme_fn");
        seed("acme-prod/prod_fn", "prod_fn");
        seed("otherorg/parse_json", "parse_json");

        let names = |org: &str| -> Vec<String> {
            get_all_transform(org)
                .unwrap()
                .iter()
                .map(|u| u.name().to_string())
                .collect()
        };

        let acme = names("acme");
        assert!(
            acme.contains(&"acme_fn".to_string()),
            "own transform missing"
        );
        assert!(
            !acme.contains(&"prod_fn".to_string()),
            "org-prefix collision: acme must not see acme-prod's transform"
        );

        let prod = names("acme-prod");
        assert!(prod.contains(&"prod_fn".to_string()));
        assert!(!prod.contains(&"acme_fn".to_string()));

        // The org id must not match inside a FUNCTION name either.
        assert!(
            names("parse").is_empty(),
            "function-name collision: an org named `parse` must not see otherorg/parse_json"
        );

        // A bare org id that is a prefix without the separator must not match.
        assert!(names("acm").is_empty(), "partial org id must not match");

        QUERY_FUNCTIONS.remove("acme/acme_fn");
        QUERY_FUNCTIONS.remove("acme-prod/prod_fn");
        QUERY_FUNCTIONS.remove("otherorg/parse_json");
    }

    use datafusion::{
        arrow::{
            array::Int64Array,
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        datasource::MemTable,
        prelude::SessionContext,
    };

    use super::*;

    #[tokio::test]
    async fn vrl_udf_test() {
        let sql = "select pod_id, vrltest(log) from t";

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("pod_id", DataType::Int64, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![
                "2 123456789010 eni-1235b8ca123456789 - - - - - - - 1431280876 1431280934 - NODATA",
                "2 123456789010 eni-1235b8ca123456789 - - - - - - - 1431280876 1431280934 - NODATA",
                "2 123456789010 eni-1235b8ca123456789 - - - - - - - 1431280876 1431280934 - NODATA",
                "2 123456789010 eni-1235b8ca123456789 - - - - - - - 1431280876 1431280934 - NODATA",
            ])),
                Arc::new(Int64Array::from(vec![1, 2, 1, 2])),
            ],
        )
        .unwrap();

        let vrl_udf = get_udf_vrl(
            "vrltest".to_string(),
            " . = parse_aws_vpc_flow_log!(.col1) \n .http_code=200 \n .",
            "col1",
            1,
            "org1",
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark
        // SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(vrl_udf.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        df.clone().show().await.unwrap();
        df.schema().fields().iter().for_each(|f| {
            println!("field: {f:?}");
        });
        let result = df.collect().await.unwrap();
        let count = result.iter().map(|batch| batch.num_rows()).sum::<usize>();
        assert_eq!(count, 4);
    }
}
