use infra::{
    db::{connect_to_orm, ORM_CLIENT},
    table::entity::alerts,
};
use o2_enterprise::enterprise::{
    common::infra::config::get_config as get_o2_config,
    openfga::{add_init_ofga_tuples, authorizer::authz::get_ownership_tuple},
};
use sea_orm::{EntityTrait, PaginatorTrait};

/// Generates a neww ID in OpenFGA for each alert using the alert's KSUID.
pub async fn run() -> Result<(), anyhow::Error> {
    if !get_o2_config().openfga.enabled {
        return Ok(());
    }
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let mut pages = alerts::Entity::find().paginate(conn, 100);
    while let Some(alerts) = pages.fetch_and_next().await? {
        let mut tuples = vec![];
        for a in alerts {
            get_ownership_tuple(&a.org, "alerts", &a.id, &mut tuples);
        }
        add_init_ofga_tuples(tuples).await;
    }

    o2_enterprise::enterprise::openfga::authorizer::authz::init_open_fga().await;
    let _ = crate::common::infra::ofga::init().await;
    Ok(())
}
