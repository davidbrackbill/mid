const { engines } = await Bun.file(new URL("../package.json", import.meta.url)).json();

if (!Bun.semver.satisfies(Bun.version, engines.bun)) {
  console.error(`mid needs Bun ${engines.bun}, but this is Bun ${Bun.version}. Run: bun upgrade`);
  process.exit(1);
}
