// Static JSON endpoint: at `astro build` time this becomes a plain file at
// /answer-key.json in the deployed output — a real static asset, not an API.
// It is NEVER linked from index.astro or fetched during the quiz; only
// src/lib/quizApp.ts's fetch() call after the last question hits it. Viewing it
// directly by URL at any time is possible (it's a static file, not access
// controlled) but per the project's "for fun, not audited" scope that's an
// acceptable trade-off — see README's Privacy design section for the stronger
// alternative (a Worker/Function requiring a completion token) if ever needed.
import type { APIRoute } from "astro";
import { getQuizPool } from "../lib/loadPolicies.ts";

export const prerender = true;

export const GET: APIRoute = () => {
  const { answerKey } = getQuizPool();
  return new Response(JSON.stringify(answerKey), {
    headers: { "content-type": "application/json" },
  });
};
