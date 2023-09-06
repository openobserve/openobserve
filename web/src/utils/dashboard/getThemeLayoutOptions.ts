// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

export const getThemeLayoutOptions = (store: any) => ({
  paper_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
  plot_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
  font: {
    size: 12,
    color: store.state.theme === "dark" ? "#fff" : "#181a1b",
  },
});
