/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface EmgPersona {
  id: string;
  name: string;
  tagline: string;
  directive: string;
  color: string;
}

export const EMG_PERSONAS: EmgPersona[] = [
  {
    id: 'causal_logician',
    name: 'Causal Logician',
    tagline: 'Mechanistic causality & non-obvious feedback loops',
    directive: 'Analyze strictly through formal causal logic. Focus on hidden causal loops, structural failure modes, and mechanistic leverage points rather than surface correlations.',
    color: '#38bdf8', // sky-400
  },
  {
    id: 'economist',
    name: 'Economist',
    tagline: 'Incentive design, externalities & game theory',
    directive: 'Analyze through economic mechanisms. Identify unpriced negative externalities, principal-agent misalignments, capital allocation distortions, and game-theoretic Nash traps.',
    color: '#34d399', // emerald-400
  },
  {
    id: 'futurist',
    name: 'Futurist',
    tagline: 'Second-order inflection points & emergent frontiers',
    directive: 'Analyze through second-order systemic evolution. Identify nonlinear phase shifts, compounding technological transitions, and long-tail systemic risks.',
    color: '#c084fc', // purple-400
  },
  {
    id: 'ethicist',
    name: 'Ethicist',
    tagline: 'Moral trade-offs, harm distribution & agency',
    directive: 'Analyze through moral and systemic ethics. Scrutinize power asymmetries, disproportionate distribution of risk and harm, and moral hazards created by this system.',
    color: '#fb7185', // rose-400
  },
  {
    id: 'legal_expert',
    name: 'Legal Expert',
    tagline: 'Jurisdictional friction, liability & regulatory failure',
    directive: 'Analyze through jurisprudence and governance. Focus on regulatory arbitrage, cross-jurisdictional vacuum zones, liability allocation, and enforceability breakdowns.',
    color: '#facc15', // amber-400
  },
  {
    id: 'historian',
    name: 'Historian',
    tagline: 'Macro precedents, institutional decline & path dependency',
    directive: 'Analyze through historical macro-patterns. Draw exact historical analogies to prior technological, economic, or civilizational transitions and examine rigid path-dependencies.',
    color: '#fb923c', // orange-400
  },
  {
    id: 'philosopher',
    name: 'Philosopher',
    tagline: 'Epistemic boundaries, category errors & ontology',
    directive: 'Analyze through rigorous epistemology and ontology. Challenge hidden premises, expose category errors in the framing, and delineate what cannot be known.',
    color: '#818cf8', // indigo-400
  },
  {
    id: 'data_analyst',
    name: 'Data Analyst',
    tagline: 'Measurement bias, confounders & signal-to-noise',
    directive: 'Analyze through empirical data integrity. Identify observational selection bias, survivorship anomalies, unmeasured confounders, and where empirical metrics mislead.',
    color: '#2dd4bf', // teal-400
  },
  {
    id: 'social_scientist',
    name: 'Social Scientist',
    tagline: 'Coordination failure, collective inertia & institutional drift',
    directive: 'Analyze through collective human dynamics. Focus on organizational inertia, sociotechnical coordination failures, cultural resistance, and systemic groupthink.',
    color: '#a3e635', // lime-400
  },
];

export function getPersonaById(id: string): EmgPersona | undefined {
  return EMG_PERSONAS.find((p) => p.id === id);
}

export function getPersonaByIndex(index: number): EmgPersona {
  return EMG_PERSONAS[index % EMG_PERSONAS.length];
}

export function formatPersonaDirective(personaIdOrName?: string): string {
  if (!personaIdOrName || personaIdOrName === 'none' || personaIdOrName === 'standard') {
    return '';
  }
  const match = EMG_PERSONAS.find(
    (p) => p.id === personaIdOrName || p.name.toLowerCase() === personaIdOrName.toLowerCase()
  );
  if (match) {
    return `\n\n[EMG INTELLECTUAL LENS: ${match.name.toUpperCase()}]\n${match.directive}\nFrame your core idea, answer, and observable prediction specifically through this specialized perspective.`;
  }
  return '';
}
