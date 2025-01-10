use config::meta::annotations::Annotations;
use infra::table;


pub async fn create_annotations(
    org_id: &str,
    annotations: Annotations,
) -> Result<(), anyhow::Error> {
    table::annotations::add_many(annotations).await  
}