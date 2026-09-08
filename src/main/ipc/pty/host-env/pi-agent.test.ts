import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: the resolver consults the user's real shell rc files as a last resort; pin that
// source so the omo fallback contract is asserted, not the developer's dotfiles.
vi.mock('../../../pty/shell-startup-env', () => ({
  readSessionShellStartupEnvVar: () => undefined
}))

const { resolvePiAgentSourceDir } = await import('./pi-agent')

describe('resolvePiAgentSourceDir (omo)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('never falls back to PI_CODING_AGENT_DIR for omo', () => {
    // Why: the Pi-family contract forbids cross-agent fallback; a Pi-only override must not
    // make omo install its status/prefill extensions into Pi's home.
    vi.stubEnv('OMO_CODING_AGENT_DIR', '')
    vi.stubEnv('SENPI_CODING_AGENT_DIR', '')
    vi.stubEnv('ORCA_OMO_SOURCE_AGENT_DIR', '')
    vi.stubEnv('PI_CODING_AGENT_DIR', '/tmp/pi-home/agent')
    expect(
      resolvePiAgentSourceDir({ PI_CODING_AGENT_DIR: '/tmp/pi-home/agent' }, 'omo')
    ).toBeUndefined()
  })

  it("honors omo's own env names in order", () => {
    vi.stubEnv('OMO_CODING_AGENT_DIR', '')
    vi.stubEnv('SENPI_CODING_AGENT_DIR', '')
    vi.stubEnv('ORCA_OMO_SOURCE_AGENT_DIR', '')
    expect(resolvePiAgentSourceDir({ SENPI_CODING_AGENT_DIR: '/tmp/senpi/agent' }, 'omo')).toBe(
      '/tmp/senpi/agent'
    )
    expect(
      resolvePiAgentSourceDir(
        { OMO_CODING_AGENT_DIR: '/tmp/omo/agent', SENPI_CODING_AGENT_DIR: '/tmp/senpi/agent' },
        'omo'
      )
    ).toBe('/tmp/omo/agent')
    expect(
      resolvePiAgentSourceDir(
        { ORCA_OMO_SOURCE_AGENT_DIR: '/tmp/src/agent', OMO_CODING_AGENT_DIR: '/tmp/omo/agent' },
        'omo'
      )
    ).toBe('/tmp/src/agent')
  })
})
