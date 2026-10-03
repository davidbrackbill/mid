import { mkdirSync, readFileSync, rmSync, watch } from "node:fs";

const root = `${import.meta.dir}/..`;
const record = `${root}/node_modules/.cache/mid-dev.json`;
const parent = process.ppid;
let server: ReturnType<typeof Bun.spawn> | undefined;
let restarting = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function commandOf(pid: number): string {
  return Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString();
}

async function stopPrevious() {
  const previous = await Bun.file(record)
    .json()
    .catch(() => undefined);
  for (const [pid, marker] of [
    [previous?.dev, "scripts/dev.ts"],
    [previous?.server, "web/index.html"],
  ] as const)
    if (pid && pid !== process.pid && commandOf(pid).includes(marker)) process.kill(pid);
}

function start() {
  server = Bun.spawn(["bun", "web/index.html", ...Bun.argv.slice(2)], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });
  void server.exited.then((code) => {
    if (!restarting) stop(code ?? 1);
  });
  mkdirSync(`${root}/node_modules/.cache`, { recursive: true });
  void Bun.write(record, JSON.stringify({ dev: process.pid, server: server.pid }));
}

async function restart() {
  restarting = true;
  server?.kill();
  await server?.exited;
  restarting = false;
  start();
}

function stop(code = 0): never {
  restarting = true;
  server?.kill();
  try {
    if (JSON.parse(readFileSync(record, "utf8")).dev === process.pid) rmSync(record);
  } catch {}
  process.exit(code);
}

await stopPrevious();

for (const dir of ["web", "src"])
  watch(`${root}/${dir}`, { recursive: true }, (event) => {
    if (event !== "rename") return;
    clearTimeout(timer);
    timer = setTimeout(restart, 100);
  });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stop());

setInterval(() => {
  if (process.ppid !== parent) stop();
}, 1000);

start();
