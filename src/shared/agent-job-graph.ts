import { z } from 'zod'

/** Per-child run totals omo attaches once a task reaches a terminal result; absent while it runs. */
export const agentRunStatsSchema = z.object({
  turns: z.number().optional(),
  toolCalls: z.number().optional(),
  tokensPerSecond: z.number().optional(),
  runtimeMs: z.number().optional()
})

export type AgentRunStats = z.infer<typeof agentRunStatsSchema>

export const agentJobGraphSchema = z.object({
  runId: z.string().optional(),
  runLabel: z.string().optional(),
  waves: z.array(z.array(z.string())).optional(),
  nodes: z.array(
    z.object({
      nodeId: z.string(),
      taskId: z.string().optional(),
      label: z.string().optional(),
      dependsOn: z.array(z.string()),
      state: z.string().optional(),
      runStats: agentRunStatsSchema.optional()
    })
  )
})

export type AgentJobGraph = z.infer<typeof agentJobGraphSchema>

export function normalizeJobGraphField(value: unknown): AgentJobGraph | undefined {
  if (value === undefined) {
    return undefined
  }
  const result = agentJobGraphSchema.safeParse(value)
  return result.success ? result.data : undefined
}

/** Keeps only the finite numeric fields of a reported stats object; empty or malformed input is dropped. */
export function normalizeRunStatsField(value: unknown): AgentRunStats | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const stats: AgentRunStats = {}
  for (const key of ['turns', 'toolCalls', 'tokensPerSecond', 'runtimeMs'] as const) {
    const field = (value as Record<string, unknown>)[key]
    if (typeof field === 'number' && Number.isFinite(field)) {
      stats[key] = field
    }
  }
  return Object.keys(stats).length > 0 ? stats : undefined
}

export function agentRunStatsEqual(
  a: AgentRunStats | undefined,
  b: AgentRunStats | undefined
): boolean {
  if (a === b || !a || !b) {
    return a === b
  }
  return (
    a.turns === b.turns &&
    a.toolCalls === b.toolCalls &&
    a.tokensPerSecond === b.tokensPerSecond &&
    a.runtimeMs === b.runtimeMs
  )
}
