import type { ResumableTuiAgent } from '../../../shared/agent-session-resume'
import type { TuiAgent } from '../../../shared/tui-agent'
import {
  AGENT_SESSION_KIMI_RESUME_RUNTIME_CAPABILITY,
  AGENT_SESSION_OMO_RESUME_RUNTIME_CAPABILITY,
  AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY,
  type RuntimeCapability
} from '../../../shared/protocol-version'

// Why: every agent added to RESUMABLE_TUI_AGENTS after agent-session.host-authority.v1 widens the
// host's ensureAgentSession enum. An older host answers the unknown member with invalid_argument,
// which runRemoteAgentSessionLaunch does not treat as a fallback signal, so the pane dies instead
// of degrading to a legacy launch. Probing the agent's own capability keeps version skew safe.
// The exhaustive Record makes the next RESUMABLE_TUI_AGENTS entry a compile error until its own
// gate — or a deliberate `undefined` — is declared here.
const RESUME_HOST_AUTHORITY_CAPABILITY_BY_AGENT = {
  // These shipped inside agent-session.host-authority.v1's enum, so the generic probe covers them.
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
  // Ungated on purpose: prime-agent's host-side status hooks and its enum entry both shipped in
  // a1f61ef, so no host emits a prime-agent provider session without also accepting the member.
  'prime-agent': undefined,
  // Ungated to match how main shipped copilot resume; gating it is its own change.
  copilot: undefined,
  omp: AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY,
  omo: AGENT_SESSION_OMO_RESUME_RUNTIME_CAPABILITY,
  kimi: AGENT_SESSION_KIMI_RESUME_RUNTIME_CAPABILITY
} satisfies Record<ResumableTuiAgent, RuntimeCapability | undefined>

// Why: omp and kimi were TuiAgent members before their resume gates existed, so a host lacking
// the gate still parses their launchAgent/agent. omo entered TuiAgent together with its gate, so
// the same host rejects its identity (isTuiAgent) and the legacy launch must carry only the command.
const IDENTITY_SHIPPED_WITH_CAPABILITY: ReadonlySet<TuiAgent> = new Set<TuiAgent>(['omo'])

export function legacyLaunchMustOmitAgentIdentity(agent: TuiAgent | null | undefined): boolean {
  return agent != null && IDENTITY_SHIPPED_WITH_CAPABILITY.has(agent)
}

// Why: any structured launch (fresh OR resume) of an agent whose identity entered TuiAgent WITH its
// capability gate is rejected by a pre-omo host's isTuiAgent with invalid_argument — not a fallback
// code — so the per-agent probe, not the error handler, must select the legacy path. Resume also has
// its own resume-path gate (kimi/omp); this covers the fresh createAgentSession hole.
export function agentStructuredLaunchCapability(
  agent: TuiAgent | null | undefined
): RuntimeCapability | undefined {
  return agent != null && IDENTITY_SHIPPED_WITH_CAPABILITY.has(agent)
    ? AGENT_SESSION_OMO_RESUME_RUNTIME_CAPABILITY
    : undefined
}

export function agentResumeHostAuthorityCapability(
  agent: TuiAgent | null | undefined
): RuntimeCapability | undefined {
  if (!agent) {
    return undefined
  }
  return (
    RESUME_HOST_AUTHORITY_CAPABILITY_BY_AGENT as Partial<Record<TuiAgent, RuntimeCapability>>
  )[agent]
}
