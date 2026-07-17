# Codex Luna Supervisor

用于由 Supervisor 负责 Luna 编排的可分发 Codex skill，支持影响范围映射、显式 DAG、阶段屏障、并行派发批次、作用域明确的 Writer、有限的只读 Scout、顺序集成以及 Supervisor 最终验收。

[English README](README.en.md)

## 创建初衷

使用 Sol 处理所有任务并不经济：许多基础实现、资料整理和常规修改并不需要 Sol 的推理能力，完全可以交给 Luna 完成。这个 skill 的核心目标，是在较大的任务中把适合的基础工作交给 Luna，从而节省 Sol 的执行时间和 token 消耗；Sol 则保留在 Supervisor 位置，负责关键审查、风险判断和最终兜底。

这套方式只适合有足够范围可以拆分和审查的较大任务。小任务或简单修改不需要为了使用 Luna 而增加编排成本。对于适合拆分的任务，Supervisor 会先建立影响范围和 DAG，再明确角色、读写边界、契约和阶段屏障，按批次派发所有已就绪的 Worker，最后统一审查、验证和验收。

## 环境要求

- 可访问 `gpt-5.6-luna` 的 Codex。
- 支持侧栏可见 Worker 的 Codex Desktop thread tools。
- 只有使用可选 CLI fallback 时，才需要 Node.js 和可用的 `codex` 可执行文件。

该 skill 会在派发前检查当前可用的执行面。如果缺少所需的 Desktop thread tools，应报告侧栏编排不可用；在适合的情况下，也可以使用文档中说明的 CLI fallback。

## 安装

使用 Codex 内置的 skill installer 从 GitHub 安装：

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo <owner>/codex-luna-supervisor \
  --path skills/luna-supervisor-orchestrator
```

安装完成后，skill 会在下一次 Codex 任务中生效。

## 使用

当任务需要委派 Luna 实现或审查时，显式调用：

```text
$luna-supervisor-orchestrator use Luna to implement the requested change.
```

当前任务始终由 Supervisor 负责。Supervisor 负责影响分析、拓扑和并行度、接口契约、阶段屏障、审查、验证以及最终验收。

## 仓库结构

```text
skills/luna-supervisor-orchestrator/
├── SKILL.md
├── agents/openai.yaml
└── scripts/luna-fleet.mjs
```

当需要严格隔离、持久化原始事件或恢复 CLI 会话时，可以使用可选的 `scripts/luna-fleet.mjs` fallback。具备所需 Desktop tools 时，侧栏可见的 Codex task 仍是默认执行方式。
