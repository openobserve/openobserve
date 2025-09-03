# Creating Migration Entity

cargo install sea-orm-cli@1.1.0

sea-orm-cli migrate generate NAME_OF_MIGRATION

For example:

```
sea-orm-cli migrate generate create_new_table
```

It will generate the new job

```
Generating new migration...
Creating migration file `./migration/m20250822_093713_create_new_table.rs`
Adding migration `m20250822_093713_create_new_table` to `./migration/mod.rs`
```
