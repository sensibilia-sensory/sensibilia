import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Backend {
  call<T = any>(request: Record<string, unknown>): Promise<T>;
  close(): void;
}

export class PythonBackend implements Backend {
  private child: ReturnType<typeof Bun.spawn>;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private ended = false;

  constructor(python?: string) {
    const root = resolve(import.meta.dir, "../../..");
    const executable =
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
    const candidates = [
      python,
      process.env.SENSIBILIA_PYTHON,
      resolve(root, ".venv", executable),
      resolve(root, "../.venv", executable),
      Bun.which("python3"),
      Bun.which("python"),
    ];
    const selected = candidates.find(
      (item): item is string => !!item && existsSync(item),
    );
    if (!selected)
      throw new Error(
        "Python was not found. Launch with flow.py tui or set SENSIBILIA_PYTHON.",
      );
    this.child = Bun.spawn(
      [selected, "-u", "-m", "sensibilia_cli.tui_backend"],
      {
        cwd: root,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONPATH: [root, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(process.platform === "win32" ? ";" : ":"),
        },
      },
    );
    void this.read();
    void new Response(this.child.stderr as ReadableStream)
      .text()
      .then((message) => {
        if (message && !this.ended)
          this.fail(
            new Error(
              "Python backend failed. Check that Pydantic is installed in the selected Python environment.",
            ),
          );
      });
    void this.child.exited.then(() => {
      if (!this.ended)
        this.fail(
          new Error(
            "Python backend stopped. Reopen the file before retrying a write.",
          ),
        );
    });
  }

  private fail(error: Error) {
    this.ended = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private async read() {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of this.child
        .stdout as ReadableStream<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const reply = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          const pending = this.pending.get(reply.id);
          this.pending.delete(reply.id);
          if (reply.ok) pending?.resolve(reply.result);
          else pending?.reject(new Error(reply.error));
        }
      }
    } catch {
      this.fail(
        new Error(
          "The authoring backend disconnected; inspect the file before retrying.",
        ),
      );
    }
  }

  call<T>(request: Record<string, unknown>): Promise<T> {
    if (this.ended)
      return Promise.reject(new Error("The authoring backend is closed."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      (this.child.stdin as import("bun").FileSink).write(
        JSON.stringify({ ...request, id }) + "\n",
      );
      void (this.child.stdin as import("bun").FileSink).flush();
    });
  }

  close() {
    if (this.ended) return;
    this.fail(new Error("The terminal interface closed."));
    (this.child.stdin as import("bun").FileSink).end();
    this.child.kill();
  }
}
