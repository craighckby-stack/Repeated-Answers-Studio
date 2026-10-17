# Repeated Answers Studio

> **Explore unique points on any topic by querying Gemini repeatedly with automated semantic novelty filtering, core-idea extraction, and GitHub sync.**

---

## What Is This System & Is There Any Point To It?

When you ask an LLM a complex, open-ended question (e.g., *"What are the hidden risks and long-term consequences of human space colonization?"*), chat interfaces give you a single averaged, polite, predictable response. If you ask again, you get a polite rephrasing of the exact same points.

**Repeated Answers Studio** solves this **mode collapse** and **sycophancy trap**:
1. **Iterative Exploration**: It continuously queries Gemini in a loop, pushing the model past its first-instinct common-sense answers into deep, edge-case territory.
2. **Aggressive Conceptual Novelty Filtering**: Every generated answer is subjected to multi-layered filters:
   - **Full-Text Embedding & Jaccard Overlap**: Filters out superficial rephrasing.
   - **Core-Idea Tagging & Embedding Gate**: Extracts the specific 4–8 word argument or framework used and compares its vector similarity against all previously accepted core ideas ($\ge 0.82$ similarity threshold triggers rejection).
   - **LLM Conceptual Novelty Judge**: A strict judge prompt that acts as a final veto against semantic redundancy.
3. **Why it matters**: It transforms an LLM from a passive answering machine into an automated exhaustive brainstorming engine—surfacing 50 to 200 genuinely distinct angles, trade-offs, and conceptual frameworks on any complex topic without human fatigue.

---

## Features

- **Dual Engines**:
  - **Gemini Engine**: Powered by `@google/genai` (supporting `gemini-3.5-flash`, `gemini-4-argon` with High Thinking mode, and `gemini-3.5-flash-lite`) with automatic rate-limit backoff and fallback models.
  - **Sandbox Engine**: Fully offline, deterministic test mode with template combinations and capacity limits.
- **Strict Novelty Pipelines**: Core-idea extraction, semantic vector distance (768-dim), and LLM-as-judge semantic validation.
- **GitHub Batch Sync**: Automatically commits run outputs in batches (`runs/<run-id>/batch-0001.jsonl`) and updates `manifest.json`.
- **Local Persistence & Export**: IndexedDB run archiving with instant export to **JSONL** and **Markdown**.

---

## Architecture Overview

| Layer | Technology | Purpose |
| --- | --- | --- |
| **Frontend** | React 19, TypeScript, Tailwind CSS | Responsive dashboard with live progress, attempt logs, rejections monitor, and export controls. |
| **Backend** | Node.js, Express (`server.ts`), `@google/genai` | Secure server-side proxy handling Gemini content generation, embeddings, rate-limiting, and model fallback. |
| **Persistence** | IndexedDB (`storage.ts`) | Client-side storage for settings, run archives, and vector memories. |
| **Sync** | GitHub Contents API (`github.ts`) | Automated batch commits and manifest tracking. |

---

## Setup & Running Locally

1. **Clone and install**:
   ```bash
   git clone https://github.com/your-username/repeated-answers-studio.git
   cd repeated-answers-studio
   npm install
   ```

2. **Configure environment variables**:
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   APP_ACCESS_TOKEN="" # Optional: require x-access-token header on /api routes
   PORT=3000
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## Usage Guidance

### Recommended Prompts (Complex & Multi-Faceted)
- *"What are the hidden risks and long-term consequences of human space colonization?"*
- *"Why do complex software architectures inevitably degenerate over time?"*
- *"How can decentralized economies reshape global labor markets?"*

### Prompts to Avoid (Factual / Single-Answer)
- *"What is one plus one?"* (Factual queries have only one valid formulation and will immediately trigger semantic duplication rejections).

---

## License

Licensed under the [Apache-2.0 License](LICENSE).
