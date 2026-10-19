/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  calculateShannonEntropy,
  sanitizeContent,
  type SanitizationResult,
  auditEmgCandidate,
  evaluateEmgSelfStopping,
  selectEmgNegativeConstraints,
  type EmgAuditResult,
  EMG_DEFAULT_MIN_ENTROPY,
} from './lib/studio/emg';
