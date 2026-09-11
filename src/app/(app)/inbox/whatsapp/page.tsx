/**
 * The WhatsApp workspace landing screen.
 *
 * `/inbox/whatsapp` and `/inbox/whatsapp/overview` render the same dashboard —
 * re-exported rather than redirected so both URLs resolve in one hop and every
 * existing link to either keeps working. The conversation list that used to
 * live here is the Communication → WhatsApp screen, linked from the dashboard
 * header.
 */
export { default, dynamic } from "./overview/page";
