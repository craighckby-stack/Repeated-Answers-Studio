/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnswerEntry } from './types';

export function validateRepoFormat(ownerRepo: string): boolean {
  // Format: owner/repo
  const parts = ownerRepo.split('/');
  return parts.length === 2 && parts[0].trim().length > 0 && parts[1].trim().length > 0;
}

export async function commitBatchToGitHub(
  token: string,
  ownerRepo: string,
  branch: string,
  runId: string,
  batchIndex: number,
  entries: AnswerEntry[]
): Promise<{ success: boolean; error?: string }> {
  if (!token || !ownerRepo) {
    return { success: false, error: 'GitHub token or repository missing' };
  }
  const [owner, repo] = ownerRepo.split('/');
  const cleanBranch = branch || 'main';

  const jsonlLines = entries.map(e => JSON.stringify({
    id: e.id,
    index: e.index,
    text: e.text,
    timestamp: e.timestamp,
    reason: e.reason,
    similarityScore: e.similarityScore
  })).join('\n') + '\n';

  const batchFileName = `runs/${runId}/batch-${String(batchIndex).padStart(4, '0')}.jsonl`;
  const contentBase64 = btoa(unescape(encodeURIComponent(jsonlLines)));

  try {
    // 1. Check if file already exists to get sha
    const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${batchFileName}`;
    const getRes = await fetch(`${fileUrl}?ref=${cleanBranch}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    let sha: string | undefined;
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }

    // 2. Put file content
    const putRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Add run ${runId} batch ${batchIndex} kept answers`,
        content: contentBase64,
        branch: cleanBranch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errData = await putRes.json();
      return { success: false, error: errData.message || `GitHub commit failed (${putRes.status})` };
    }

    // 3. Update manifest.json
    await updateManifest(token, owner, repo, cleanBranch, runId, batchIndex);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error during GitHub commit' };
  }
}

async function updateManifest(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  runId: string,
  latestBatch: number
): Promise<void> {
  const manifestPath = `runs/${runId}/manifest.json`;
  const manifestUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${manifestPath}`;

  try {
    const getRes = await fetch(`${manifestUrl}?ref=${branch}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    let sha: string | undefined;
    let existingBatches: number[] = [];
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      try {
        const decoded = JSON.parse(decodeURIComponent(escape(atob(fileData.content))));
        if (Array.isArray(decoded.batches)) {
          existingBatches = decoded.batches;
        }
      } catch {}
    }

    if (!existingBatches.includes(latestBatch)) {
      existingBatches.push(latestBatch);
      existingBatches.sort((a, b) => a - b);
    }

    const manifestObj = {
      runId,
      updatedAt: new Date().toISOString(),
      batches: existingBatches,
    };

    const contentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(manifestObj, null, 2))));

    await fetch(manifestUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Update manifest for run ${runId}`,
        content: contentBase64,
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
  } catch (err) {
    console.warn('Failed to update manifest.json (non-fatal):', err);
  }
}
