# Learn: explanations, diagrams, Story Mode and Creator Studio

The guiding rule for everything on this page of the product: **evidence and general explanation are never mixed.** A reader can always tell which sentences come from the item's own sources and which describe how that kind of technology generally works.

## How an explanation is built

`buildExplanation(view)` in `lib/explain/build.ts` is a pure function. It runs in the Next.js app, on the static site and in the Artifact, and needs no model.

| Input | Where it comes from |
|---|---|
| Evidence | The stored discovery: summary, documented mechanism (only if the sources describe one), repository and model facts read from APIs, stated maturity with the quoted phrase, limitations from the verification checks |
| General explanation | The concept library, `lib/explain/concepts.ts`: ten hand-written entries (AI agents, retrieval-augmented generation, medical image analysis, generative image and video models, speech, robotics, emulation and WebAssembly, model releases, the research process, developer tools and APIs) |

Each discovery is matched to at most one concept by `detectConcept`. Its title and description decide first, so a passing mention in a README cannot change what the project is.

### The five layers

| Layer | Evidence part | General part |
|---|---|---|
| Explain it simply | The item's one-sentence summary | The concept in plain language |
| Everyday analogy | none | An analogy, always followed by where it stops being accurate |
| How it works | The documented mechanism, if any | The usual workflow for this kind of system |
| Deep technical breakdown | Language, licence, release, model facts, how it runs | Architecture typical of the class, labelled as not confirmed for this project |
| Real-world usage | Stated maturity, industries, audience, limitations | Where such systems are and are not used |

When the sources do not describe the implementation, the layer says so and the general part is marked as general. Nothing is invented to fill the gap. When no concept matches and no mechanism is documented, no diagram is drawn at all.

## The explanation schema

`lib/explain/schema.ts` is the single contract for anything rendered in Learn, validated with zod whether it was assembled here or (in future) drafted by a model:

- Strings are plain text: angle brackets and control characters are rejected, so no markup or script can be carried.
- There are no URL fields and no code fields. A diagram is data (nodes, edges, steps), never something to execute.
- `diagramType` is one of seven fixed values; the renderer is looked up in a registry. An unknown type or an invalid diagram renders its text alternative.
- Complexity is capped (`LIMITS`): 12 steps, 14 nodes, 24 edges.
- Every step carries `illustrative` and `evidenceRefs`; every visualization carries `confirmed`. Concept-library diagrams are always `confirmed: false`.
- Every visualization has a `textAlternative`.

## Diagram engine and Story Mode

`components/learn/` holds the renderers, the step-through view, the layer switcher and the Story Mode player. They are plain React, inline SVG and CSS. Motion for React, D3, React Flow and Recharts were considered and not used: the same components ship inside a single-file page of about 110 KB, and the diagrams here are small directed graphs that a deterministic layout function (`lib/explain/layout.ts`) handles.

Story Mode turns one explanation into eight scenes (problem, innovation, under the hood, conceptual demonstration, applications, limitations, why it matters, what is next). It has play and pause, replay, speed, a progress bar, keyboard control and a transcript that is available without playing anything. Under `prefers-reduced-motion` nothing moves on its own and the transcript is open.

Scenes that restate evidence cite the item's sources. Scenes built from the concept library are marked illustrative. The demonstration scene is always labelled a conceptual walk-through, never a recording of the project.

## Languages

| What | How it is translated |
|---|---|
| Interface strings, concept library, diagram labels, scene scaffolding | Bundled in the app for English, Hindi and Hinglish (`lib/i18n/bundled.*.ts`), keyed by the English source string. A coverage test fails if a string is missing. |
| Text from an item's sources (summary, mechanism, limitations) | By a translation provider through the protected endpoint, then cached. Shown in the original until a translation exists. |
| Other languages (Marathi, Arabic, French, Spanish, German) | Provider only. |

The page always states which of these the reader is looking at. The original text is never replaced: translations are separate records keyed by a hash of the source, so a changed source invalidates them.

The bundled Hindi and Hinglish were written by a language model and have not been reviewed by a native-speaking subject expert.

## Creator Studio and Content Radar

`lib/creator/templates.ts` assembles nine formats (hooks, 30 and 60 second scripts, Shorts, LinkedIn, news article, explainer, technical deep dive, and a scene-by-scene video script from Story Mode) in five tones. Every sentence restates a stored fact or is fixed scaffolding (labels, timings, transitions). Tone changes framing words only; a test asserts the numbers are identical across tones. Each draft lists its sources and a "do not state as fact" list taken from the checks that did not pass.

With an AI provider configured, a signed-in user can ask for a rewrite. The rewrite is accepted only if every number and link in it already appears in the assembled draft; otherwise the assembled draft is kept.

Content Radar ranks verified stories by story potential: novelty, significance, confidence, how explainable they are, and momentum, with a deduction for stories already covered widely. Unverified items score zero by rule.

No video is rendered anywhere. The video script is a script.
