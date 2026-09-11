// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { useAppStore } from '@/store'
import { TOGGLE_FLOATING_TERMINAL_EVENT } from './floating-terminal'
import { openSubagentLiveInFloatingWorkspace } from './open-subagent-live-in-floating-workspace'

const initialState = useAppStore.getState()

afterEach(() => {
  useAppStore.setState(initialState, true)
  document.body.innerHTML = ''
})

describe('openSubagentLiveInFloatingWorkspace', () => {
  it('opens one floating virtual editor tab bound to the child transcript and reveals the panel', () => {
    const toggles = vi.fn()
    window.addEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggles)

    const fileId = openSubagentLiveInFloatingWorkspace({
      worktreeCwd: '/repo/worktrees/omo',
      taskId: 'st_01a08fe1',
      label: 'Map shell navigation'
    })

    const state = useAppStore.getState()
    const file = state.openFiles.find((candidate) => candidate.id === fileId)
    expect(file).toMatchObject({
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      mode: 'subagent-live',
      subagentLive: {
        worktreeCwd: '/repo/worktrees/omo',
        taskId: 'st_01a08fe1',
        label: 'Map shell navigation'
      }
    })
    const floatingTabs = state.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []
    expect(floatingTabs.filter((tab) => tab.entityId === fileId)).toHaveLength(1)
    expect(toggles).toHaveBeenCalledTimes(1)
    window.removeEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggles)
  })

  it('focuses the existing tab on a second click instead of duplicating it', () => {
    const binding = { worktreeCwd: '/repo/worktrees/omo', taskId: 'st_dup', label: 'Dup' }
    const first = openSubagentLiveInFloatingWorkspace(binding)
    const second = openSubagentLiveInFloatingWorkspace(binding)

    expect(second).toBe(first)
    const state = useAppStore.getState()
    expect(state.openFiles.filter((file) => file.id === first)).toHaveLength(1)
    expect(
      (state.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []).filter(
        (tab) => tab.entityId === first
      )
    ).toHaveLength(1)
  })

  it('does not toggle the panel closed when it is already visible', () => {
    const panel = document.createElement('div')
    panel.setAttribute('data-floating-terminal-panel', '')
    panel.setAttribute('aria-hidden', 'false')
    document.body.appendChild(panel)
    const toggles = vi.fn()
    window.addEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggles)

    openSubagentLiveInFloatingWorkspace({ worktreeCwd: '/w', taskId: 'st_open', label: 'Open' })

    expect(toggles).not.toHaveBeenCalled()
    window.removeEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggles)
  })
})
