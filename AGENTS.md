# AGENTS.md

## Subagent Discipline

- When a subagent is assigned a concrete task, treat that subagent as the owner of that slice of work.
- Do not duplicate the subagent's investigation in the main context just to stay busy. That defeats the point of delegation and pollutes context.
- If the subagent's result is on the critical path, it is correct to wait for it, including multiple consecutive waits when needed.
- Repeated waits are preferable to re-reading the same files or redoing the same search locally when the subagent is already handling that work.
- While waiting, only do non-overlapping work such as integration, verification planning, or investigating a different slice of the problem.
- If a subagent is stalled, blocked, or producing the wrong kind of output, redirect it or replace it. Do not silently take over the same task in parallel without a reason.
- Use subagents to keep the main context clean. Delegate bounded work, wait when that work is the dependency, then synthesize the returned result.
