import { describe, expect, it } from 'vitest'
import { agentJobGraphSchema, normalizeJobGraphField } from './agent-job-graph'
import {
  normalizeAgentStatusPayload,
  parseAgentStatusPayload,
  pickParsedAgentStatusPayload
} from './agent-status-types'

const jobGraph = {
  runId: 'run-1',
  runLabel: 'Synthetic run',
  waves: [['A'], ['B']],
  nodes: [
    { nodeId: 'A', taskId: 'task-a', label: 'Gate wiring', dependsOn: [], state: 'running' },
    { nodeId: 'B', dependsOn: ['A'] }
  ]
}

describe('agent job graph contract', () => {
  it('accepts the full contract and preserves it through JSON, projection and structured clone', () => {
    expect(agentJobGraphSchema.parse(jobGraph)).toEqual(jobGraph)
    const payload = parseAgentStatusPayload(JSON.stringify({ state: 'working', jobGraph }))!
    expect(payload.jobGraph).toEqual(jobGraph)
    expect(structuredClone(pickParsedAgentStatusPayload(payload)).jobGraph).toEqual(jobGraph)
  })
  it('round-trips per-node runStats and leaves nodes without stats untouched', () => {
    const runStats = { turns: 12, toolCalls: 34, tokensPerSecond: 40, runtimeMs: 5000 }
    const graph = {
      nodes: [
        { nodeId: 'A', dependsOn: [], state: 'completed', runStats },
        { nodeId: 'B', dependsOn: ['A'], runStats: { turns: 3 } },
        { nodeId: 'C', dependsOn: ['A'] }
      ]
    }
    const parsed = normalizeJobGraphField(graph)!
    expect(parsed).toEqual(graph)
    expect(parsed.nodes[0].runStats).toEqual(runStats)
    expect(parsed.nodes[1].runStats).toEqual({ turns: 3 })
    expect(parsed.nodes[2]).not.toHaveProperty('runStats')
    const payload = parseAgentStatusPayload(JSON.stringify({ state: 'working', jobGraph: graph }))!
    expect(structuredClone(pickParsedAgentStatusPayload(payload)).jobGraph).toEqual(graph)
  })
  it('strips unknown fields and preserves an explicitly empty graph', () => {
    expect(normalizeJobGraphField({ nodes: [], extra: () => {} })).toEqual({ nodes: [] })
    expect(normalizeJobGraphField({ nodes: [{ nodeId: 'A', dependsOn: [], extra: 1 }] })).toEqual({
      nodes: [{ nodeId: 'A', dependsOn: [] }]
    })
  })
  it.each([
    null,
    {},
    { nodes: 'bad' },
    { nodes: [{ nodeId: 'A' }] },
    { nodes: [{ nodeId: 1, dependsOn: [] }] },
    { nodes: [], waves: [1] },
    { nodes: [{ nodeId: 'A', dependsOn: [1] }] },
    { nodes: [], runId: 1 },
    { nodes: [{ nodeId: 'A', dependsOn: [], runStats: { turns: '12' } }] },
    { nodes: [{ nodeId: 'A', dependsOn: [], runStats: { runtimeMs: Number.POSITIVE_INFINITY } }] }
  ])('drops malformed graph metadata without losing the status: %j', (value) => {
    const payload = normalizeAgentStatusPayload({ state: 'working', jobGraph: value })
    expect(payload?.state).toBe('working')
    expect(payload?.jobGraph).toBeUndefined()
  })
  it('leaves absent graph payloads unchanged', () => {
    const payload = normalizeAgentStatusPayload({ state: 'working' })!
    expect(payload).not.toHaveProperty('jobGraph')
    expect(pickParsedAgentStatusPayload(payload)).not.toHaveProperty('jobGraph')
  })
})
