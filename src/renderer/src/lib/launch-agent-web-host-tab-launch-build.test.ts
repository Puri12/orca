import { describe, expect, it } from 'vitest'
import { buildWebHostTabLaunch } from './launch-agent-web-host-tab'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'

function startupPlan(overrides: Partial<AgentStartupPlan> = {}): AgentStartupPlan {
  return {
    launchCommand: 'omo',
    launchConfig: { agentCommand: 'omo', agentArgs: '', agentEnv: {} },
    ...overrides
  } as AgentStartupPlan
}

describe('buildWebHostTabLaunch', () => {
  it('carries the launch command and agent for a fresh NO-PROMPT omo launch', () => {
    // Why: on a host that predates omo the per-agent gate drops `agent`, so the command must
    // survive to still launch omo; the no-prompt branch previously sent only { agent }.
    // Only enum-gated agents (omo) get this; others keep the minimal no-prompt shape.
    const launch = buildWebHostTabLaunch({
      agent: 'omo',
      worktreeId: 'repo::/wt',
      environmentId: 'env-1',
      startupPlan: startupPlan(),
      prompt: '',
      promptDelivery: 'auto-submit',
      pastePromptAfterReady: null
    }) as Record<string, unknown>
    expect(launch.command).toBe('omo')
    expect(launch.launchAgent).toBe('omo')
    expect(launch.agentSessionKind).toBe('fresh')
    // No prompt fields when there is no prompt.
    expect(launch).not.toHaveProperty('prompt')
    expect(launch).not.toHaveProperty('promptDelivery')
  })

  it('still carries the command and prompt for a prompted launch', () => {
    const launch = buildWebHostTabLaunch({
      agent: 'omo',
      worktreeId: 'repo::/wt',
      environmentId: 'env-1',
      startupPlan: startupPlan(),
      prompt: 'do the thing',
      promptDelivery: 'auto-submit',
      pastePromptAfterReady: null
    }) as Record<string, unknown>
    expect(launch.command).toBe('omo')
    expect(launch.launchAgent).toBe('omo')
    expect(launch.prompt).toBe('do the thing')
  })
})
