use config::meta::annotations::AnnotationObj;
use infra::table;


pub async fn create_annotations(
    org_id: &str,
    annotations: AnnotationObj,
) -> Result<(), anyhow::Error> {
    table::annotations::add_many(org_id, annotations).await?;  
    Ok(())
}