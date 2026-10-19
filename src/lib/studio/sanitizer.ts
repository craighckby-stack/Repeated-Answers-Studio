/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shannon Entropy Calculation
 * H(X) = - sum( P(x) * log2(P(x)) )
 */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;

  const frequencies = new Map<string, number>();
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    frequencies.set(ch, (frequencies.get(ch) || 0) + 1);
  }

  let entropy = 0;
  const len = str.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

export interface SanitizationResult {
  sanitized: string;
  redactedCount: number;
  detectedSecrets: string[];
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; placeholder: string }> = [
  // Google API Key
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z-_]{35}/g, placeholder: '[REDACTED_GOOGLE_KEY]' },
  // GitHub Personal Access Token (classic & fine-grained)
  { name: 'GitHub PAT', regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g, placeholder: '[REDACTED_GITHUB_TOKEN]' },
  { name: 'GitHub Fine-Grained PAT', regex: /github_pat_[A-Za-z0-9_]{40,255}/g, placeholder: '[REDACTED_GITHUB_PAT]' },
  // OpenAI API Key
  { name: 'OpenAI API Key', regex: /sk-(?:proj-)?[A-Za-z0-9_-]{32,100}/g, placeholder: '[REDACTED_OPENAI_KEY]' },
  // Anthropic API Key
  { name: 'Anthropic Key', regex: /sk-ant-[A-Za-z0-9_-]{40,120}/g, placeholder: '[REDACTED_ANTHROPIC_KEY]' },
  // AWS Access Key ID
  { name: 'AWS Key ID', regex: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g, placeholder: '[REDACTED_AWS_KEY]' },
  // Private Key Block
  { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, placeholder: '[REDACTED_PRIVATE_KEY]' },
  // Generic Bearer Token
  { name: 'Bearer Token', regex: /Bearer\s+[A-Za-z0-9_\-\.]{30,}/g, placeholder: 'Bearer [REDACTED_TOKEN]' },
  // Generic high-entropy hex / base64 secret assignment (e.g. api_key="...", client_secret='...')
  { name: 'Secret Assignment', regex: /(?:api[_-]?key|client[_-]?secret|auth[_-]?token|password|secret)[\s:=]+["']?([A-Za-z0-9_\-+/]{20,}={0,2})["']?/gi, placeholder: '$1="[REDACTED_SECRET]"' },
];

/**
 * Scans and redacts credentials, API keys, and high-entropy secret tokens from text.
 * Enforces EMG-style Shannon entropy threshold (> 4.5 for strings >= 18 chars).
 */
export function sanitizeContent(content: string, entropyThreshold = 4.5): SanitizationResult {
  if (!content) {
    return { sanitized: '', redactedCount: 0, detectedSecrets: [] };
  }

  let sanitized = content;
  let redactedCount = 0;
  const detectedSecrets: string[] = [];

  // 1. Regex rule scanning
  for (const pattern of SECRET_PATTERNS) {
    const matches = sanitized.match(pattern.regex);
    if (matches && matches.length > 0) {
      redactedCount += matches.length;
      if (!detectedSecrets.includes(pattern.name)) {
        detectedSecrets.push(pattern.name);
      }
      sanitized = sanitized.replace(pattern.regex, pattern.placeholder);
    }
  }

  // 2. High-entropy token scan for isolated opaque words (tokens >= 20 chars with no whitespace)
  const tokens = sanitized.split(/\s+/);
  for (const token of tokens) {
    const cleanToken = token.replace(/[^\w\-_+=/.]/g, '');
    if (cleanToken.length >= 24 && !cleanToken.includes('[REDACTED_')) {
      const entropy = calculateShannonEntropy(cleanToken);
      // High randomness threshold typical of base64 or crypto keys
      if (entropy >= entropyThreshold) {
        sanitized = sanitized.replace(token, '[REDACTED_HIGH_ENTROPY_TOKEN]');
        redactedCount++;
        if (!detectedSecrets.includes('High Entropy Secret Token')) {
          detectedSecrets.push('High Entropy Secret Token');
        }
      }
    }
  }

  return {
    sanitized,
    redactedCount,
    detectedSecrets,
  };
}
