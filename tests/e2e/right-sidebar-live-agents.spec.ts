import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const LEAF_ID = '00000000-0000-4000-8000-00000000a9e1'

/**
 * The right-sidebar Live Agents tab renders omo's live roster and jobGraph waves
 * from the same agent-status pipeline the worktree cards read, so the proof seeds
 * one omo pane through setAgentStatus and reads the wave/dependency DOM back.
 */
test('right-sidebar Live Agents tab shows omo rows grouped by jobGraph wave', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(
    ({ worktreeId, leafId }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is unavailable')
      }
      const state = store.getState()
      const tab =
        state.tabsByWorktree[worktreeId]?.[0] ??
        state.createTab(worktreeId, undefined, undefined, {
          activate: false,
          id: 'omo-live-tab'
        })
      const now = Date.now()
      state.setAgentStatus(
        `${tab.id}:${leafId}`,
        {
          state: 'working',
          prompt: 'Ship the navigation refactor',
          agentType: 'omo',
          model: 'gpt-6-astra',
          toolName: 'Read',
          toolInput: 'src/router.ts',
          subagents: [
            {
              id: 'map',
              description: 'Map shell navigation',
              agentType: 'quick',
              model: 'gpt-6-astra',
              state: 'working',
              startedAt: now - 3_000,
              job: {
                taskId: 'task-map',
                lifecycle: 'running',
                currentStep: 'Reading routes'
              }
            },
            {
              id: 'cover',
              description: 'Test coverage',
              agentType: 'quick',
              state: 'idle',
              startedAt: now - 9_000,
              job: {
                taskId: 'cover',
                lifecycle: 'succeeded',
                runStats: { turns: 12, toolCalls: 34, tokensPerSecond: 40, runtimeMs: 5000 }
              }
            }
          ],
          jobGraph: {
            runLabel: 'Navigation refactor run',
            waves: [['A'], ['B', 'C']],
            nodes: [
              { nodeId: 'A', taskId: 'task-map', dependsOn: [] },
              { nodeId: 'B', taskId: 'cover', dependsOn: ['A'] },
              {
                nodeId: 'C',
                label: 'Verify evidence',
                dependsOn: ['A', 'B'],
                state: 'queued'
              }
            ]
          }
        },
        'omo',
        { updatedAt: now, stateStartedAt: now - 5_000 },
        { tabId: tab.id, worktreeId }
      )
      state.setRightSidebarTab('agents')
      state.setRightSidebarOpen(true)
    },
    { worktreeId, leafId: LEAF_ID }
  )

  const panel = orcaPage.locator('[data-live-agents-panel]')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Ship the navigation refactor')
  await expect(panel).toContainText('Navigation refactor run')
  await expect(panel.locator('[data-live-agent-wave]')).toHaveCount(2)
  await expect(panel.locator('[data-live-agent-node="A"]')).toContainText('Reading routes')
  await expect(
    panel.locator('[data-live-agent-node="C"] [data-live-agent-depends-on]')
  ).toContainText('depends on Map shell navigation, Test coverage')

  // Why: the detail is collapsed by default and opens in place from the row body.
  const nodeA = panel.locator('[data-live-agent-node="A"]')
  await expect(nodeA.locator('[data-live-agent-detail]')).toHaveCount(0)
  await nodeA.locator('[data-live-agent-detail-trigger]').click()
  await expect(nodeA.locator('[data-live-agent-detail-line="step"]')).toContainText(
    'Reading routes'
  )
  await expect(nodeA.locator('[data-live-agent-detail-line="model"]')).toContainText('gpt-6-astra')
  await expect(nodeA.locator('[data-live-agent-detail-line="state"]')).toContainText('Working')
  await expect(nodeA.locator('[data-live-agent-detail-line="elapsed"]')).toContainText('now')

  const rootRow = panel.locator('[data-live-agent-row]').first()
  await rootRow.locator('.compact-agent-row').click()
  await expect(rootRow.locator('[data-live-agent-detail-line="tool"]')).toContainText(
    'Read: src/router.ts'
  )
  await expect(rootRow.locator('[data-live-agent-jump]')).toBeVisible()

  // Why: a finished child reports run stats; the expanded detail must show them, not the empty copy.
  const nodeB = panel.locator('[data-live-agent-node="B"]')
  await nodeB.locator('[data-live-agent-detail-trigger]').click()
  await expect(nodeB.locator('[data-live-agent-detail]')).not.toContainText(
    'No current activity reported'
  )
  await expect(nodeB.locator('[data-live-agent-detail-line="turns"]')).toContainText('12')
  await expect(nodeB.locator('[data-live-agent-detail-line="tools"]')).toContainText('34')
  await expect(nodeB.locator('[data-live-agent-detail-line="tokensPerSecond"]')).toContainText('40')
  await expect(nodeB.locator('[data-live-agent-detail-line="runtime"]')).toContainText('5.0s')
  await expect(nodeB.locator('[data-live-agent-detail-line="state"]')).toContainText('Done')

  if (process.env.ORCA_LIVE_AGENTS_EVIDENCE_PATH) {
    await mkdir(path.dirname(process.env.ORCA_LIVE_AGENTS_EVIDENCE_PATH), {
      recursive: true
    })
    await orcaPage.screenshot({
      path: process.env.ORCA_LIVE_AGENTS_EVIDENCE_PATH
    })
  }
})
