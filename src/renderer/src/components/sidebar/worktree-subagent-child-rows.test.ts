import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { buildSubagentChildRows } from './worktree-subagent-child-rows'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'
const tab = { id: 'tab-1', worktreeId: 'wt-1', title: 'omo' } as unknown as TerminalTab

function makeParent(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey: PANE_KEY,
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    agentType: 'omo',
    state: 'working',
    prompt: 'Build navigation',
    updatedAt: 22_000,
    stateStartedAt: 1_000,
    stateHistory: [],
    subagents: [
      {
        id: 'map',
        description: 'Map shell navigation',
        agentType: 'quick',
        state: 'working',
        startedAt: 2_000,
        job: { taskId: 'task-map', lifecycle: 'running' }
      }
    ],
    ...overrides
  }
}

describe('buildSubagentChildRows', () => {
  it('carries the parent session cwd onto each child row entry', () => {
    // Why: the child transcript lives under the parent omo process cwd, which can be
    // a subdirectory of the worktree; the row is the only place a click can read it from.
    const rows = buildSubagentChildRows({
      parentEntry: makeParent({ sessionCwd: '/repo/worktrees/omo/packages/app' }),
      tab,
      parentIsFresh: true
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].entry.sessionCwd).toBe('/repo/worktrees/omo/packages/app')
  })

  it('leaves sessionCwd undefined when the parent reported none', () => {
    const rows = buildSubagentChildRows({ parentEntry: makeParent(), tab, parentIsFresh: true })

    expect(rows).toHaveLength(1)
    expect(rows[0].entry.sessionCwd).toBeUndefined()
    expect('sessionCwd' in rows[0].entry).toBe(false)
  })
})
