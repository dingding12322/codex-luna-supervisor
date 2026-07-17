# Codex Luna Supervisor

Distributable Codex skill for Supervisor-owned Luna orchestration with impact mapping, explicit DAGs, phase barriers, parallel dispatch batches, scoped writers, bounded read-only scouts, sequential integration, and final Supervisor acceptance.

[中文 README](README.md)

## Why This Skill Exists

Using Sol for every task is inefficient. Many basic implementations, routine edits, and documentation tasks do not need Sol's reasoning capacity and can be completed by Luna. This skill is intended for larger tasks where suitable foundational work can be delegated to Luna, reducing Sol's execution time and token usage while keeping Sol as the Supervisor responsible for critical review, risk decisions, and final fallback acceptance.

This approach is only worthwhile when a task is large enough to justify decomposition and review. Small tasks and simple edits should be handled directly rather than paying the coordination cost of orchestration. For suitable tasks, the Supervisor builds the impact map and DAG, defines roles, read/write boundaries, contracts, and phase barriers, dispatches every ready Worker in batches, and finishes with centralized review, verification, and acceptance.

## Requirements

- Codex with access to `gpt-5.6-luna`.
- Codex Desktop thread tools for sidebar-visible Workers.
- Node.js and a working `codex` executable only when using the optional CLI fallback.

The skill checks the available execution surface before dispatch. Without the required Desktop thread tools, it must report that sidebar orchestration is unavailable or use the documented CLI fallback when that surface is appropriate.

## Install

Install from GitHub with the built-in skill installer:

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo <owner>/codex-luna-supervisor \
  --path skills/luna-supervisor-orchestrator
```

The skill becomes available on the next Codex turn.

## Use

Invoke it explicitly when a task needs delegated Luna implementation or review:

```text
$luna-supervisor-orchestrator use Luna to implement the requested change.
```

The current task remains the Supervisor. It owns impact analysis, topology, parallelism, contracts, barriers, review, verification, and final acceptance.

## Repository Layout

```text
skills/luna-supervisor-orchestrator/
├── SKILL.md
├── agents/openai.yaml
└── scripts/luna-fleet.mjs
```

`scripts/luna-fleet.mjs` is an optional fallback for strict isolation, persistent raw events, or CLI session resume. Sidebar-visible Codex tasks remain the normal execution surface when the required Desktop tools are available.
