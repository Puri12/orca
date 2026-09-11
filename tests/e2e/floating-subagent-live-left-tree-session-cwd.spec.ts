import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow } from './worktree-row-locators'

const LEAF_ID = '00000000-0000-4000-8000-00000000c4d3'
const TASK_ID = 'st_01a09032'
// Why: real bytes of a child session omo wrote; the pane must render these as chat rows.
const FIXTURE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'main',
  'omo',
  '__fixtures__',
  'child-session-st_01a09032'
)
const OPEN_PANEL_SELECTOR = '[data-floating-terminal-panel][aria-hidden="false"]'

/**
 * omo reports the cwd it was launched from as `sessionCwd`, and its children write
 * their transcripts under that cwd — which is a subdirectory of the worktree when the
 * user ran omo from one. The left worktree tree's subagent row must open the floating
 * Subagent-Live view against that session cwd (not the worktree root), so the pane
 * tails the real transcript instead of showing "No transcript".
 */
test('left worktree tree subagent row opens live output tailed from the parent session cwd', async ({
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

  // Why: the transcript lives ONLY under the session cwd; the worktree root has none,
  // so a root-resolved tailer would land on the empty state.
  const sessionCwd = path.join(worktreePath, 'packages', 'app')
  const sessionDir = path.join(
    sessionCwd,
    '.omo',
    'senpi-task',
    'children',
    TASK_ID,
    'sessions',
    TASK_ID
  )
  mkdirSync(sessionDir, { recursive: true })
  for (const name of readdirSync(FIXTURE_DIR).filter((entry) => entry.endsWith('.jsonl'))) {
    copyFileSync(path.join(FIXTURE_DIR, name), path.join(sessionDir, name))
  }

  await orcaPage.evaluate(
    ({ worktreeId, leafId, taskId, sessionCwd }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is unavailable')
      }
      const state = store.getState()
      void state.updateSettings({ floatingTerminalEnabled: true })
      if (!state.worktreeCardProperties.includes('inline-agents')) {
        state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
      }
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
          prompt: 'Narrate the slow demo',
          agentType: 'omo',
          model: 'gpt-6-astra',
          sessionCwd,
          subagents: [
            {
              id: 'narrator',
              description: 'Slow demo narrator',
              agentType: 'quick',
              model: 'grok-4.20-0309-non-reasoning',
              state: 'working',
              startedAt: now - 3_000,
              job: { taskId, lifecycle: 'running', currentStep: 'Saying S1-boot' }
            }
          ]
        },
        'omo',
        { updatedAt: now, stateStartedAt: now - 5_000 },
        { tabId: tab.id, worktreeId }
      )
    },
    { worktreeId, leafId: LEAF_ID, taskId: TASK_ID, sessionCwd }
  )

  // Why: the list's aria-label is localized; the compact-list marker is not.
  const agentList = worktreeRow(orcaPage, worktreeId).locator('[data-compact-agent-list="true"]')
  await expect(agentList).toContainText('Slow demo narrator')
  // Why: only the subagent row offers live output; the omo root pane has no child transcript.
  const liveOutput = agentList.locator('[data-live-agent-live-output]')
  await expect(liveOutput).toHaveCount(1)
  const subagentRow = agentList.locator('.compact-agent-row', { hasText: 'Slow demo narrator' })
  await expect(subagentRow.locator('[data-live-agent-live-output]')).toHaveCount(1)
  await liveOutput.click()

  const floating = orcaPage.locator(OPEN_PANEL_SELECTOR)
  await expect(floating).toBeVisible()
  const pane = floating.locator(`[data-subagent-live-pane="${TASK_ID}"]`)
  await expect(pane).toBeVisible()
  await expect(pane).toHaveAttribute('data-subagent-live-phase', 'live')
  await expect(pane).toContainText('Slow demo narrator')
  await expect(pane).not.toContainText('No transcript')

  const log = pane.locator('[data-subagent-live-log]')
  await expect(log.locator('[data-subagent-live-role="user"]').first()).toContainText(
    'Narrate a slow demo'
  )
  await expect(log.locator('[data-subagent-live-line="tool-call"]').first()).toContainText('todo')
  await expect(log.locator('[data-subagent-live-line="tool-result"]')).toContainText(['S1-boot'])
  await expect(
    log
      .locator('[data-subagent-live-role="assistant"] [data-subagent-live-line="assistant"]')
      .last()
  ).toContainText('Demo completed')

  if (process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH) {
    await mkdir(path.dirname(process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH), { recursive: true })
    await orcaPage.screenshot({ path: process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH })
  }
})
