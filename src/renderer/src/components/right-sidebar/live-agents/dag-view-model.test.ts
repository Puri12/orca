import { describe, expect, it } from 'vitest'
import type {
  AgentStatusEntry,
  AgentSubagentJobLifecycle
} from '../../../../../shared/agent-status-types'
import { buildDagViewModel } from './dag-view-model'

export const entry: AgentStatusEntry = {
  paneKey: 'tab:leaf',
  agentType: 'omo',
  state: 'working',
  prompt: 'Build navigation',
  updatedAt: 22000,
  stateStartedAt: 1000,
  stateHistory: [],
  model: 'gpt-6-astra',
  subagents: [
    {
      id: 'map',
      description: 'Map shell navigation',
      agentType: 'quick',
      model: 'gpt-6-astra',
      state: 'idle',
      startedAt: 2000,
      job: { taskId: 'task-map', lifecycle: 'running', currentStep: 'Reading routes' }
    }
  ]
}

describe('buildDagViewModel', () => {
  it('uses true dependencies and waves instead of roster lineage when jobGraph is present', () => {
    const graphEntry = {
      ...entry,
      jobGraph: {
        runId: 'run-1',
        runLabel: 'Dependency run',
        waves: [['A'], ['B'], ['C']],
        nodes: [
          { nodeId: 'A', taskId: 'task-map', dependsOn: [], state: 'queued' },
          { nodeId: 'B', label: 'Test coverage', dependsOn: ['A'], state: 'succeeded' },
          { nodeId: 'C', label: 'Verify evidence', dependsOn: ['A', 'B'], state: 'queued' }
        ]
      }
    }
    const vm = buildDagViewModel(graphEntry)
    expect(vm.edges).toEqual([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' }
    ])
    expect(vm.nodes.map((node) => node.id)).toEqual(['A', 'B', 'C'])
    expect(vm.nodes[0]).toMatchObject({
      label: 'Map shell navigation',
      status: 'running',
      currentStep: 'Reading routes'
    })
    expect(vm).toMatchObject({ runLabel: 'Dependency run', waves: [['A'], ['B'], ['C']] })
    expect(buildDagViewModel(entry).edges).toEqual([
      { from: entry.paneKey, to: `${entry.paneKey}\u0000subagent:map` }
    ])
  })
  it('joins task ids to roster ids and keeps unreported nodes with graph metadata', () => {
    const vm = buildDagViewModel({
      ...entry,
      jobGraph: {
        nodes: [
          { nodeId: 'A', taskId: 'map', label: 'Gate wiring', dependsOn: [] },
          { nodeId: 'B', label: 'Coverage', dependsOn: ['A', 'A', 'missing'], state: 'succeeded' },
          { nodeId: 'C', dependsOn: [], state: 'future-state' }
        ]
      }
    })
    expect(vm.nodes[0]).toMatchObject({
      id: 'A',
      label: 'Gate wiring',
      status: 'running',
      model: 'gpt-6-astra'
    })
    expect(vm.nodes[1]).toMatchObject({ id: 'B', label: 'Coverage', status: 'succeeded' })
    expect(vm.nodes[2]).toMatchObject({ id: 'C', label: 'C', status: 'idle' })
    expect(vm.edges).toEqual([{ from: 'A', to: 'B' }])
  })
  it('does not invent a coordinator or lineage for an explicitly empty graph', () => {
    expect(buildDagViewModel({ ...entry, jobGraph: { nodes: [] } })).toMatchObject({
      nodes: [],
      edges: []
    })
  })
  it('derives coordinator, child metadata and lineage edges', () => {
    const vm = buildDagViewModel(entry)
    expect(vm.runLabel).toBe('Build navigation')
    expect(vm.nodes).toEqual([
      expect.objectContaining({
        id: entry.paneKey,
        label: 'Build navigation',
        status: 'running',
        model: 'gpt-6-astra'
      }),
      expect.objectContaining({
        label: 'Map shell navigation',
        status: 'running',
        agentType: 'quick',
        model: 'gpt-6-astra',
        currentStep: 'Reading routes',
        startedAt: 2000
      })
    ])
    expect(vm.edges).toEqual([{ from: entry.paneKey, to: vm.nodes[1].id }])
  })
  it.each<[AgentSubagentJobLifecycle, string]>([
    ['queued', 'idle'],
    ['running', 'running'],
    ['blocked', 'idle'],
    ['waiting', 'idle'],
    ['succeeded', 'succeeded'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['unknown', 'idle']
  ])('maps lifecycle %s to %s, ahead of state', (lifecycle, expected) => {
    const subagent = { ...entry.subagents![0], state: 'working' as const, job: { lifecycle } }
    expect(buildDagViewModel({ ...entry, subagents: [subagent] }).nodes[1].status).toBe(expected)
  })
  it.each(['working', 'blocked', 'waiting', 'idle'] as const)('maps fallback state %s', (state) => {
    const subagent = { ...entry.subagents![0], state, job: undefined }
    expect(buildDagViewModel({ ...entry, subagents: [subagent] }).nodes[1].status).toBe(
      state === 'working' ? 'running' : 'idle'
    )
  })
  it('distinguishes completed turns, cancellation and session idle', () => {
    expect(buildDagViewModel({ ...entry, state: 'done' }).nodes[0].status).toBe('succeeded')
    expect(buildDagViewModel({ ...entry, state: 'done', interrupted: true }).nodes[0].status).toBe(
      'cancelled'
    )
    expect(
      buildDagViewModel({ ...entry, state: 'done', sessionBoundary: true }).nodes[0].status
    ).toBe('idle')
  })
  it('keeps an empty roster as a coordinator-only graph', () => {
    const vm = buildDagViewModel({ ...entry, subagents: undefined })
    expect(vm.nodes).toHaveLength(1)
    expect(vm.edges).toEqual([])
  })
})
