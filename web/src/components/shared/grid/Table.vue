<q-table
  :title="t('ticket.header')"
  :rows="tickets"
  row-key="id"
  :pagination="pagination"
  :filter="filterQuery"
  :filter-method="filterData"
  @row-click="editTicket"
>
    <template #top-right>
    <q-input
        v-model="filterQuery"
        filled
        borderless
        dense
        :placeholder="t('ticket.search')"
    >
        <template #append>
        <q-icon name="search" class="cursor-pointer" />
        </template>
    </q-input>
    <q-btn
        class="q-ml-sm"
        color="primary"
        icon="add"
        :label="t(`ticket.add`)"
        @click="addTicket"
    />
    </template>

    <template v-slot:body-cell-#="props">
    <q-td :props="props" width="80" @click="editTicket(props)">
        {{ props.value }}
    </q-td>
    </template>
</q-table>
