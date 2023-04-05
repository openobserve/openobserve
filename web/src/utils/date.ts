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

// Parses the duration string and returns the number is seconds
export const parseDuration = (durationString: string) => {
  const regex = /^(\d+)([smhdwMy])?$/;
  const match = durationString.match(regex);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    if (unit === "s") {
      return value;
    } else if (unit === "m") {
      return value * 60;
    } else if (unit === "h") {
      return value * 3600;
    } else if (unit === "d") {
      return value * 86400;
    } else if (unit === "w") {
      return value * 604800;
    } else if (unit === "M") {
      return value * 2592000;
    } else if (unit === "y") {
      return value * 31536000;
    } else {
      return value;
    }
  } else {
    return 0;
  }
};

export const generateDurationLabel = (seconds: number) => {
  const units = [
    { label: "s", value: 1 },
    { label: "m", value: 60 },
    { label: "h", value: 3600 },
    { label: "d", value: 86400 },
    { label: "w", value: 604800 },
    { label: "M", value: 2592000 },
    { label: "y", value: 31536000 },
  ];

  let duration = seconds;
  let label = "";

  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];

    if (duration >= unit.value) {
      const unitDuration = Math.floor(duration / unit.value);
      const remainingDuration = duration % unit.value;

      if (remainingDuration === 0) {
        label = `${unitDuration}${unit.label}`;
        break;
      } else {
        label = `${duration}s`;
        break;
      }
    }
  }

  if (label === "") {
    label = `${duration}s`;
  }

  return label;
};
