/** Explicit operator command; normal builds and sign-up never initialize data. */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: npm run reference:init -- --organization <existing-organization-slug>");
    console.log("Adds ISO 42001 reference definitions only. Never creates accounts or demo records.");
    return;
  }
  if (args.length !== 2 || args[0] !== "--organization" || !args[1].trim()) {
    throw new Error("An explicit organization is required.");
  }
  // Validate arguments before importing the database module or reading its URL.
  const { initializeReferenceFramework } = await import("../src/lib/reference-init");
  const result = await initializeReferenceFramework(args[1]);
  console.log("Reference initialization complete:", result);
}

main().then(() => process.exit(0)).catch(() => {
  // Driver errors can contain connection details; never echo them to logs.
  console.error("Reference initialization failed. Check the --organization slug, existing schema, and database access. Rerunning is safe; no existing records are overwritten or removed.");
  process.exit(1);
});
