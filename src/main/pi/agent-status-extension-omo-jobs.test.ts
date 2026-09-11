import { describe, expect, it } from 'vitest'

import { createAgentStatusPostingHarness as createHarness } from './agent-status-extension-test-harness'

const workflowDefinition = {
  key: 'pipeline',
  name: 'Pipeline',
  nodes: [
    { id: 'A', label: 'Plan', category: 'deep', prompt: 'Plan' },
    { id: 'B', dependsOn: ['A'], category: 'deep', prompt: 'Build' },
    { id: 'C', dependsOn: ['A', 'B'], category: 'deep', prompt: 'Verify' }
  ],
  waves: [['A'], ['B'], ['C']]
}
const workflowGraph = {
  runLabel: 'Pipeline',
  nodes: [
    { nodeId: 'A', label: 'Plan', dependsOn: [] },
    { nodeId: 'B', dependsOn: ['A'] },
    { nodeId: 'C', dependsOn: ['A', 'B'] }
  ],
  waves: workflowDefinition.waves
}
const workflow = (toolCallId = 'w1', args: Record<string, unknown> = {}) => ({
  toolName: 'workflow',
  toolCallId,
  args: { action: 'start', definition: workflowDefinition, ...args }
})

describe('omo workflow graph', () => {
  it('emits definition dependencies and waves alongside an existing task roster', async () => {
    const harness = createHarness()
    const taskOnly = await harness.post('tool_execution_start', task('t1'))
    expect(taskOnly).not.toHaveProperty('jobGraph')
    const started = await harness.post('tool_execution_start', workflow())
    expect(started.jobGraph).toEqual(workflowGraph)
    expect(started.subagents).toEqual(taskOnly.subagents)
    expect((await harness.post('agent_start')).jobGraph).toEqual(workflowGraph)
  })

  it('joins snapshot child IDs and object waves, then tracks task terminal observations', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', workflow())
    const snapshot = {
      runId: 'run-1',
      name: 'Pipeline',
      status: 'running',
      nodes: workflowDefinition.nodes.map((node) => ({
        ...node,
        dependsOn: node.dependsOn ?? [],
        taskId: `st_${node.id}`,
        state: 'running'
      })),
      waves: workflowDefinition.waves.map((nodeIds, index) => ({ index, nodeIds }))
    }
    const ended = await harness.post('tool_execution_end', {
      toolName: 'workflow',
      toolCallId: 'w1',
      result: { details: { kind: 'started', run_id: 'run-1', snapshot } }
    })
    expect(ended.jobGraph).toEqual({
      ...workflowGraph,
      runId: 'run-1',
      nodes: workflowGraph.nodes.map((node) => ({
        ...node,
        taskId: `st_${node.nodeId}`,
        state: 'running'
      }))
    })
    expect(ended.subagents.map((row: { job: { taskId: string } }) => row.job.taskId)).toEqual([
      'st_A',
      'st_B',
      'st_C'
    ])
    const terminal = await harness.post('tool_execution_end', {
      toolName: 'task_output',
      toolCallId: 'output-1',
      result: { details: { snapshot: { task_id: 'st_A', status: 'completed' } } }
    })
    expect(terminal.jobGraph.nodes[0]).toEqual({
      ...workflowGraph.nodes[0],
      taskId: 'st_A',
      state: 'completed'
    })
    expect(terminal.subagents[0].job.lifecycle).toBe('succeeded')
    const continued = await harness.post('before_agent_start', { prompt: 'continue' })
    expect(continued.jobGraph).toEqual(terminal.jobGraph)
    expect(continued.subagents.map((row: { job: { taskId: string } }) => row.job.taskId)).toEqual([
      'st_B',
      'st_C'
    ])
    const waited = await harness.post('tool_execution_end', {
      toolName: 'workflow',
      toolCallId: 'wait-1',
      result: {
        details: {
          kind: 'waited',
          run_id: 'run-1',
          result: {
            snapshot: {
              ...snapshot,
              status: 'completed',
              nodes: snapshot.nodes.map((node) => ({ ...node, state: 'completed' }))
            }
          }
        }
      }
    })
    expect(waited.jobGraph.nodes.map((node: { state: string }) => node.state)).toEqual([
      'completed',
      'completed',
      'completed'
    ])
    expect(await harness.post('before_agent_start', { prompt: 'new task' })).not.toHaveProperty(
      'jobGraph'
    )
  })

  it('does not fabricate waves or IDs and drops a refused definition', async () => {
    const harness = createHarness()
    const { waves: _waves, ...definition } = workflowDefinition
    const started = await harness.post('tool_execution_start', workflow('w1', { definition }))
    expect(started.jobGraph).toEqual({ nodes: workflowGraph.nodes, runLabel: 'Pipeline' })
    const refused = await harness.post('tool_execution_end', {
      toolName: 'workflow',
      toolCallId: 'w1',
      isError: false,
      result: { details: { kind: 'error', error: { code: 'invalid_definition' } } }
    })
    expect(refused).not.toHaveProperty('jobGraph')
  })

  it.each([
    undefined,
    { nodes: [] },
    { nodes: [{ id: 12 }] },
    { nodes: [{ id: 'A', dependsOn: [42] }] }
  ])('omits malformed definitions (%j)', async (definition) => {
    const harness = createHarness()
    expect(
      await harness.post('tool_execution_start', workflow('w1', { definition }))
    ).not.toHaveProperty('jobGraph')
  })

  it('adopts attached runs and ignores late results from a replaced run', async () => {
    const harness = createHarness()
    await harness.post(
      'tool_execution_start',
      workflow('attach-1', { action: 'attach', definition: undefined, run_id: 'run-1' })
    )
    const attached = await harness.post('tool_execution_end', {
      toolName: 'workflow',
      toolCallId: 'attach-1',
      result: {
        details: {
          kind: 'attached',
          run_id: 'run-1',
          snapshot: { ...workflowDefinition, runId: 'run-1', status: 'running' }
        }
      }
    })
    expect(attached.jobGraph).toEqual({ ...workflowGraph, runId: 'run-1' })
    await harness.post(
      'tool_execution_start',
      workflow('w2', { definition: { key: 'next', nodes: [{ id: 'D' }] } })
    )
    const late = await harness.post('tool_execution_end', {
      toolName: 'workflow',
      toolCallId: 'attach-1',
      result: {
        details: {
          kind: 'snapshot',
          run_id: 'run-1',
          snapshot: { ...workflowDefinition, runId: 'run-1' }
        }
      }
    })
    expect(late.jobGraph).toEqual({ nodes: [{ nodeId: 'D', dependsOn: [] }] })
  })

  it('does not leak graph state into another session or another agent kind', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', workflow())
    await harness.callHook('session_start', { reason: 'switch' })
    expect(await harness.post('tool_execution_start', task('t1'))).not.toHaveProperty('jobGraph')
    for (const kind of ['pi', 'omp', 'prime-agent'] as const) {
      expect(
        await createHarness({ kind }).post('tool_execution_start', workflow())
      ).not.toHaveProperty('jobGraph')
    }
  })
})

