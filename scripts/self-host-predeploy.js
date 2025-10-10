// Thin wrapper so existing deployment tooling can keep calling
// `node ./scripts/self-host-predeploy.js` even though the actual
// implementation lives in the backend server package. This avoids
// duplicating the logic and keeps the runtime image layout compatible
// with upstream compose files.
async function main() {
  await import('../packages/backend/server/scripts/self-host-predeploy.js');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
