// Client-side controller. Runs entirely in the browser after hydration — no
// server calls except one fetch("/answer-key.json") which only fires after the
// last question is answered (see index.astro + README's Privacy design).
import { buildResults, shuffle } from "./scoring.ts";
import type { Answers, AnswerKey, QuizStatement, QuizResults, PartyMatch, ScaleValue } from "./types.ts";

const SCALE_OPTIONS: { value: ScaleValue; label: string }[] = [
  { value: 1, label: "Strongly disagree" },
  { value: 2, label: "Disagree" },
  { value: 3, label: "Neutral / not sure" },
  { value: 4, label: "Agree" },
  { value: 5, label: "Strongly agree" },
];

const PARTY_ACCENT: Record<string, string> = {
  labour: "#e4003b",
  conservative: "#0087dc",
  reform: "#12b6cf",
  libdem: "#faa61a",
  green: "#02a95c",
};

const ANSWER_KEY_URL = "/answer-key.json";
const ADVANCE_DELAY_MS = 220;

type ViewState = "intro" | "question" | "loading-results" | "results" | "error";

export function mountQuizApp(root: HTMLElement, initialStatements: QuizStatement[]) {
  // Reshuffle again in-browser (on top of the build-time shuffle already applied
  // to initialStatements) so every visitor gets their own statement order.
  const statements = shuffle(initialStatements);
  const answers: Answers = {};
  let index = 0;
  let view: ViewState = "intro";
  let errorMessage = "";

  function render() {
    root.innerHTML = "";
    if (view === "intro") root.appendChild(renderIntro());
    else if (view === "question") root.appendChild(renderQuestion());
    else if (view === "loading-results") root.appendChild(renderLoading());
    else if (view === "error") root.appendChild(renderError());
    // "results" is rendered directly by showResults() once data arrives.
  }

  function renderIntro(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <h1>Which UK party matches your views?</h1>
      <div class="intro-card">
        <p>You'll see ${statements.length} current policy statements from the five
        UK-wide parties — one at a time, with no party name attached. Rate how much
        you agree with each. At the end we'll reveal which party you're most (and
        least) aligned with, and why.</p>
        <p>Nothing is sent anywhere until you finish. Your answers stay in this
        browser tab.</p>
      </div>
      <button class="primary-button" type="button" style="margin-top:1.25rem" id="start-btn">Start the quiz</button>
    `;
    wrap.querySelector<HTMLButtonElement>("#start-btn")!.addEventListener("click", () => {
      view = "question";
      render();
    });
    return wrap;
  }

  function renderQuestion(): HTMLElement {
    const wrap = document.createElement("div");
    const statement = statements[index];
    const pct = Math.round((index / statements.length) * 100);
    const selected = answers[statement.id];

    wrap.innerHTML = `
      <div class="progress-label">Statement ${index + 1} of ${statements.length}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="question-card">
        <div class="statement-text">${escapeHtml(statement.statement)}</div>
        <div class="scale" role="group" aria-label="Agreement scale"></div>
      </div>
      <div class="nav-row" style="margin-top:1rem">
        <button type="button" class="text-button" id="back-btn" ${index === 0 ? "disabled" : ""}>&larr; Back</button>
        <button type="button" class="text-button" id="skip-btn">Skip &rarr;</button>
      </div>
    `;

    const scaleEl = wrap.querySelector<HTMLElement>(".scale")!;
    for (const opt of SCALE_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      if (selected === opt.value) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        answers[statement.id] = opt.value;
        scaleEl.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        window.setTimeout(advance, ADVANCE_DELAY_MS);
      });
      scaleEl.appendChild(btn);
    }

    wrap.querySelector<HTMLButtonElement>("#back-btn")!.addEventListener("click", () => {
      if (index > 0) {
        index -= 1;
        render();
      }
    });
    wrap.querySelector<HTMLButtonElement>("#skip-btn")!.addEventListener("click", () => {
      delete answers[statement.id];
      advance();
    });

    return wrap;
  }

  function advance() {
    if (index < statements.length - 1) {
      index += 1;
      render();
    } else {
      view = "loading-results";
      render();
      void loadResults();
    }
  }

  function renderLoading(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<p>Working out your matches&hellip;</p>`;
    return wrap;
  }

  function renderError(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="caveat">Something went wrong loading your results: ${escapeHtml(errorMessage)}.
      Your answers are still safe in this tab — you can try again.</div>
      <button class="primary-button" type="button" id="retry-btn" style="margin-top:1rem">Try again</button>
    `;
    wrap.querySelector<HTMLButtonElement>("#retry-btn")!.addEventListener("click", () => {
      view = "loading-results";
      render();
      void loadResults();
    });
    return wrap;
  }

  async function loadResults() {
    try {
      const res = await fetch(ANSWER_KEY_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`answer key request failed (${res.status})`);
      const answerKey = (await res.json()) as AnswerKey;
      const results = buildResults(answers, answerKey);
      view = "results";
      root.innerHTML = "";
      root.appendChild(renderResults(results));
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      view = "error";
      render();
    }
  }

  function renderResults(results: QuizResults): HTMLElement {
    const wrap = document.createElement("div");
    const answeredCount = Object.keys(answers).length;

    wrap.innerHTML = `
      <h1>Your results</h1>
      <div class="results-summary">
        <p>You answered ${answeredCount} of ${statements.length} statements.</p>
        ${results.lowConfidence ? `<div class="caveat">You answered relatively few statements, so treat this as a rough steer rather than a precise result.</div>` : ""}
      </div>
    `;

    if (results.best) wrap.appendChild(renderMatchCard(results.best, "best", "Best match"));
    if (results.secondBest) wrap.appendChild(renderMatchCard(results.secondBest, "second", "Second-best match"));
    if (results.worst) wrap.appendChild(renderMatchCard(results.worst, "worst", "Furthest from your views"));

    if (!results.best) {
      const none = document.createElement("p");
      none.textContent = "You didn't answer enough statements to calculate a match.";
      wrap.appendChild(none);
    }

    const rankingsHeading = document.createElement("h2");
    rankingsHeading.textContent = "Full ranking";
    wrap.appendChild(rankingsHeading);
    wrap.appendChild(renderRankingsTable(results.rankings));

    const restartBtn = document.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "primary-button";
    restartBtn.style.marginTop = "2rem";
    restartBtn.textContent = "Take the quiz again";
    restartBtn.addEventListener("click", () => window.location.reload());
    wrap.appendChild(restartBtn);

    const footer = document.createElement("footer");
    footer.className = "app-footer";
    footer.textContent = `Based on each party's stated policies as of the latest monthly update. For fun, not a voting recommendation.`;
    wrap.appendChild(footer);

    return wrap;
  }

  function renderMatchCard(match: PartyMatch, kind: "best" | "second" | "worst", heading: string): HTMLElement {
    const card = document.createElement("div");
    card.className = `match-card ${kind === "best" ? "best" : kind === "worst" ? "worst" : ""}`;
    const accent = PARTY_ACCENT[match.partyId] ?? "var(--accent)";
    const scoreLabel = match.averageScore !== null ? `${match.averageScore.toFixed(1)} / 5 avg. agreement` : "no data";

    card.innerHTML = `
      <h2 style="margin-top:0">${escapeHtml(heading)}</h2>
      <div class="match-heading">
        <span class="party-name" style="color:${accent}">${escapeHtml(match.party)}</span>
        <span class="match-score">${scoreLabel} &middot; ${match.answeredCount}/${match.totalCount} answered</span>
      </div>
      <ul class="driving-list"></ul>
    `;

    const list = card.querySelector<HTMLUListElement>(".driving-list")!;
    for (const s of match.drivingStatements) {
      const li = document.createElement("li");
      const scoreOpt = SCALE_OPTIONS.find((o) => o.value === s.score);
      li.innerHTML = `
        <div class="driving-title">${escapeHtml(s.title)}</div>
        <div>${escapeHtml(s.statement)}</div>
        <div class="driving-your-score">You: ${scoreOpt ? escapeHtml(scoreOpt.label) : s.score}</div>
        <a href="${escapeAttr(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source &rarr;</a>
      `;
      list.appendChild(li);
    }
    return card;
  }

  function renderRankingsTable(rankings: QuizResults["rankings"]): HTMLElement {
    const table = document.createElement("table");
    table.className = "rankings-table";
    const tbody = document.createElement("tbody");
    rankings.forEach((r, i) => {
      const tr = document.createElement("tr");
      const scoreLabel = r.averageScore !== null ? r.averageScore.toFixed(1) : "&mdash;";
      tr.innerHTML = `
        <td class="rank-num">${i + 1}</td>
        <td>${escapeHtml(r.party)}</td>
        <td>${scoreLabel}</td>
        <td>${r.answeredCount}/${r.totalCount} answered</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  render();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
