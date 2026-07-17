#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const RUNS_ROOT = join(homedir(), ".codex", "luna-fleet-runs");
const DEFAULT_CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";
const VALID_MODES = new Set(["read-only", "workspace-write"]);
const VALID_REASONING_EFFORTS = new Set(["low", "medium", "max"]);

function emit(status, summary, nextActions = [], artifacts = []) {
  process.stdout.write(
    `${JSON.stringify({
      status,
      summary,
      next_actions: nextActions,
      artifacts,
    })}\n`,
  );
}

function fail(message) {
  emit("error", message, ["Correct the inputs and retry."], []);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      fail(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = value;
    index += 1;
  }

  return { command, options };
}

function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporaryPath, path);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function locateCodex() {
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) {
    return process.env.CODEX_BIN;
  }
  if (existsSync(DEFAULT_CODEX_BIN)) {
    return DEFAULT_CODEX_BIN;
  }

  const lookup = spawnSync("sh", ["-lc", "command -v codex"], {
    encoding: "utf8",
  });
  const candidate = lookup.stdout.trim();
  if (lookup.status === 0 && candidate) {
    return candidate;
  }

  fail("Unable to locate Codex. Set CODEX_BIN and retry.");
}

function latestRun() {
  if (!existsSync(RUNS_ROOT)) {
    return null;
  }
  return readdirSync(RUNS_ROOT)
    .map((entry) => join(RUNS_ROOT, entry))
    .filter((path) => statSync(path).isDirectory())
    .sort()
    .at(-1);
}

function resolveRun(runOption) {
  const run = runOption ? resolve(runOption) : latestRun();
  if (!run || !existsSync(join(run, "manifest.json"))) {
    fail("No Luna fleet run was found.");
  }
  return run;
}

function readManifest(run) {
  return JSON.parse(readFileSync(join(run, "manifest.json"), "utf8"));
}

function processExists(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findSessionId(eventPath) {
  if (!eventPath || !existsSync(eventPath)) {
    return null;
  }

  for (const line of readFileSync(eventPath, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      const candidate =
        event.thread_id ??
        event.session_id ??
        event.threadId ??
        event.sessionId ??
        event.payload?.thread_id ??
        event.payload?.session_id;
      if (candidate) {
        return candidate;
      }
    } catch {
      // Ignore incomplete lines while Codex is writing the event stream.
    }
  }
  return null;
}

function normalizeScope(cwd, scope = ".") {
  const absoluteScope = resolve(cwd, scope);
  const relativeScope = relative(cwd, absoluteScope) || ".";
  if (
    isAbsolute(relativeScope) ||
    relativeScope === ".." ||
    relativeScope.startsWith(`..${sep}`)
  ) {
    fail(`Scope escapes the working directory: ${scope}`);
  }
  if (!existsSync(absoluteScope)) {
    fail(`Scope does not exist: ${scope}`);
  }
  return relativeScope;
}

function scopesOverlap(left, right) {
  if (left === "." || right === ".") {
    return true;
  }
  return (
    left === right ||
    left.startsWith(`${right}${sep}`) ||
    right.startsWith(`${left}${sep}`)
  );
}

function normalizeReasoningEffort(value, jobId) {
  const reasoningEffort = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!reasoningEffort) {
    fail(
      `Job ${jobId} has no reasoning effort. Provide low, medium, or max with --effort or job.effort.`,
    );
  }
  if (!VALID_REASONING_EFFORTS.has(reasoningEffort)) {
    fail(`Job ${jobId} has invalid reasoning effort: ${reasoningEffort}`);
  }
  return reasoningEffort;
}

