import Link from "next/link";
import { Bot, BotOff, AlertTriangle } from "lucide-react";
import { Badge, Card, Empty, PageHeader, SetupNotice, formatNumber } from "@/components/osf/ui";
import {
  SERVICE_WINDOW_HOURS,
  WHATSAPP_ENV_VARS,
  lastInboundFrom,
  listConversations,
  loadThread,
  serviceWindow,
  windowLabel,
} from "@/lib/osf/communication";
import { configStatus } from "@/lib/osf/env";
import { gatedLoad } from "@/lib/osf/queries";
import { ConversationList, MessageThread, NoThreadSelected, ThreadHeader } from "../thread";
import ReplyBox from "./ReplyBox";

export const dynamic = "force-dynamic";

const BASE = "/inbox/whatsapp/communication/whatsapp";

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; error?: string }>;
}) {
  const { c, error } = await searchParams;

  const page = await gatedLoad(null, () =>
    Promise.all([
      listConversations({ channel: "whatsapp", limit: 80 }),
      c ? loadThread(c) : Promise.resolve(null),
    ] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="WhatsApp" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [conversations, thread] = page.data;
  const connected = configStatus().whatsapp;

  // A thread reached from the inbox may not be WhatsApp at all. The send path
  // refuses those anyway; saying so here beats offering a composer that can't work.
  const wrongChannel = thread !== null && thread.conversation.channel !== "whatsapp";

  const window = thread ? serviceWindow(lastInboundFrom(thread.messages)) : null;
  const closesAt =
    window?.lastInboundAt !== null && window?.lastInboundAt !== undefined
      ? new Date(new Date(window.lastInboundAt).getTime() + SERVICE_WINDOW_HOURS * 3_600_000).toISOString()
      : null;

  const awaiting = conversations.filter((row) => row.preview?.role === "customer").length;
  const paused = conversations.filter((row) => row.lead?.ai_paused).length;

  return (
    <>
      <PageHeader
        title="WhatsApp"
        sub="The only channel with a live send integration. Replying here hands the thread to you — the AI stops answering on it until you give it back."
        actions={
          <div className="text-right">
            <p className="stat text-xl">{formatNumber(conversations.length)}</p>
            <p className="label mt-0.5">
              {awaiting} awaiting reply · {paused} AI paused
            </p>
          </div>
        }
      />

      {!connected && <SetupNotice missing={WHATSAPP_ENV_VARS} detail="Threads still render from the database, but nothing can be sent until the WhatsApp Cloud API credentials are set." />}

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] p-4 text-sm text-[var(--color-danger)]">
          <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="card overflow-hidden p-0">
          <header className="flex items-baseline justify-between border-b border-[var(--color-line)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">WhatsApp threads</h2>
            <span className="text-[11px] tabular-nums text-[var(--color-faint)]">
              {formatNumber(conversations.length)} shown
            </span>
          </header>

          {conversations.length === 0 ? (
            <div className="p-4">
              <Empty
                action={
                  <Link href="/inbox/whatsapp/simulator" className="btn-ghost">
                    Open the simulator
                  </Link>
                }
              >
                No WhatsApp conversations yet. One is created the first time someone messages the
                business number.
              </Empty>
            </div>
          ) : (
            <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
              <ConversationList
                conversations={conversations}
                activeId={thread?.conversation.id}
                basePath={BASE}
              />
            </div>
          )}
        </section>

        <Card>
          {!thread ? (
            <NoThreadSelected hasConversations={conversations.length > 0} />
          ) : (
            <>
              <ThreadHeader
                lead={thread.lead}
                channel={thread.conversation.channel}
                status={thread.conversation.status}
                // Count the rows being displayed, not the cached tally on the
                // conversation. That counter is incremented per agent turn and
                // drifts — it read 54 against 66 stored messages — so the header
                // contradicted the thread directly beneath it.
                messageCount={thread.messages.length}
              >
                {thread.lead && <AiControl leadId={thread.lead.id} paused={thread.lead.ai_paused} conversationId={thread.conversation.id} />}
              </ThreadHeader>

              {thread.lead?.ai_paused && (
                <p className="mt-4 rounded-xl border border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] px-3.5 py-3 text-xs leading-relaxed text-[var(--color-ink)]">
                  <span className="font-semibold text-[var(--color-gold-300)]">You own this thread.</span>{" "}
                  The agent will not reply to this customer while it is paused, including to a
                  question it could have answered. Resume it when you are done.
                </p>
              )}

              {thread.lead?.opted_out && (
                <p className="mt-4 rounded-xl border border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] px-3.5 py-3 text-xs text-[var(--color-danger)]">
                  This customer opted out. Nothing may be sent to them on any channel.
                </p>
              )}

              <div className="mt-5 max-h-[calc(100vh-30rem)] min-h-[16rem] overflow-y-auto pr-1">
                <MessageThread messages={thread.messages} />
              </div>

              {wrongChannel ? (
                <p className="mt-5 border-t border-[var(--color-line)] pt-4 text-sm text-[var(--color-muted)]">
                  This is not a WhatsApp thread, so it cannot be replied to from this console.
                </p>
              ) : thread.lead?.opted_out ? (
                <p className="mt-5 border-t border-[var(--color-line)] pt-4 text-sm text-[var(--color-muted)]">
                  The composer is withheld because this customer opted out.
                </p>
              ) : (
                <ReplyBox
                  conversationId={thread.conversation.id}
                  windowClosesAt={closesAt}
                  initiallyOpen={window?.open ?? false}
                  initialLabel={window ? windowLabel(window) : "No inbound message yet"}
                  preferredLanguage={thread.lead?.preferred_language ?? "en"}
                />
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * Pause/resume, as a one-button form.
 *
 * Sending already pauses the AI, so the common case is resuming. The button
 * states what will happen rather than what is true now, because a toggle that
 * reads "AI paused" is ambiguous about which way it is about to move.
 */
function AiControl({
  leadId,
  paused,
  conversationId,
}: {
  leadId: string;
  paused: boolean;
  conversationId: string;
}) {
  return (
    <form action="/api/osf/communication" method="POST" className="flex items-center gap-2">
      <input type="hidden" name="action" value="set_ai_paused" />
      <input type="hidden" name="leadId" value={leadId} />
      {!paused && <input type="hidden" name="paused" value="on" />}
      <input type="hidden" name="next" value={`/inbox/whatsapp/communication/whatsapp?c=${conversationId}`} />
      {paused ? (
        <Badge tone="warning">AI paused</Badge>
      ) : (
        <Badge tone="success">AI answering</Badge>
      )}
      <button type="submit" className="btn-ghost !py-2 text-xs">
        {paused ? <Bot size={14} strokeWidth={1.75} aria-hidden /> : <BotOff size={14} strokeWidth={1.75} aria-hidden />}
        {paused ? "Resume AI" : "Pause AI"}
      </button>
    </form>
  );
}
