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

use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

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
use vector_enrichment::{Table, TableRegistry};
use vrl::compiler::{CompilationResult, TargetValueRef, VrlRuntime, runtime::Runtime};

type FnType = Arc<dyn Fn(&[ColumnarValue]) -> Result<ColumnarValue> + Sync + Send>;
pub type EnrichmentTable = (String, Box<dyn Table + Send + Sync>);

#[derive(Clone)]
pub struct PreparedQueryTransform {
    name: String,
    source: String,
    params: String,
    num_args: u8,
    enrichment_tables: Arc<Vec<EnrichmentTable>>,
}

impl PreparedQueryTransform {
    pub fn new(
        name: String,
        source: String,
        params: String,
        num_args: u8,
        enrichment_tables: Arc<Vec<EnrichmentTable>>,
    ) -> Self {
        Self {
            name,
            source,
            params,
            num_args,
            enrichment_tables,
        }
    }
}

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

pub fn get_all_transform(transforms: Vec<PreparedQueryTransform>) -> Result<Vec<ScalarUDF>> {
    transforms.into_iter().map(get_udf_vrl).collect()
}

fn get_udf_vrl(transform: PreparedQueryTransform) -> Result<ScalarUDF> {
    let local_func = transform.source.trim().to_owned();
    let local_fn_params = transform.params;
    let enrichment_tables = transform.enrichment_tables;

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
            match compile_vrl_function(&obj_str, &enrichment_tables) {
                Ok((program, registry)) => {
                    registry.finish_load();
                    let result = apply_vrl_fn(&mut runtime, program);
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

    Ok(create_user_df(
        transform.name.as_str(),
        transform.num_args,
        vrl_calc,
    ))
}

fn compile_vrl_function(
    source: &str,
    enrichment_tables: &[EnrichmentTable],
) -> Result<(vrl::compiler::Program, TableRegistry), std::io::Error> {
    if source.contains("get_env_var") {
        return Err(std::io::Error::other("get_env_var is not supported"));
    }

    let tables = enrichment_tables
        .iter()
        .map(|(name, table)| (name.clone(), table.clone()))
        .collect::<HashMap<_, _>>();
    let registry = TableRegistry::default();
    registry.load(tables);

    let mut functions = vrl::stdlib::all();
    functions.append(&mut vector_enrichment::vrl_functions());
    let mut config = vrl::compiler::CompileConfig::default();
    config.set_custom(registry.clone());

    match vrl::compiler::compile_with_external(
        source,
        &functions,
        &vrl::prelude::state::ExternalEnv::default(),
        config,
    ) {
        Ok(CompilationResult { program, .. }) => Ok((program, registry)),
        Err(error) => Err(std::io::Error::other(
            vrl::diagnostic::Formatter::new(source, error).to_string(),
        )),
    }
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

        let vrl_udf = get_udf_vrl(PreparedQueryTransform::new(
            "vrltest".to_string(),
            " . = parse_aws_vpc_flow_log!(.col1) \n .http_code=200 \n .".to_string(),
            "col1".to_string(),
            1,
            Arc::new(Vec::new()),
        ))
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
