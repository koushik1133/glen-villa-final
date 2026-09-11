import { WorkspaceNav } from "@/components/whatsapp-workspace/workspace-nav";

/**
 * The WhatsApp workspace.
 *
 * Everything WhatsApp-related lives under this one tab: the inbox, the
 * assistant's training, and the sales console that grew up around the agent.
 * They used to be three separate sidebar entries pointing at the same subject,
 * one of which opened a second application with its own chrome and its own
 * colours.
 *
 * There is no shell of its own here on purpose — the app layout above already
 * supplies the sidebar, the gate and the dock. This adds only the second-level
 * navigation between the workspace's sections.
 */
export default function WhatsAppWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="osf-root flex min-h-screen flex-col">
      <WorkspaceNav />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
