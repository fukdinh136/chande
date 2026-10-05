// Fail before connecting. The acknowledgement is an operator assertion that
// these dedicated local targets are disposable, not evidence inferred from a URL.
function storageTarget(kind, raw, env = process.env) {
  if (env.DRIVER_TEST_STORAGE_ACK !== "ISOLATED_DRIVER_TEST_ONLY")
    throw new Error("Explicit isolated test storage acknowledgement required");
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("Invalid isolated test storage URL");
  }
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.search ||
    target.hash
  )
    throw new Error(
      "Test storage must be a dedicated local target without URL options",
    );
  if (kind === "postgres") {
    if (
      !["postgres:", "postgresql:"].includes(target.protocol) ||
      !/^\/[a-z0-9_]+_driver_test$/i.test(target.pathname)
    )
      throw new Error(
        "Dedicated PostgreSQL database ending _driver_test required",
      );
  } else if (kind === "redis") {
    if (
      !["redis:", "rediss:"].includes(target.protocol) ||
      target.port !== "16379" ||
      target.pathname !== "/15"
    )
      throw new Error("Dedicated local Redis port 16379 database 15 required");
  } else throw new Error("Unknown test storage type");
  return target;
}
module.exports = { storageTarget };
