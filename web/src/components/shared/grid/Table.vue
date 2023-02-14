<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

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
