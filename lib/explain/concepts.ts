/**
 * The concept library: hand-written, general explanations of the kinds of
 * system this product covers. A discovery is matched to at most one concept.
 *
 * Everything here describes how a CLASS of technology works. It is never a
 * claim about a specific project, and the UI always shows it apart from
 * evidence and marks its diagrams "illustrative".
 */
import type { DiagramType } from './schema';

type NodeKind = 'input' | 'process' | 'model' | 'tool' | 'decision' | 'output' | 'human' | 'store';
type EdgeKind = 'data' | 'feedback' | 'retry' | 'approval';

export interface Concept {
  id: string;
  name: string;
  /** Matched against title, description, tags and documentation. First match in list order wins. */
  match: RegExp;
  /** The problem that existed before this kind of technology. */
  problem: string;
  simple: string[];
  analogy: string;
  /** Where the analogy stops being accurate. */
  analogyLimit: string;
  how: string[];
  deep: string[];
  realWorld: string[];
  diagram: {
    type: DiagramType;
    title: string;
    nodes: { id: string; label: string; kind: NodeKind; detail: string }[];
    edges: { from: string; to: string; kind?: EdgeKind; label?: string }[];
    columns?: { title: string; points: string[] }[];
    steps: { id: string; title: string; description: string; focus: string[] }[];
    textAlternative: string;
  };
}

