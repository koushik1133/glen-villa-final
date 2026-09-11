import type { AgentReply, Conversation, Lead } from "../types";

export interface RunResult {
  replies: AgentReply[];
  leadScore: number;
  temperature: string;
  toolsUsed: string[];
  /** Cache diagnostics — only populated on the Anthropic path; zero on Groq. */
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface RunAgentParams {
  lead: Lead;
  conversation: Conversation;
  customerMessage: string;
  deliver: (reply: AgentReply) => Promise<void>;
}
