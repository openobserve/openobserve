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
    price: "Free",
    duration: "Month",
    included: {
      rule1: "200GB Ingestion",
      rule2: "200GB Query Volume",
      rule3: "30Days Retention",
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
    price: "$1000 or 10% of monthly spend, whichever is greater",
    duration: "monthly",
    included: {
      rule1: "Developer Plan Features",
      rule2: "Additional Ingestion ($0.50/GB)",
      rule3: "Additional Query Volume ($5/GB)",
    },
    basic: false,
    pro: true,
    subscribed: "Subscribed",
    getStarted: "Get started",
    color: "primary",
  },
];

export default Plans;
