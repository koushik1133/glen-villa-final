import Link from "next/link";
import {
  FileText,
  Globe,
  Mail,
  MessageSquare,
  Phone,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { Badge, Empty, TemperaturePill, timeAgo } from "@/components/osf/ui";
import { channelLabel, type InboxConversation, type ThreadLead } from "@/lib/osf/communication";
import type { Message, MessageRole } from "@/lib/osf/types";

/**
 * The subset of a message this file actually renders.
 *
 * Widened from `Message` so the CRM's lead-360 thread — which selects eleven
 * columns rather than the whole row — reuses the same bubbles instead of
 * growing a second, slowly-diverging copy of them.
 */
export type ThreadMessage = Pick<Message, "id" | "role" | "body" | "media_url" | "created_at"> & {
  media_kind: string | null;
};

/**
 * Presentation shared by the unified inbox and the WhatsApp console.
 *
 * Both surfaces render the same list and the same thread; only the filters
 * above them and the composer below them differ. Keeping the pieces here means
 * a change to how a message bubble reads lands on both at once.
 */

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  whatsapp: MessageSquare,
  instagram: Smartphone,
  facebook: Globe,
  email: Mail,
  sms: Smartphone,
  web_form: Globe,
  call: Phone,
};

export function ChannelIcon({ channel, size = 14 }: { channel: string; size?: number }) {
  const Icon = CHANNEL_ICONS[channel] ?? Globe;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

/** Media-only messages have a null body; say what arrived rather than nothing. */
function previewText(body: string | null, mediaKind: string | null): string {
  const text = body?.trim();
  if (text) return text;
  if (mediaKind) return `Sent a ${mediaKind.replace(/_/g, " ")}`;
  return "No message body";
}

const ROLE_PREFIX: Record<MessageRole, string> = {
  customer: "",
  agent: "AI: ",
  human_agent: "You: ",
  system: "",
};

function buildHref(basePath: string, params: Record<string, string | undefined>, id: string) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  query.set("c", id);
  return `${basePath}?${query.toString()}`;
}

