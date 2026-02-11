# Card Pattern

## Default Card
```vue
<q-card
  data-test="feature-card"
  flat
  bordered
>
  <q-card-section>
    <!-- Content -->
  </q-card-section>
</q-card>
```

## Card with Header
```vue
<q-card flat bordered data-test="feature-card">
  <q-card-section class="card-header">
    <div class="text-h6">{{ t('card.title') }}</div>
  </q-card-section>
  <q-separator />
  <q-card-section>
    <!-- Content -->
  </q-card-section>
</q-card>
```
