import { describe, expect, it } from 'vitest'
import { RESUMABLE_TUI_AGENTS } from '../../../shared/agent-session-resume'
import {
  AGENT_SESSION_KIMI_RESUME_RUNTIME_CAPABILITY,
  AGENT_SESSION_OMO_RESUME_RUNTIME_CAPABILITY,
  AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY,
  RUNTIME_CAPABILITIES
} from '../../../shared/protocol-version'
import {
  agentResumeHostAuthorityCapability,
  agentStructuredLaunchCapability,
  legacyLaunchMustOmitAgentIdentity
} from './agent-resume-host-authority-capability'

describe('agentResumeHostAuthorityCapability', () => {
  it('gates Kimi resume behind its own capability', () => {
    expect(agentResumeHostAuthorityCapability('kimi')).toBe(
      AGENT_SESSION_KIMI_RESUME_RUNTIME_CAPABILITY
    )
  })

  it('gates omo resume behind its own capability, like Kimi', () => {
    // Why: omo grows the closed ensureAgentSession enum; an older host answers invalid_argument.
    expect(agentResumeHostAuthorityCapability('omo')).toBe(
      AGENT_SESSION_OMO_RESUME_RUNTIME_CAPABILITY
    )
    expect(RUNTIME_CAPABILITIES).toContain(AGENT_SESSION_OMO_RESUME_RUNTIME_CAPABILITY)
    expect(RESUMABLE_TUI_AGENTS).toContain('omo')
  })

  it('keeps the OMP resume-path gate', () => {
    expect(agentResumeHostAuthorityCapability('omp')).toBe(
      AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY
    )
  })

  it('leaves agents shipped with host authority on the generic probe', () => {
    expect(agentResumeHostAuthorityCapability('codex')).toBeUndefined()
    expect(agentResumeHostAuthorityCapability(null)).toBeUndefined()
    expect(agentResumeHostAuthorityCapability(undefined)).toBeUndefined()
  })

  it('advertises the Kimi resume capability from the host', () => {
    expect(RUNTIME_CAPABILITIES).toContain(AGENT_SESSION_KIMI_RESUME_RUNTIME_CAPABILITY)
  })

  it('gates a fresh structured launch of an enum-gated agent (omo) but not older members', () => {
    // Why: a fresh omo createAgentSession carries agent:'omo'; a pre-omo host rejects it with
    // invalid_argument, so the per-agent probe must select legacy. kimi/omp predate their gates.
    expect(agentStructuredLaunchCapability('omo')).toBe(AGENT_SESSION_OMO_RESUME_RUNTIME_CAPABILITY)
    expect(agentStructuredLaunchCapability('kimi')).toBeUndefined()
    expect(agentStructuredLaunchCapability('codex')).toBeUndefined()
    expect(agentStructuredLaunchCapability(null)).toBeUndefined()
  })

  it('omits the agent identity on a degraded legacy launch only for enum-gated agents', () => {
    // Why: omp and kimi were TuiAgent members before their gates (b2902cb61^ already lists kimi),
    // so an old host still parses their identity; omo entered TuiAgent with its gate.
    expect(legacyLaunchMustOmitAgentIdentity('omo')).toBe(true)
    expect(legacyLaunchMustOmitAgentIdentity('kimi')).toBe(false)
    expect(legacyLaunchMustOmitAgentIdentity('omp')).toBe(false)
    expect(legacyLaunchMustOmitAgentIdentity('codex')).toBe(false)
    expect(legacyLaunchMustOmitAgentIdentity(null)).toBe(false)
  })

  it('pins the gate for every resumable agent so a new member is a deliberate decision', () => {
    // Why: silently defaulting a newly resumable agent to the generic probe is the exact skew
    // failure this module exists to prevent — the mapping must be reviewed, not inherited.
    expect(
      Object.fromEntries(
        RESUMABLE_TUI_AGENTS.map((agent) => [agent, agentResumeHostAuthorityCapability(agent)])
      )
    ).toEqual({
      claude: undefined,
      codex: undefined,
      gemini: undefined,
      antigravity: undefined,
      opencode: undefined,
      pi: undefined,
      'mimo-code': undefined,
      droid: undefined,
      grok: undefined,
      devin: undefined,
      'prime-agent': undefined,
      copilot: undefined,
      omp: AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY,
      omo: AGENT_SESSION_OMO_RESUME_RUNTIME_CAPABILITY,
      kimi: AGENT_SESSION_KIMI_RESUME_RUNTIME_CAPABILITY
    })
  })
})
