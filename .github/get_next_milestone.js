const ORG = "openobserve";
const REPO = process.env.REPO || "openobserve";

const ver_regexp = new RegExp("[a-zA-Z]*([0-9]+\\.[0-9]+\\.[0-9]+)");

function get_lowest_milestone(ms1, ms2) {
  // the first index will be the first captured group
  let v1 = ver_regexp.exec(ms1.title)[1];
  let v2 = ver_regexp.exec(ms2.title)[1];

  let [v11, v12, v13] = v1.split(".").map((v) => parseInt(v));
  let [v21, v22, v23] = v2.split(".").map((v) => parseInt(v));

  // if the major version mismatch,
  // return one with lowest major version
  if (v11 != v21) {
    return v11 < v21 ? ms1 : ms2;
  }

  // if major match, but minor do not, return one with lowest minor
  if (v12 != v22) {
    return v12 < v22 ? ms1 : ms2;
  }

  // if both major and minor match, return
  // one with lowest patch number
  if (v13 != v23) {
    return v13 < v23 ? ms1 : ms2;
  }

  // default is first arg
  return ms1;
}

async function main() {
  const res = await fetch(
    `https://api.github.com/repos/${ORG}/${REPO}/milestones`
  );
  const body = await res.json();
  let milestones = [];
  body.forEach((ms) => {
    // always ignore backlog for auto labeling, and skip non-open milestones
    if (ms.title == "Backlog" || ms.state !== "open") {
      return;
    }

    milestones.push({
      title: ms.title,
      created_at: ms.created_at,
      due_on: ms.due_on,
    });
  });
  let lowest_milestone = milestones.reduce((prev, crr) =>
    get_lowest_milestone(prev, crr)
  );
  console.log(lowest_milestone.title);
}

main().then(() => {});
