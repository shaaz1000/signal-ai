/**
 * Cross-industry coverage. The registry is data: add an entry to cover a new
 * industry. Matching is keyword based, like category classification, and an
 * item can belong to several industries or to none.
 */
export interface Industry {
  id: string;
  name: string;
  re: RegExp;
}

export const INDUSTRIES: Industry[] = [
  { id: 'healthcare', name: 'Healthcare and medicine', re: /\b(health ?care|medical|medicine|clinical|clinician|patient|diagnos\w+|radiolog\w+|patholog\w+|oncolog\w+|drug discovery|biomedical|hospital|ehr|genomic\w*|protein (folding|design|structure)|mri|ct scan|x-ray)\b/i },
  { id: 'defence', name: 'Defence and national security', re: /\b(defen[cs]e|military|national security|warfare|battlefield|pentagon|darpa|nato|missile|surveillance drone|intelligence agenc\w+)\b/i },
  { id: 'robotics', name: 'Robotics', re: /\b(robot(s|ics|ic)?|humanoid|quadruped|manipulat(or|ion)|embodied|teleoperat\w+|actuator)\b/i },
  { id: 'transport', name: 'Autonomous transportation', re: /\b(autonomous (vehicle|driving|truck)\w*|self[- ]driving|robotaxi|adas|lidar|waymo|autopilot)\b/i },
  { id: 'space', name: 'Space', re: /\b(space(craft|flight)?|satellite\w*|orbit\w*|nasa|esa|rocket|astronom\w+|telescope|exoplanet)\b/i },
  { id: 'agriculture', name: 'Agriculture', re: /\b(agricultur\w+|farming|farm|crop\w*|livestock|precision ag\w*|soil|harvest\w*)\b/i },
  { id: 'climate-energy', name: 'Climate and energy', re: /\b(climate|weather (forecast|model)\w*|energy|power grid|battery|solar|wind (farm|turbine)|nuclear|fusion|carbon|emission\w*)\b/i },
  { id: 'finance', name: 'Finance', re: /\b(financ\w+|fintech|bank(ing)?|trading|quant\w*|portfolio|fraud detection|credit|insurance|payments?)\b/i },
  { id: 'education', name: 'Education', re: /\b(education\w*|student\w*|teacher\w*|classroom|tutor\w*|curriculum|learning platform|edtech)\b/i },
  { id: 'manufacturing', name: 'Manufacturing', re: /\b(manufactur\w+|factory|industrial|supply chain|semiconductor|chip (design|fab)\w*|cad|3d print\w+|quality inspection)\b/i },
  { id: 'fashion-beauty', name: 'Fashion and beauty', re: /\b(fashion|apparel|beauty|cosmetic\w*|virtual try[- ]on|garment)\b/i },
  { id: 'gaming', name: 'Gaming', re: /\b(gam(e|es|ing)|emulat(or|ion)|game engine|npc|unreal|unity|playstation|xbox|nintendo|steam)\b/i },
  { id: 'entertainment', name: 'Entertainment', re: /\b(film|movie|music|streaming service|animation|vfx|podcast|video generation|text[- ]to[- ]video)\b/i },
  { id: 'creative-tools', name: 'Creative tools', re: /\b(photo editor|video editor|image generation|design tool|illustrat\w+|vector|creative coding|comfyui|diffusion|daw|3d model\w*)\b/i },
  { id: 'government', name: 'Government', re: /\b(government|public sector|regulat\w+|legislation|policy|eu ai act|executive order|election\w*)\b/i },
  { id: 'cybersecurity', name: 'Cybersecurity', re: /\b(cyber ?security|vulnerabilit\w+|exploit\w*|malware|pentest\w*|red team\w*|reverse[- ]engineer\w*|decompil\w+|threat (detection|intel\w*)|prompt injection|jailbreak\w*)\b/i },
  { id: 'science', name: 'Scientific discovery', re: /\b(scientific discovery|physics|chemistry|materials science|biology|mathemat\w+|theorem|molecul\w+|simulation|ai for science)\b/i },
  { id: 'consumer', name: 'Consumer technology', re: /\b(smartphone|iphone|android|wearable\w*|smart (glasses|home|watch)|consumer (device|app)\w*|personal assistant)\b/i },
];