export function ConversationList({
  conversations,
  activeId,
  basePath,
  params = {},
}: {
  conversations: InboxConversation[];
  activeId?: string;
  basePath: string;
  /** Filter state to carry through when a thread is opened. */
  params?: Record<string, string | undefined>;
}) {
  return (
    <ul className="divide-y divide-[--color-line]">
      {conversations.map((conversation) => {
        const active = conversation.id === activeId;
        const lead = conversation.lead;
        return (
          <li key={conversation.id}>
            <Link
              href={buildHref(basePath, params, conversation.id)}
              className={`block px-4 py-3.5 transition-colors ${
                active ? "bg-[--color-gold-soft]" : "hover:bg-[--color-raised]"
              }`}
              style={active ? { boxShadow: "inset 2px 0 0 0 var(--color-gold-500)" } : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[--color-faint]">
                    <ChannelIcon channel={conversation.channel} />
                  </span>
                  <p
                    className={`truncate text-sm font-medium ${
                      active ? "text-[--color-gold-100]" : "text-[--color-ink]"
                    }`}
                  >
                    {lead?.name?.trim() || (lead ? `+${lead.phone}` : "Unknown contact")}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-[--color-faint]">
                  {timeAgo(conversation.last_message_at)}
                </span>
              </div>

              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[--color-muted]">
                {conversation.preview
                  ? `${ROLE_PREFIX[conversation.preview.role]}${previewText(
                      conversation.preview.body,
                      conversation.preview.media_kind,
                    )}`
                  : "No messages yet"}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {lead && <TemperaturePill value={lead.lead_temperature} />}
                {/* The customer wrote last, so nobody has answered them yet. */}
                {conversation.preview?.role === "customer" && (
                  <Badge tone="info">Awaiting reply</Badge>
                )}
                {lead?.ai_paused && <Badge tone="warning">AI paused</Badge>}
                {lead?.opted_out && <Badge tone="danger">Opted out</Badge>}
                {conversation.status !== "open" && (
                  <Badge tone="neutral">{conversation.status}</Badge>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const BUBBLE_STYLES: Record<MessageRole, string> = {
  customer: "bg-[--color-raised] text-[--color-ink] rounded-bl-sm",
  agent: "bg-[rgba(109,168,232,0.10)] text-[--color-ink] rounded-br-sm border border-[rgba(109,168,232,0.24)]",
  human_agent: "bg-[--color-gold-soft] text-[--color-gold-100] rounded-br-sm border border-[--color-gold-line]",
  system: "bg-transparent text-[--color-faint] border border-dashed border-[--color-line]",
};

const ROLE_LABELS: Record<MessageRole, string> = {
  customer: "Customer",
  agent: "AI agent",
  human_agent: "Rep",
  system: "System",
};

function messageTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  const outbound = message.role === "agent" || message.role === "human_agent";
  const system = message.role === "system";
  const template = message.body?.startsWith("[template: ") ?? false;

  return (
    <div className={`flex ${system ? "justify-center" : outbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] ${system ? "max-w-full" : ""}`}>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${BUBBLE_STYLES[message.role]}`}>
          {template && (
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--color-gold-300]">
              <FileText size={11} strokeWidth={2} aria-hidden />
              Approved template
            </p>
          )}
          {message.body ? (
            <p className="whitespace-pre-wrap break-words">
              {template ? message.body.replace(/^\[template: /, "").replace(/\]/, "") : message.body}
            </p>
          ) : (
            <p className="italic text-[--color-muted]">No text</p>
          )}

          {message.media_url && (
            <a
              href={message.media_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-[--color-gold-300] underline underline-offset-2"
            >
              <FileText size={12} strokeWidth={1.75} aria-hidden />
              {message.media_kind?.replace(/_/g, " ") ?? "Attachment"}
            </a>
          )}
        </div>

        <p
          className={`mt-1 px-1 text-[10px] tabular-nums text-[--color-faint] ${
            system ? "text-center" : outbound ? "text-right" : ""
          }`}
        >
          {ROLE_LABELS[message.role]} · {messageTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

/** Groups by calendar day so a long thread doesn't read as one undated run. */
export function MessageThread({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return <Empty>This conversation has no messages yet.</Empty>;
  }

  const days: Array<{ day: string; items: ThreadMessage[] }> = [];
  for (const message of messages) {
    const day = new Date(message.created_at).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(message);
    else days.push({ day, items: [message] });
  }

  return (
    <div className="space-y-6">
      {days.map((group) => (
        <div key={group.day} className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[--color-line]" />
            <span className="label">{group.day}</span>
            <span className="h-px flex-1 bg-[--color-line]" />
          </div>
          {group.items.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ThreadHeader({
  lead,
  channel,
  status,
  messageCount,
  children,
}: {
  lead: ThreadLead | null;
  channel: string;
  status: string;
  messageCount: number;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[--color-line] pb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-base font-semibold text-[--color-ink]">
            {lead?.name?.trim() || (lead ? `+${lead.phone}` : "Unknown contact")}
          </h2>
          {lead && <TemperaturePill value={lead.lead_temperature} />}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[--color-muted]">
          <span className="inline-flex items-center gap-1.5">
            <ChannelIcon channel={channel} size={12} />
            {channelLabel(channel)}
          </span>
          {lead && <span>+{lead.phone}</span>}
          {lead?.email && <span>{lead.email}</span>}
          <span>{messageCount} messages</span>
          <span className="capitalize">{status}</span>
          {lead && (
            <Link
              href={`/os/crm/leads/${lead.id}`}
              className="text-[--color-gold-300] underline underline-offset-2"
            >
              Open lead
            </Link>
          )}
        </p>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** The right-hand pane when no `?c=` is selected. */
export function NoThreadSelected({ hasConversations }: { hasConversations: boolean }) {
  return (
    <Empty>
      {hasConversations
        ? "Pick a conversation on the left to read the thread."
        : "No conversations yet. One is created the first time a customer messages."}
    </Empty>
  );
}
