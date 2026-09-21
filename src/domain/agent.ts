import { z } from 'zod';

export const DEFAULT_AGENT_MAX_ATTEMPTS = 5;
export const agentMaxAttempts = z.number().int().min(1).max(10);
export const AGENT_CONTEXT_MESSAGES = 12;

export const agentDecisions = [
  'STILL_WAITING',
  'POSSIBLE_SUCCESS',
  'NEEDS_USER',
  'UNKNOWN',
] as const;
export type AgentDecision = (typeof agentDecisions)[number];

export const agentEvaluation = z.strictObject({
  decision: z.enum(agentDecisions),
  rationale: z.string().trim().min(3).max(1000),
  evidenceReferences: z.array(z.uuid()).max(50),
  recommendedNextCheckAt: z.string().datetime({ offset: true }).nullable(),
  userSummary: z.string().trim().min(3).max(1000).nullable(),
});
export type AgentEvaluation = z.infer<typeof agentEvaluation>;

export type AgentEvidence = {
  id: string;
  sender: string;
  subject: string;
  occurredAt: string;
  content: string;
  direction: 'incoming' | 'outgoing';
};
export type AgentEvaluationInput = {
  loop: {
    status: string;
    desiredOutcome: string;
    verificationCondition: string;
    waitingOn: string;
  };
  evidence: AgentEvidence[];
  previousObservation: string | null;
};
export interface AgentEvaluator {
  evaluate(input: AgentEvaluationInput, signal?: AbortSignal): Promise<unknown>;
}

export class AgentError extends Error {
  constructor(
    public readonly code:
      | 'SETUP'
      | 'GMAIL_AUTH'
      | 'GMAIL_API'
      | 'AI_API'
      | 'AI_OUTPUT'
      | 'STALE'
      | 'STORAGE',
  ) {
    super(code);
  }
}

export function validateAgentEvaluation(
  raw: unknown,
  evidence: AgentEvidence[],
): AgentEvaluation {
  const parsed = agentEvaluation.safeParse(raw);
  if (!parsed.success) throw new AgentError('AI_OUTPUT');
  const allowed = new Set(evidence.map((item) => item.id));
  if (parsed.data.evidenceReferences.some((id) => !allowed.has(id)))
    throw new AgentError('AI_OUTPUT');
  if (
    parsed.data.decision === 'POSSIBLE_SUCCESS' &&
    parsed.data.evidenceReferences.length === 0
  )
    throw new AgentError('AI_OUTPUT');
  return parsed.data;
}
