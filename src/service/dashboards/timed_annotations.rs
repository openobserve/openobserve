use config::meta::timed_annotations::AnnotationObj;
use infra::table;

pub async fn create_annotations(
    org_id: &str,
    annotations: AnnotationObj,
) -> Result<(), anyhow::Error> {
    Ok(())
}
