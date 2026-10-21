how to force a language model to explore the outer edges of a hypothesis space rather than regurgitating its first-instinct consensus answer

# Repeated Answers Studio

> **Explore unique points on any topic by querying Gemini repeatedly with automated semantic novelty filtering, core-idea extraction, and GitHub sync.**

---

## The Point of the System (Summarized)

When asked a question, language models default to their highest-probability consensus answer. If queried repeatedly, they rephrase the same 2–3 concepts using different words (*semantic mode collapse*).

**Repeated Answers Studio** breaks this loop by turning the model into a divergent research engine:
1. **Repeated Diverse Probing**: Prompts the model repeatedly while actively injecting previous outputs as negative constraints ("avoid these concepts").
2. **Mandatory Testability**: Requires every answer to state an **observable consequence** and **counterevidence**, filtering out untestable hand-waving.
3. **Multi-Stage Novelty Filtering**: Evaluates each candidate through a fast cascade of gates (exact core-idea match, Jaccard word overlap, dense vector cosine similarity, and an optional LLM conceptual judge) to reject duplicates.
4. **Persistent Research Corpus**: Compiles kept insights into clean Markdown summaries or versioned JSONL datasets synced to GitHub.

---

## Question Guide: Getting the Best Results

The quality of insights depends directly on the structure of the prompt.

### ✅ What Works Best

High-yield questions have **wide, multi-causal hypothesis spaces** where dozens of valid mechanisms, failure modes, or trade-offs coexist.

* **Complex Systems & Software Architecture**:
  * *"What unexpected structural failure modes cause large distributed microservice systems to experience cascading collapse despite comprehensive automated testing?"*
  * *"Why do cybersecurity defenses in mature enterprises systematically fail against low-sophistication insider threats?"*
* **Biology, Medicine & Longevity**:
  * *"What under-investigated cellular or systemic mechanisms could explain why certain mammal species show negligible senescence compared to closely related counterparts?"*
  * *"What non-genetic maternal environmental factors during early gestation induce long-term epigenetic adaptations in offspring immune systems?"*
* **Economics & System Dynamics**:
  * *"What second-order feedback loops cause well-intended platform anti-monopoly regulations to entrench existing incumbent monopolies?"*
  * *"What unpriced economic externalities will emerge if automated agent-to-agent micropayment networks replace human consumer billing?"*
* **Cognitive Science & Organizations**:
  * *"How does prolonged daily interaction with predictive AI language assistants alter human cognitive metacognition and problem decomposition skills?"*
  * *"Why do organizational consensus-seeking mechanisms systematically filter out true outlier innovations in high-stakes industries?"*

#### The Prompt Recipe
1. **Ask for *mechanisms*, not *opinions***: Use *"What non-obvious mechanisms..."* or *"What unrecognized failure modes..."* rather than *"Is X good or bad?"*
2. **Anchor to a paradox or constraint**: e.g., *"Why does X degrade even when Y investment increases?"*
3. **Set the right abstraction level**: Use the UI's **Abstraction** toggle (**Balanced** for conceptual frameworks with observables; **Concrete** for direct experimental hypotheses).

---

### ❌ What Doesn't Work (And Why)

* **Single-Answer / Factual Queries** (*"What is the capital of Iceland?"*, *"When was Python created?"*):
  * *Why it fails*: There is only one correct answer. Attempt #1 is kept; attempts #2+ are identical and immediately rejected by the exact core-idea or full-text gate.
* **Broad "Explain X" Tutorials** (*"Explain how transformers work"*, *"Overview of photosynthesis"*):
  * *Why it fails*: The model regurgitates textbook intros. After 2–3 attempts, all canonical explanations are exhausted and subsequent attempts fail word overlap or embedding thresholds.
* **Vague Philosophical Opinions** (*"Is artificial intelligence good or bad for art?"*):
  * *Why it fails*: Subjective moralizing fails the **Testability Gate** (requires a concrete, falsifiable observable consequence and measurable counterevidence).
* **Binary Yes/No Questions** (*"Will quantum computers break RSA by 2030?"*):
  * *Why it fails*: The model splits into two camps ("Yes because X", "No because Y") and hits maximum consecutive misses by attempt #3.

---

## Features

- **Dual Engines**: 
  - **Gemini Engine**: Live API queries with automated multi-model fallback (`gemini-3.5-flash-lite`, `gemini-3.5-flash`), high thinking config, and structured JSON outputs.
  - **Sandbox Engine**: Built-in algorithmic test runner requiring zero API keys for instant testing.
