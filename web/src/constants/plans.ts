// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License. 

const Plans = [
  {
    id: 1,
    icon: "",
    for: "individuals",
    type: "basic",
    description:
      "Lorem ipsum dolor sit amet doloroli sitiol conse ctetur adipiscing elit.",
    price: "Free",
    duration: "1 Week",
    included: {
      rule1: "1 User",
      rule2: "500 Ingestion (GB)",
      rule3: "7 Retention (Days)",
      rule4: "2000 Query Volume (GB)",
    },
    basic: true,
    pro: false,
    subscribed: "Subscribed",
    getStarted: "Get started",
    color: "secondary",
  },
  {
    id: 2,
    icon: "",
    for: "startups",
    type: "pro",
    description:
      "Lorem ipsum dolor sit amet doloroli sitiol conse ctetur adipiscing elit.",
    price: "$199",
    duration: "monthly",
    included: {
      rule1: "1 Free ( $25 / per user)",
      rule2: "500 Ingestion ($0.30 /GB)",
      rule3: "15 Retention (Days)",
      rule4: "2000 Fee ( $5/1TB) Query Volume (GB)",
    },
    basic: false,
    pro: true,
    subscribed: "Subscribed",
    getStarted: "Get started",
    color: "primary",
  },
];

export default Plans;
