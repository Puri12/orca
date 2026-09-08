import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import type { AgentHookEndpoint } from '../../src/shared/agent-hook-endpoint-file'
import {
  sendToTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const EVIDENCE_DIR =
  process.env.ORCA_E2E_EVIDENCE_DIR ?? path.join(process.cwd(), 'test-results', 'omo-evidence')

type OmoJobRoster = {
  id: string
  description: string
  state: 'working' | 'idle'
  startedAt: number
  job?: { taskId: string; lifecycle: string; currentStep?: string }
}[]

/** POST a real Pi-compatible hook to the app's /hook/omo endpoint, as omo's status extension does. */
async function emitOmoHook(
  endpoint: AgentHookEndpoint,
  target: { paneKey: string; worktreeId: string },
  payload: Record<string, unknown>
): Promise<void> {
  const [tabId] = target.paneKey.split(':')
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/omo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Orca-Agent-Hook-Token': endpoint.token
    },
    body: JSON.stringify({
      paneKey: target.paneKey,
      tabId,
      worktreeId: target.worktreeId,
      env: endpoint.env,
      version: endpoint.version,
      payload
    })
  })
  if (response.status !== 204) {
    throw new Error(`omo hook POST returned ${response.status}`)
  }
}

function roster(currentStep: string): OmoJobRoster {
  return [
    {
      id: 'job-a',
      description: 'research lane A',
      state: 'working',
      startedAt: Date.now(),
      job: { taskId: 'task-a', lifecycle: 'running', currentStep }
    },
    {
      id: 'job-b',
      description: 'research lane B',
      state: 'idle',
      startedAt: Date.now() - 1000,
      job: { taskId: 'task-b', lifecycle: 'succeeded' }
    }
  ]
}

test('shows omo background jobs live on the Agent Dashboard and admits omo to native chat', async ({
  electronApp,
  orcaPage
}) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  const endpoint = await readHookEndpoint(electronApp)

  // Why: the hook server only accepts status for a live claimed pane, so drive the
  // app's real PTY pane instead of a synthetic store entry.
  const ptyId = await waitForActivePanePtyId(orcaPage)
  const readyMarker = `__OMO_HOOK_READY_${Date.now()}__`
  await sendToTerminal(orcaPage, ptyId, `printf '${readyMarker}\\n'\r`)
  await waitForTerminalOutput(orcaPage, readyMarker)
  const { paneKey } = await waitForActivePaneHookDescriptor(orcaPage)
  const target = { paneKey, worktreeId }

  await orcaPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    const state = store.getState()
    store.setState({
      agentDashboardDrawerOpen: false,
      settings: {
        ...state.settings,
        experimentalAgentDashboardPopout: true,
        experimentalAgentDashboardMode: 'in-window',
        experimentalAgentDashboardShowIdle: true,
        experimentalNativeChat: true,
        tabAutoGenerateTitle: false
      } as typeof state.settings
    })
  })

  // Turn start, then a real omo roster carrying job metadata.
  const prompt = `omo-live-jobs-${Date.now()}`
  await emitOmoHook(endpoint, target, { hook_event_name: 'before_agent_start', prompt })
  await emitOmoHook(endpoint, target, {
    hook_event_name: 'tool_execution_start',
    tool_name: 'task',
    subagents: roster('reading src/shared')
  })

  // Feature 3 first, while the hook row is fresh: the omo-attributed tab offers the native
  // chat view. The context-menu item is gated by canSwitchNativeChatView ->
  // isNativeChatSupportedAgent('omo'), so its presence is the user-visible proof.
  // Why: this pane's real foreground is a shell, so Orca's confirmed-shell reconciliation
  // legitimately retires a synthetic hook row once the pane goes quiet; assert before that.
  await expect
    .poll(
      () =>
        orcaPage.evaluate(
          (paneKey) => window.__store?.getState().agentStatusByPaneKey[paneKey]?.agentType ?? null,
          paneKey
        ),
      { timeout: 15_000 }
    )
    .toBe('omo')
  const [tabId] = paneKey.split(':')
  await orcaPage.locator(`[data-tab-id="${tabId}"]`).first().click({ button: 'right' })
  const chatItem = orcaPage.getByRole('menuitem', { name: /Switch to chat view|채팅 보기로 전환/ })
  await expect(chatItem).toBeVisible({ timeout: 10_000 })
  await expect(orcaPage.locator('[role="menu"][data-state="open"]')).toHaveCSS('opacity', '1')
  await orcaPage.screenshot({ path: path.join(EVIDENCE_DIR, '03-omo-chat-view-offered.png') })
  await orcaPage.keyboard.press('Escape')
  await expect(chatItem).toHaveCount(0)

  const dashboardButton = orcaPage.getByRole('button', {
    name: /Agent Dashboard|에이전트 대시보드/
  })
  await expect(dashboardButton).toBeVisible()
  await dashboardButton.click()
  const sheet = orcaPage.locator('[data-agent-dashboard-sheet]')
  await sheet.waitFor({ state: 'visible' })

  // The omo card is on the board; expand its job rows and assert user-visible job text.
  await expect(sheet.getByText(prompt)).toBeVisible({ timeout: 15_000 })
  // Why: the expander's accessible name is the localized subagent count ("2 subagents" / "서브에이전트 2개").
  await sheet
    .getByRole('button', { name: /subagent|서브에이전트/i, expanded: false })
    .first()
    .click()
  await expect(sheet.getByText('research lane A')).toBeVisible()
  await expect(sheet.getByText('reading src/shared')).toBeVisible()
  await expect(sheet.getByText('research lane B')).toBeVisible()
  await expect(sheet.getByText('succeeded')).toBeVisible()
  await orcaPage.screenshot({ path: path.join(EVIDENCE_DIR, '01-omo-jobs-initial.png') })

  // Second real hook: job A advances. The row must update live while the drawer stays open.
  await emitOmoHook(endpoint, target, {
    hook_event_name: 'tool_execution_start',
    tool_name: 'task',
    subagents: roster('writing ROADMAP-OMO.md')
  })
  await expect(sheet.getByText('writing ROADMAP-OMO.md')).toBeVisible({ timeout: 15_000 })
  await expect(sheet.getByText('reading src/shared')).toHaveCount(0)
  await orcaPage.screenshot({ path: path.join(EVIDENCE_DIR, '02-omo-jobs-live-updated.png') })

  console.log(JSON.stringify({ evidenceDir: EVIDENCE_DIR, paneKey, chatViewOffered: true }))
})