function loadJobs(options, cwd) {
  let jobs;
  if (options["jobs-file"]) {
    jobs = JSON.parse(readFileSync(resolve(options["jobs-file"]), "utf8"));
  } else if (options["jobs-json"]) {
    jobs = JSON.parse(String(options["jobs-json"]));
  } else {
    const task = String(options.task ?? "").trim();
    if (!task) {
      fail("Provide --task, --jobs-file, or --jobs-json.");
    }
    const scopes = String(options.scopes ?? ".")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    const mode = String(options.mode ?? "workspace-write");
    jobs = scopes.map((scope, index) => ({
      id: `${String(index + 1).padStart(2, "0")}-${
        slug(basename(scope)) || "luna"
      }`,
      task,
      scope,
      mode,
      effort: options.effort,
    }));
  }

  if (!Array.isArray(jobs) || jobs.length === 0) {
    fail("The job list must be a non-empty JSON array.");
  }

  const ids = new Set();
  const normalized = jobs.map((job, index) => {
    const task = String(job.task ?? "").trim();
    const mode = String(job.mode ?? options.mode ?? "workspace-write");
    const scope = normalizeScope(cwd, String(job.scope ?? "."));
    const id =
      slug(String(job.id ?? `${index + 1}-${basename(scope)}`)) ||
      `worker-${index + 1}`;
    if (!task) {
      fail(`Job ${id} has no task.`);
    }
    if (!VALID_MODES.has(mode)) {
      fail(`Job ${id} has invalid mode: ${mode}`);
    }
    if (ids.has(id)) {
      fail(`Duplicate job id: ${id}`);
    }
    ids.add(id);
    const reasoningEffort = normalizeReasoningEffort(
      job.effort ?? options.effort,
      id,
    );
    return { id, task, scope, mode, reasoningEffort };
  });

  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const a = normalized[left];
      const b = normalized[right];
      if (
        a.mode === "workspace-write" &&
        b.mode === "workspace-write" &&
        scopesOverlap(a.scope, b.scope)
      ) {
        fail(
          `Writable scopes overlap: ${a.id} (${a.scope}) and ${b.id} (${b.scope}).`,
        );
      }
    }
  }
  return normalized;
}

function buildPrompt(worker) {
  return `You are a bounded GPT-5.6 Luna Codex worker using ${worker.reasoningEffort} reasoning effort.

Task: ${worker.task}
Authorized repository scope: ${worker.scope}
Execution mode: ${worker.mode}

Requirements:
- Read all applicable AGENTS.md files and invoke any task-matching skills before acting.
- Complete this assignment yourself. Do not call spawn_agent, invoke any subagent, or launch another Luna CLI fleet.
- Work only within the authorized scope. Read direct consumers when necessary, but do not write outside scope.
- Preserve existing user changes and inspect git status before editing.
- Follow the repository's architecture, naming, formatting, validation, UI screenshot, and documentation rules.
- Do not create or modify test files when active instructions prohibit them.
- Do not commit or push unless the user explicitly requested that exact action for this task.
- For read-only mode, do not modify files.
- For writable work, format changed files when supported and run relevant verification.
- Return the outcome first, then changed files or evidence, verification, out-of-scope observations, and blockers.
`;
}

function codexArgs({ cwd, worker, prompt, finalPath, resumeSessionId }) {
  const common = [
    "-m",
    "gpt-5.6-luna",
    "-c",
    `model_reasoning_effort="${worker.reasoningEffort}"`,
    "-c",
    'approval_policy="never"',
    "--json",
    "-o",
    finalPath,
  ];
  if (resumeSessionId) {
    return ["exec", "resume", resumeSessionId, ...common, prompt];
  }
  return ["exec", "-C", cwd, "-s", worker.mode, ...common, prompt];
}

