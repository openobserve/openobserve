export default [
  {
    name: "alert1",
    stream_type: "logs",
    stream_name: "default",
    is_real_time: false,
    query_condition: {
      conditions: [
        {
          column: "kubernetes_container_image",
          operator: "=",
          value: "abc",
          id: "67781bcb-e3d1-436b-83a5-2c27f15c6dc8",
        },
      ],
      sql: "select * from 'default' where kubernetes_container_image = 'abc'",
      promql: null,
      type: "sql",
    },
    trigger_condition: {
      period: 10,
      operator: "=",
      threshold: 3,
      silence: 10,
      tolerance: 0,
    },
    destinations: ["slack"],
    enabled: true,
    description: "adsadsad",
    context_attributes: {},
  },
  {
    name: "alert2",
    stream_type: "logs",
    stream_name: "default",
    is_real_time: false,
    query_condition: {
      conditions: [
        {
          column: "kubernetes_container_image",
          operator: "=",
          value: "abc",
          id: "67781bcb-e3d1-436b-83a5-2c27f15c6dc8",
        },
      ],
      sql: "select * from 'default' where kubernetes_container_image = 'abc'",
      promql: null,
      type: "custom",
    },
    trigger_condition: {
      period: 10,
      operator: "=",
      threshold: 3,
      silence: 10,
      tolerance: 0,
    },
    destinations: ["slack"],
    enabled: true,
    description: "adsadsad",
    context_attributes: {},
  },
];
