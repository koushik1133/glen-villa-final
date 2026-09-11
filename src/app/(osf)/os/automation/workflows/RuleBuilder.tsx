"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { PIPELINE_STAGES, STAGE_LABELS } from "@/lib/osf/kanban";
import {
  ACTION_LABELS,
  ACTION_TYPES,
  CONDITION_FIELDS,
  LIVE_TRIGGERS,
  OPERATOR_LABELS,
  TASK_PRIORITIES,
  TRIGGER_EVENTS,
  TRIGGER_LABELS,
  type ActionType,
  type ConditionOperator,
} from "@/lib/osf/automations";

/**
 * The rule builder.
 *
 * State here decides only which inputs are *visible* — which action's config
 * fields to show, and how many condition rows exist. The submit is a native
 * form POST, so the rule that gets stored is parsed by /api/automation from
 * the same flat field names a script would send, and the page then re-reads it
 * from the database rather than trusting anything this component believed.
 *
 * Condition rows are named by index (`condition0Field`, `condition1Field`, …)
 * because that is what the route handler's parser walks. Removing a row splices
 * the array, so the indices stay contiguous and the parser sees no gaps.
 */

/** Must not exceed MAX_CONDITIONS in src/app/api/automation/route.ts. */
const MAX_CONDITIONS = 6;

const SEVERITIES = ["info", "success", "warning", "critical"] as const;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-[--color-faint]">{hint}</p>}
    </label>
  );
}

interface ConditionRow {
  /** Stable across splices so React keeps input state with the right row. */
  uid: number;
  field: string;
}

