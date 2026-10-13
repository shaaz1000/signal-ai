import type { CategoryId, ClaimType, ExecutionMode, Kind, SourceGroup } from '@/lib/types';
import { slugTag } from '@/lib/utils/text';

/**
 * Keyword rules, not a model. They decide (a) whether a general-interest item
 * is on topic at all and (b) which section it belongs in. Order matters: the
 * first matching rule wins, most specific first.
 */
const RULES: { category: CategoryId; tag: string; re: RegExp }[] = [
  { category: 'robotics', tag: 'robotics', re: /\b(robot(s|ics|ic)?|humanoid|quadruped|manipulat(or|ion)|drone(s)?|ros2?|embodied|teleoperat\w+|actuator|exoskeleton)\b/i },
  { category: 'agents', tag: 'agents', re: /\b(agent(s|ic)?|multi-agent|computer[- ]use|browser[- ]use|browser automation|langgraph|mcp|model context protocol|tool[- ]calling|autonomous(ly)?|orchestrat\w+|crewai|autogen|swarm)\b/i },
  { category: 'gaming-browser', tag: 'browser-experiment', re: /\b(webassembly|wasm|webgpu|webgl|emulat(or|ion|ed)|in (the|your) browser|browser[- ]based|runs? in (a |the )?browser|game engine|gta|doom|decompil\w+|reverse[- ]engineer\w*|recompil\w+|rom hack|retro ?gam\w+|cloud gaming)\b/i },
  { category: 'creative', tag: 'creative', re: /\b(image generation|video generation|text[- ]to[- ](image|video|speech|music|3d)|diffusion|generative (art|music|video)|music generation|voice clon\w+|tts|speech synthesis|photo editor|video editor|design tool|animation|3d (model|generation)|gaussian splat\w*|comfyui|shader|creative coding)\b/i },
  { category: 'llms', tag: 'llm', re: /\b(llms?|large language model|language model|transformer(s)?|fine[- ]?tun\w+|quantiz\w+|gguf|llama|mistral|qwen|gemma|deepseek|gpt-?\d|claude|gemini|inference (engine|server)|tokeniz\w+|rag|retrieval[- ]augmented|embedding(s)?|prompt\w*|context window|open[- ]weights?|vlm|multimodal)\b/i },
  { category: 'research', tag: 'research', re: /\b(paper|arxiv|preprint|benchmark|dataset|ablation|we propose|state of the art|neurips|icml|iclr|cvpr|acl 20\d\d)\b/i },
  { category: 'dev-tools', tag: 'dev-tools', re: /\b(cli|sdk|compiler|debugger|ide|vs ?code|neovim|terminal|linter|devtool\w*|developer tool\w*|coding (assistant|agent)|code (review|generation|editor|search)|git|database|postgres|sqlite|kubernetes|docker|observability|api (client|gateway)|framework|library|runtime|bundler|typescript|rust|golang)\b/i },
  { category: 'ai-tools', tag: 'ai', re: /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|neural|deep learning|computer vision|generative|chatbot|copilot|assistant|speech recognition|ocr|nlp)\b/i },
  { category: 'open-source', tag: 'open-source', re: /\b(open[- ]source|self[- ]host\w*|foss|alternative to|open alternative|mit licen[cs]e|apache[- ]2)\b/i },
  { category: 'launches', tag: 'launch', re: /\b(launch(es|ed|ing)?|startup|raises?|funding|seed round|series [abc]|yc [wsf]\d\d|product hunt|waitlist|beta)\b/i },
];

export function matchedRules(text: string) {
  return RULES.filter((r) => r.re.test(text));
}

/** True when a general-feed item is about something this product covers. */
export function isRelevant(text: string): boolean {
  return RULES.slice(0, 8).some((r) => r.re.test(text));
}

export function classify(input: {
  title: string;
  description: string;
  tags: string[];
  kind: Kind;
  group: SourceGroup;
  sourceId: string;
}): { category: CategoryId; tags: string[] } {
  const text = `${input.title} ${input.description} ${input.tags.join(' ')}`;
  const hits = matchedRules(text);
  let category: CategoryId;
  if (input.kind === 'paper') category = hits.find((h) => h.category === 'robotics')?.category ?? 'research';
  else if (input.sourceId === 'producthunt') category = 'launches';
  else if (input.kind === 'model') category = 'llms';
  else category = hits[0]?.category ?? (input.kind === 'repository' ? 'open-source' : 'ai-tools');

  const tags = new Set<string>();
  for (const t of input.tags) {
    const s = slugTag(t);
    if (s && !/^(region:|license:|arxiv:|base_model:|dataset:)/.test(t)) tags.add(s);
  }
  for (const h of hits.slice(0, 4)) tags.add(h.tag);
  return { category, tags: [...tags].slice(0, 10) };
}

export function defaultClaimType(kind: Kind, group: SourceGroup): ClaimType {
  if (kind === 'paper') return 'preprint';
  if (kind === 'repository' || kind === 'model' || kind === 'demo') return 'project_release';
  if (group === 'news') return 'third_party';
  if (group === 'blog') return 'company_announcement';
  if (kind === 'product') return 'company_announcement';
  return 'community_post';
}

const EXECUTION_CUES: { mode: ExecutionMode; re: RegExp }[] = [
  { mode: 'cloud_streaming', re: /\b(cloud[- ]gaming|game stream\w*|stream(s|ed|ing)? (the game |it )?(from|to|over|via)|pixel stream\w*|webrtc stream\w*|geforce now|xcloud|server[- ]side render\w* stream\w*)\b/i },
  { mode: 'remote_desktop', re: /\b(remote desktop|vnc|rdp|moonlight|sunshine|parsec|guacamole|kvm over ip)\b/i },
  { mode: 'ai_generated', re: /\b(world model|neural (game )?(engine|simulation)|ai[- ]generated (gameplay|frames|video)|frames? (are |is )?generated by|diffusion[- ]based (game|simulation)|generates? (each|every) frame)\b/i },
  { mode: 'emulation', re: /\b(emulat(or|ion|es|ed|ing)|virtual machine|v86|qemu|dosbox|jslinux|x86 in the browser)\b/i },
  { mode: 'native', re: /\b(compiled to (webassembly|wasm)|ported to (webassembly|wasm|the web|the browser)|(webassembly|wasm) port|native port|native(ly)? in the browser|static recompilation|runs? (entirely |fully )?client[- ]side|recompiled|decompilation)\b/i },
];

/**
 * Looks for an explicit statement of how something runs. Returns the matched
 * phrase so the evidence record can quote it; returns null when the source
 * text does not say, in which case the UI shows "not verified".
 */
export function detectExecutionMode(...texts: string[]): { mode: ExecutionMode; cue: string } | null {
  // The project's own one-line description outranks anything buried in its documentation.
  for (const text of texts) {
    const hits = EXECUTION_CUES.map(({ mode, re }) => ({ mode, m: text.match(re) })).filter((h) => h.m);
    if (!hits.length) continue;
    const first = hits.sort((a, b) => (a.m!.index ?? 0) - (b.m!.index ?? 0))[0];
    return { mode: first.mode, cue: first.m![0] };
  }
  return null;
}
