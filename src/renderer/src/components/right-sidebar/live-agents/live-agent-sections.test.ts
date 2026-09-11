import { describe, expect, it } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { buildSubagentChildRows } from '@/components/sidebar/worktree-subagent-child-rows'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { buildLiveAgentSections, dagStatusToDotState } from './live-agent-sections'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'
const tab = { id: 'tab-1', worktreeId: 'wt-1', title: 'omo' } as unknown as TerminalTab

const entry: AgentStatusEntry = {
  paneKey: PANE_KEY,
  tabId: 'tab-1',
  worktreeId: 'wt-1',
  agentType: 'omo',
  state: 'working',
  prompt: 'Build navigation',
  updatedAt: 22000,
  stateStartedAt: 1000,
  stateHistory: [],
  subagents: [
    {
      id: 'map',
      description: 'Map shell navigation',
      agentType: 'quick',
      model: 'gpt-6-astra',
      state: 'working',
      startedAt: 2000,
      job: { taskId: 'task-map', lifecycle: 'running', currentStep: 'Reading routes' }
    },
    {
      id: 'cover',
      description: 'Test coverage',
      agentType: 'quick',
      state: 'idle',
      startedAt: 0,
      job: { lifecycle: 'queued' }
    }
  ]
}

function rowsFor(rootEntry: AgentStatusEntry): DashboardAgentRow[] {
  const root: DashboardAgentRow = {
    paneKey: rootEntry.paneKey,
    entry: rootEntry,
    tab,
    agentType: 'omo',
    rowSource: 'live',
    state: rootEntry.state,
    startedAt: rootEntry.stateStartedAt
  }
  return [root, ...buildSubagentChildRows({ parentEntry: rootEntry, tab, parentIsFresh: true })]
}

describe('buildLiveAgentSections', () => {
  it('keeps flat lineage children when no jobGraph was reported', () => {
    const sections = buildLiveAgentSections(rowsFor(entry))
    expect(sections).toHaveLength(1)
    expect(sections[0].root.paneKey).toBe(PANE_KEY)
    expect(sections[0].waves).toBeNull()
    expect(sections[0].children.map((child) => child.entry.prompt)).toEqual([
      'Map shell navigation',
      'Test coverage'
    ])
  })

  it('groups jobGraph nodes by reported wave, joins roster rows and labels dependencies', () => {
    const sections = buildLiveAgentSections(
      rowsFor({
        ...entry,
        jobGraph: {
          runLabel: 'Dependency run',
          waves: [['A'], ['B', 'C']],
          nodes: [
            { nodeId: 'A', taskId: 'task-map', dependsOn: [] },
            { nodeId: 'B', taskId: 'cover', dependsOn: ['A'] },
            { nodeId: 'C', label: 'Verify evidence', dependsOn: ['A', 'B'], state: 'queued' },
            { nodeId: 'D', label: 'Late add', dependsOn: ['C'], state: 'failed' }
          ]
        }
      })
    )
    const [section] = sections
    expect(section.runLabel).toBe('Dependency run')
    expect(section.waves?.map((wave) => wave.label)).toEqual(['Wave 1', 'Wave 2', 'Unscheduled'])
    const [first, second, unscheduled] = section.waves!
    expect(first.nodes[0]).toMatchObject({
      node: { id: 'A', label: 'Map shell navigation', status: 'running' },
      dependsOnLabels: []
    })
    expect(first.nodes[0].row?.job?.currentStep).toBe('Reading routes')
    expect(second.nodes.map((graphNode) => graphNode.node.id)).toEqual(['B', 'C'])
    expect(second.nodes[0].row?.entry.prompt).toBe('Test coverage')
    expect(second.nodes[0].dependsOnLabels).toEqual(['Map shell navigation'])
    expect(second.nodes[1]).toMatchObject({
      row: null,
      dependsOnLabels: ['Map shell navigation', 'Test coverage']
    })
    expect(unscheduled.nodes[0]).toMatchObject({
      node: { id: 'D', status: 'failed' },
      dependsOnLabels: ['Verify evidence']
    })
  })

  it('derives waves from dependency depth when omo omits them and tolerates cycles', () => {
    const [section] = buildLiveAgentSections(
      rowsFor({
        ...entry,
        jobGraph: {
          nodes: [
            { nodeId: 'A', dependsOn: ['C'] },
            { nodeId: 'B', dependsOn: ['A'] },
            { nodeId: 'C', dependsOn: ['B'] },
            { nodeId: 'D', dependsOn: [] },
            { nodeId: 'E', dependsOn: ['D', 'B'] }
          ]
        }
      })
    )
    expect(section.waves?.map((wave) => wave.nodes.map((graphNode) => graphNode.node.id))).toEqual([
      ['D'],
      ['B'],
      ['C', 'E'],
      ['A']
    ])
  })

  it('maps graph status onto the shared agent state dot vocabulary', () => {
    expect(dagStatusToDotState('running')).toBe('working')
    expect(dagStatusToDotState('succeeded')).toBe('done')
    expect(dagStatusToDotState('failed')).toBe('failed')
    expect(dagStatusToDotState('cancelled')).toBe('interrupted')
    expect(dagStatusToDotState('idle')).toBe('idle')
  })
})
