import { expect, it } from "vitest";
import { selectSyntheticsFolder } from "./selectFolder";

it.each([
  { folders: ["team", "default"], url: undefined, expected: "default" },
  { folders: ["team", "other"], url: undefined, expected: "team" },
  { folders: ["team"], url: "linked", expected: "linked" },
  { folders: ["team", "default"], url: "", expected: "default" },
  { folders: ["team"], url: "  ", expected: "team" },
  { folders: [], url: undefined, expected: undefined },
])("selects $expected for folders $folders and URL $url", ({ folders, url, expected }) => {
  expect(
    selectSyntheticsFolder(
      folders.map((folderId) => ({ folderId })),
      url,
    ),
  ).toBe(expected);
});
