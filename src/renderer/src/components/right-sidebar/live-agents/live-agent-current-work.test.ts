import { describe, expect, it } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import {
  buildCurrentWorkDetail,
  currentWorkSourceFromGraphNode,
  currentWorkSourceFromRow
} from './live-agent-current-work'

const NOW = 10 * 60 * 60_000
const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'
const tab = {
  id: 'tab-1',
  worktreeId: 'wt-1',
  title: 'omo'
} as unknown as TerminalTab

function makeRow(
  entryOverrides: Partial<AgentStatusEntry> = {},
  rowOverrides: Partial<DashboardAgentRow> = {}
): DashboardAgentRow {
  const entry: AgentStatusEntry = {
    paneKey: PANE_KEY,
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    agentType: 'omo',
    state: 'working',
    prompt: 'Build navigation',
    updatedAt: NOW,
    stateStartedAt: 0,
    stateHistory: [],
    ...entryOverrides
  }
  return {
    paneKey: PANE_KEY,
    entry,
    tab,
    agentType: 'omo',
    rowSource: 'live',
    state: 'working',
    startedAt: 0,
    ...rowOverrides
  }
}

describe('buildCurrentWorkDetail', () => {
  it('lists step, tool, latest message, model, state and elapsed in order for a live row', () => {
    const row = makeRow(
      {
        toolName: 'Read',
        toolInput: 'src/router.ts',
        lastAssistantMessage: '  Mapped 12 routes so far  ',
        model: 'gpt-6-astra',
        stateStartedAt: NOW - 5 * 60_000
      },
      { job: { lifecycle: 'running', currentStep: 'Reading routes' } }
    )

    const detail = buildCurrentWorkDetail(currentWorkSourceFromRow(row), NOW)

    expect(detail.activityReported).toBe(true)
    expect(detail.lines).toEqual([
      { key: 'step', label: 'Step', value: 'Reading routes' },
      { key: 'tool', label: 'Tool', value: 'Read: src/router.ts' },
      {
        key: 'message',
        label: 'Latest message',
        value: 'Mapped 12 routes so far'
      },
      { key: 'model', label: 'Model', value: 'gpt-6-astra' },
      { key: 'state', label: 'State', value: 'Working' },
      { key: 'elapsed', label: 'Elapsed', value: '5m' }
    ])
  })

  it('labels a tool-result preview as tool output and hides tool fields once the turn is over', () => {
    const row = makeRow(
      {
        state: 'done',
        toolName: 'Bash',
        toolInput: 'pnpm test',
        lastAssistantMessage: '12 passed',
        lastAssistantMessageIsToolOutput: true
      },
      { state: 'done', startedAt: NOW - 2 * 60 * 60_000 }
    )

    const detail = buildCurrentWorkDetail(currentWorkSourceFromRow(row), NOW)

    expect(detail.lines.map((line) => line.key)).toEqual(['message', 'state', 'elapsed'])
    expect(detail.lines[0]).toEqual({
      key: 'message',
      label: 'Tool output',
      value: '12 passed'
    })
    expect(detail.lines[2]).toEqual({
      key: 'elapsed',
      label: 'Elapsed',
      value: '2h'
    })
  })

  it('reports no activity for a row that only knows its state', () => {
    const detail = buildCurrentWorkDetail(currentWorkSourceFromRow(makeRow()), NOW)

    expect(detail.activityReported).toBe(false)
    expect(detail.lines).toEqual([{ key: 'state', label: 'State', value: 'Working' }])
  })

  it('lists the run stats a finished child reported instead of the empty state', () => {
    const row = makeRow(
      { state: 'done' },
      {
        rowSource: 'subagent',
        state: 'done',
        job: {
          taskId: 'st_a',
          lifecycle: 'succeeded',
          runStats: { turns: 12, toolCalls: 34, tokensPerSecond: 40, runtimeMs: 5000 }
        }
      }
    )

    const detail = buildCurrentWorkDetail(currentWorkSourceFromRow(row), NOW)

    expect(detail.activityReported).toBe(true)
    expect(detail.lines).toEqual([
      { key: 'turns', label: 'Turns', value: '12' },
      { key: 'tools', label: 'Tool calls', value: '34' },
      { key: 'tokensPerSecond', label: 'Tok/s', value: '40' },
      { key: 'runtime', label: 'Runtime', value: '5.0s' },
      { key: 'state', label: 'State', value: 'Done' }
    ])
  })

  it('omits absent stats, rounds fractional rates and formats long runtimes in minutes', () => {
    const row = makeRow(
      {},
      { job: { lifecycle: 'succeeded', runStats: { tokensPerSecond: 40.37, runtimeMs: 65_000 } } }
    )

    const detail = buildCurrentWorkDetail(currentWorkSourceFromRow(row), NOW)

    expect(detail.lines.map((line) => line.key)).toEqual(['tokensPerSecond', 'runtime', 'state'])
    expect(detail.lines[0].value).toBe('40.4')
    expect(detail.lines[1].value).toBe('1m 5s')
  })

  it('falls back to the jobGraph node stats when the roster row carries none', () => {
    const runStats = { turns: 3, toolCalls: 7, tokensPerSecond: 21, runtimeMs: 900 }
    const unstarted = currentWorkSourceFromGraphNode({
      node: { id: 'B', label: 'Build', status: 'succeeded', runStats },
      row: null,
      dependsOnLabels: []
    })
    const started = currentWorkSourceFromGraphNode({
      node: { id: 'B', label: 'Build', status: 'succeeded', runStats },
      row: makeRow({}, { job: { lifecycle: 'succeeded', runStats: { turns: 4 } } }),
      dependsOnLabels: []
    })

    expect(buildCurrentWorkDetail(unstarted, NOW).lines).toEqual([
      { key: 'turns', label: 'Turns', value: '3' },
      { key: 'tools', label: 'Tool calls', value: '7' },
      { key: 'tokensPerSecond', label: 'Tok/s', value: '21' },
      { key: 'runtime', label: 'Runtime', value: '0.9s' },
      { key: 'state', label: 'State', value: 'Done' }
    ])
    // Why: the roster row is the live authority; its stats win over the node snapshot as a whole.
    expect(buildCurrentWorkDetail(started, NOW).lines).toEqual([
      { key: 'turns', label: 'Turns', value: '4' },
      { key: 'state', label: 'State', value: 'Done' }
    ])
  })

  it('falls back to the jobGraph node when omo has not started the row yet', () => {
    const source = currentWorkSourceFromGraphNode({
      node: {
        id: 'C',
        label: 'Verify evidence',
        status: 'running',
        model: 'gpt-6-mini',
        currentStep: 'Collecting screenshots',
        startedAt: NOW - 90_000
      },
      row: null,
      dependsOnLabels: []
    })

    const detail = buildCurrentWorkDetail(source, NOW)

    expect(detail.activityReported).toBe(true)
    expect(detail.lines).toEqual([
      { key: 'step', label: 'Step', value: 'Collecting screenshots' },
      { key: 'model', label: 'Model', value: 'gpt-6-mini' },
      { key: 'state', label: 'State', value: 'Working' },
      { key: 'elapsed', label: 'Elapsed', value: '1m' }
    ])
  })

  it('prefers the live roster row over the node snapshot for a started graph node', () => {
    const row = makeRow(
      { model: 'gpt-6-astra', stateStartedAt: NOW - 3 * 60_000 },
      {
        rowSource: 'subagent',
        job: { lifecycle: 'running', currentStep: 'Reading routes' }
      }
    )
    const source = currentWorkSourceFromGraphNode({
      node: {
        id: 'A',
        label: 'Map shell navigation',
        status: 'succeeded',
        currentStep: 'Stale snapshot step',
        startedAt: NOW - 60 * 60_000
      },
      row,
      dependsOnLabels: []
    })

    const detail = buildCurrentWorkDetail(source, NOW)

    expect(detail.lines).toEqual([
      { key: 'step', label: 'Step', value: 'Reading routes' },
      { key: 'model', label: 'Model', value: 'gpt-6-astra' },
      { key: 'state', label: 'State', value: 'Done' },
      { key: 'elapsed', label: 'Elapsed', value: '3m' }
    ])
  })
})