export const CONCEPTS: Concept[] = [
  {
    id: 'medical-imaging',
    name: 'AI image analysis in medicine',
    match: /\b(medical imag\w+|radiolog\w+|patholog\w+|x-ray|ct scan|mri|mammogra\w+|histolog\w+|retina\w* (scan|imag)\w*|tumou?r (detection|segmentation))\b/i,
    problem: 'Reading medical images takes trained specialists a long time, and there are not enough of them for the number of scans produced.',
    simple: [
      'A computer program looks at a medical picture, such as an X-ray, and points out areas a doctor may want to look at more closely.',
      'It does not decide what is wrong with a patient. A trained clinician looks at the picture, the highlighted area and everything else known about the patient, and makes the decision.',
    ],
    analogy: 'It is like a spell-checker for a scan: it underlines places that might need attention, and a person decides whether each one really is a problem.',
    analogyLimit: 'A spell-checker follows fixed rules. An imaging model learned patterns from past scans, so it can be confidently wrong on images unlike the ones it was trained on.',
    how: [
      'The image is first prepared: resized, brightness-normalised and sometimes split into smaller patches.',
      'A neural network trained on labelled scans turns the pixels into numerical features and produces a score, a label or a highlighted region.',
      'The output is shown next to the original image. A clinician reviews both alongside the patient history before anything is acted on.',
    ],
    deep: [
      'Typical architectures are convolutional networks or vision transformers, trained with supervised labels from specialists and, increasingly, pretrained on large unlabelled image collections.',
      'Outputs are classification scores, bounding boxes or pixel-level segmentation masks. Saliency or attention maps are often shown, but they indicate where the model looked, not why.',
      'Performance depends heavily on the scanner type, hospital and patient population in the training data. Validation on data from other sites is what shows whether a model generalises.',
    ],
    realWorld: [
      'Use on patients normally requires regulatory clearance for a specific, narrow purpose, and evidence from clinical studies, not only from stored test images.',
      'A result on a research dataset does not mean a tool is in clinical use. Look for the stated stage: retrospective study, clinical trial, clearance or deployment.',
    ],
    diagram: {
      type: 'image-analysis',
      title: 'From scan to clinical review',
      nodes: [
        { id: 'scan', label: 'Medical image', kind: 'input', detail: 'The scan as produced by the imaging machine. The picture shown here is a simulated illustration.' },
        { id: 'prepare', label: 'Prepare the image', kind: 'process', detail: 'Resize, normalise brightness and contrast, and split into patches if needed.' },
        { id: 'model', label: 'Trained model', kind: 'model', detail: 'A neural network that learned visual patterns from past labelled scans.' },
        { id: 'finding', label: 'Highlighted region and score', kind: 'output', detail: 'A suggestion with a confidence score. It is not a diagnosis.' },
        { id: 'clinician', label: 'Clinician review', kind: 'human', detail: 'A qualified person weighs the suggestion against the original image and the clinical context.' },
      ],
      edges: [
        { from: 'scan', to: 'prepare' }, { from: 'prepare', to: 'model' }, { from: 'model', to: 'finding' },
        { from: 'finding', to: 'clinician', kind: 'approval', label: 'reviewed by' },
      ],
      steps: [
        { id: 'enter', title: 'An image enters the system', description: 'A scan arrives from the imaging machine.', focus: ['scan'] },
        { id: 'prepare', title: 'The image is prepared', description: 'It is cleaned up and put in the format the model expects.', focus: ['scan', 'prepare'] },
        { id: 'analyse', title: 'The model analyses features', description: 'The network turns pixels into features and compares them with patterns it learned.', focus: ['prepare', 'model'] },
        { id: 'suggest', title: 'It produces a suggestion', description: 'The output is a highlighted region or a score, with a level of confidence.', focus: ['model', 'finding'] },
        { id: 'review', title: 'A clinician reviews it', description: 'The suggestion is checked against the original image and the patient context. The clinician decides.', focus: ['finding', 'clinician'] },
      ],
      textAlternative: 'A medical image is prepared, analysed by a trained model that outputs a highlighted region and confidence score, and then reviewed by a clinician who makes the decision.',
    },
  },
  {
    id: 'agent-loop',
    name: 'AI agents',
    match: /\b(agent(s|ic)?|multi-agent|computer[- ]use|browser[- ]use|tool[- ]calling|function calling|mcp|model context protocol|langgraph|autonomous(ly)? (complet|perform|operat)\w*)\b/i,
    problem: 'A chatbot can only reply with text. Getting real work done means someone has to copy its answers into other programs, step by step.',
    simple: [
      'An AI agent is a program that is given a goal, not just a question. It works out the steps, uses tools such as a web browser or a code editor to carry them out, and checks whether each step worked.',
      'If something goes wrong it can try again or ask a person what to do.',
    ],
    analogy: 'Think of an assistant who is handed a task, picks the right tools from a toolbox, does one step, looks at the result and decides what to do next.',
    analogyLimit: 'A human assistant understands the task. An agent predicts likely next actions from patterns, so it can repeat a mistake confidently, misread a screen or follow instructions hidden in a web page.',
    how: [
      'The goal and a description of the available tools are given to a language model.',
      'The model replies with either a final answer or a request to call one tool with specific arguments.',
      'The surrounding program runs the tool, returns the result to the model as an observation, and the loop repeats until the model finishes, a step limit is reached or a person stops it.',
    ],
    deep: [
      'The loop is ordinary code around a model API: message history, a tool registry with JSON schemas, an executor, and stop conditions. Protocols such as MCP standardise how tools are described and called.',
      'Reliability comes from the harness, not the model alone: retries with error text fed back, validation of tool arguments, sandboxing, step and cost limits, and approval gates before irreversible actions.',
      'Content read by a tool is untrusted input. Prompt injection, where retrieved text contains instructions, is the main security risk and has to be handled by limiting what tools can do.',
    ],
    realWorld: [
      'Agents are in real use for coding, research and browser tasks where a wrong step can be undone. They are much less dependable for long tasks with no checkpoints.',
      'Running one needs a model API or local model, tool integrations, and a way to contain actions: permissions, a sandbox and logs.',
    ],
    diagram: {
      type: 'flow',
      title: 'The agent loop',
      nodes: [
        { id: 'goal', label: 'User goal', kind: 'input', detail: 'What the person wants done, in plain language.' },
        { id: 'plan', label: 'Plan', kind: 'model', detail: 'The model decides the next step toward the goal.' },
        { id: 'select', label: 'Choose a tool', kind: 'decision', detail: 'It picks one tool and the arguments to call it with.' },
        { id: 'execute', label: 'Run the tool', kind: 'tool', detail: 'The surrounding program runs the tool. The model itself cannot act.' },
        { id: 'observe', label: 'Observe result', kind: 'process', detail: 'The tool output, or an error, is returned to the model.' },
        { id: 'evaluate', label: 'Evaluate', kind: 'decision', detail: 'Is the goal met? If not, plan again. If a step failed, retry or change approach.' },
        { id: 'approve', label: 'Human approval', kind: 'human', detail: 'For risky actions a person confirms before the tool runs.' },
        { id: 'respond', label: 'Response', kind: 'output', detail: 'The final answer, with what was done.' },
      ],
      edges: [
        { from: 'goal', to: 'plan' }, { from: 'plan', to: 'select' }, { from: 'select', to: 'execute' },
        { from: 'select', to: 'approve', kind: 'approval', label: 'if risky' }, { from: 'approve', to: 'execute', kind: 'approval' },
        { from: 'execute', to: 'observe' }, { from: 'observe', to: 'evaluate' },
        { from: 'evaluate', to: 'plan', kind: 'retry', label: 'not done or failed' }, { from: 'evaluate', to: 'respond' },
      ],
      steps: [
        { id: 'goal', title: 'A goal comes in', description: 'The person describes an outcome, not individual steps.', focus: ['goal'] },
        { id: 'plan', title: 'The model plans', description: 'It decides what to do next and which tool fits.', focus: ['goal', 'plan', 'select'] },
        { id: 'approve', title: 'A person can be asked first', description: 'Before a risky action, the loop can pause for approval.', focus: ['select', 'approve'] },
        { id: 'act', title: 'The tool runs', description: 'The program around the model executes the tool call.', focus: ['select', 'execute'] },
        { id: 'observe', title: 'The result is read', description: 'Output or error text goes back to the model.', focus: ['execute', 'observe', 'evaluate'] },
        { id: 'retry', title: 'Not done: go round again', description: 'On failure or an unfinished goal, the model plans another step with what it learned.', focus: ['evaluate', 'plan'] },
        { id: 'respond', title: 'Done: respond', description: 'When the goal is met or a limit is reached, the agent reports back.', focus: ['evaluate', 'respond'] },
      ],
      textAlternative: 'A user goal goes to a model that plans a step and chooses a tool. Risky actions can wait for human approval. The tool runs, its result is observed and evaluated, and the loop either retries with a new plan or returns a response.',
    },
  },
  {
    id: 'rag',
    name: 'Retrieval-augmented generation',
    match: /\b(rag|retrieval[- ]augmented|vector (database|store|search)|embedding(s)? (search|store|index)|semantic search|knowledge base|document (q&a|question))\b/i,
    problem: 'A language model only knows what was in its training data. It cannot see your documents, and it may state outdated or invented facts.',
    simple: [
      'Before the AI answers, the system first looks up relevant pages from a collection of documents and hands them to the AI along with the question.',
      'The AI then answers using those pages, so the answer can be checked against them.',
    ],
    analogy: 'It is an open-book exam: instead of answering from memory, the student first finds the right pages and then writes the answer from them.',
    analogyLimit: 'A student understands the book. The system picks pages by numerical similarity, so it can fetch the wrong ones, and the model can still misread or ignore what it was given.',
    how: [
      'Documents are split into chunks, and each chunk is converted into a list of numbers (an embedding) that captures its meaning. These are stored in an index.',
      'The question is converted the same way, and the chunks with the closest embeddings are retrieved.',
      'The retrieved chunks are placed in the prompt with the question, and the model writes an answer, ideally citing which chunk each claim came from.',
    ],
    deep: [
      'Quality is dominated by retrieval: chunking strategy, the embedding model, hybrid keyword plus vector search, and a re-ranking step that reorders candidates with a stronger model.',
      'Common failure modes are retrieving near-duplicates, missing the one relevant chunk, and the generator answering from its own memory instead of the context.',
      'Evaluation needs both retrieval metrics (was the right passage found) and answer metrics (is the answer supported by it).',
    ],
    realWorld: [
      'Widely used for search over company documents, support assistants and code search.',
      'It needs a document pipeline, an index and access controls: the system must not retrieve documents the asker is not allowed to see.',
    ],
    diagram: {
      type: 'flow',
      title: 'Retrieve, then generate',
      nodes: [
        { id: 'docs', label: 'Documents', kind: 'store', detail: 'The collection the system is allowed to use.' },
        { id: 'index', label: 'Embedding index', kind: 'store', detail: 'Each chunk stored as numbers that capture its meaning.' },
        { id: 'question', label: 'Question', kind: 'input', detail: 'What the person asks.' },
        { id: 'retrieve', label: 'Retrieve closest chunks', kind: 'process', detail: 'Find the chunks whose meaning is nearest to the question.' },
        { id: 'model', label: 'Language model', kind: 'model', detail: 'Reads the question together with the retrieved chunks.' },
        { id: 'answer', label: 'Answer with sources', kind: 'output', detail: 'An answer that can be checked against the retrieved text.' },
      ],
      edges: [
        { from: 'docs', to: 'index', label: 'chunk and embed' }, { from: 'question', to: 'retrieve' }, { from: 'index', to: 'retrieve' },
        { from: 'retrieve', to: 'model' }, { from: 'model', to: 'answer' },
      ],
      steps: [
        { id: 'index', title: 'Documents are indexed', description: 'Ahead of time, documents are split up and stored by meaning.', focus: ['docs', 'index'] },
        { id: 'ask', title: 'A question arrives', description: 'The question is converted into the same numerical form.', focus: ['question', 'retrieve'] },
        { id: 'retrieve', title: 'Relevant chunks are found', description: 'The closest chunks are pulled from the index.', focus: ['index', 'retrieve'] },
        { id: 'generate', title: 'The model answers from them', description: 'Question and chunks go to the model together.', focus: ['retrieve', 'model'] },
        { id: 'cite', title: 'The answer points to its sources', description: 'A good system shows which chunk supports each claim.', focus: ['model', 'answer'] },
      ],
      textAlternative: 'Documents are chunked and stored in an embedding index. A question is matched against the index, the closest chunks are retrieved and given to a language model with the question, and the model writes an answer that cites those chunks.',
    },
  },
  {
    id: 'diffusion',
    name: 'Generative image and video models',
    match: /\b(diffusion|text[- ]to[- ](image|video|3d)|image generation|video generation|generative (image|video|art)|stable diffusion|flux|comfyui|inpaint\w*|gaussian splat\w*)\b/i,
    problem: 'Making an image or video used to require drawing, filming or 3D modelling every frame by hand.',
    simple: [
      'You describe a picture in words and the AI produces one. It starts from random speckles, like TV static, and cleans them up a little at a time until a picture matching the description appears.',
    ],
    analogy: 'It is like a sculptor starting with a rough block and removing a little material at each pass until the shape described is left.',
    analogyLimit: 'A sculptor has a plan and knows what a hand looks like. The model only follows statistical patterns, which is why it can produce extra fingers or text that is not real writing.',
    how: [
      'The text prompt is converted into numbers by a text encoder.',
      'Starting from random noise, a neural network repeatedly predicts and removes a bit of noise, steered by the prompt, over a series of steps.',
      'Most systems do this in a compressed form of the image and decode the result to full-size pixels at the end.',
    ],
    deep: [
      'Latent diffusion pairs an autoencoder with a denoising network (a U-Net or a transformer). Guidance strength trades prompt adherence against variety.',
      'Video models add consistency across frames, which multiplies compute and is where most visible artefacts come from.',
      'Outputs reflect the training data, including its biases and its copyright questions.',
    ],
    realWorld: [
      'Used for concept art, advertising drafts, editing tools and stock imagery.',
      'Running locally needs a capable graphics card. Hosted services charge per image or per second of video.',
    ],
    diagram: {
      type: 'process',
      title: 'From noise to picture',
      nodes: [
        { id: 'prompt', label: 'Text prompt', kind: 'input', detail: 'The description of the picture wanted.' },
        { id: 'encode', label: 'Text encoder', kind: 'model', detail: 'Turns the words into numbers that steer generation.' },
        { id: 'noise', label: 'Random noise', kind: 'input', detail: 'Every image starts as random static.' },
        { id: 'denoise', label: 'Remove noise, step by step', kind: 'model', detail: 'A network removes a little noise each step, guided by the prompt.' },
        { id: 'decode', label: 'Decode to pixels', kind: 'process', detail: 'The compressed result is expanded into a full image.' },
        { id: 'image', label: 'Generated image', kind: 'output', detail: 'A new image. It is not a photograph of anything real.' },
      ],
      edges: [
        { from: 'prompt', to: 'encode' }, { from: 'encode', to: 'denoise' }, { from: 'noise', to: 'denoise' },
        { from: 'denoise', to: 'decode' }, { from: 'decode', to: 'image' },
      ],
      steps: [
        { id: 'prompt', title: 'The prompt is encoded', description: 'Words become numbers the image model can use.', focus: ['prompt', 'encode'] },
        { id: 'noise', title: 'Start from noise', description: 'Generation begins with random static.', focus: ['noise', 'denoise'] },
        { id: 'denoise', title: 'Clean up, many times', description: 'Each pass removes some noise in the direction of the prompt.', focus: ['encode', 'denoise'] },
        { id: 'decode', title: 'Decode the result', description: 'The finished compressed image is turned into pixels.', focus: ['denoise', 'decode', 'image'] },
      ],
      textAlternative: 'A text prompt is encoded into numbers. Starting from random noise, a model removes noise over many steps guided by the prompt, and the result is decoded into a generated image.',
    },
  },
  {
    id: 'speech',
    name: 'Speech AI',
    match: /\b(speech (recognition|synthesis|to text)|text[- ]to[- ]speech|tts|asr|voice (clon\w+|assistant|agent|model)|transcri\w+|whisper)\b/i,
    problem: 'Computers work with text, but people talk. Turning speech into text and back again accurately, across accents and noise, was unreliable for decades.',
    simple: [
      'Speech AI lets a computer write down what someone says, or read text aloud in a natural-sounding voice.',
    ],
    analogy: 'One half is a very fast typist who writes down everything it hears; the other half is a narrator who reads a script aloud.',
    analogyLimit: 'A typist asks when something is unclear. A speech model always outputs something, so on poor audio it can write down words that were never said.',
    how: [
      'Recognition: the sound wave is converted into a picture of frequencies over time, and a neural network turns that into text.',
      'Synthesis: text is turned into a sequence of sound features, and a second network converts those into an audio waveform.',
    ],
    deep: [
      'Modern recognisers are encoder-decoder or transducer transformers trained on very large amounts of loosely labelled audio. Word error rate is the standard metric and varies by language, accent and noise.',
      'Synthesis systems use an acoustic model plus a vocoder, or generate audio tokens directly. Voice cloning from short samples raises consent and fraud concerns.',
    ],
    realWorld: [
      'Used for captions, meeting notes, call centres, accessibility tools and voice assistants.',
      'Real-time use adds latency constraints; on-device models trade some accuracy for privacy and speed.',
    ],
    diagram: {
      type: 'flow',
      title: 'Speech in, speech out',
      nodes: [
        { id: 'audio', label: 'Spoken audio', kind: 'input', detail: 'A sound wave from a microphone or a file.' },
        { id: 'features', label: 'Sound features', kind: 'process', detail: 'The wave is converted into frequencies over time.' },
        { id: 'asr', label: 'Recognition model', kind: 'model', detail: 'Predicts the most likely words for those sounds.' },
        { id: 'text', label: 'Text', kind: 'output', detail: 'The transcript. It can then be processed like any other text.' },
        { id: 'tts', label: 'Synthesis model', kind: 'model', detail: 'Turns text into sound features and then into a waveform.' },
        { id: 'voice', label: 'Generated speech', kind: 'output', detail: 'Audio produced by the model, not a recording of a person.' },
      ],
      edges: [{ from: 'audio', to: 'features' }, { from: 'features', to: 'asr' }, { from: 'asr', to: 'text' }, { from: 'text', to: 'tts' }, { from: 'tts', to: 'voice' }],
      steps: [
        { id: 'listen', title: 'Sound is captured', description: 'Audio is converted into a form a network can read.', focus: ['audio', 'features'] },
        { id: 'recognise', title: 'Words are recognised', description: 'The model predicts the text that best matches the sounds.', focus: ['features', 'asr', 'text'] },
        { id: 'speak', title: 'Text is spoken', description: 'A synthesis model produces a new waveform from text.', focus: ['text', 'tts', 'voice'] },
      ],
      textAlternative: 'Spoken audio is converted into sound features, a recognition model turns them into text, and a synthesis model can turn text back into generated speech.',
    },
  },
  {
    id: 'robotics',
    name: 'Robot sensing and decision-making',
    match: /\b(robot(s|ics|ic)?|humanoid|quadruped|manipulat(or|ion)|embodied|teleoperat\w+|autonomous (vehicle|driving)\w*|self[- ]driving|drone)\b/i,
    problem: 'Robots in factories repeat one fixed motion. Outside that setting, they have to cope with objects and places that are different every time.',
    simple: [
      'A robot uses cameras and other sensors to see what is around it, decides what to do, moves, and then looks again to check what happened.',
      'It repeats this many times a second.',
    ],
    analogy: 'It is like catching a ball: you watch it, predict where it will be, move your hand, and keep adjusting as it gets closer.',
    analogyLimit: 'People adapt instantly to things they have never seen. A robot trained in one setting often fails when lighting, objects or surfaces change.',
    how: [
      'Sensors such as cameras, depth sensors and joint encoders produce readings.',
      'Perception software or a learned model turns the readings into an understanding of the scene, and a planner or policy chooses the next motion.',
      'Motor commands are sent, the world changes, and new sensor readings close the loop. A person can supervise or take over.',
    ],
    deep: [
      'Classical stacks separate perception, state estimation, planning and control. Learned approaches train a policy that maps observations to actions, by imitation from demonstrations or by reinforcement learning, often in simulation first.',
      'Vision-language-action models add a language-conditioned policy on top of a pretrained vision-language model. The gap between simulation and real hardware remains a central difficulty.',
      'Safety relies on low-level controllers, force limits and emergency stops that work independently of the learned parts.',
    ],
    realWorld: [
      'Reliable today in structured settings: warehouses, inspection, some surgery assistance under direct human control.',
      'General-purpose home robots are still research. Demonstration videos are often teleoperated or selected from many attempts; check which.',
    ],
    diagram: {
      type: 'flow',
      title: 'Sense, decide, act',
      nodes: [
        { id: 'sense', label: 'Sensors', kind: 'input', detail: 'Cameras, depth sensors, touch and joint position readings.' },
        { id: 'perceive', label: 'Perception', kind: 'model', detail: 'Works out what is in the scene and where.' },
        { id: 'decide', label: 'Decide next motion', kind: 'decision', detail: 'A planner or learned policy picks the next movement.' },
        { id: 'act', label: 'Motors', kind: 'tool', detail: 'Commands are sent to the joints or wheels.' },
        { id: 'world', label: 'The world changes', kind: 'process', detail: 'The action has an effect, which the sensors then pick up.' },
        { id: 'human', label: 'Human supervision', kind: 'human', detail: 'A person monitors, and can stop or take control.' },
      ],
      edges: [
        { from: 'sense', to: 'perceive' }, { from: 'perceive', to: 'decide' }, { from: 'decide', to: 'act' }, { from: 'act', to: 'world' },
        { from: 'world', to: 'sense', kind: 'feedback', label: 'sense again' }, { from: 'human', to: 'decide', kind: 'approval', label: 'can override' },
      ],
      steps: [
        { id: 'sense', title: 'Sense', description: 'The robot reads its cameras and sensors.', focus: ['sense', 'perceive'] },
        { id: 'decide', title: 'Decide', description: 'It chooses the next small movement.', focus: ['perceive', 'decide'] },
        { id: 'act', title: 'Act', description: 'Motors carry out the movement.', focus: ['decide', 'act', 'world'] },
        { id: 'loop', title: 'Check and repeat', description: 'New readings show what happened, and the loop runs again.', focus: ['world', 'sense'] },
        { id: 'human', title: 'A person stays in charge', description: 'Supervision and an independent stop are part of the system.', focus: ['human', 'decide'] },
      ],
      textAlternative: 'Sensors feed a perception stage, a planner or policy decides the next motion, motors act, the world changes, and the sensors read again in a continuous loop under human supervision.',
    },
  },
  {
    id: 'emulation',
    name: 'Running software where it was never meant to run',
    match: /\b(emulat(or|ion|es|ed|ing)|webassembly|wasm|recompil\w+|decompil\w+|reverse[- ]engineer\w*|compatibility layer|native port|runs? in (the|a|your) browser|browser[- ]based)\b/i,
    problem: 'Software is built for one kind of machine. A game for an old console, or a desktop program, will not run on a different device or inside a web page as it is.',
    simple: [
      'There are a few ways to make a program run somewhere new. One is to build a pretend version of the old machine in software. Another is to translate the program itself. A third is to run it on a powerful computer far away and just send you the picture.',
      'From the outside these can look the same, but they work very differently.',
    ],
    analogy: 'To watch a foreign film you can hire a live interpreter (emulation), read a translated script (porting or recompiling), or watch someone else watching it over a video call (streaming).',
    analogyLimit: 'A film has no timing requirements. Software does: a pretend machine must copy the timing quirks of the original hardware, which is why emulation can be slow or subtly wrong.',
    how: [
      'Emulation: a program imitates the original processor and hardware, reading the original software instruction by instruction and performing the equivalent on the new machine.',
      'Porting or recompilation: the program is rebuilt for the new target, for example compiled to WebAssembly so a browser can run it at near-native speed.',
      'Streaming: the software runs on a remote computer, which sends video to you and receives your key presses. Nothing runs on your device.',
    ],
    deep: [
      'Emulators use interpreters or just-in-time recompilers for the CPU and must model graphics, audio and timing hardware. Accuracy and speed pull in opposite directions.',
      'Static recompilation and decompilation convert the original binary or recovered source into code for the new target. WebAssembly gives browsers a sandboxed, portable compilation target with access to graphics through WebGL or WebGPU.',
      'Streaming moves the cost to servers and adds network latency. Legal questions (firmware, game files, clean-room rules for reverse engineering) differ for each approach.',
    ],
    realWorld: [
      'Used for game preservation, running desktop tools in a browser, and moving old software to new hardware.',
      'When a demo claims something "runs in the browser", ask which of the three it is. They differ in what your device needs, what it costs to host and whether it works offline.',
    ],
    diagram: {
      type: 'comparison',
      title: 'Three ways to run it somewhere new',
      nodes: [],
      edges: [],
      columns: [
        { title: 'Emulation', points: ['A software copy of the original machine', 'Runs the original program unchanged', 'Works offline', 'Slower: every instruction is translated as it runs'] },
        { title: 'Port or recompile', points: ['The program is rebuilt for the new target', 'Near-native speed, for example via WebAssembly', 'Works offline', 'Needs the source or a decompilation effort'] },
        { title: 'Streaming', points: ['Runs on a remote computer', 'Your device only shows video', 'Needs a fast connection', 'Hosting cost for every user'] },
      ],
      steps: [
        { id: 'emulate', title: 'Emulation', description: 'Imitate the old machine so the original program runs as it is.', focus: [] },
        { id: 'port', title: 'Port or recompile', description: 'Rebuild the program for the new place it should run.', focus: [] },
        { id: 'stream', title: 'Streaming', description: 'Run it elsewhere and send only the picture.', focus: [] },
      ],
      textAlternative: 'Three approaches compared. Emulation imitates the original machine and runs the program unchanged but slower. Porting or recompiling rebuilds the program for the new target at near-native speed. Streaming runs it on a remote computer and sends video, which needs a fast connection.',
    },
  },
  {
    id: 'model-release',
    name: 'A new AI model',
    match: /\b(open[- ]weights?|model release|new model|foundation model|language model|llms?|vlm|multimodal model|gguf|quantiz\w+|fine[- ]?tun\w+|parameters?\b|checkpoint)\b/i,
    problem: 'Each new model is announced with claims about what it can do. It is hard to tell what is actually different and what has only been measured by its makers.',
    simple: [
      'An AI model is a very large table of numbers that was adjusted, by showing it huge amounts of examples, until it became good at predicting what comes next.',
      'A new model usually means a bigger or better-trained table, sometimes one that can also read images or sound, not only text.',
    ],
    analogy: 'Training is like years of schooling; using the model is like sitting an exam afterwards. The learning has stopped, and it answers from what it absorbed.',
    analogyLimit: 'A student can say "I do not know". A model always produces a likely-sounding answer, and does not learn anything new from your conversation unless it is retrained.',
    how: [
      'Training: the model reads vast amounts of data and its numbers (parameters) are nudged, billions of times, to reduce prediction errors. This is done once, at great cost.',
      'Inference: your input is split into tokens, passed through the fixed network, and the model outputs one token at a time.',
      'Models can be adapted afterwards by fine-tuning on smaller data, or compressed (quantised) to run on cheaper hardware.',
    ],
    deep: [
      'Most current models are transformers. Differences between releases come from data, scale, training method and post-training, and vendors rarely disclose all of these.',
      'Benchmarks published by the maker are claims until others reproduce them. Test-set contamination and selective reporting are common problems.',
      'Open weights means the parameters can be downloaded; it does not necessarily mean open training data or an open-source licence. Check the licence terms.',
    ],
    realWorld: [
      'What matters in practice: licence, price, context length, speed, supported inputs, and results on your own tasks rather than on headline benchmarks.',
      'Closed models are used through an API. Open-weight models can be run on your own hardware, which costs engineering effort but keeps data in-house.',
    ],
    diagram: {
      type: 'flow',
      title: 'Training once, then inference many times',
      nodes: [
        { id: 'data', label: 'Training data', kind: 'store', detail: 'Text, images or audio the model learns from. Often not fully disclosed.' },
        { id: 'train', label: 'Training', kind: 'process', detail: 'Parameters are adjusted to reduce prediction error. Done once, expensively.' },
        { id: 'weights', label: 'Model weights', kind: 'model', detail: 'The finished table of numbers. Fixed after training.' },
        { id: 'input', label: 'Your input', kind: 'input', detail: 'Text, and for some models images or audio, split into tokens.' },
        { id: 'infer', label: 'Inference', kind: 'process', detail: 'The input passes through the fixed network.' },
        { id: 'output', label: 'Generated output', kind: 'output', detail: 'Produced one token at a time. Plausible, not guaranteed correct.' },
      ],
      edges: [{ from: 'data', to: 'train' }, { from: 'train', to: 'weights' }, { from: 'weights', to: 'infer' }, { from: 'input', to: 'infer' }, { from: 'infer', to: 'output' }],
      steps: [
        { id: 'train', title: 'Training happens first', description: 'The model learns patterns from a very large dataset.', focus: ['data', 'train', 'weights'] },
        { id: 'freeze', title: 'The weights are fixed', description: 'After training, the model no longer changes as you use it.', focus: ['weights'] },
        { id: 'infer', title: 'You send an input', description: 'Your text or image goes through the fixed network.', focus: ['input', 'infer', 'weights'] },
        { id: 'output', title: 'It generates an output', description: 'The answer is predicted piece by piece.', focus: ['infer', 'output'] },
      ],
      textAlternative: 'Training data is used once to train the model and produce fixed weights. At inference, a user input passes through those weights and the model generates an output one token at a time.',
    },
  },
  {
    id: 'research-method',
    name: 'How a research result becomes established',
    match: /\b(we (propose|introduce|present)|this paper|arxiv|preprint|benchmark|ablation|state of the art|peer[- ]review\w*)\b/i,
    problem: 'A new paper can claim a breakthrough the day it is posted. Whether the claim holds up is only known later.',
    simple: [
      'Scientists write up an idea and the tests they ran. Posting it online lets everyone read it straight away, but at that point nobody else has checked it.',
      'It becomes trustworthy when other experts review it and other teams get the same results.',
    ],
    analogy: 'A preprint is like a recipe someone has just posted: it may be excellent, but you only know after other cooks have tried it and got the same dish.',
    analogyLimit: 'A recipe is easy to try. Reproducing a paper can need data, code and computing power that were never released.',
    how: [
      'Researchers state a hypothesis, build a method, and test it against baselines on benchmark datasets.',
      'They post a preprint. Peer review by a venue may follow, and may require changes.',
      'Independent groups try to reproduce or build on the result. Only then is it considered established.',
    ],
    deep: [
      'Check what was compared and against which baselines, whether ablations isolate the claimed cause, whether code and data are released, and whether the evaluation data could have leaked into training.',
      'Peer review assesses plausibility and method. It does not rerun experiments, so acceptance is not the same as replication.',
    ],
    realWorld: [
      'Most preprints are incremental. A few change the field, usually visible later through replication and adoption rather than at posting time.',
    ],
    diagram: {
      type: 'timeline',
      title: 'From claim to established result',
      nodes: [
        { id: 'idea', label: 'Hypothesis', kind: 'input', detail: 'What the authors think will work, and why.' },
        { id: 'experiment', label: 'Experiments', kind: 'process', detail: 'The method is tested against baselines.' },
        { id: 'preprint', label: 'Preprint posted', kind: 'output', detail: 'Public, but not yet checked by anyone else.' },
        { id: 'review', label: 'Peer review', kind: 'human', detail: 'Experts assess the method and claims. They do not rerun the experiments.' },
        { id: 'replicate', label: 'Independent replication', kind: 'decision', detail: 'Other teams get the same result, or fail to.' },
        { id: 'established', label: 'Established', kind: 'output', detail: 'Others build on it and it holds up.' },
      ],
      edges: [{ from: 'idea', to: 'experiment' }, { from: 'experiment', to: 'preprint' }, { from: 'preprint', to: 'review' }, { from: 'review', to: 'replicate' }, { from: 'replicate', to: 'established' }],
      steps: [
        { id: 'claim', title: 'A claim is made', description: 'Hypothesis and experiments by one team.', focus: ['idea', 'experiment'] },
        { id: 'preprint', title: 'It is posted as a preprint', description: 'Anyone can read it. No one has verified it yet.', focus: ['preprint'] },
        { id: 'review', title: 'Experts review it', description: 'Review checks reasoning and method.', focus: ['review'] },
        { id: 'replicate', title: 'Others reproduce it', description: 'Replication is what turns a claim into a result.', focus: ['replicate', 'established'] },
      ],
      textAlternative: 'A timeline: a hypothesis is tested in experiments and posted as a preprint, then assessed in peer review, then independently replicated, and only then considered established.',
    },
  },
  {
    id: 'api-tool',
    name: 'Developer tools and APIs',
    match: /\b(cli|sdk|api|compiler|framework|library|runtime|database|devtool\w*|developer tool\w*|self[- ]host\w*|open[- ]source)\b/i,
    problem: 'Software is built from many parts that have to talk to each other. Doing that by hand each time is slow and error-prone.',
    simple: [
      'Most software is built from ready-made parts. A developer tool or library is one of those parts: it does one job so that other programmers do not have to write it again.',
      'Programs talk to each other through an API, which is an agreed list of requests one program can make of another.',
    ],
    analogy: 'An API is like a restaurant menu: you choose from a fixed list, the kitchen does the work, and you get the dish without seeing how it was made.',
    analogyLimit: 'A waiter can handle an unusual request. An API accepts only exactly what it defines, and returns an error for anything else.',
    how: [
      'A program sends a request in an agreed format to another program or service.',
      'The receiving side checks the request, does the work, often reading or writing stored data, and sends back a response or an error.',
      'The caller handles the response, and retries or reports the problem if something failed.',
    ],
    deep: [
      'What separates dependable tools from demos: versioned interfaces, tests, clear error behaviour, documentation, a licence that permits your use, and maintainers who respond to issues.',
      'Self-hosted open-source alternatives trade subscription cost for the work of running, securing and updating the software yourself.',
    ],
    realWorld: [
      'Before adopting a new tool, check its licence, release history, open issues and whether more than one person maintains it.',
    ],
    diagram: {
      type: 'flow',
      title: 'A request and its response',
      nodes: [
        { id: 'client', label: 'Your program', kind: 'input', detail: 'The code that needs something done.' },
        { id: 'request', label: 'Request', kind: 'process', detail: 'A message in the format the API defines.' },
        { id: 'service', label: 'Tool or service', kind: 'tool', detail: 'Validates the request and does the work.' },
        { id: 'data', label: 'Stored data', kind: 'store', detail: 'Read or updated as part of the work.' },
        { id: 'response', label: 'Response or error', kind: 'output', detail: 'The result, or a clear reason it failed.' },
      ],
      edges: [
        { from: 'client', to: 'request' }, { from: 'request', to: 'service' }, { from: 'service', to: 'data' }, { from: 'service', to: 'response' },
        { from: 'response', to: 'client', kind: 'retry', label: 'retry on failure' },
      ],
      steps: [
        { id: 'call', title: 'A request is sent', description: 'Your program asks for something in the agreed format.', focus: ['client', 'request'] },
        { id: 'work', title: 'The service does the work', description: 'It checks the request and reads or writes data.', focus: ['request', 'service', 'data'] },
        { id: 'reply', title: 'A response comes back', description: 'Either the result or an error.', focus: ['service', 'response'] },
        { id: 'retry', title: 'Failures are handled', description: 'The caller retries or reports the problem.', focus: ['response', 'client'] },
      ],
      textAlternative: 'A program sends a request to a tool or service, which validates it, reads or writes stored data and returns a response or an error. On failure the caller can retry.',
    },
  },
];

const GENERIC = new Set(['model-release', 'api-tool', 'emulation', 'research-method']);
const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));
export const conceptById = (id: string | null | undefined): Concept | null => (id ? BY_ID.get(id) ?? null : null);

/**
 * Picks the concept for an item. The title and description decide first, so a
 * passing mention deep in a README cannot override what the project says it is.
 */
export function detectConcept(input: { headline: string; text: string; kind: string }): string | null {
  // A paper about a domain gets that domain's explainer; otherwise it gets the research-process one.
  const pool = input.kind === 'paper' ? CONCEPTS.filter((c) => !GENERIC.has(c.id)) : CONCEPTS;
  for (const text of [input.headline, input.text]) {
    const hit = pool.find((c) => c.match.test(text));
    if (hit) return hit.id;
  }
  if (input.kind === 'model') return 'model-release';
  if (input.kind === 'paper') return 'research-method';
  return null;
}
