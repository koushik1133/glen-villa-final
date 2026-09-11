import { env } from "../env";
import type { RunAgentParams, RunResult } from "./types";

export type { RunResult } from "./types";

/**
 * Provider dispatch. LLM_PROVIDER selects which implementation actually
 * talks to a model — everything upstream of this (the webhook, the
 * simulator, the CRM) is provider-agnostic and doesn't need to know which
 * one is active.
 */
export async function runAgent(params: RunAgentParams): Promise<RunResult> {
  if (env.llmProvider === "groq") {
    const { runAgentGroq } = await import("./run-groq");
    return runAgentGroq(params);
  }
  const { runAgentAnthropic } = await import("./run");
  return runAgentAnthropic(params);
}
