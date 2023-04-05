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

export const getQueryParamsForDuration = (obj : any) =>  {
  let params : any = {};
  let tab = obj.tab;
  let period = obj.relative.period;
  let from = obj.absolute.date.from + " " + obj.absolute.startTime;
  let to = obj.absolute.date.to + " " + obj.absolute.endTime;

  if (tab === "relative") {
    const labelsToUnitMapping : any = {
      Minutes: "m",
      Hours: "h",
      Days: "d",
      Weeks: "w",
      Months: "M"
    }

    let periodValue = obj.relative.value;
    let periodLabel = period.label;
    let periodUnit = labelsToUnitMapping[periodLabel];

    if (periodLabel === "Minutes" && periodUnit === "m") {
      params['period'] = `${periodValue}${periodUnit}`;
    } else if (periodLabel === "Hours" && periodUnit === "h") {
      params['period'] = `${periodValue}${periodUnit}`;
    } else if (periodLabel === "Days" && periodUnit === "d") {
      params['period'] = `${periodValue}${periodUnit}`;
    } else if (periodLabel === "Weeks" && periodUnit === "w") {
      params['period'] = `${periodValue}${periodUnit}`;
    } else if (periodLabel === "Months" && periodUnit === "M") {
      params['period'] = `${periodValue}${periodUnit}`;
    }
  } else if (tab === "absolute") {
    let fromTime = new Date(from).getTime();
    let toTime = new Date(to).getTime();

    params['from'] = `${fromTime}`;
    params['to'] = `${toTime}`;
  }

  return params;
}

export const getDurationObjectFromParams = (params: any) => {
  let obj = {
    tab: "relative",
    relative: {
      period: { label: "Minutes", value: "Minutes" },
      value: 15,
    },
    absolute: {
      date: {
        from: new Date().toLocaleDateString("en-ZA"),
        to: new Date().toLocaleDateString("en-ZA"),
      },
      startTime: "00:00",
      endTime: "23:59",
    },
  };

  let period = params?.period?.match(/(\d+)([mhdwM])/);
  let from = params?.from?.match(/(\d+)/);
  let to = params?.to?.match(/(\d+)/);

  if (period) {
    let periodValue = period[1];
    let periodUnit = period[2];

    if (periodUnit === "m") {
      obj.relative.period = { label: "Minutes", value: "Minutes" };
    } else if (periodUnit === "h") {
      obj.relative.period = { label: "Hours", value: "Hours" };
    } else if (periodUnit === "d") {
      obj.relative.period = { label: "Days", value: "Days" };
    } else if (periodUnit === "w") {
      obj.relative.period = { label: "Weeks", value: "Weeks" };
    } else if (periodUnit === "M") {
      obj.relative.period = { label: "Months", value: "Months" };
    }

    obj.relative.value = parseInt(periodValue);
  } else if (from && to) {
    let fromTime = parseInt(from[1]);
    let toTime = parseInt(to[1]);

    obj.tab = "absolute";
    obj.absolute.date.from = new Date(fromTime).toLocaleDateString("en-ZA");
    obj.absolute.date.to = new Date(toTime).toLocaleDateString("en-ZA");

    const startTimeDateObj = new Date(fromTime);
    obj.absolute.startTime = `${startTimeDateObj.getHours().toString().padStart(2, '0')}:${startTimeDateObj.getMinutes().toString().padStart(2, '0')}`
    
    const toTimeDateObj = new Date(toTime);
    obj.absolute.endTime = `${toTimeDateObj.getHours().toString().padStart(2, '0')}:${toTimeDateObj.getMinutes().toString().padStart(2, '0')}`
  }

  return obj;
}
