export const ToString = (o: any) => {
  if (!o) {
    return "";
  }
  if (typeof o == "string") {
    return o;
  } else if (Array.isArray(o)) {
    let tmp = "";
    for (let i = 0; i < o.length; i++) {
      tmp += (tmp === "" ? "" : ", ") + ToString(o[i]);
    }
    return `[${tmp}]`;
  } else if (typeof o == "object") {
    let tmp = "";
    for (const key in o) {
      tmp += (tmp === "" ? "" : ", ") + `"${key}":` + ToString(o[key]);
    }
    return `{${tmp}}`;
  } else {
    return o;
  }
};

export const byString = (o: any, s: string) => {
  if (s == undefined) {
    return "";
  }
  if (s in o) {
    return ToString(o[s]);
  }
  s = s.replace(/\[(\w+)\]/g, ".$1"); // convert indexes to properties
  s = s.replace(/^\./, ""); // strip a leading dot
  let a = s.split(".");

  // eg.1, o = {"a1": {"b1": "1234", "b2": "1", "b3": {"c1":"12", "c2":"22"}}, "a2":"334"}, s = "a1.b3.c2"
  // eg.2, o = {"a1.b1": "1234", "a1":"233", "a2":"334"}, s = "a1.b1"
  // eg.3, o = {"a1.b1": {"c1": "123"}, "a1":"233", "a2":"334"}, s = "a1.b1.c1"
  // eg.4, o = {"a1": [{"b1":"12", "b2":"222"}], "a2":"334"}, s = "a1"
  for (let i = 0, n = a.length; i < n; ++i) {
    let flag = false;
    for (let j = n; j > i; j--) {
      // Priority matching (longest)
      let key = a.slice(i, j).join(".");
      if (typeof o == "object" && key in o) {
        o = o[key];
        flag = true;
        break;
      }
    }

    if (flag == false) {
      o=""
    }
  }
  return ToString(o);
};

export const deepKeys = (o: any) => {
  if (!(o instanceof Object)) {
    return [];
  }
  let results = [];
  let keys = Object.keys(o);
  for (var i in keys) {
    if (o[keys[i]] == undefined || o[keys[i]].length) {
      results.push(keys[i]);
    } else {
      let subKeys = deepKeys(o[keys[i]]);
      if (subKeys.length > 0) {
        subKeys.forEach((key) => {
          results.push(keys[i] + "." + key);
        });
      } else {
        results.push(keys[i]);
      }
    }
  }
  return results;
};