const task = (toolCallId: string, args: Record<string, unknown> = {}) => ({
  toolName: 'task',
  toolCallId,
  args
})

describe('omo task roster', () => {
  it.each([false, true])('reports task start and completion (isError=%s)', async (isError) => {
    const harness = createHarness()
    const started = await harness.post(
      'tool_execution_start',
      task('t1', { task_summary: 'lane A', description: 'fallback', run_in_background: true })
    )
    expect(started.subagents).toEqual([
      {
        id: 't1',
        agentType: 'omo',
        description: 'lane A',
        state: 'working',
        startedAt: expect.any(Number),
        job: { taskId: 't1', lifecycle: 'running' }
      }
    ])
    const ended = await harness.post('tool_execution_end', { toolCallId: 't1', isError })
    expect(started).not.toHaveProperty('jobGraph')
    expect(ended).not.toHaveProperty('jobGraph')
    expect(ended.subagents).toEqual([
      {
        ...started.subagents[0],
        state: 'idle',
        job: { taskId: 't1', lifecycle: isError ? 'failed' : 'succeeded' }
      }
    ])
    expect(harness.fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4321/hook/omo')
  })

  it('keeps a background task running when its spawn tool returns immediately', async () => {
    // Why: omo's task tool returns as soon as a run_in_background job is spawned (details:
    // status 'running'); that tool return is not job completion. Rekey by the real task_id.
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: {
        details: { task_id: 'st_abc', status: 'running', mode: 'spawn', run_in_background: true }
      }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({
        id: 't1',
        state: 'working',
        job: { taskId: 'st_abc', lifecycle: 'running' }
      })
    ])
  })

  it('finishes a background task when a later tool result reports it terminal', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_abc', status: 'running', run_in_background: true } }
    })
    // task_output / task_send style follow-up carrying the terminal status for that task id.
    await harness.post('tool_execution_start', {
      toolName: 'task_output',
      toolCallId: 't2',
      args: { task_id: 'st_abc' }
    })
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't2',
      isError: false,
      result: { details: { task_id: 'st_abc', status: 'completed' } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({
        id: 't1',
        state: 'idle',
        job: { taskId: 'st_abc', lifecycle: 'succeeded' }
      })
    ])
  })

  it('retains still-running background jobs across a new prompt and drops finished ones', async () => {
    // Why: a background child outlives the parent turn; the next prompt must not blind the dashboard.
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'running', run_in_background: true } }
    })
    await harness.post('tool_execution_start', task('t2', { task_summary: 'lane B' }))
    await harness.post('tool_execution_end', {
      toolCallId: 't2',
      isError: false,
      result: { details: { task_id: 'st_b', status: 'completed', run_in_background: false } }
    })
    const next = await harness.post('before_agent_start', { prompt: 'next' })
    expect(next.subagents).toEqual([
      expect.objectContaining({
        id: 't1',
        state: 'working',
        job: { taskId: 'st_a', lifecycle: 'running' }
      })
    ])
    // A later status for the retained child still finishes it.
    await harness.post('tool_execution_start', {
      toolName: 'task_output',
      toolCallId: 't3',
      args: { task_id: 'st_a' }
    })
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't3',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'completed' } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({
        id: 't1',
        state: 'idle',
        job: { taskId: 'st_a', lifecycle: 'succeeded' }
      })
    ])
  })

  it('fans a batch spawn out into one row per child', async () => {
    const harness = createHarness()
    await harness.post(
      'tool_execution_start',
      task('t1', { tasks: [{ task_summary: 'A' }, { task_summary: 'B' }] })
    )
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: {
        details: {
          task_id: 'st_a',
          status: 'running',
          run_in_background: true,
          items: [
            { task_id: 'st_a', name: 'A', task_summary: 'A', status: 'running' },
            { task_id: 'st_b', name: 'B', task_summary: 'B', status: 'running' }
          ]
        }
      }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({
        description: 'A',
        state: 'working',
        job: { taskId: 'st_a', lifecycle: 'running' }
      }),
      expect.objectContaining({
        description: 'B',
        state: 'working',
        job: { taskId: 'st_b', lifecycle: 'running' }
      })
    ])
    const later = await harness.post('tool_execution_end', {
      toolCallId: 't9',
      isError: false,
      result: { details: { task_id: 'st_b', status: 'completed' } }
    })
    expect(later.subagents).toEqual([
      expect.objectContaining({ job: { taskId: 'st_a', lifecycle: 'running' } }),
      expect.objectContaining({ state: 'idle', job: { taskId: 'st_b', lifecycle: 'succeeded' } })
    ])
  })

  it('resolves a single-item batch whose result collapses to one task (no items)', async () => {
    // Why: omo routes a one-element tasks[] through the single-task path, returning top-level
    // details with no items[]; the provisional batch row must still adopt that task_id.
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { tasks: [{ task_summary: 'solo' }] }))
    await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_solo', status: 'running', run_in_background: true } }
    })
    const later = await harness.post('tool_execution_start', {
      toolName: 'task_output',
      toolCallId: 't2',
      args: { task_id: 'st_solo' }
    })
    // The row is reachable by its real task id, proving the collapse was reconciled.
    void later
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't2',
      isError: false,
      result: { details: { task_id: 'st_solo', status: 'completed' } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({ state: 'idle', job: { taskId: 'st_solo', lifecycle: 'succeeded' } })
    ])
  })

  it('fails every provisional row when a whole batch invocation is refused (no items)', async () => {
    const harness = createHarness()
    await harness.post(
      'tool_execution_start',
      task('t1', { tasks: [{ task_summary: 'A' }, { task_summary: 'B' }] })
    )
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: true,
      result: { details: { task_id: '', status: 'invalid_arguments', mode: 'spawn' } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({
        description: 'A',
        state: 'idle',
        job: expect.objectContaining({ lifecycle: 'failed' })
      }),
      expect.objectContaining({
        description: 'B',
        state: 'idle',
        job: expect.objectContaining({ lifecycle: 'failed' })
      })
    ])
  })

  it('does not fabricate completion from a control result that carries no status', async () => {
    // Why: task_output / task_send can return a noop/queued control result for a live task; that
    // is not a terminal outcome and must leave the running row untouched.
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'running', run_in_background: true } }
    })
    await harness.post('tool_execution_start', {
      toolName: 'task_send',
      toolCallId: 't2',
      args: { task_id: 'st_a' }
    })
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't2',
      isError: false,
      result: { details: { task_id: 'st_a', queue_position: 1 } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({ state: 'working', job: { taskId: 'st_a', lifecycle: 'running' } })
    ])
  })

  it('single-item batch that finishes in one result marks the sole row done', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { tasks: [{ task_summary: 'solo' }] }))
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_solo', status: 'completed', run_in_background: false } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({ state: 'idle', job: { taskId: 'st_solo', lifecycle: 'succeeded' } })
    ])
  })

  it('finishes a live row when a control result carries a recognized terminal status', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'running', run_in_background: true } }
    })
    await harness.post('tool_execution_start', {
      toolName: 'task_output',
      toolCallId: 't2',
      args: { task_id: 'st_a' }
    })
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't2',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'cancelled' } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({ state: 'idle', job: { taskId: 'st_a', lifecycle: 'cancelled' } })
    ])
  })

  it('treats an interrupted result as terminal (cancelled), not still running', async () => {
    // Why: omo-task.js Jv() counts 'interrupted' as terminal alongside completed/error/cancelled/lost.
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'interrupted', run_in_background: false } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({ state: 'idle', job: { taskId: 'st_a', lifecycle: 'cancelled' } })
    ])
  })

  it('re-opens a finished child when task_send revives it', async () => {
    // Why: task_send can revive a completed/error/interrupted resident child; omo returns
    // { kind: 'revived', task_id, run_epoch } with no status. The row must go back to working.
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'completed', run_in_background: true } }
    })
    await harness.post('tool_execution_start', {
      toolName: 'task_send',
      toolCallId: 't2',
      args: { task_id: 'st_a' }
    })
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't2',
      isError: false,
      result: { details: { kind: 'revived', task_id: 'st_a', run_epoch: 2 } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({ state: 'working', job: { taskId: 'st_a', lifecycle: 'running' } })
    ])
  })

  it('finishes a tracked job when task_output reports it terminal inside details.snapshot', async () => {
    // Why: omo-task.js vS() returns { kind: 'status', snapshot: { task_id, status } } — the child's
    // id and terminal status live under details.snapshot, NOT at the top level.
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: false,
      result: { details: { task_id: 'st_a', status: 'running', run_in_background: true } }
    })
    await harness.post('tool_execution_start', {
      toolName: 'task_output',
      toolCallId: 't2',
      args: { task_id: 'st_a' }
    })
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't2',
      isError: false,
      result: { details: { kind: 'status', snapshot: { task_id: 'st_a', status: 'completed' } } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({ state: 'idle', job: { taskId: 'st_a', lifecycle: 'succeeded' } })
    ])
  })

  it('marks a refused spawn failed instead of leaving a nameless running row', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1', { task_summary: 'lane A' }))
    const ended = await harness.post('tool_execution_end', {
      toolCallId: 't1',
      isError: true,
      result: { details: { task_id: '', status: 'invalid_arguments', mode: 'spawn' } }
    })
    expect(ended.subagents).toEqual([
      expect.objectContaining({
        id: 't1',
        state: 'idle',
        job: { taskId: 't1', lifecycle: 'failed' }
      })
    ])
  })

  it('carries the full roster on every later status and clears it on a new prompt', async () => {
    const harness = createHarness()
    await harness.post('tool_execution_start', task('t1'))
    const started = await harness.post('tool_execution_start', task('t2'))
    const events = [
      ['tool_call', { toolName: 'read', input: {} }],
      ['tool_execution_start', { toolName: 'read', toolCallId: 'read-1' }],
      ['tool_execution_end', { toolCallId: 'read-1' }],
      ['message_end', { message: { role: 'assistant', content: 'done' } }],
      ['tool_approval_requested', { toolName: 'bash' }],
      ['tool_approval_resolved', { toolName: 'bash', approved: true }],
      ['agent_start', undefined],
      ['agent_settled', undefined]
    ] as const
    for (const [name, event] of events) {
      expect((await harness.post(name, event)).subagents).toEqual(started.subagents)
    }
    expect(await harness.post('before_agent_start', { prompt: 'new turn' })).not.toHaveProperty(
      'subagents'
    )
    expect(await harness.post('agent_start')).not.toHaveProperty('subagents')
  })

  it('bounds descriptions and prefers task_summary even when empty', async () => {
    const harness = createHarness()
    const cases = [
      [{ description: 'a'.repeat(201) }, 'a'.repeat(200)],
      [{ task_summary: '', description: 'fallback' }, ''],
      [{ task_summary: 123 }, '123'],
      [{}, '']
    ] as const
    for (const [index, [args, description]] of cases.entries()) {
      const payload = await harness.post('tool_execution_start', task(String(index), args))
      expect(payload.subagents[index].description).toBe(description)
    }
  })

  it('caps the roster at 32, evicting oldest idle jobs before running jobs', async () => {
    const harness = createHarness()
    for (let index = 0; index < 32; index += 1) {
      await harness.post('tool_execution_start', task(String(index)))
    }
    await harness.post('tool_execution_end', { toolCallId: '5' })
    await harness.post('tool_execution_end', { toolCallId: '3' })
    for (const [newId, removedId] of [
      ['32', '3'],
      ['33', '5'],
      ['34', '0']
    ]) {
      const payload = await harness.post('tool_execution_start', task(newId))
      expect(payload.subagents).toHaveLength(32)
      expect(payload.subagents.map((entry: { id: string }) => entry.id)).not.toContain(removedId)
      expect(payload.subagents.at(-1).id).toBe(newId)
    }
  })

  it('keeps the roster on the latest pending post when intermediate posts are replaced', async () => {
    const harness = createHarness()
    let finishDelivery!: () => void
    harness.fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDelivery = () => resolve({ ok: true })
        })
    )
    await harness.callHook('agent_start')
    await harness.callHook('tool_execution_start', task('t1'))
    await harness.callHook('tool_execution_end', { toolCallId: 't1' })
    const posted = harness.post('message_end', {
      message: { role: 'assistant', content: 'done' }
    })
    finishDelivery()
    expect((await posted).subagents).toMatchObject([
      { id: 't1', state: 'idle', job: { lifecycle: 'succeeded' } }
    ])
    expect(harness.fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('omo settlement contract', () => {
  it('preserves approvals for omo detected through the Pi extension', async () => {
    const harness = createHarness({ kind: 'pi', title: 'omo' })
    const requested = await harness.post('tool_approval_requested', { toolName: 'bash' })
    expect(requested.tool_name).toBe('bash')
    const resolved = await harness.post('tool_approval_resolved', {
      toolName: 'bash',
      approved: true
    })
    expect(resolved.approved).toBe(true)
    expect(harness.fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4321/hook/omo')
  })

  it('waits for agent_settled rather than treating absent willContinue as completion', async () => {
    const harness = createHarness()
    await harness.post('agent_settled')
    await harness.post('agent_start')
    await harness.callHook('agent_end', {}, { isIdle: () => false })
    expect(harness.fetchMock).toHaveBeenCalledTimes(2)
    await harness.post('agent_settled')
    expect(harness.fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps an unflagged first agent_end working while the context is not idle', async () => {
    const harness = createHarness()
    await harness.callHook('agent_end', {}, { isIdle: () => false })
    expect(harness.fetchMock).not.toHaveBeenCalled()
    await harness.post('agent_settled')
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps a continuing turn working even without an idle context', async () => {
    const harness = createHarness()
    await harness.callHook('agent_end', { willContinue: true })
    expect(harness.fetchMock).not.toHaveBeenCalled()
    await harness.post('agent_settled')
  })
})
