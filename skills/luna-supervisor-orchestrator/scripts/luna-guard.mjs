#!/usr/bin/env node

import { readFileSync } from "node:fs";

const LEDGER_START = "<!-- luna-guard:start -->";
const LEDGER_END = "<!-- luna-guard:end -->";
const LEDGER_STATES = new Set([
  "PLANNING",
  "WAITING_FOR_EVENT",
  "REVIEWING_BARRIER",
  "CORRECTING",
  "ACCEPTING",
]);
const EVENTS = new Set([
  "LUNA_PLAN",
  "LUNA_BLOCKED",
  "LUNA_DONE",
  "LUNA_CORRECTION_DONE",
]);
const ENVELOPE_KEYS = [
  "event",
  "worker_thread_id",
  "assignment_or_status",
  "phase",
  "barrier_id",
  "decision_required",
  "contract_changes",
  "changed_paths",
  "validation_summary",
  "request",
];
const REVIEW_KEYS = [
  "reviewer_thread_id",
  "target_barrier_id",
  "current_barrier_id",
  "barrier_closed_at",
  "review_started_at",
  "scope_revision",
  "current_scope_revision",
  "changed_paths",
];
const LEDGER_REQUIRED_KEYS = [
  "schema_version",
  "state",
  "ready_nodes",
  "dispatch_batch",
  "expected_events",
  "pending_barrier",
  "terminal_workers",
];
const LEDGER_ARRAY_KEYS = [
  "ready_nodes",
  "dispatch_batch",
  "expected_events",
  "terminal_workers",
];
const SUCCESSFUL_LAUNCH_RESULTS = new Set(["launched", "instructed"]);
const PLACEHOLDER_VALUES = new Set([
  "actual-uuid",
  "current-worker",
  "current_worker",
  "placeholder",
  "thread-id",
  "worker-thread-id",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

class GuardError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(message) {
  throw new GuardError(message);
}

function requireRecord(value, label) {
  if (!isRecord(value)) {
    fail(`${label} must be a JSON object`);
  }
}

function requireKeys(value, keys, label) {
  const missing = keys.filter((key) => !hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (missing.length > 0 || unknown.length > 0) {
    const details = [];
    if (missing.length > 0) {
      details.push(`missing ${missing.join(", ")}`);
    }
    if (unknown.length > 0) {
      details.push(`unknown ${unknown.join(", ")}`);
    }
    fail(`${label} keys: ${details.join("; ")}`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean`);
  }
}

function requireStringArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      fail(`${label}[${index}] must be a non-empty string`);
    }
    if (seen.has(item)) {
      fail(
        `${label} must contain unique values; duplicate ${JSON.stringify(item)}`,
      );
    }
    seen.add(item);
  }
}

function requireNonEmptyStringArray(value, label) {
  requireStringArray(value, label);
  if (value.length === 0) {
    fail(`${label} must be non-empty`);
  }
}

function requireInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
}

function requireChangedPaths(value, label) {
  requireRecord(value, label);
  requireKeys(value, ["count", "paths"], label);
  requireInteger(value.count, `${label}.count`);
  requireStringArray(value.paths, `${label}.paths`);
  if (value.count !== value.paths.length) {
    fail(`${label}.count must equal ${label}.paths.length`);
  }
}

function sameChangedPaths(left, right) {
  return (
    left.count === right.count &&
    left.paths.length === right.paths.length &&
    left.paths.every((path) => right.paths.includes(path))
  );
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    PLACEHOLDER_VALUES.has(normalized) ||
    (normalized.startsWith("<") && normalized.endsWith(">"))
  );
}

function requireUuid(value, label) {
  requireString(value, label);
  if (isPlaceholder(value)) {
    fail(`${label} cannot be a placeholder`);
  }
  if (!UUID_PATTERN.test(value)) {
    fail(`${label} must be UUID-like`);
  }
}

function requireNonPlaceholderString(value, label) {
  requireString(value, label);
  if (isPlaceholder(value)) {
    fail(`${label} cannot be a placeholder`);
  }
}

function parseIsoTimestamp(value, label) {
  requireString(value, label);
  const match = ISO_PATTERN.exec(value);
  if (!match) {
    fail(`${label} must be an ISO 8601 timestamp`);
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offset,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  const offsetHour = offsetMatch ? Number(offsetMatch[2]) : 0;
  const offsetMinute = offsetMatch ? Number(offsetMatch[3]) : 0;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    fail(`${label} must be a valid ISO 8601 timestamp`);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    fail(`${label} must be a valid ISO 8601 timestamp`);
  }
  return timestamp;
}

function requireNullableTimestamp(value, label) {
  if (value !== null) {
    parseIsoTimestamp(value, label);
  }
}

function requireLedgerField(ledger, key) {
  if (!hasOwn(ledger, key)) {
    fail(`ledger missing required field ${key}`);
  }
}

function sameStringSet(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function assertLedger(ledger) {
  requireRecord(ledger, "ledger JSON");
  for (const key of LEDGER_REQUIRED_KEYS) {
    requireLedgerField(ledger, key);
  }
  if (ledger.schema_version !== 1) {
    fail("ledger.schema_version must be 1");
  }
  requireString(ledger.state, "ledger.state");
  if (!LEDGER_STATES.has(ledger.state)) {
    fail(`ledger.state must be one of ${[...LEDGER_STATES].join(", ")}`);
  }
  for (const key of LEDGER_ARRAY_KEYS) {
    requireStringArray(ledger[key], `ledger.${key}`);
  }
  requireString(ledger.pending_barrier, "ledger.pending_barrier");

  if (hasOwn(ledger, "waiting_since")) {
    requireNullableTimestamp(ledger.waiting_since, "ledger.waiting_since");
  }
  if (hasOwn(ledger, "timeout_at")) {
    requireNullableTimestamp(ledger.timeout_at, "ledger.timeout_at");
  }
  if (hasOwn(ledger, "barrier_closed_at")) {
    requireNullableTimestamp(
      ledger.barrier_closed_at,
      "ledger.barrier_closed_at",
    );
  }
  if (hasOwn(ledger, "launch_results")) {
    requireRecord(ledger.launch_results, "ledger.launch_results");
    if (
      (ledger.state === "PLANNING" || ledger.state === "CORRECTING") &&
      Object.keys(ledger.launch_results).length > 0
    ) {
      fail(`${ledger.state} requires launch_results to be empty before send`);
    }
  }
  if (hasOwn(ledger, "scope_revision")) {
    requireString(ledger.scope_revision, "ledger.scope_revision");
  }
  if (hasOwn(ledger, "worker_thread_id")) {
    if (ledger.worker_thread_id !== null) {
      requireString(ledger.worker_thread_id, "ledger.worker_thread_id");
    }
  }

  if (ledger.state === "PLANNING" || ledger.state === "CORRECTING") {
    requireNonEmptyStringArray(ledger.ready_nodes, "ledger.ready_nodes");
    requireNonEmptyStringArray(ledger.dispatch_batch, "ledger.dispatch_batch");
    requireNonEmptyStringArray(
      ledger.expected_events,
      "ledger.expected_events",
    );
    requireLedgerField(ledger, "waiting_since");
    requireLedgerField(ledger, "timeout_at");
    if (ledger.waiting_since !== null || ledger.timeout_at !== null) {
      fail(`${ledger.state} requires waiting_since and timeout_at to be null`);
    }
    if (!sameStringSet(ledger.ready_nodes, ledger.dispatch_batch)) {
      fail(`${ledger.state} requires ready_nodes to equal dispatch_batch`);
    }
  }

  if (ledger.state === "WAITING_FOR_EVENT") {
    requireNonEmptyStringArray(ledger.dispatch_batch, "ledger.dispatch_batch");
    requireNonEmptyStringArray(
      ledger.expected_events,
      "ledger.expected_events",
    );
    requireLedgerField(ledger, "launch_results");
    requireLedgerField(ledger, "waiting_since");
    requireLedgerField(ledger, "timeout_at");
    if (ledger.waiting_since === null) {
      fail("WAITING_FOR_EVENT requires non-null waiting_since");
    }
    const waitingSince = parseIsoTimestamp(
      ledger.waiting_since,
      "ledger.waiting_since",
    );
    if (ledger.timeout_at !== null) {
      const timeoutAt = parseIsoTimestamp(
        ledger.timeout_at,
        "ledger.timeout_at",
      );
      if (timeoutAt <= waitingSince) {
        fail("WAITING_FOR_EVENT requires timeout_at after waiting_since");
      }
    }
    const launchResultKeys = Object.keys(ledger.launch_results);
    if (!sameStringSet(launchResultKeys, ledger.dispatch_batch)) {
      const missing = ledger.dispatch_batch.filter(
        (node) => !launchResultKeys.includes(node),
      );
      const extra = launchResultKeys.filter(
        (node) => !ledger.dispatch_batch.includes(node),
      );
      const details = [];
      if (missing.length > 0) {
        details.push(`missing ${missing.join(", ")}`);
      }
      if (extra.length > 0) {
        details.push(`extra ${extra.join(", ")}`);
      }
      fail(
        `WAITING_FOR_EVENT launch_results keys must exactly match dispatch_batch (${details.join(
          "; ",
        )})`,
      );
    }
    for (const node of ledger.dispatch_batch) {
      if (!SUCCESSFUL_LAUNCH_RESULTS.has(ledger.launch_results[node])) {
        fail(
          `WAITING_FOR_EVENT launch_results.${node} must equal "launched" or "instructed"`,
        );
      }
    }
  }

  if (ledger.state === "REVIEWING_BARRIER") {
    requireNonEmptyStringArray(ledger.dispatch_batch, "ledger.dispatch_batch");
    requireNonEmptyStringArray(
      ledger.expected_events,
      "ledger.expected_events",
    );
    requireLedgerField(ledger, "barrier_closed_at");
    if (ledger.barrier_closed_at === null) {
      fail("REVIEWING_BARRIER requires non-null barrier_closed_at");
    }
    parseIsoTimestamp(ledger.barrier_closed_at, "ledger.barrier_closed_at");
    const missingTerminalWorkers = ledger.dispatch_batch.filter(
      (node) => !ledger.terminal_workers.includes(node),
    );
    if (missingTerminalWorkers.length > 0) {
      fail(
        `REVIEWING_BARRIER terminal_workers missing ${missingTerminalWorkers.join(
          ", ",
        )}`,
      );
    }
  }
}

function assertEnvelope(envelope, sourceThreadId) {
  requireRecord(envelope, "envelope JSON");
  requireKeys(envelope, ENVELOPE_KEYS, "envelope");
  requireString(envelope.event, "envelope.event");
  if (!EVENTS.has(envelope.event)) {
    fail(`envelope.event must be one of ${[...EVENTS].join(", ")}`);
  }
  if (envelope.worker_thread_id !== null) {
    requireUuid(envelope.worker_thread_id, "envelope.worker_thread_id");
  }
  if (sourceThreadId !== undefined) {
    requireUuid(sourceThreadId, "--source-thread-id");
    if (
      envelope.worker_thread_id !== null &&
      envelope.worker_thread_id.toLowerCase() === sourceThreadId.toLowerCase()
    ) {
      fail("envelope.worker_thread_id must not equal --source-thread-id");
    }
  }
  requireString(envelope.assignment_or_status, "envelope.assignment_or_status");
  requireString(envelope.phase, "envelope.phase");
  requireString(envelope.barrier_id, "envelope.barrier_id");
  requireBoolean(envelope.decision_required, "envelope.decision_required");
  requireStringArray(envelope.contract_changes, "envelope.contract_changes");
  requireChangedPaths(envelope.changed_paths, "envelope.changed_paths");
  requireString(envelope.validation_summary, "envelope.validation_summary");
  requireString(envelope.request, "envelope.request");

  if (envelope.event === "LUNA_PLAN") {
    if (!envelope.decision_required) {
      fail("LUNA_PLAN requires decision_required=true");
    }
    if (envelope.changed_paths.count !== 0) {
      fail("LUNA_PLAN requires changed_paths to be empty");
    }
  }
  if (envelope.event === "LUNA_BLOCKED" && !envelope.decision_required) {
    fail("LUNA_BLOCKED requires decision_required=true");
  }
  if (
    (envelope.event === "LUNA_DONE" ||
      envelope.event === "LUNA_CORRECTION_DONE") &&
    envelope.decision_required !== envelope.contract_changes.length > 0
  ) {
    fail(
      `${envelope.event} requires decision_required=false unless contract_changes is non-empty`,
    );
  }
}

function getReviewLedgerMetadata(ledger) {
  const requiredKeys = [
    "review_target_barrier_id",
    "barrier_closed_at",
    "scope_revision",
    "review_changed_paths",
  ];
  for (const key of requiredKeys) {
    requireLedgerField(ledger, key);
  }
  requireNonPlaceholderString(
    ledger.review_target_barrier_id,
    "ledger.review_target_barrier_id",
  );
  if (ledger.barrier_closed_at === null) {
    fail("ledger.barrier_closed_at must be non-null for review");
  }
  const barrierClosedAt = parseIsoTimestamp(
    ledger.barrier_closed_at,
    "ledger.barrier_closed_at",
  );
  requireNonPlaceholderString(ledger.scope_revision, "ledger.scope_revision");
  requireChangedPaths(
    ledger.review_changed_paths,
    "ledger.review_changed_paths",
  );
  return {
    barrierClosedAt,
    barrierClosedAtText: ledger.barrier_closed_at,
    reviewChangedPaths: ledger.review_changed_paths,
    reviewTargetBarrierId: ledger.review_target_barrier_id,
    scopeRevision: ledger.scope_revision,
  };
}

function assertReview(review, ledger) {
  const ledgerMetadata = getReviewLedgerMetadata(ledger);
  requireRecord(review, "review JSON");
  requireKeys(review, REVIEW_KEYS, "review");
  requireUuid(review.reviewer_thread_id, "review.reviewer_thread_id");
  requireNonPlaceholderString(
    review.target_barrier_id,
    "review.target_barrier_id",
  );
  requireNonPlaceholderString(
    review.current_barrier_id,
    "review.current_barrier_id",
  );
  if (review.target_barrier_id !== ledgerMetadata.reviewTargetBarrierId) {
    fail("review target_barrier_id must equal ledger.review_target_barrier_id");
  }
  if (review.current_barrier_id !== ledgerMetadata.reviewTargetBarrierId) {
    fail(
      "review current_barrier_id must equal ledger.review_target_barrier_id",
    );
  }
  parseIsoTimestamp(review.barrier_closed_at, "review.barrier_closed_at");
  if (review.barrier_closed_at !== ledgerMetadata.barrierClosedAtText) {
    fail(
      "review barrier_closed_at must exactly match ledger.barrier_closed_at",
    );
  }
  const reviewStartedAt = parseIsoTimestamp(
    review.review_started_at,
    "review.review_started_at",
  );
  if (reviewStartedAt <= ledgerMetadata.barrierClosedAt) {
    fail("review_started_at must be after barrier_closed_at");
  }
  requireNonPlaceholderString(review.scope_revision, "review.scope_revision");
  requireNonPlaceholderString(
    review.current_scope_revision,
    "review.current_scope_revision",
  );
  if (review.scope_revision !== ledgerMetadata.scopeRevision) {
    fail("review scope_revision must exactly match ledger.scope_revision");
  }
  if (review.current_scope_revision !== ledgerMetadata.scopeRevision) {
    fail(
      "review current_scope_revision must exactly match ledger.scope_revision",
    );
  }
  requireChangedPaths(review.changed_paths, "review.changed_paths");
  if (
    !sameChangedPaths(review.changed_paths, ledgerMetadata.reviewChangedPaths)
  ) {
    fail("review changed_paths must exactly match ledger.review_changed_paths");
  }
}

function findStandaloneMarkers(text, marker) {
  const positions = [];
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === marker) {
      positions.push(offset + line.indexOf(marker));
    }
    offset += line.length + 1;
  }
  return positions;
}

function readLedger(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ledger ${path}: ${error.message}`);
  }
  const starts = findStandaloneMarkers(text, LEDGER_START);
  const ends = findStandaloneMarkers(text, LEDGER_END);
  if (starts.length !== 1 || ends.length !== 1) {
    fail("ledger must contain exactly one start marker and one end marker");
  }
  const start = starts[0] + LEDGER_START.length;
  const end = ends[0];
  if (end < start) {
    fail("ledger end marker must follow the start marker");
  }
  const body = text.slice(start, end).trim();
  if (body.length === 0) {
    fail("ledger marker block must contain one JSON object");
  }
  let ledger;
  try {
    ledger = JSON.parse(body);
  } catch (error) {
    fail(
      `ledger marker block must contain exactly one JSON object: ${error.message}`,
    );
  }
  assertLedger(ledger);
  return ledger;
}

function parseJsonArgument(raw, label) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    fail(`${label} must be valid JSON: ${error.message}`);
  }
  requireRecord(value, `${label} JSON`);
  return value;
}

function parseEnvelopeArguments(args) {
  if (args.length < 1 || args.length > 3) {
    fail("usage: envelope <json> [--source-thread-id <id>]");
  }
  const rawJson = args[0];
  let sourceThreadId;
  if (args.length === 2 || args.length === 3) {
    if (args.length !== 3 || args[1] !== "--source-thread-id") {
      fail("usage: envelope <json> [--source-thread-id <id>]");
    }
    sourceThreadId = args[2];
  }
  return { envelope: parseJsonArgument(rawJson, "envelope"), sourceThreadId };
}

function run(command, args) {
  if (command === "ledger") {
    if (args.length !== 1) {
      fail("usage: ledger <task.md>");
    }
    readLedger(args[0]);
    return "ledger: valid";
  }
  if (command === "envelope") {
    const { envelope, sourceThreadId } = parseEnvelopeArguments(args);
    assertEnvelope(envelope, sourceThreadId);
    return "envelope: valid";
  }
  if (command === "review") {
    if (args.length !== 3 || args[1] !== "--ledger") {
      fail("usage: review <json> --ledger <task.md>");
    }
    const review = parseJsonArgument(args[0], "review");
    const ledger = readLedger(args[2]);
    assertReview(review, ledger);
    return "review: valid";
  }
  fail(
    "usage: luna-guard.mjs ledger <task.md> | envelope <json> [--source-thread-id <id>] | review <json> --ledger <task.md>",
  );
}

try {
  const [command, ...args] = process.argv.slice(2);
  console.log(run(command, args));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`luna-guard: ${message}`);
  process.exitCode = 1;
}
