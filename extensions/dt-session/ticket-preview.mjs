import { readFile } from "node:fs/promises";

export const TICKET_MESSAGE = "dt-ticket";

// Use the parsed ticket index: filenames need not be <id>.md.
export async function readTicketPreview(snapshot, id) {
  if (!/^\d{1,2}$/.test(id)) throw new Error("Use a numeric ticket ID.");
  const ticket = snapshot.tickets.find((t) => t.id === id.padStart(2, "0"));
  if (!ticket) throw new Error(`No ticket ${id.padStart(2, "0")}.`);
  const content = await readFile(ticket.file, "utf8");
  return { id: ticket.id, title: ticket.title, file: ticket.file, content };
}

export function ticketStatus(snapshot, id) {
  return snapshot.st[id].status.replaceAll("_", " ").toUpperCase();
}

export function displayTicket(pi, project, ticket, status, progress, screenshots = [], screenshotExport) {
  const content = [status ? `Status: ${status}` : "", ticket.content, progress].filter(Boolean).join("\n\n");
  pi.sendMessage({ customType: TICKET_MESSAGE, content, display: true,
    details: { slug: project.slug, id: ticket.id, file: ticket.file, ...(screenshots.length ? { screenshots } : {}), ...(screenshotExport ? { screenshotExport } : {}) } });
}

// Keep lane confirmation compact; /dt-status <id> remains the full-ticket viewer.
export function summarizeTicket(ticket) {
  const body = ticket.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const outcome = body.match(/^(?:#{1,6}[ \t]+Outcome[ \t]*:?[ \t]*|\*\*Outcome:?\*\*[ \t]*:?[ \t]*)(?:\r?\n|$)([\s\S]*)/im)?.[1];
  const text = outcome?.split(/^#{1,6}\s|^\*\*[^*\n]+\*\*/m)[0].replace(/\s+/g, " ").trim();
  const summary = text && (text.length > 400 ? `${text.slice(0, 397).trimEnd()}…` : text);
  return [`${ticket.id} · ${ticket.title}`, summary, `Full ticket: /dt-status ${ticket.id}`].filter(Boolean).join("\n\n");
}

export async function confirmTicket({ pi, ctx, project, snapshot, id, force = false }) {
  const ticket = await readTicketPreview(snapshot, id);
  const summary = summarizeTicket(ticket);
  displayTicket(pi, project, { ...ticket, content: summary });
  if (!ctx.hasUI) {
    ctx.ui.notify("Ticket summary displayed; starting requires confirmation in an interactive or RPC session. No claim or work has started.", "warning");
    return false;
  }
  const confirmed = await ctx.ui.confirm(`Start/resume ticket ${ticket.id} · ${project.slug}?`,
    `${summary}\n\n${force ? "This will request a force takeover; it does not stop the previous agent.\n" : ""}Is this the ticket you want to work on?`);
  if (!confirmed) return false;
  if (await readFile(ticket.file, "utf8") !== ticket.content) throw new Error("Ticket changed during confirmation. Run /dt-lane again to review it.");
  return true;
}
