import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  language: z.string().trim().min(1).max(60),
  sets: z.array(z.object({
    title: z.string().max(60), script: z.string().max(20), total: z.number(), done: z.number(),
    missing: z.array(z.object({ char: z.string().max(4), code: z.string().max(10) })).max(200),
  })).max(10),
});

export type AdvisorPlan = {
  summary: string;
  steps: { title: string; priority: "high" | "medium" | "low"; chars: string[]; why: string }[];
};

export const getCompletionPlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<{ plan: AdvisorPlan | null; error: string | null }> => {
    const { generateResponse, GatewayError } = await import("@lovable.dev/ai-gateway");
    const prompt = `You are a type design advisor. A creator is making a handwriting font for writing ${data.language}.
Coverage of their chosen character sets (missing glyphs listed):
${JSON.stringify(data.sets)}
Explain which missing glyphs matter most for everyday ${data.language} text (letter frequency, common words, required vowel signs/marks) and give a prioritized completion plan of 2-5 steps. Only list characters that are actually missing. If nothing is missing, say so and return an empty steps array.
Reply ONLY with JSON: {"summary": string (2-3 plain sentences), "steps": [{"title": string, "priority": "high"|"medium"|"low", "chars": string[], "why": string}]}`;
    try {
      const res = await generateResponse({ model: "openai/gpt-6-astra", input: [{ role: "user", content: prompt }] });
      const r = res as unknown as { output_text?: string; output?: { content?: { type: string; text?: string }[] }[] };
      const text = r.output_text ?? (r.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      return { plan: JSON.parse(json) as AdvisorPlan, error: null };
    } catch (e) {
      console.error("advisor failed", e);
      if (e instanceof GatewayError && e.httpStatus === 429) return { plan: null, error: "Too many requests right now — try again in a minute." };
      if (e instanceof GatewayError && e.httpStatus === 402) return { plan: null, error: "AI credits have run out for this workspace." };
      return { plan: null, error: "Couldn't get suggestions. Please try again." };
    }
  });
