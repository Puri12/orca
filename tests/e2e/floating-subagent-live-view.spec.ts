import { copyFileSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const LEAF_ID = '00000000-0000-4000-8000-00000000b7e2'
const TASK_ID = 'st_01a08fe1'
const FIXTURE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'main',
  'omo',
  '__fixtures__',
  'child-session-st_01a08fe1'
)
const OPEN_PANEL_SELECTOR = '[data-floating-terminal-panel][aria-hidden="false"]'

/**
 * Clicking a subagent row's live-output action must open the floating Subagent-Live
 * view and stream that child's senpi transcript from
 * `<worktree>/.omo/senpi-task/children/<taskId>/sessions/<taskId>/` — replaying what
 * omo already wrote, then following a line appended while the view is open.
 */
test('Live Agents subagent row opens a floating view that replays and tails the child transcript', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  const worktreePath = await orcaPage.evaluate((worktreeId) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    return store.getState().getKnownWorktreeById(worktreeId)?.path ?? null
  }, worktreeId)
  if (!worktreePath) {
    throw new Error(`no filesystem path for worktree ${worktreeId}`)
  }

  const sessionDir = path.join(
    worktreePath,
    '.omo',
    'senpi-task',
    'children',
    TASK_ID,
    'sessions',
    TASK_ID
  )
  mkdirSync(sessionDir, { recursive: true })
  const turnFiles = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
  for (const name of turnFiles) {
    copyFileSync(path.join(FIXTURE_DIR, name), path.join(sessionDir, name))
  }

  await orcaPage.evaluate(
    ({ worktreeId, leafId, taskId }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is unavailable')
      }
      const state = store.getState()
      void state.updateSettings({ floatingTerminalEnabled: true })
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
          subagents: [
            {
              id: 'demo',
              description: 'Demo child',
              agentType: 'quick',
              model: 'grok-4.20-0309-non-reasoning',
              state: 'working',
              startedAt: now - 3_000,
              job: { taskId, lifecycle: 'running', currentStep: 'Saying s3-end' }
            }
          ]
        },
        'omo',
        { updatedAt: now, stateStartedAt: now - 5_000 },
        { tabId: tab.id, worktreeId }
      )
      state.setRightSidebarTab('agents')
      state.setRightSidebarOpen(true)
    },
    { worktreeId, leafId: LEAF_ID, taskId: TASK_ID }
  )

  const panel = orcaPage.locator('[data-live-agents-panel]')
  await expect(panel).toContainText('Demo child')
  const liveOutput = panel.locator('[data-live-agent-live-output]')
  await expect(liveOutput).toHaveCount(1)
  await liveOutput.click()

  const floating = orcaPage.locator(OPEN_PANEL_SELECTOR)
  await expect(floating).toBeVisible()
  const pane = floating.locator(`[data-subagent-live-pane="${TASK_ID}"]`)
  await expect(pane).toBeVisible()
  await expect(pane).toHaveAttribute('data-subagent-live-phase', 'live')
  await expect(pane).toContainText('Demo child')

  // Why: the replay must show the fixture's real turn content, in order.
  const log = pane.locator('[data-subagent-live-log]')
  await expect(log.locator('[data-subagent-live-line="user"]').first()).toContainText(
    'say s1-start'
  )
  await expect(log.locator('[data-subagent-live-line="tool-call"]').first()).toContainText('eval')
  await expect(log.locator('[data-subagent-live-line="tool-result"]').first()).toContainText(
    'eval run requires language'
  )
  await expect(log.locator('[data-subagent-live-line="assistant"]').last()).toContainText('s3-end')

  // Why: a line the child appends after the view opened must stream in without a reopen.
  const newestTurn = path.join(sessionDir, turnFiles.at(-1) ?? '')
  appendFileSync(
    newestTurn,
    `${JSON.stringify({
      type: 'message',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'live-tail-ok' }],
        stopReason: 'stop'
      }
    })}\n`
  )
  await expect(log.locator('[data-subagent-live-line="assistant"]').last()).toContainText(
    'live-tail-ok'
  )

  // Why: a second click focuses the existing tab rather than opening a duplicate.
  await liveOutput.click()
  await expect(floating.locator(`[data-subagent-live-pane="${TASK_ID}"]`)).toHaveCount(1)

  if (process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH) {
    await mkdir(path.dirname(process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH), { recursive: true })
    await orcaPage.screenshot({ path: process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH })
  }
})
