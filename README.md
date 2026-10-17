# Repeated Answers Studio

> **Explore unique points on any topic by querying Gemini repeatedly with automated semantic novelty filtering and GitHub sync.**

---

## Why Repeated Answers Studio?

When prompting LLMs on complex research questions, brainstorming, or policy analysis, standard generations quickly plateau into repetitive phrasing and common knowledge. **Repeated Answers Studio** solves this by automating iterative queries against Gemini, comparing every generated answer against all previously kept insights using dual semantic and lexical novelty filters, and curating only genuinely distinct perspectives.

---

## Features

- **Iterative AI Querying**: Automatically runs continuous generation loops against Gemini models.
- **Dual Novelty Filters**:
  - **Semantic Cosine Similarity**: Evaluates 768-dimension embedding vectors (`gemini-embedding-001`).
  - **Local Word Jaccard Overlap**: Ensures vocabulary diversity.
- **Automatic Model Fallback**: Gracefully falls back across Gemini models if quotas or rate limits are encountered.
- **Sandbox Engine**: A fully offline, deterministic test mode with word overlap filtering.
- **GitHub Repository Sync**: Commits batches automatically from the browser to `runs/<run-id>/batch-0001.jsonl` and updates `manifest.json`.
- **Flexible Export**: Download compiled insights as **JSONL** or **Markdown**.

---

## Architecture Overview

| Layer | Technology / Implementation | Purpose |
| --- | --- | --- |
| **Frontend** | React 19, TypeScript, Tailwind CSS, Lucide Icons | Responsive single-page dashboard with real-time progress, attempt logs, and export tools. |
| **Backend** | Node.js, Express (`server.ts`), `@google/genai` | Secure server-side proxy handling Gemini content generation, embeddings, rate-limiting, and model fallback. |
| **Persistence** | IndexedDB (`storage.ts`) | Client-side storage for settings, run archives, and vector memories. |
| **Sync** | GitHub Contents API (`github.ts`) | Automated batch commits and manifest tracking. |

---

## Setup & Running Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/repeated-answers-studio.git
   cd repeated-answers-studio
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   APP_ACCESS_TOKEN="" # Optional: require x-access-token header on /api routes
   PORT=3000
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## Security & Secrets
- **Gemini Key**: The Gemini API key stays strictly on the server (`server.ts`) and is never exposed to the browser.
- **GitHub & Server Access Tokens**: GitHub commits run directly in the browser. Tokens are kept in memory by default for the session. Users can opt-in to saving tokens to IndexedDB via the "Remember token on this device" setting (with the caveat that any script running on the site can read saved browser tokens).

---

## Usage Guidance

### Good Prompts (Exploratory & Multi-Faceted)
- *"What are the hidden risks and long-term consequences of human space colonization?"*
- *"Why do complex software architectures inevitably degenerate over time?"*
- *"How can decentralized economies reshape global labor markets?"*

### Prompts to Avoid (Factual / Single-Answer)
- *"What is one plus one?"* (Factual queries have only one valid formulation and will immediately trigger semantic duplication rejections).

---

## License

This project is open source and available under the [Apache-2.0 License](LICENSE).
