"use client";

import { useRef } from "react";
import { PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@/lib/osf/crm";

/**
 * Stage picker that submits itself.
 *
 * The board is a Server Component and every write goes through the same form
 * POST the rest of the CRM uses; the only thing this needs the client for is
 * firing the submit on change, so a rep moves a deal in one gesture rather than
 * select-then-confirm. Without JS the `<noscript>` button keeps it working.
 */
export default function StageMove({
  leadId,
  stage,
}: {
  leadId: string;
  stage: PipelineStage;
}) {
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action="/api/osf/crm" method="POST" className="flex items-center gap-1.5">
      <input type="hidden" name="action" value="set_stage" />
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="next" value="/os/crm/pipeline" />
      <select
        name="stage"
        defaultValue={stage}
        onChange={() => form.current?.requestSubmit()}
        aria-label="Move to stage"
        className="w-full rounded-lg border border-[--color-line] bg-[--color-void] px-2 py-1.5 text-[11px] text-[--color-muted] transition hover:border-[--color-gold-line] hover:text-[--color-ink] focus:border-[--color-gold-line] focus:outline-none"
      >
        {PIPELINE_STAGES.map((value) => (
          <option key={value} value={value}>
            {value === stage ? `Move to…  (${STAGE_LABELS[value]})` : STAGE_LABELS[value]}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn-ghost !px-2 !py-1 text-[11px]">
          Move
        </button>
      </noscript>
    </form>
  );
}