export function RuleBuilder({ languages }: { languages: string[] }) {
  const [actionType, setActionType] = useState<ActionType>("notify");
  const [rows, setRows] = useState<ConditionRow[]>([{ uid: 0, field: CONDITION_FIELDS[0].field }]);
  const [nextUid, setNextUid] = useState(1);

  function addRow() {
    if (rows.length >= MAX_CONDITIONS) return;
    setRows([...rows, { uid: nextUid, field: CONDITION_FIELDS[0].field }]);
    setNextUid(nextUid + 1);
  }

  return (
    <form action="/api/osf/automation" method="POST" className="space-y-5">
      <input type="hidden" name="intent" value="create-rule" />
      <input type="hidden" name="next" value="/os/automation/workflows" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            name="name"
            required
            placeholder="Alert the desk on a hot lead"
            className="field"
          />
        </Field>
        <Field
          label="Trigger"
          hint="Only the two live triggers are raised by this codebase today. A rule on a dormant trigger stores fine and stays inert until something fires it."
        >
          <select name="triggerEvent" defaultValue="lead_created" className="field">
            {TRIGGER_EVENTS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
                {LIVE_TRIGGERS.has(t) ? "" : " — not fired yet"}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description">
        <input name="description" placeholder="Why this rule exists" className="field" />
      </Field>

      {/* ---------------------------------------------------------------- */}

      <fieldset className="rounded-xl border border-[--color-line] bg-[--color-void]/40 p-4">
        <legend className="label px-1.5">If — all of these hold</legend>
        <p className="mb-3 text-[11px] leading-relaxed text-[--color-faint]">
          Every row must match. A row with a blank value is skipped, so a rule with no filled rows
          runs on every lead that hits the trigger. Fields are top-level lead columns only.
        </p>

        <div className="space-y-2.5">
          {rows.map((row, i) => {
            const kind = CONDITION_FIELDS.find((f) => f.field === row.field)?.kind ?? "text";
            return (
              <div key={row.uid} className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                  <select
                    name={`condition${i}Field`}
                    value={row.field}
                    onChange={(e) =>
                      setRows(rows.map((r) => (r.uid === row.uid ? { ...r, field: e.target.value } : r)))
                    }
                    className="field"
                  >
                    {CONDITION_FIELDS.map((f) => (
                      <option key={f.field} value={f.field}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select name={`condition${i}Operator`} defaultValue="equals" className="field">
                    {(Object.keys(OPERATOR_LABELS) as ConditionOperator[]).map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  <input
                    name={`condition${i}Value`}
                    type={kind === "number" ? "number" : "text"}
                    placeholder={kind === "boolean" ? "true / false" : "Value (blank = any)"}
                    className="field"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((r) => r.uid !== row.uid))}
                  disabled={rows.length === 1}
                  aria-label="Remove condition"
                  className="mt-1 rounded-lg border border-[--color-line] p-2 text-[--color-faint] transition hover:border-[--color-line-strong] hover:text-[--color-ink] disabled:opacity-30"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= MAX_CONDITIONS}
          className="btn-ghost mt-3 px-3 py-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add condition
          {rows.length >= MAX_CONDITIONS && <span className="text-[--color-faint]">(max {MAX_CONDITIONS})</span>}
        </button>
      </fieldset>

      {/* ---------------------------------------------------------------- */}

      <fieldset className="rounded-xl border border-[--color-line] bg-[--color-void]/40 p-4">
        <legend className="label px-1.5">Then — do this</legend>

        <select
          name="actionType"
          value={actionType}
          onChange={(e) => setActionType(e.target.value as ActionType)}
          className="field"
        >
          {ACTION_TYPES.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </select>

        <div className="mt-3 space-y-3">
          {actionType === "notify" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Notification title">
                  <input name="actionTitle" placeholder="Hot lead needs a call" className="field" />
                </Field>
                <Field label="Severity">
                  <select name="actionSeverity" defaultValue="info" className="field">
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field
                label="Body"
                hint="Left blank, the engine writes which rule matched which lead on which trigger."
              >
                <input name="actionDescription" className="field" />
              </Field>
            </>
          )}

          {actionType === "create_task" && (
            <>
              <Field label="Task title">
                <input name="actionTitle" placeholder="Call the lead" className="field" />
              </Field>
              <Field label="Details">
                <input name="actionDescription" className="field" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Priority">
                  <select name="actionPriority" defaultValue="medium" className="field">
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due in (hours)">
                  <input name="actionDueInHours" type="number" min={0} defaultValue={24} className="field" />
                </Field>
              </div>
            </>
          )}

          {actionType === "change_status" && (
            <Field
              label="Move to stage"
              hint="Skipped with a reason on the run log if the lead is already in that stage."
            >
              <select name="actionStage" defaultValue="qualified" className="field">
                {PIPELINE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {actionType === "assign_lead" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Language"
                  hint="The rep must list this language. No match means the action is skipped and says so — it never falls back to just anyone."
                >
                  <select name="actionLanguage" defaultValue="" className="field">
                    <option value="">Any language</option>
                    {languages.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Department">
                  <input name="actionDepartment" placeholder="sales" className="field" />
                </Field>
              </div>
              <label className="flex items-start gap-2.5 text-sm text-[--color-ink]">
                <input type="checkbox" name="actionMatchLeadLanguage" className="mt-0.5 size-4 accent-[--color-gold-500]" />
                <span>
                  Match the lead&apos;s own preferred language
                  <span className="mt-0.5 block text-[11px] text-[--color-faint]">
                    Overrides the choice above, per lead.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-sm text-[--color-ink]">
                <input type="checkbox" name="actionReassign" className="mt-0.5 size-4 accent-[--color-gold-500]" />
                <span>
                  Reassign leads that already have an owner
                  <span className="mt-0.5 block text-[11px] text-[--color-faint]">
                    Off by default — a rep mid-conversation should not lose the lead under them.
                  </span>
                </span>
              </label>
              <p className="text-[11px] leading-relaxed text-[--color-faint]">
                Picks the eligible rep holding the fewest open leads. With no active row in
                villa_team_members accepting leads, the action is skipped and the reason is written
                to the run log — it never invents an owner.
              </p>
            </>
          )}

          {actionType === "send_message" && (
            <>
              <Field label="Message">
                <input name="actionMessage" className="field" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Approved template name">
                  <input name="actionTemplateName" placeholder="Required outside the 24h window" className="field" />
                </Field>
                <Field label="Send after (hours)">
                  <input name="actionDelayHours" type="number" min={0} defaultValue={24} className="field" />
                </Field>
              </div>
              <p className="text-[11px] leading-relaxed text-[--color-faint]">
                This queues a follow-up rather than sending one. Whether WhatsApp will accept free
                text or demand a template depends on how long the 24-hour window has left, and only
                the dispatcher knows that at send time.
              </p>
            </>
          )}

          {actionType === "generate_ai_followup" && (
            <>
              <Field label="Send after (hours)">
                <input name="actionDelayHours" type="number" min={0} defaultValue={24} className="field" />
              </Field>
              <p className="text-[11px] leading-relaxed text-[--color-faint]">
                No copy is drafted now. The dispatcher writes it against the conversation as it
                stands at send time.
              </p>
            </>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2.5 text-sm text-[--color-ink]">
          <input type="checkbox" name="isActive" className="size-4 accent-[--color-gold-500]" />
          Activate immediately
        </label>
        <button type="submit" className="btn-gold">
          Create rule
        </button>
      </div>
    </form>
  );
}
