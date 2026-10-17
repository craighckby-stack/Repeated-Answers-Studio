# Repeated Answers Studio

Repeated Answers Studio is a web application built with React, TypeScript, Tailwind CSS, and the Google Gemini API. It allows you to query Gemini models repeatedly on a single research prompt while filtering out semantic duplicates and wording overlaps to compile a curated list of distinct perspectives and insights.

---

## What It Does

- **Repeated AI Querying**: Automatically runs iterative generations against Gemini models.
- **Novelty Filtering**: Employs dual novelty checks:
  1. **Semantic Cosine Similarity** (using `gemini-embedding-001` vectors).
  2. **Local Word Jaccard Overlap** (checking vocabulary similarity).
- **Dual Engines**:
  - **Gemini Engine**: AI-powered queries with model selection, high thinking mode, and automatic fallback across Gemini models.
  - **Sandbox Engine**: Deterministic template engine for offline testing and demonstration.
- **Export & Sync**: Export kept insights as JSONL or Markdown, copy to clipboard, or sync batches directly to a GitHub repository.

---

## How to Use

1. **Enter Your Research Prompt**: Type a broad question or topic in the prompt box (e.g., *"What are the hidden risks of space colonization?"*), or pick one of the built-in presets.
   - *Note on factual queries*: If you test a strict mathematical question like *"What is one plus one?"*, the model will quickly exhaust unique variations after the first correct answer, leading to semantic rejections (as seen in the screenshots). For best results, use exploratory or multi-faceted philosophical and scientific questions!
2. **Configure Settings**:
   - Choose your engine and model (`gemini-3.5-flash`, `gemini-4-argon`, etc.).
   - Adjust the **Target Kept** count and **Embedding/Local Similarity Thresholds**.
3. **Run & Monitor**: Click **Start Run**. Watch the live progress bar, review the attempt log to see why answers were kept or rejected, and inspect similarity metrics.
4. **Export**: Once your insights are collected, switch to the **Export & Share** tab to download your results in JSONL or Markdown format.
