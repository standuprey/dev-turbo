/** Shows remaining parallel batches from saved tickets, without starting work or calling the model. */
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { createModuleLoader } from "../dt-session/runtime.ts";

const MESSAGE = "dt-slice-plan";

export default async function (pi: ExtensionAPI) {
  const load = createModuleLoader(import.meta.url);
  const { ENTRY, restoreProject } = await load("../dt-session/state.mjs");
  const { slicePlan, renderSlicePlan } = await load("./plan.mjs");
  const dt = join(process.env.DT_DIR || join(homedir(), ".pi", "agent", "dt"), "dt.mjs");
  pi.registerMessageRenderer(MESSAGE, (msg, { outputPad }, theme) => {
    const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(String(msg.content), 0, 0));
    return box;
  });
  pi.registerCommand("dt-slice-plan", {
    description: "Show all remaining parallel ticket batches from saved dependencies and conflicts (no model call)",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /dt-slice-plan. Switch projects with /dt-resume [slug].", "warning");
        return;
      }
      const branch = ctx.sessionManager.getBranch();
      const selected = [...branch].reverse().find((e) => e.type === "custom" && e.customType === ENTRY);
      if (!selected || !("data" in selected) || !selected.data) {
        ctx.ui.notify("No dev-turbo project selected. Run /dt-resume [slug], or /dt-start and approve the plan.", "warning");
        return;
      }
      try {
        const logic = await load(pathToFileURL(dt).href);
        const repo = logic.resolveRepo(ctx.cwd);
        const project = restoreProject(branch, repo);
        if (!project) throw new Error("The saved project does not match this repository. Select it with /dt-resume.");
        const plan = slicePlan(logic.readFeatureStatus(repo, project.slug));
        pi.sendMessage({ customType: MESSAGE, content: renderSlicePlan(plan), display: true, details: { slug: project.slug, ...plan } });
      } catch (error) {
        ctx.ui.notify(`dt-slice-plan: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
