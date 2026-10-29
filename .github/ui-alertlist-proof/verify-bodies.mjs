import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [web, baselinePath, candidatePath] = process.argv.slice(2);
const { default: ts } = await import(pathToFileURL(path.join(web, "node_modules/typescript/lib/typescript.js")).href);
const printer = ts.createPrinter({ removeComments: true });
function inventory(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const tests = [], assertions = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      let callee = node.expression;
      while (ts.isCallExpression(callee) || ts.isPropertyAccessExpression(callee)) callee = callee.expression;
      if (ts.isIdentifier(callee) && ["it", "test"].includes(callee.text) && node.arguments.some(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) tests.push(printer.printNode(ts.EmitHint.Unspecified, node, source));
      if (ts.isIdentifier(node.expression) && node.expression.text === "expect") assertions.push(printer.printNode(ts.EmitHint.Unspecified, node, source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { tests, assertions };
}
const baseline = inventory(baselinePath), candidate = inventory(candidatePath);
const result = { declarations: baseline.tests.length, expectCalls: baseline.assertions.length, identicalBodies: JSON.stringify(baseline.tests) === JSON.stringify(candidate.tests), identicalAssertions: JSON.stringify(baseline.assertions) === JSON.stringify(candidate.assertions) };
console.log(JSON.stringify(result, null, 2));
if (!result.identicalBodies || !result.identicalAssertions || result.declarations !== 115 || result.expectCalls !== 237) process.exitCode = 1;
