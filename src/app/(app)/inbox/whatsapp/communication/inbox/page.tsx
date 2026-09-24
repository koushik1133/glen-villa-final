import Link from "next/link";
import { Card, Empty, PageHeader, SetupNotice, formatNumber } from "@/components/osf/ui";
import {
  CHANNELS,
  CONVERSATION_STATUSES,
  SERVICE_WINDOW_HOURS,
  channelLabel,
  inboxFacets,
  lastInboundFrom,
  listConversations,
  loadThread,
  serviceWindow,
  serviceWindowApplies,
  windowLabel,
} from "@/lib/osf/communication";
import { gatedLoad } from "@/lib/osf/queries";
import { ChannelIcon, ConversationList, MessageThread, NoThreadSelected, ThreadHeader } from "../thread";
import { LiveRefresh } from "../LiveRefresh";
import ReplyBox from "../whatsapp/ReplyBox";

export const dynamic = "force-dynamic";

const BASE = "/inbox/whatsapp/communication/inbox";

/** A filter chip. Selecting one drops `?c=` — the open thread may not survive the new filter. */
function FilterPill({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`pill border transition ${
        active
          ? "border-[var(--color-gold-line)] bg-[var(--color-gold-soft)] text-[var(--color-gold-100)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
      }`}
    >
      {children}
      {count !== undefined && (
        <span className="tabular-nums text-[var(--color-faint)]">{formatNumber(count)}</span>
      )}
    </Link>
  );
}

function filterHref(channel?: string, status?: string): string {
  const query = new URLSearchParams();
  if (channel) query.set("channel", channel);
  if (status) query.set("status", status);
  const search = query.toString();
  return search ? `${BASE}?${search}` : BASE;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; channel?: string; status?: string; error?: string }>;
}) {
  const { c, channel, status, error } = await searchParams;

  // Narrowed against the enum so a hand-typed ?channel= can't reach PostgREST
  // and turn an unknown value into a 400 on an otherwise working page.
  const activeChannel = CHANNELS.find((value) => value === channel);
  const activeStatus = CONVERSATION_STATUSES.find((value) => value === status);

  const page = await gatedLoad(null, () =>
    Promise.all([
      listConversations({ channel: activeChannel, status: activeStatus, limit: 80 }),
      inboxFacets(),
      c ? loadThread(c) : Promise.resolve(null),
    ] as const),
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Inbox" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const [conversations, facets, thread] = page.data;
  const carry = { channel: activeChannel, status: activeStatus };

  /** Back to this same thread, with whatever filters are applied, after a send. */
  const threadHref = (conversationId: string) => {
    const query = new URLSearchParams({ c: conversationId });
    if (activeChannel) query.set("channel", activeChannel);
    if (activeStatus) query.set("status", activeStatus);
    return `${BASE}?${query.toString()}`;
  };

  // Meta's 24-hour rule is a property of the conversation, not of the screen it
  // is read on, so it is computed here exactly as the WhatsApp console does it.
  const windowApplies = serviceWindowApplies();
  const replyWindow = thread ? serviceWindow(lastInboundFrom(thread.messages)) : null;
  const closesAt =
    replyWindow?.lastInboundAt !== null && replyWindow?.lastInboundAt !== undefined
      ? new Date(
          new Date(replyWindow.lastInboundAt).getTime() + SERVICE_WINDOW_HOURS * 3_600_000,
        ).toISOString()
      : null;

  return (
    <>
      <PageHeader
        title="Inbox"
        sub="Every thread, every channel, newest first. WhatsApp threads can be answered here; replying pauses the AI on that lead."
        actions={<LiveRefresh seconds={8} />}
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-[color-mix(in_oklab,var(--c-bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--c-bad)_8%,transparent)] p-4 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label w-14 shrink-0">Channel</span>
          <FilterPill href={filterHref(undefined, activeStatus)} active={!activeChannel} count={facets.total}>
            All
          </FilterPill>
          {CHANNELS.map((value) => (
            <FilterPill
              key={value}
              href={filterHref(value, activeStatus)}
              active={activeChannel === value}
              count={facets.byChannel[value] ?? 0}
            >
              <ChannelIcon channel={value} size={12} />
              {channelLabel(value)}
            </FilterPill>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="label w-14 shrink-0">Status</span>
          <FilterPill href={filterHref(activeChannel, undefined)} active={!activeStatus}>
            Any
          </FilterPill>
          {CONVERSATION_STATUSES.map((value) => (
            <FilterPill
              key={value}
              href={filterHref(activeChannel, value)}
              active={activeStatus === value}
              count={facets.byStatus[value] ?? 0}
            >
              <span className="capitalize">{value}</span>
            </FilterPill>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="card overflow-hidden p-0">
          <header className="flex items-baseline justify-between border-b border-[var(--color-line)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">Conversations</h2>
            <span className="text-[11px] tabular-nums text-[var(--color-faint)]">
              {formatNumber(conversations.length)} shown
            </span>
          </header>

          {conversations.length === 0 ? (
            <div className="p-4">
              <Empty>
                {facets.total === 0
                  ? "No conversations yet. One is created the first time a customer messages."
                  : "No conversations match this filter."}
              </Empty>
            </div>
          ) : (
            <div className="max-h-[calc(100vh-19rem)] overflow-y-auto">
              <ConversationList
                conversations={conversations}
                activeId={thread?.conversation.id}
                basePath={BASE}
                params={carry}
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
                messageCount={thread.conversation.message_count}
              >
                {thread.conversation.channel === "whatsapp" && (
                  <Link
                    href={`/inbox/whatsapp/communication/whatsapp?c=${thread.conversation.id}`}
                    className="btn-ghost !py-2 text-xs"
                  >
                    {/* Replying no longer requires the console, so the link
                        now offers what the inbox does not: the AI pause/resume
                        toggle and the opt-out banner. */}
                    Open in WhatsApp console
                  </Link>
                )}
              </ThreadHeader>

              {thread.conversation.summary && (
                <p className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-void)] p-3 text-xs leading-relaxed text-[var(--color-muted)]">
                  <span className="label mr-2">AI summary</span>
                  {thread.conversation.summary}
                </p>
              )}

              <div className="mt-5 max-h-[calc(100vh-30rem)] min-h-[12rem] overflow-y-auto pr-1">
                <MessageThread messages={thread.messages} />
              </div>

              {/*
                Replying happens here now, not only in the WhatsApp console.
                Making someone read a thread on one screen and answer it on
                another is a step that exists for no reason the customer would
                recognise — and the composer already carries its own rules
                (the 24-hour window, template fallback, and pausing the AI on
                send), so nothing is lost by offering it in both places.
              */}
              {thread.conversation.channel !== "whatsapp" ? (
                <p className="mt-4 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-muted)]">
                  {channelLabel(thread.conversation.channel)} has no send integration wired up in
                  this app, so this thread is read-only.
                </p>
              ) : thread.lead?.opted_out ? (
                <p className="mt-4 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-danger)]">
                  This customer opted out. Nothing may be sent to them on any channel.
                </p>
              ) : (
                <ReplyBox
                  conversationId={thread.conversation.id}
                  windowClosesAt={closesAt}
                  initiallyOpen={replyWindow?.open ?? false}
                  initialLabel={replyWindow ? windowLabel(replyWindow) : "No inbound message yet"}
                  preferredLanguage={thread.lead?.preferred_language ?? "en"}
                  windowApplies={windowApplies}
                  returnTo={threadHref(thread.conversation.id)}
                />
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
