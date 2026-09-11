import type { AgentRunStats } from '../../../../../shared/agent-job-graph'
import type {
  AgentStatusEntry,
  AgentSubagentJobLifecycle,
  AgentSubagentState
} from '../../../../../shared/agent-status-types'

export type DagStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'idle'
export type DagNode = {
  id: string
  label: string
  status: DagStatus
  agentType?: string
  model?: string
  currentStep?: string
  startedAt?: number
  runStats?: AgentRunStats
}
export type DagEdge = { from: string; to: string }
export type DagViewModel = {
  runLabel?: string
  waves?: string[][]
  nodes: DagNode[]
  edges: DagEdge[]
}

const STATUS: Record<AgentSubagentJobLifecycle | AgentSubagentState, DagStatus> = {
  working: 'running',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  queued: 'idle',
  blocked: 'idle',
  waiting: 'idle',
  unknown: 'idle',
  idle: 'idle'
}

export function buildDagViewModel(entry: AgentStatusEntry): DagViewModel {
  if (entry.jobGraph) {
    const graph = entry.jobGraph
    const roster = new Map(entry.subagents?.map((child) => [child.id, child]))
    for (const child of entry.subagents ?? []) {
      if (child.job?.taskId) {
        roster.set(child.job.taskId, child)
      }
    }
    const nodeIds = new Set(graph.nodes.map((node) => node.nodeId))
    return {
      runLabel: graph.runLabel,
      waves: graph.waves,
      nodes: graph.nodes.map((node) => {
        const child = node.taskId === undefined ? undefined : roster.get(node.taskId)
        const state = child?.job?.lifecycle ?? child?.state ?? node.state ?? 'unknown'
        return {
          id: node.nodeId,
          label: node.label || child?.description || node.taskId || node.nodeId,
          status: Object.hasOwn(STATUS, state) ? STATUS[state as keyof typeof STATUS] : 'idle',
          agentType: child?.agentType,
          model: child?.model,
          currentStep: child?.job?.currentStep,
          startedAt: child && child.startedAt > 0 ? child.startedAt : undefined,
          runStats: child?.job?.runStats ?? node.runStats
        }
      }),
      edges: graph.nodes.flatMap((node) =>
        [...new Set(node.dependsOn)]
          .filter((dependency) => nodeIds.has(dependency))
          .map((dependency) => ({ from: dependency, to: node.nodeId }))
      )
    }
  }
  const coordinator: DagNode = {
    id: entry.paneKey,
    label: entry.orchestration?.taskTitle || entry.prompt || 'Start node',
    status:
      entry.state === 'done'
        ? entry.interrupted
          ? 'cancelled'
          : entry.sessionBoundary
            ? 'idle'
            : 'succeeded'
        : entry.state === 'working'
          ? 'running'
          : 'idle',
    agentType: entry.agentType,
    model: entry.model,
    currentStep: entry.toolName,
    startedAt: entry.stateStartedAt
  }
  const children: DagNode[] = (entry.subagents ?? []).map((child) => ({
    id: `${entry.paneKey}\u0000subagent:${child.id}`,
    label: child.description || child.job?.taskId || child.id,
    status: STATUS[child.job?.lifecycle ?? child.state],
    agentType: child.agentType,
    model: child.model,
    currentStep: child.job?.currentStep,
    startedAt: child.startedAt > 0 ? child.startedAt : undefined,
    runStats: child.job?.runStats
  }))
  // Why: roster children have no independent pane lineage; their owner is the parent pane.
  return {
    runLabel: entry.orchestration?.taskTitle || entry.prompt || undefined,
    nodes: [coordinator, ...children],
    edges: children.map((child) => ({ from: coordinator.id, to: child.id }))
  }
}
