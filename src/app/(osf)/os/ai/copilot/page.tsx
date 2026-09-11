import { Badge, PageHeader, SetupNotice } from "@/components/osf/ui";
import { gatedLoad } from "@/lib/osf/queries";
import { STARTER_QUESTIONS, gatherContext } from "@/lib/osf/ai/copilot";
import { configStatus } from "@/lib/osf/env";
import Copilot from "./Copilot";

export const dynamic = "force-dynamic";

/**
 * Ask questions of this business's own numbers.
 *
 * The context is gathered here as well as in the route handler: the panel has
 * to show what the copilot can see before anyone has asked anything, otherwise
 * the promise that answers are checkable only holds retrospectively.
 */
export default async function CopilotPage() {
  const page = await gatedLoad(
    { table: "villa_funnel", migration: "001_schema.sql" },
    gatherContext,
  );

  if (!page.ok) {
    return (
      <>
        <PageHeader title="Copilot" />
        <SetupNotice missing={page.missing} detail={page.error} />
      </>
    );
  }

  const status = configStatus();

  return (
    <>
      <PageHeader
        title="Copilot"
        sub="Answers come from a fixed set of aggregates read out of this database — the funnel, sources, hot leads, revenue, follow-ups, objections, campaigns and inventory. The model has no query tool and cannot reach a single conversation, so anything outside that context comes back as “I don't have that data” rather than an estimate."
        actions={
          <Badge tone={status.aiConfigured ? "gold" : "danger"}>
            {status.llmProvider}
            {status.aiConfigured ? "" : " · key missing"}
          </Badge>
        }
      />

      <Copilot starters={STARTER_QUESTIONS} initialContext={page.data} />
    </>
  );
}