export const industryName = (id: string): string => INDUSTRIES.find((i) => i.id === id)?.name ?? id;

export function classifyIndustries(text: string, max = 3): string[] {
  return INDUSTRIES.filter((i) => i.re.test(text)).slice(0, max).map((i) => i.id);
}

/**
 * How far along a claim is. Only set when the source text says so; the cue is
 * kept so the UI can quote it. Order matters: the strongest stated stage wins.
 */
export const EVIDENCE_STAGES = {
  // Medicine
  'clinical-deployment': 'In clinical use',
  'regulatory-clearance': 'Regulatory clearance',
  'clinical-trial': 'Clinical trial',
  preclinical: 'Preclinical research',
  // Defence
  'operational-deployment': 'Operational deployment (as stated by the source)',
  'field-test': 'Test or trial',
  'vendor-claim': 'Vendor claim',
  // General
  deployment: 'Deployed in production',
  'independent-validation': 'Independently validated',
  'peer-reviewed': 'Peer-reviewed result',
  demonstration: 'Technical demonstration',
  announcement: 'Product announcement',
  research: 'Research (preprint or early work)',
  concept: 'Concept',
} as const;
export type EvidenceStage = keyof typeof EVIDENCE_STAGES;

const MEDICAL: { stage: EvidenceStage; re: RegExp }[] = [
  { stage: 'regulatory-clearance', re: /\b(fda[- ](cleared|approved|clearance|approval)|510\(k\)|ce[- ]mark\w*|regulatory (clearance|approval)|de novo (clearance|authori[sz]ation))\b/i },
  { stage: 'clinical-trial', re: /\b(clinical trial|randomi[sz]ed (controlled )?trial|phase (i{1,3}|[123])\b|prospective study|multi-?cent(er|re) study)\b/i },
  { stage: 'clinical-deployment', re: /\b(deployed (in|at|across) \w+ (hospital|clinic)\w*|in clinical use|used by clinicians|rolled out (to|across) hospitals)\b/i },
  { stage: 'preclinical', re: /\b(preclinical|in vitro|in silico|animal (model|study)|retrospective (study|analysis|dataset)|proof[- ]of[- ]concept)\b/i },
];
const DEFENCE: { stage: EvidenceStage; re: RegExp }[] = [
  { stage: 'operational-deployment', re: /\b(operationally deployed|fielded|in (active )?service|deployed (by|with) the (army|navy|air force|military))\b/i },
  { stage: 'field-test', re: /\b(field (test|trial)\w*|flight test\w*|live[- ]fire|exercise|trial(l)?ed)\b/i },
  { stage: 'vendor-claim', re: /\b(the company (says|claims)|according to the (vendor|manufacturer|contractor)|contract (award|worth))\b/i },
  { stage: 'concept', re: /\b(concept|proposal|white ?paper|envision\w*|roadmap)\b/i },
];
const GENERAL: { stage: EvidenceStage; re: RegExp }[] = [
  { stage: 'independent-validation', re: /\b(independent(ly)? (test|evaluat|verif|replicat|reproduc)\w+|third[- ]party (benchmark|evaluation|audit)|reproduced by)\b/i },
  { stage: 'deployment', re: /\b(in production (at|use)|deployed (to|in) production|used in production|generally available|now available to all)\b/i },
  { stage: 'demonstration', re: /\b(demo(nstration)?|prototype|proof[- ]of[- ]concept|experimental|preview|alpha)\b/i },
];

export function detectEvidenceStage(input: { text: string; industries: string[]; claimType: string }): { stage: EvidenceStage; cue: string | null } | null {
  const sets = [
    ...(input.industries.includes('healthcare') ? [MEDICAL] : []),
    ...(input.industries.includes('defence') ? [DEFENCE] : []),
    GENERAL,
  ];
  for (const set of sets) {
    for (const { stage, re } of set) {
      const m = input.text.match(re);
      if (m) return { stage, cue: m[0] };
    }
  }
  // No explicit statement: fall back to what the claim type itself establishes, with no cue.
  if (input.claimType === 'peer_reviewed') return { stage: 'peer-reviewed', cue: null };
  if (input.claimType === 'preprint') return { stage: 'research', cue: null };
  if (input.claimType === 'company_announcement') return { stage: 'announcement', cue: null };
  return null;
}
