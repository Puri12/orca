import { copyFileSync, mkdirSync, readdirSync, readFileSync, appendFileSync } from 'node:fs'
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
// Why: real bytes of an eval call/result whose arguments and envelope used to render as JSON.
const ENVELOPED_FIXTURE_DIR = path.resolve(
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

type FixtureRecord = {
  message?: {
    role?: string
    toolName?: string
    content?: { type?: string; name?: string; text?: string; arguments?: { code?: string } }[]
  }
}

/** The eval call that printed `marker` and its result, as the raw JSONL lines omo wrote. */
function evalFixtureLines(dir: string, marker: string): { call: string; result: string } {
  const turnFile = readdirSync(dir).find((name) => name.endsWith('.jsonl')) ?? ''
  const lines = readFileSync(path.join(dir, turnFile), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
  const parsed = lines.map((line) => JSON.parse(line) as FixtureRecord)
  const callIndex = parsed.findIndex((record) =>
    record.message?.content?.some(
      (block) =>
        block.type === 'toolCall' &&
        block.name === 'eval' &&
        block.arguments?.code?.includes(marker) === true
    )
  )
  const resultIndex = parsed.findIndex(
    (record, index) =>
      index > callIndex &&
      record.message?.role === 'toolResult' &&
      record.message.toolName === 'eval' &&
      record.message.content?.[0]?.text === marker
  )
  if (callIndex === -1 || resultIndex === -1) {
    throw new Error(`fixture ${turnFile} has no eval call/result for ${marker}`)
  }
  return { call: lines[callIndex], result: lines[resultIndex] }
}

/**
 * Clicking a subagent row's live-output action must open the floating Subagent-Live
 * view and stream that child's senpi transcript from
 * `<worktree>/.omo/senpi-task/children/<taskId>/sessions/<taskId>/` — replaying what
 * omo already wrote, then following a line appended while the view is open. The pane
 * reads as a chat conversation: role rows, humanized tool rows, no raw JSON.
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

  // Why: the replay must show the fixture's real turn content, in order, as chat rows.
  const log = pane.locator('[data-subagent-live-log]')
  await expect(log.locator('[data-subagent-live-role="user"]').first()).toContainText(
    'say s1-start'
  )
  const firstToolCall = log.locator('[data-subagent-live-line="tool-call"]').first()
  await expect(firstToolCall).toContainText('eval')
  await expect(firstToolCall).toContainText('sleep 4 && echo s2-tool-ok')
  await expect(firstToolCall.locator('button[aria-expanded]')).toHaveCount(1)
  await expect(log.locator('[data-subagent-live-line="tool-result"]').first()).toContainText(
    'eval run requires language'
  )
  await expect(
    log
      .locator('[data-subagent-live-role="assistant"] [data-subagent-live-line="assistant"]')
      .last()
  ).toContainText('s3-end')

  // Why: a line the child appends after the view opened must stream in without a reopen,
  // and a real multi-key eval call plus its enveloped result must land as data, not JSON.
  const newestTurn = path.join(sessionDir, turnFiles.at(-1) ?? '')
  const evalLines = evalFixtureLines(ENVELOPED_FIXTURE_DIR, 'S1-boot')
  appendFileSync(
    newestTurn,
    `${evalLines.call}\n${evalLines.result}\n${JSON.stringify({
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
  const lastToolCall = log.locator('[data-subagent-live-line="tool-call"]').last()
  await expect(lastToolCall).toContainText('console.log("S1-boot");')
  await expect(log.locator('[data-subagent-live-line="tool-result"]').last()).toContainText(
    'S1-boot'
  )
  await expect(log).not.toContainText('{"')

  // Why: a second click focuses the existing tab rather than opening a duplicate.
  await liveOutput.click()
  await expect(floating.locator(`[data-subagent-live-pane="${TASK_ID}"]`)).toHaveCount(1)

  // Why: the evidence screenshot must show the chat look with the tool rows visible.
  await lastToolCall.scrollIntoViewIfNeeded()
  if (process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH) {
    await mkdir(path.dirname(process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH), { recursive: true })
    await orcaPage.screenshot({ path: process.env.ORCA_SUBAGENT_LIVE_EVIDENCE_PATH })
  }
})