function runWorker({
  codexBin,
  cwd,
  run,
  manifest,
  worker,
  prompt,
  revision = 0,
}) {
  return new Promise((complete) => {
    const workerDir = join(run, worker.id);
    mkdirSync(workerDir, { recursive: true });
    const suffix = revision === 0 ? "" : `-revision-${revision}`;
    const eventPath = join(workerDir, `events${suffix}.jsonl`);
    const errorPath = join(workerDir, `stderr${suffix}.log`);
    const finalPath = join(workerDir, `final${suffix}.txt`);
    const promptPath = join(workerDir, `prompt${suffix}.txt`);
    writeFileSync(promptPath, `${prompt}\n`);

    const eventStream = createWriteStream(eventPath, { flags: "a" });
    const errorFd = openSync(errorPath, "a");
    const child = spawn(
      codexBin,
      codexArgs({
        cwd,
        worker,
        prompt,
        finalPath,
        resumeSessionId: revision === 0 ? null : worker.sessionId,
      }),
      { cwd, env: process.env, stdio: ["ignore", "pipe", errorFd] },
    );

    worker.status = revision === 0 ? "running" : "revising";
    worker.pid = child.pid;
    worker.startedAt = new Date().toISOString();
    worker.eventPath = eventPath;
    worker.errorPath = errorPath;
    worker.finalPath = finalPath;
    worker.promptPath = promptPath;
    worker.revision = revision;
    writeJsonAtomic(join(run, "manifest.json"), manifest);
    emit("success", `Started ${worker.id}: ${worker.task}`, [], [workerDir]);

    child.stdout.pipe(eventStream);
    child.on("error", (error) => {
      worker.error = error.message;
    });
    child.on("close", (code, signal) => {
      eventStream.end();
      closeSync(errorFd);
      worker.exitCode = code;
      worker.signal = signal;
      worker.finishedAt = new Date().toISOString();
      worker.sessionId = worker.sessionId ?? findSessionId(eventPath);
      worker.status = code === 0 ? "succeeded" : "failed";
      writeJsonAtomic(join(run, "manifest.json"), manifest);
      emit(
        worker.status === "succeeded" ? "success" : "error",
        `${worker.id} ${worker.status}.`,
        worker.status === "succeeded"
          ? ["Review the final report and authorized-scope diff or evidence."]
          : ["Inspect stderr and resume or retry safely."],
        [eventPath, errorPath, finalPath],
      );
      complete(worker.status === "succeeded");
    });
  });
}

async function start(options) {
  const cwd = resolve(options.cwd ?? process.cwd());
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    fail(`Working directory does not exist: ${cwd}`);
  }
  const maxParallel = Number(options["max-parallel"] ?? 3);
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 6) {
    fail("--max-parallel must be an integer from 1 to 6.");
  }
  const jobs = loadJobs(options, cwd);

  mkdirSync(RUNS_ROOT, { recursive: true });
  const run = join(
    RUNS_ROOT,
    `${timestamp()}-${slug(basename(cwd)) || "workspace"}`,
  );
  mkdirSync(run, { recursive: true });
  const manifest = {
    version: 1,
    status: "running",
    createdAt: new Date().toISOString(),
    cwd,
    model: "gpt-5.6-luna",
    maxParallel,
    workers: jobs.map((job) => ({
      ...job,
      status: "queued",
      pid: null,
      sessionId: null,
      revision: 0,
    })),
  };
  writeJsonAtomic(join(run, "manifest.json"), manifest);
  emit(
    "success",
    `Created Luna fleet run with ${manifest.workers.length} worker(s).`,
    [],
    [run],
  );

  const codexBin = locateCodex();
  let cursor = 0;
  let allSucceeded = true;
  async function consume() {
    while (cursor < manifest.workers.length) {
      const worker = manifest.workers[cursor];
      cursor += 1;
      const succeeded = await runWorker({
        codexBin,
        cwd,
        run,
        manifest,
        worker,
        prompt: buildPrompt(worker),
      });
      allSucceeded = allSucceeded && succeeded;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(maxParallel, manifest.workers.length) }, () =>
      consume(),
    ),
  );

  manifest.status = allSucceeded ? "succeeded" : "failed";
  manifest.finishedAt = new Date().toISOString();
  writeJsonAtomic(join(run, "manifest.json"), manifest);
  emit(
    allSucceeded ? "success" : "warning",
    `Luna fleet run ${manifest.status}.`,
    ["Review each worker result before accepting the task."],
    [run, join(run, "manifest.json")],
  );
  process.exit(allSucceeded ? 0 : 2);
}

