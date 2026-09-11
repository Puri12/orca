import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeHookPayload } from '../../../../shared/agent-hook-listener'
import { createHookListenerState } from '../../../../shared/agent-hook-listener/listener-state'
import { PANE_KEY } from '../../../../shared/agent-hook-listener-test-harness'
import { normalizeAgentStatusEvent } from '../../hooks/ipc-events/normalize-agent-status-event'
import { buildDagViewModel } from '../../components/right-sidebar/live-agents/dag-view-model'
import { createTestStore } from './store-test-helpers'

const jobGraph = {
  runId: 'run-1',
  waves: [['A'], ['B']],
  nodes: [
    { nodeId: 'A', taskId: 'task-a', dependsOn: [] },
    { nodeId: 'B', dependsOn: ['A'], state: 'queued' }
  ]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('OMO jobGraph hook to store', () => {
  it.each([null, 'ssh-host'])(
    'threads synthetic hooks through IPC and live updates (%s)',
    (connectionId) => {
      const event = normalizeHookPayload(
        createHookListenerState(),
        'omo',
        {
          paneKey: PANE_KEY,
          payload: {
            hook_event_name: 'tool_execution_start',
            tool_name: 'task',
            jobGraph,
            subagents: [
              {
                id: 'job-a',
                state: 'working',
                startedAt: 100,
                job: { taskId: 'task-a', lifecycle: 'running', currentStep: 'Wiring gate' }
              }
            ]
          }
        },
        'production'
      )!
      expect(event.payload.jobGraph).toEqual(jobGraph)
      const normalized = normalizeAgentStatusEvent({
        ...event.payload,
        paneKey: PANE_KEY,
        connectionId,
        receivedAt: 1000,
        stateStartedAt: 1000
      })!
      const store = createTestStore()
      store.getState().setAgentStatus(PANE_KEY, normalized, undefined, { updatedAt: 1000 })
      const first = store.getState().agentStatusByPaneKey[PANE_KEY]
      expect(first.jobGraph).toEqual(jobGraph)
      expect(buildDagViewModel(first).edges).toEqual([{ from: 'A', to: 'B' }])
      expect(buildDagViewModel(first).nodes[0].currentStep).toBe('Wiring gate')
      store
        .getState()
        .setAgentStatus(PANE_KEY, structuredClone(normalized), undefined, { updatedAt: 1001 })
      expect(store.getState().agentStatusByPaneKey[PANE_KEY].jobGraph).toBe(first.jobGraph)
      const changed = {
        ...jobGraph,
        nodes: jobGraph.nodes.map((node) => ({ ...node, dependsOn: [] }))
      }
      store.getState().setAgentStatus(PANE_KEY, { ...normalized, jobGraph: changed }, undefined, {
        updatedAt: 1002
      })
      expect(buildDagViewModel(store.getState().agentStatusByPaneKey[PANE_KEY]).edges).toEqual([])
      store.getState().setAgentStatus(PANE_KEY, { ...normalized, jobGraph: undefined }, undefined, {
        updatedAt: 1003
      })
      const fallback = store.getState().agentStatusByPaneKey[PANE_KEY]
      expect(fallback.jobGraph).toBeUndefined()
      expect(buildDagViewModel(fallback).edges[0].from).toBe(PANE_KEY)
    }
  )
  it('keeps per-child runStats from the hook through to the stored entry', () => {
    const runStats = { turns: 12, toolCalls: 34, tokensPerSecond: 40, runtimeMs: 5000 }
    const roster = [
      {
        id: 'job-a',
        state: 'idle',
        startedAt: 100,
        job: { taskId: 'task-a', lifecycle: 'succeeded' }
      }
    ]
    const hook = (subagents: unknown[], nodes: unknown[]) =>
      normalizeAgentStatusEvent({
        ...normalizeHookPayload(
          createHookListenerState(),
          'omo',
          {
            paneKey: PANE_KEY,
            payload: {
              hook_event_name: 'tool_execution_end',
              tool_name: 'task',
              jobGraph: { nodes },
              subagents
            }
          },
          'production'
        )!.payload,
        paneKey: PANE_KEY,
        connectionId: null,
        receivedAt: 1000,
        stateStartedAt: 1000
      })!
    const store = createTestStore()
    const node = { nodeId: 'A', taskId: 'task-a', dependsOn: [], state: 'completed' }
    store.getState().setAgentStatus(PANE_KEY, hook(roster, [node]), undefined, { updatedAt: 1000 })
    const before = store.getState().agentStatusByPaneKey[PANE_KEY]
    expect(before.subagents?.[0].job).not.toHaveProperty('runStats')
    expect(before.jobGraph?.nodes[0]).not.toHaveProperty('runStats')

    // Why: stats can land on an already-finished row; the store must not keep the stale stat-less roster.
    const withStats = hook(
      [{ ...roster[0], job: { ...roster[0].job, runStats } }],
      [{ ...node, runStats }]
    )
    store.getState().setAgentStatus(PANE_KEY, withStats, undefined, { updatedAt: 1001 })
    const after = store.getState().agentStatusByPaneKey[PANE_KEY]
    expect(after.subagents?.[0].job?.runStats).toEqual(runStats)
    expect(after.jobGraph?.nodes[0].runStats).toEqual(runStats)
    expect(buildDagViewModel(after).nodes[0].runStats).toEqual(runStats)
  })

  it.each(['pi', 'omp', 'prime-agent'] as const)(
    'does not forward OMO graphs from %s hooks',
    (agent) => {
      const event = normalizeHookPayload(
        createHookListenerState(),
        agent,
        { paneKey: PANE_KEY, payload: { hook_event_name: 'agent_start', jobGraph } },
        'production'
      )!
      expect(event.payload.jobGraph).toBeUndefined()
    }
  )
})
