<template>
  <div>
    <div>
      <div class="row items-center no-wrap">
        <div class="error_type">Reference Error</div>
        <div class="text-grey-8 error_description q-pl-sm">
          Proxy.updateDashboardList(assets/Dashboards)
        </div>
      </div>
      <div class="error_message">store is not defined</div>
      <div class="error_time row items-center q-mt-xs">
        <q-icon name="schedule" size="14px" />
        <span class="q-pl-xs">20min old</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.error_type {
  font-size: 16px;
  color: $info;
}

.error_description {
  font-size: 14px;
}

.error_message {
  font-size: 14px;
}

.error_time {
  font-size: 12px;
}
</style>
