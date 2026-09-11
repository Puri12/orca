import { agentStateLabel, type AgentDotState } from '@/components/AgentStateDot'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { getAgentDotState } from '@/components/sidebar/worktree-card-agent-summary'
import { translate } from '@/i18n/i18n'
import { formatAgentToolPreview } from '@/lib/agent-row-tool-preview'
import type { AgentRowState } from '@/lib/agent-row-decay-state'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import type { AgentRunStats } from '../../../../../shared/agent-job-graph'
import { formatNativeChatDuration } from '../../../../../shared/native-chat-turn-status'
import { dagStatusToDotState, type LiveAgentGraphNode } from './live-agent-sections'

/** The live fields one Live Agents row can show when expanded, already resolved
 *  between the roster entry and (for jobGraph nodes) the node snapshot. */
export type LiveAgentCurrentWorkSource = {
  currentStep?: string
  toolName?: string
  toolInput?: string
  /** Row state that gates the tool preview; null when only a node snapshot exists. */
  toolPreviewState: AgentRowState | null
  lastAssistantMessage?: string
  lastAssistantMessageIsToolOutput?: boolean
  model?: string
  dotState: AgentDotState
  /** ms epoch the current state began; 0 when unknown. */
  startedAt: number
  /** Terminal run totals, when the child reported them. */
  runStats?: AgentRunStats
}

export type LiveAgentCurrentWorkLineKey =
  | 'step'
  | 'tool'
  | 'message'
  | 'turns'
  | 'tools'
  | 'tokensPerSecond'
  | 'runtime'
  | 'model'
  | 'state'
  | 'elapsed'

export type LiveAgentCurrentWorkLine = {
  key: LiveAgentCurrentWorkLineKey
  label: string
  value: string
}

export type LiveAgentCurrentWorkDetail = {
  lines: LiveAgentCurrentWorkLine[]
  /** False when only state/elapsed are known, so the panel can say so instead of implying work. */
  activityReported: boolean
}

export function currentWorkSourceFromRow(row: DashboardAgentRow): LiveAgentCurrentWorkSource {
  const { entry } = row
  return {
    currentStep: row.job?.currentStep,
    toolName: entry.toolName,
    toolInput: entry.toolInput,
    toolPreviewState: row.state,
    lastAssistantMessage: entry.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: entry.lastAssistantMessageIsToolOutput,
    model: entry.model,
    dotState: getAgentDotState(row),
    startedAt: entry.stateStartedAt > 0 ? entry.stateStartedAt : row.startedAt,
    runStats: row.job?.runStats
  }
}

/** Roster row first, node snapshot as fallback — the node's status still owns the
 *  state label so the detail agrees with the dot the row already shows. */
export function currentWorkSourceFromGraphNode(
  graphNode: LiveAgentGraphNode
): LiveAgentCurrentWorkSource {
  const { node, row } = graphNode
  const dotState = dagStatusToDotState(node.status)
  if (!row) {
    return {
      currentStep: node.currentStep,
      toolPreviewState: null,
      model: node.model,
      dotState,
      startedAt: node.startedAt ?? 0,
      runStats: node.runStats
    }
  }
  const fromRow = currentWorkSourceFromRow(row)
  return {
    ...fromRow,
    currentStep: fromRow.currentStep ?? node.currentStep,
    model: fromRow.model ?? node.model,
    dotState,
    startedAt: fromRow.startedAt > 0 ? fromRow.startedAt : (node.startedAt ?? 0),
    runStats: fromRow.runStats ?? node.runStats
  }
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? ''
}

/** Sub-minute runs keep a decimal so short children don't all read "0s"; longer ones reuse the chat turn copy. */
function formatRuntime(ms: number): string {
  return ms < 60_000
    ? `${(Math.max(0, ms) / 1000).toFixed(1)}s`
    : formatNativeChatDuration(ms / 1000)
}

function formatRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function runStatsLines(stats: AgentRunStats | undefined): LiveAgentCurrentWorkLine[] {
  if (!stats) {
    return []
  }
  const lines: LiveAgentCurrentWorkLine[] = []
  if (stats.turns !== undefined) {
    lines.push({
      key: 'turns',
      label: translate('auto.components.right.sidebar.liveAgents.detail.turns', 'Turns'),
      value: String(stats.turns)
    })
  }
  if (stats.toolCalls !== undefined) {
    lines.push({
      key: 'tools',
      label: translate('auto.components.right.sidebar.liveAgents.detail.tools', 'Tool calls'),
      value: String(stats.toolCalls)
    })
  }
  if (stats.tokensPerSecond !== undefined) {
    lines.push({
      key: 'tokensPerSecond',
      label: translate('auto.components.right.sidebar.liveAgents.detail.tokensPerSecond', 'Tok/s'),
      value: formatRate(stats.tokensPerSecond)
    })
  }
  if (stats.runtimeMs !== undefined) {
    lines.push({
      key: 'runtime',
      label: translate('auto.components.right.sidebar.liveAgents.detail.runtime', 'Runtime'),
      value: formatRuntime(stats.runtimeMs)
    })
  }
  return lines
}

/** Ordered label/value lines for the expanded row; absent fields are omitted. */
export function buildCurrentWorkDetail(
  source: LiveAgentCurrentWorkSource,
  now: number
): LiveAgentCurrentWorkDetail {
  const lines: LiveAgentCurrentWorkLine[] = []
  const step = trimmed(source.currentStep)
  if (step) {
    lines.push({
      key: 'step',
      label: translate('auto.components.right.sidebar.liveAgents.detail.step', 'Step'),
      value: step
    })
  }
  const tool = formatAgentToolPreview(source, source.toolPreviewState)
  if (tool) {
    lines.push({
      key: 'tool',
      label: translate('auto.components.right.sidebar.liveAgents.detail.tool', 'Tool'),
      value: tool
    })
  }
  const message = trimmed(source.lastAssistantMessage)
  if (message) {
    lines.push({
      key: 'message',
      label: source.lastAssistantMessageIsToolOutput
        ? translate('auto.components.right.sidebar.liveAgents.detail.toolOutput', 'Tool output')
        : translate('auto.components.right.sidebar.liveAgents.detail.message', 'Latest message'),
      value: message
    })
  }
  lines.push(...runStatsLines(source.runStats))
  const activityReported = lines.length > 0
  const model = trimmed(source.model)
  if (model) {
    lines.push({
      key: 'model',
      label: translate('auto.components.right.sidebar.liveAgents.detail.model', 'Model'),
      value: model
    })
  }
  lines.push({
    key: 'state',
    label: translate('auto.components.right.sidebar.liveAgents.detail.state', 'State'),
    value: agentStateLabel(source.dotState)
  })
  if (source.startedAt > 0) {
    lines.push({
      key: 'elapsed',
      label: translate('auto.components.right.sidebar.liveAgents.detail.elapsed', 'Elapsed'),
      value: formatShortTimeAgo(source.startedAt, now)
    })
  }
  return { lines, activityReported }
}
