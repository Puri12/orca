import { describe, expect, it } from 'vitest'

import { createAgentStatusPostingHarness as createHarness } from './agent-status-extension-test-harness'

// Why: omo-task.js merges run_stats into a task result's details on terminal transitions
// (case "complete"/"fail": { ...details, ...Bs(t.run_stats) }); that is the only live stat
// source that reaches the hook boundary, so the roster must carry it verbatim (camelCased).
const run_stats = { turns: 12, tool_calls: 34, tokens_per_second: 40, runtime_ms: 5000 }
const runStats = { turns: 12, toolCalls: 34, tokensPerSecond: 40, runtimeMs: 5000 }

const task = (toolCallId: string, args: Record<string, unknown> = {}) => ({
  toolName: 'task',
  toolCallId,
  args
})

const workflowNodes = [
  { id: 'A', label: 'Plan', category: 'deep', prompt: 'Plan' },
  { id: 'B', dependsOn: ['A'], category: 'deep', prompt: 'Build' }
]

describe('omo run stats', () => {
  it('maps a terminal task result run_stats onto the job as camelCase runStats', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'completed', run_stats } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({
        state: 'idle',
        job: { taskId: 'st_a', lifecycle: 'succeeded', runStats }
      })
    ])
  })

  it('attaches runStats to the jobGraph node joined by task_id', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', {
      toolName: 'workflow',
      toolCallId: 'w1',
      args: { action: 'start', definition: { key: 'pipeline', nodes: workflowNodes } }
    })
    await harness.post('tool_execution_end', {
      toolName: 'workflow',
      toolCallId: 'w1',
      result: {
        details: {
          kind: 'started',
          run_id: 'run-1',
          snapshot: {
            runId: 'run-1',
            status: 'running',
            nodes: workflowNodes.map((node) => ({
              ...node,
              taskId: `st_${node.id}`,
              state: 'running'
            }))
          }
        }
      }
    })
    const ended = await harness.post('tool_execution_end', {
      toolName: 'task_output',
      toolCallId: 'out-1',
      result: { details: { task_id: 'st_B', status: 'completed', run_stats } }
    })
    expect(ended.jobGraph.nodes[1]).toEqual({
      nodeId: 'B',
      dependsOn: ['A'],
      taskId: 'st_B',
      state: 'completed',
      runStats
    })
    expect(ended.jobGraph.nodes[0]).not.toHaveProperty('runStats')
    expect(ended.subagents[1].job).toEqual({ taskId: 'st_B', lifecycle: 'succeeded', runStats })
  })

  it('reads run_stats nested under a task_output status snapshot', async () => {
    // Why: omo-task.js vS() nests { task_id, status, run_stats } under details.snapshot.
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1'))
    await harness.post('tool_execution_end', {
      toolCallId: 't1',
      result: { details: { task_id: 'st_a', status: 'running', run_in_background: true } }
    })
    const ended = await harness.post('tool_execution_end', {
      toolName: 'task_output',
      toolCallId: 't2',
      result: {
        details: { kind: 'status', snapshot: { task_id: 'st_a', status: 'completed', run_stats } }
      }
    })
    expect(ended.subagents[0].job).toEqual({ taskId: 'st_a', lifecycle: 'succeeded', runStats })
  })

  it('keeps only finite numbers and omits runStats when run_stats is absent', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1'))
    await harness.post('tool_execution_start', task('t2'))
    const partial = await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: {
        details: {
          task_id: 'st_a',
          status: 'completed',
          run_stats: { turns: 3, tool_calls: 'x', tokens_per_second: Number.NaN, output_tokens: 9 }
        }
      }
    })
    expect(partial.subagents[0].job).toEqual({
      taskId: 'st_a',
      lifecycle: 'succeeded',
      runStats: { turns: 3 }
    })
    const none = await harness.post('tool_execution_end', {
      toolCallId: 't2',
      isError: false,
      result: { details: { task_id: 'st_b', status: 'completed' } }
    })
    expect(none.subagents[1].job).toEqual({ taskId: 'st_b', lifecycle: 'succeeded' })
    expect(none.subagents[1].job).not.toHaveProperty('runStats')
  })
})
