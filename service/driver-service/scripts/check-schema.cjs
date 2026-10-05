const fs = require("node:fs"),
  path = require("node:path"),
  ts = require("typescript");
let count = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) walk(file);
    else if (e.name.endsWith(".ts")) {
      const source = fs.readFileSync(file, "utf8"),
        tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (
          ts.isPropertyAssignment(node) &&
          ["synchronize", "migrationsRun", "installExtensions"].includes(
            node.name.getText(tree),
          ) &&
          node.initializer.kind === ts.SyntaxKind.TrueKeyword
        ) {
          console.error("Automatic DDL forbidden:", file);
          count++;
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
      if (
        /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|TYPE|SCHEMA|EXTENSION)\b/i.test(
          source,
        )
      ) {
        console.error("DDL forbidden:", file);
        count++;
      }
    }
  }
}
walk("src");
process.exitCode = count ? 1 : 0;
if (!count)
  console.log(
    "Schema-safety source check passed (not a database schema diff).",
  );
