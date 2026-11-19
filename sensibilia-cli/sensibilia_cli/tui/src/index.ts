import { createCliRenderer } from "@opentui/core";
import { Workbench } from "./app";
import { PythonBackend } from "./bridge";

const args = Bun.argv.slice(2);
const pythonIndex = args.indexOf("--python");
const python = pythonIndex >= 0 ? args.splice(pythonIndex, 2)[1] : undefined;
if (args.includes("--help")) {
  console.log(
    "Sensibilia flow workbench\n\nUsage: bun run src/index.ts [study.json] [--python /path/to/python]\n\nF1 help · F2 apply · F3 add · F5 check · F6 server · F7 files · F8 theme · F10 quit",
  );
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    "The workbench needs an interactive terminal. Use the CLI for scripts.",
  );
  process.exitCode = 2;
} else {
  const backend = new PythonBackend(python);
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    onDestroy: () => backend.close(),
  });
  const app = new Workbench(renderer, backend);
  try {
    await app.start(args[0]);
  } catch (error) {
    app.close();
    console.error(String(error));
    process.exitCode = 2;
  }
}
