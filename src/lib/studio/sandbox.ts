/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const SUBJECTS = [
  'Orbital debris accumulation',
  'Interplanetary radiation shielding',
  'Psychological isolation in deep space',
  'Microgravity bone density degradation',
  'Resource sovereignty on celestial bodies',
  'Light-speed communication lag governance',
  'Extraterrestrial microbial contamination',
  'Solar flare vulnerability in life support',
  'Economic disparity between Earth and colonies',
  'Ethical treatment of artificial intelligence companions'
];

const ACTIONS = [
  'demands international regulatory frameworks',
  'risks catastrophic systemic failure if ignored',
  'catalyzes unprecedented technological innovation',
  'creates severe geopolitical friction between nations',
  'necessitates decentralized autonomous governance',
  'exposes fundamental flaws in current life support designs',
  'requires radical shifts in long-term human psychology',
  'threatens planetary protection protocols',
  'presents insurmountable logistical bottlenecks without new physics',
  'forces a re-evaluation of human rights across planetary boundaries'
];

const OUTCOMES = [
  'leading to permanent societal divergence.',
  'resulting in unforeseen evolutionary pressures.',
  'sparking intense philosophical debate on stewardship.',
  'triggering rapid adaptation in engineering standards.',
  'fostering resilient multi-planetary communities.',
  'endangering foundational treaties of space law.',
  'creating new paradigms for resource allocation.',
  'challenging our fundamental definitions of civilization.',
  'inaugurating a golden age of cooperative science.',
  'demanding strict oversight by independent councils.'
];

export function getSandboxCapacity(): number {
  return SUBJECTS.length * ACTIONS.length * OUTCOMES.length; // 10 * 10 * 10 = 1000
}

export function generateSandboxAnswer(index: number): string {
  const subIdx = index % SUBJECTS.length;
  const actIdx = Math.floor(index / SUBJECTS.length) % ACTIONS.length;
  const outIdx = Math.floor(index / (SUBJECTS.length * ACTIONS.length)) % OUTCOMES.length;

  return `${SUBJECTS[subIdx]} ${ACTIONS[actIdx]}, ${OUTCOMES[outIdx]} (Perspective #${index + 1})`;
}