- **Strict 5-Gate Novelty Evaluation**:
  1. **Full-Text Embedding Cosine Similarity** (Default threshold: `0.85`, adjustable in Settings).
  2. **Local Word Overlap / Jaccard Similarity** (Default threshold: `0.75`, adjustable in Settings).
  3. **Exact Core Idea Match**: Rejects exact duplicates of previous core idea labels.
  4. **Core Idea Embedding Cosine Similarity** (Default threshold: `0.90`, adjustable in Settings).
  5. **LLM Conceptual Judge**: Optional final validation check via `gemini-3.5-flash-lite` to ensure the candidate introduces a genuinely new conceptual claim. If the judge is unavailable, candidates are not kept.
- **EMG Enhanced Machine Gates & Ephemeral Mind Gem Core Integration**:
  - **9-Persona Intellectual Steering**: Decomposes repetitive probing across nine specialized intellectual biases (*Causal Logician*, *Economist*, *Futurist*, *Ethicist*, *Legal Expert*, *Historian*, *Philosopher*, *Data Analyst*, *Social Scientist*) to break semantic mode collapse.
  - **Topological Concept Knowledge Graph**: Interactively renders kept insights, causal pathways, and observable predictions as a structured Mermaid JS vector network map.
  - **Executive Synthesis & Assumption Mining**: Cross-synthesizes divergent candidate insights into an overarching executive analysis and uncovers 3–5 foundational epistemic assumptions.
  - **Edge Security Sanitizer**: Continuous regex & Shannon entropy scanning ($\mathcal{H} > 4.5$) that intercepts and redacts API keys (`AIzaSy...`, `ghp_`, `sk-`, `AKIA...`), bearer tokens, and credentials in prompts, generated answers, and GitHub commits.
  - **Information Density Floor**: Evaluates candidate responses against Shannon information entropy ($\mathcal{H} \ge 3.6\text{ bits/char}$) and mechanistic mass to prevent trivial platitude collapse.
  - **Interactive Conversational Mind**: Direct analytical chat shell querying the synthesized collective memory block across all 9 perspective streams.
  - **Memory & State Portability (Backup / Restore Memory)**: Package and download entire analytical state blocks (settings, attempt history, kept matrices, concept graphs, and synthesis) as sanitized `.json` files, and re-inject them into any session instantly without re-burning API quota.
- **Robust Rate Limiting & Pausing**: Configurable via `RATE_LIMIT_PER_MINUTE` (default `60`). Runs automatically pause on rate limits and can be resumed safely.
- **GitHub Sync**: Automatically batch-commits your attempt history (kept, rejected, and error entries) and Markdown export manifests directly to any GitHub repository.
- **Export Options**: Download full attempt logs as JSONL, compiled kept answers as clean Markdown with embedded Shannon entropy metrics and sanitization stamps, or portable EMG Core memory dumps.

---

## Setup & Running Locally

1. **Clone & Install Dependencies**:
   ```bash
   git clone https://github.com/<OWNER>/<REPO>.git
   cd repeated-answers-studio
   npm install
   ```
2. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   RATE_LIMIT_PER_MINUTE=60
   TRUST_PROXY=false
   # Optional: APP_ACCESS_TOKEN=your_secret_token
   ```
3. **Development Mode**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

4. **Production Deployment**:
   ```bash
   npm run build
   NODE_ENV=production npm start
   ```
   *Note: The app requires a Node.js server (Express + Vite middleware) and will not run on static-only hosting.*

---

## Configuration Notes

- **Thresholds**: Fully adjustable in the Settings panel (Embedding similarity `0.5 - 0.99`, Wording overlap `0.5 - 0.99`, Core idea similarity `0.5 - 0.99`).
- **Rate Limits & Proxies**: If running behind a reverse proxy (e.g. Nginx, Cloud Run), set `TRUST_PROXY=true` (or the number of trusted proxy hops) so rate limiting correctly tracks client IPs.
- **Server Security**: By default, `/api/*` routes are unauthenticated except for rate limits. Set `APP_ACCESS_TOKEN` in `.env` to require the `x-access-token` header.

---

## Disclaimer

Outputs are generated by a language model, have not been checked for accuracy, and should not be cited as findings. Whether this filter produces more distinct ideas than plain repeated sampling has not been measured. Each attempt consumes API quota.

---

## License

Licensed under the [Apache-2.0 License](LICENSE).