function plan(options) {
  const cwd = resolve(options.cwd ?? process.cwd());
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    fail(`Working directory does not exist: ${cwd}`);
  }
  const maxParallel = Number(options["max-parallel"] ?? 3);
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 6) {
    fail("--max-parallel must be an integer from 1 to 6.");
  }
  const workers = loadJobs(options, cwd);
  emit(
    "success",
    `Validated ${workers.length} Luna worker plan.`,
    ["Run the same arguments with start when ready."],
    [],
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        cwd,
        model: "gpt-5.6-luna",
        maxParallel,
        workers,
      },
      null,
      2,
    )}\n`,
  );
}

function status(options) {
  const run = resolveRun(options.run);
  const manifest = readManifest(run);
  const workers = manifest.workers.map((worker) => ({
    id: worker.id,
    task: worker.task,
    scope: worker.scope,
    mode: worker.mode,
    reasoningEffort: worker.reasoningEffort,
    status:
      ["running", "revising"].includes(worker.status) &&
      !processExists(worker.pid)
        ? "process-missing"
        : worker.status,
    pid: worker.pid,
    sessionId: worker.sessionId,
    revision: worker.revision,
    finalPath: worker.finalPath,
  }));
  const missingWorkers = workers.filter(
    (worker) => worker.status === "process-missing",
  );
  const unhealthy = manifest.status === "failed" || missingWorkers.length > 0;
  emit(
    unhealthy ? "warning" : "success",
    missingWorkers.length > 0
      ? `Run has ${missingWorkers.length} missing worker process(es).`
      : `Run status: ${manifest.status}.`,
    unhealthy ? ["Inspect failed or missing workers before continuing."] : [],
    [run],
  );
  process.stdout.write(
    `${JSON.stringify({ run, ...manifest, workers }, null, 2)}\n`,
  );
}

async function resume(options) {
  const run = resolveRun(options.run);
  const manifest = readManifest(run);
  const worker = manifest.workers.find(
    (candidate) => candidate.id === options.worker,
  );
  const task = String(options.task ?? "").trim();
  if (!worker) {
    fail(`Worker not found: ${options.worker ?? "<missing>"}`);
  }
  const activeWorker = manifest.workers.find(
    (candidate) =>
      ["running", "revising"].includes(candidate.status) &&
      processExists(candidate.pid),
  );
  if (activeWorker) {
    fail(
      `Worker ${activeWorker.id} is still active; wait for the fleet to stop before resuming ${worker.id}.`,
    );
  }
  worker.sessionId = worker.sessionId ?? findSessionId(worker.eventPath);
  if (!worker.sessionId) {
    fail(`Worker ${worker.id} has no resumable Codex session UUID.`);
  }
  if (!task) {
    fail("Provide correction instructions with --task.");
  }
  worker.reasoningEffort = normalizeReasoningEffort(
    options.effort ?? worker.reasoningEffort,
    worker.id,
  );

  manifest.status = "revising";
  const revision = Number(worker.revision ?? 0) + 1;
  await runWorker({
    codexBin: locateCodex(),
    cwd: manifest.cwd,
    run,
    manifest,
    worker,
    revision,
    prompt: `Continue the original task within scope ${worker.scope}. Parent review instructions: ${task}`,
  });
  manifest.status = manifest.workers.every(
    (candidate) => candidate.status === "succeeded",
  )
    ? "succeeded"
    : "failed";
  manifest.finishedAt = new Date().toISOString();
  writeJsonAtomic(join(run, "manifest.json"), manifest);
  process.exit(manifest.status === "succeeded" ? 0 : 2);
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === "plan") {
  plan(options);
} else if (command === "start") {
  await start(options);
} else if (command === "status") {
  status(options);
} else if (command === "resume") {
  await resume(options);
} else {
  fail(
    "Usage: luna-fleet.mjs <plan|start|status|resume> [options]. Plans and starts require --effort low|medium|max or job.effort.",
  );
}
