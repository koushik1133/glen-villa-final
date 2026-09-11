import { NextResponse } from "next/server";
import { db } from "@/lib/osf/supabase";
import {
  generateContent,
  inputsFromProject,
  type ContentFormat,
  type ContentLanguage,
  type ContentTone,
} from "@/lib/osf/marketing/gemini";
import type { Project, VillaType } from "@/lib/osf/types";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generates ad/social copy for a real project and saves it as a draft.
 * Never publishes anywhere — see 0006_content_drafts.sql for why.
 */
export async function POST(request: Request) {
  const denied = await guard("marketing.publish");
  if (denied) return denied;
  let body: {
    projectId?: string;
    villaTypeId?: string;
    format?: ContentFormat;
    tone?: ContentTone;
    language?: ContentLanguage;
    customNotes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.projectId || !body.format) {
    return NextResponse.json({ error: "projectId and format are required" }, { status: 400 });
  }

  const supabase = db();

  const { data: project, error: projectError } = await supabase
    .from("villa_projects")
    .select("*")
    .eq("id", body.projectId)
    .maybeSingle();

  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let villaType: VillaType | null = null;
  if (body.villaTypeId) {
    const { data } = await supabase
      .from("villa_types")
      .select("*")
      .eq("id", body.villaTypeId)
      .maybeSingle();
    villaType = (data as VillaType) ?? null;
  }

  const inputs = inputsFromProject(project as Project, villaType);

  const content = await generateContent({
    ...inputs,
    format: body.format,
    tone: body.tone,
    language: body.language,
    customNotes: body.customNotes,
  });

  const { data: draft, error: insertError } = await supabase
    .from("villa_content_drafts")
    .insert({
      project_id: body.projectId,
      villa_type_id: body.villaTypeId ?? null,
      format: body.format,
      tone: body.tone ?? "ultra_luxury",
      language: body.language ?? "en",
      custom_notes: body.customNotes ?? null,
      headline: content.headline,
      primary_text: content.primaryText,
      secondary_text: content.secondaryText ?? null,
      hashtags: content.hashtags,
      call_to_action: content.callToAction,
      cta_button_text: content.ctaButtonText,
      suggested_audio: content.suggestedAudio ?? null,
      video_script: content.videoScript ?? null,
      visual_prompt: content.visualPrompt,
      target_audience_advice: content.targetAudienceAdvice,
      target_platforms: content.targetPlatforms,
      generated_by_ai: content.generatedByAi,
    })
    .select("*")
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ draft });
}
