import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  addPayment,
  createBooking,
  setPaymentStatus,
  updateBookingStatus,
  type Result,
} from "@/lib/osf/bookings";
import { guard } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every write behind /bookings, keyed on an `action` field.
 *
 * The console posts plain HTML forms (no client JS), so the response is a 303
 * back to the page it came from; failures ride back on ?error= rather than
 * dumping JSON at the user. Scripted callers can send JSON and get JSON.
 */
export async function POST(request: Request) {
  const denied = await guard("sales.write");
  if (denied) return denied;
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  const fields: Record<string, string> = {};
  if (isJson) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) {
      if (v !== null && v !== undefined) fields[k] = String(v);
    }
  } else {
    const form = await request.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") fields[k] = v;
    }
  }

  const respond = (result: Result<unknown>, path: string) => {
    if (isJson) {
      return result.ok
        ? NextResponse.json({ ok: true, data: result.data })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }
    const url = new URL(path, request.url);
    if (!result.ok) url.searchParams.set("error", result.error);
    return NextResponse.redirect(url, { status: 303 });
  };

  switch (fields.action) {
    case "create": {
      const result = await createBooking({
        leadId: fields.leadId ?? "",
        projectId: fields.projectId || null,
        villaTypeId: fields.villaTypeId || null,
        valueInr: Math.trunc(Number(fields.valueInr)),
        customerName: fields.customerName || null,
        assignedTo: fields.assignedTo || null,
      });
      if (result.ok) {
        revalidatePath("/inbox/whatsapp/sales/bookings");
        revalidatePath("/inbox/whatsapp/sales/revenue");
        revalidatePath("/inbox/whatsapp/crm/pipeline");
        revalidatePath("/inbox/whatsapp/crm/leads");
      }
      return respond(result, result.ok ? `/inbox/whatsapp/sales/bookings/${result.data.id}` : "/inbox/whatsapp/sales/bookings");
    }

    case "update-status": {
      const bookingId = fields.bookingId ?? "";
      const result = await updateBookingStatus(bookingId, fields.status ?? "");
      if (result.ok) {
        revalidatePath("/inbox/whatsapp/sales/bookings");
        revalidatePath(`/inbox/whatsapp/sales/bookings/${bookingId}`);
        revalidatePath("/inbox/whatsapp/sales/revenue");
      }
      return respond(result, `/inbox/whatsapp/sales/bookings/${bookingId}`);
    }

    case "add-payment": {
      const bookingId = fields.bookingId ?? "";
      const result = await addPayment({
        bookingId,
        milestone: fields.milestone ?? "",
        amountInr: Math.trunc(Number(fields.amountInr)),
        dueDate: fields.dueDate || null,
        status: fields.status,
      });
      if (result.ok) {
        revalidatePath("/inbox/whatsapp/sales/bookings");
        revalidatePath(`/inbox/whatsapp/sales/bookings/${bookingId}`);
        revalidatePath("/inbox/whatsapp/sales/revenue");
      }
      return respond(result, `/inbox/whatsapp/sales/bookings/${bookingId}`);
    }

    case "payment-status": {
      const bookingId = fields.bookingId ?? "";
      const result = await setPaymentStatus(fields.paymentId ?? "", fields.status ?? "");
      if (result.ok) {
        revalidatePath("/inbox/whatsapp/sales/bookings");
        revalidatePath(`/inbox/whatsapp/sales/bookings/${bookingId}`);
        revalidatePath("/inbox/whatsapp/sales/revenue");
      }
      return respond(result, `/inbox/whatsapp/sales/bookings/${bookingId}`);
    }

    default:
      return NextResponse.json(
        { error: "action must be create, update-status, add-payment or payment-status" },
        { status: 400 },
      );
  }
}
