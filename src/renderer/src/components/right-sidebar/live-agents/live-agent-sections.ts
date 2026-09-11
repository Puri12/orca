import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { buildAgentRowLineageTree } from '@/components/dashboard/agent-row-lineage-model'
import type { AgentDotState } from '@/components/AgentStateDot'
import {
  buildDagViewModel,
  type DagNode,
  type DagStatus,
  type DagViewModel
} from './dag-view-model'

export type LiveAgentGraphNode = {
  node: DagNode
  /** Live roster row backing this node; null while omo has not started it. */
  row: DashboardAgentRow | null
  dependsOnLabels: string[]
}

export type LiveAgentWave = {
  key: string
  label: string
  nodes: LiveAgentGraphNode[]
}

export type LiveAgentSection = {
  root: DashboardAgentRow
  children: DashboardAgentRow[]
  runLabel?: string
  /** Present only when the root reported a jobGraph; children then render inside waves. */
  waves: LiveAgentWave[] | null
}

const DOT_STATE_BY_DAG_STATUS: Record<DagStatus, AgentDotState> = {
  running: 'working',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'interrupted',
  idle: 'idle'
}

export function dagStatusToDotState(status: DagStatus): AgentDotState {
  return DOT_STATE_BY_DAG_STATUS[status]
}

function subagentIdFromRowKey(row: DashboardAgentRow): string | null {
  const marker = row.paneKey.indexOf('\u0000subagent:')
  return marker === -1 ? null : row.paneKey.slice(marker + '\u0000subagent:'.length)
}

function indexChildRowsByTask(
  children: readonly DashboardAgentRow[]
): Map<string, DashboardAgentRow> {
  const byTask = new Map<string, DashboardAgentRow>()
  for (const child of children) {
    const subagentId = subagentIdFromRowKey(child)
    if (subagentId !== null) {
      byTask.set(subagentId, child)
    }
    if (child.job?.taskId) {
      byTask.set(child.job.taskId, child)
    }
  }
  return byTask
}

/** Longest-path depth per node so an omitted `waves` field still yields a stable ordering. */
function deriveWaves(vm: DagViewModel): string[][] {
  const dependenciesById = new Map<string, string[]>(vm.nodes.map((node) => [node.id, []]))
  for (const edge of vm.edges) {
    dependenciesById.get(edge.to)?.push(edge.from)
  }
  const depthById = new Map<string, number>()
  const resolveDepth = (id: string, trail: Set<string>): number => {
    const known = depthById.get(id)
    if (known !== undefined) {
      return known
    }
    // Why: a cyclic report must not hang the panel; break the cycle at its first revisit.
    if (trail.has(id)) {
      return 0
    }
    trail.add(id)
    const depth = (dependenciesById.get(id) ?? []).reduce(
      (max, dependency) => Math.max(max, resolveDepth(dependency, trail) + 1),
      0
    )
    depthById.set(id, depth)
    return depth
  }
  const waves: string[][] = []
  for (const node of vm.nodes) {
    const depth = resolveDepth(node.id, new Set())
    ;(waves[depth] ??= []).push(node.id)
  }
  return waves.filter((wave) => wave.length > 0)
}

function buildWaves(
  vm: DagViewModel,
  taskIdByNodeId: ReadonlyMap<string, string>,
  children: readonly DashboardAgentRow[]
): LiveAgentWave[] {
  const nodeById = new Map(vm.nodes.map((node) => [node.id, node]))
  const rowByTask = indexChildRowsByTask(children)
  const dependencyLabelsById = new Map<string, string[]>()
  for (const edge of vm.edges) {
    const label = nodeById.get(edge.from)?.label ?? edge.from
    const labels = dependencyLabelsById.get(edge.to) ?? []
    labels.push(label)
    dependencyLabelsById.set(edge.to, labels)
  }
  const toGraphNode = (node: DagNode): LiveAgentGraphNode => ({
    node,
    row: rowByTask.get(taskIdByNodeId.get(node.id) ?? node.id) ?? null,
    dependsOnLabels: dependencyLabelsById.get(node.id) ?? []
  })
  const waves: LiveAgentWave[] = []
  const placed = new Set<string>()
  const reported = vm.waves && vm.waves.length > 0 ? vm.waves : deriveWaves(vm)
  reported.forEach((ids, index) => {
    const nodes = ids.flatMap((id) => {
      const node = nodeById.get(id)
      if (!node || placed.has(id)) {
        return []
      }
      placed.add(id)
      return [toGraphNode(node)]
    })
    if (nodes.length > 0) {
      waves.push({ key: `wave-${index}`, label: `Wave ${index + 1}`, nodes })
    }
  })
  const unscheduled = vm.nodes.filter((node) => !placed.has(node.id)).map(toGraphNode)
  if (unscheduled.length > 0) {
    waves.push({ key: 'unscheduled', label: 'Unscheduled', nodes: unscheduled })
  }
  return waves
}

/**
 * Group a workspace's agent rows into one section per root agent. Roots that
 * reported an omo jobGraph get their children arranged by dependency wave; the
 * rest keep the flat parent/child lineage the worktree card already shows.
 */
export function buildLiveAgentSections(rows: readonly DashboardAgentRow[]): LiveAgentSection[] {
  const { rootRows, childrenByParentPaneKey } = buildAgentRowLineageTree(rows)
  return rootRows.map((root) => {
    const children = childrenByParentPaneKey.get(root.paneKey) ?? []
    if (!root.entry.jobGraph) {
      return { root, children, waves: null }
    }
    const vm = buildDagViewModel(root.entry)
    const taskIdByNodeId = new Map(
      root.entry.jobGraph.nodes.flatMap((node) =>
        node.taskId === undefined ? [] : [[node.nodeId, node.taskId] as const]
      )
    )
    return {
      root,
      children,
      runLabel: vm.runLabel,
      waves: buildWaves(vm, taskIdByNodeId, children)
    }
  })
}
