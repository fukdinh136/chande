const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
let failures = 0;
function walk(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isDirectory()) walk(file);
    else if (file.endsWith(".ts")) {
      const source = fs.readFileSync(file, "utf8");
      const tree = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const layer = path.relative("src", file).split(path.sep)[0];
      for (const statement of tree.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const target = statement.moduleSpecifier.text;
        const destination = path
          .relative("src", path.resolve(path.dirname(file), target))
          .split(path.sep)[0];
        if (
          ["domain", "application"].includes(layer) &&
          (!target.startsWith(".") ||
            ![
              "domain",
              ...(layer === "application" ? ["application"] : []),
            ].includes(destination))
        ) {
          console.error(`Dependency violation: ${file} -> ${target}`);
          failures++;
        }
        if (
          layer === "infrastructure" &&
          target.startsWith(".") &&
          ["bootstrap", "presentation"].includes(destination)
        ) {
          console.error(`Adapter dependency violation: ${file}`);
          failures++;
        }
      }
    }
  }
}
walk("src");
if (failures) process.exitCode = 1;
else console.log("Architecture check passed.");
