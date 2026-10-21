/**
 * Live coach WebSocket bridge.
 *
 * Browser  <--ws-->  ORATOR server  <--wss-->  Gemini Live API
 *
 * The browser captures microphone audio as 16 kHz mono PCM (base64), the server
 * relays it to Gemini's Live API, and the model's audio reply is relayed back
 * for playback. Transcripts flow both ways so the UI can show the conversation.
 *
 * The browser also sends a local transcript + PCM buffer at the end of a take;
 * that is what the metrics engine analyses.
 */
import { WebSocketServer } from 'ws';
import { ai, MODELS } from './gemini.js';

const COACH_SYSTEM = `You are ORATOR, an elite executive public-speaking coach working live with a senior professional.

You are in a REAL-TIME VOICE session. The learner is speaking to you.

HOW TO COACH IN THIS FORMAT:
- Listen. The learner is practising a specific exercise.
- Your default move is ONE short, specific observation plus ONE drill, in under 30 words.
- Reference what they literally just said: "You said 'basically we improved things' - name the number."
- Correct the single highest-leverage thing. Not everything.
- Push back when they are avoiding the hard part. Say it plainly.
- Never flatter. If it was weak, say so in the first sentence.
- Use their vocabulary and their context.
- Keep responses tight: 2-4 sentences. This is a conversation, not a lecture.
- If they ask a question, answer it directly and concretely, then offer one drill.
- If they go quiet, prompt them: "Keep going - what is the point of this slide?"
- Never read out long bullet lists. Speak like a coach standing next to them.
`;

/** Build the live-session system instruction for a given exercise. */
export function buildCoachInstruction({ module, exercise, scenario, extra = '' }) {
  const parts = [COACH_SYSTEM];

  if (module) {
    parts.push(`\nCURRENT MODULE: "${module.title}" - ${module.subtitle}`);
    parts.push(`Module outcome: ${module.outcome}`);
    const fw = (module.frameworks || []).map(f => f.name).join(', ');
    if (fw) parts.push(`Frameworks in play for this module: ${fw}.`);
  }

  if (exercise) {
    parts.push(`\nTHE EXERCISE THEY ARE PRACTISING: "${exercise.title}"`);
    parts.push(`Instructions they were given: ${exercise.instructions}`);
    if (exercise.successCriteria?.length) {
      parts.push(`Success criteria: ${exercise.successCriteria.join(' | ')}`);
    }
    parts.push(`\nOpen the session by saying, in your own words: ${exercise.liveCoachPrompt}`);
    parts.push('Then let them begin. Do not monologue - wait for them to speak.');
  }

  if (scenario) {
    parts.push(`\nTHE SCENARIO: "${scenario.title}"`);
    parts.push(`Setting: ${scenario.setting}`);
    parts.push(`Challenge: ${scenario.challenge}`);
    parts.push(`Their objectives: ${(scenario.objectives || []).join('; ')}`);
    parts.push('Play the room realistically. Be the person who asked the question.');
  }

  if (extra) parts.push(`\n${extra}`);

  parts.push('\nBegin the session now. Speak first.');
  return parts.join('\n');
}

/**
 * Prebuilt voices available on gemini-3.1-flash-live-preview.
 * Puck is a bright, energetic voice - a good default for a coach.
 */
export const VOICES = ['Puck', 'Charon', 'Kore', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr'];
export const DEFAULT_VOICE = 'Puck';

/**
 * Attach the live coach to an HTTP server.
 * @param {import('http').Server} server
 */
export function attachLiveCoach(server, { path = '/live' } = {}) {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (ws) => {
    let session = null;
    let closed = false;
    let established = false;

    const send = (obj) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    };

    const teardown = () => {
      closed = true;
      if (session) { try { session.close(); } catch { /* already gone */ } session = null; }
    };
    ws.on('close', teardown);
    ws.on('error', teardown);

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      /* ---------------- start ---------------- */
      if (msg.type === 'start') {
        if (session) { try { session.close(); } catch { /* noop */ } }
        try {
          const config = {
            responseModalities: ['AUDIO'],
            systemInstruction: msg.systemInstruction || COACH_SYSTEM,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechThreshold: 0.5,
              endOfSpeechThreshold: 0.9,
              prefixPaddingMs: 300,
              silenceDurationMs: 700,
            },
            // NOTE: contextWindowCompression is deliberately NOT set. The API
            // rejects the token values this model expects and closes the socket
            // with no error payload, which looks identical to a network drop.
            // If compression is needed, validate the thresholds first.
          };
          // An explicit voice is REQUIRED for reliable audio output.
          // Measured on gemini-3.1-flash-live-preview (2026-10-21): with an
          // explicit prebuiltVoiceConfig the model returned audio on 6/6 runs;
          // without it, only 1/6 runs produced audio - the rest returned a
          // transcript with zero audio bytes and no error. The server silently
          // falls back to a non-audio response path, so this must always be set.
          const voice = msg.voice || DEFAULT_VOICE;
          config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };

          session = await ai.live.connect({
            model: MODELS.live,
            config,
            callbacks: {
              onopen: () => send({ type: 'ready' }),
              onerror: (e) => {
                const detail = e?.error?.message || e?.message || 'live session error';
                send({ type: 'error', message: String(detail).slice(0, 300) });
              },
              onclose: () => {
                // A close before the session was ever established is a config
                // rejection, not a normal end. Tell the client explicitly.
                if (!established) send({ type: 'error', message: 'Live session closed during setup - the model rejected the session configuration.' });
                else send({ type: 'closed' });
              },
              onmessage: (m) => {
                const sc = m.serverContent;
                if (m.setupComplete) { established = true; send({ type: 'ready' }); }
                if (!sc) return;

                // model audio out
                const parts = sc.modelTurn?.parts || [];
                for (const p of parts) {
                  if (p.inlineData?.data) {
                    send({ type: 'audio', pcm: p.inlineData.data, mimeType: p.inlineData.mimeType || 'audio/pcm;rate=16000' });
                  }
                }
                if (sc.outputTranscription?.text) {
                  send({ type: 'transcript', role: 'coach', text: sc.outputTranscription.text, final: !!sc.turnComplete });
                }
                if (sc.inputTranscription?.text) {
                  send({ type: 'transcript', role: 'user', text: sc.inputTranscription.text, final: !!sc.turnComplete });
                }
                if (sc.turnComplete) send({ type: 'turnComplete' });
                if (sc.interrupted) send({ type: 'interrupted' });
              },
            },
          });

          send({ type: 'connected', model: MODELS.live });

          // If the model never completes setup, surface it instead of hanging.
          const setupTimer = setTimeout(() => {
            if (!established) {
              send({ type: 'error', message: 'Live session setup timed out after 20s.' });
              try { session.close(); } catch { /* noop */ }
            }
          }, 20000);

          // Kick off the coach's opening line.
          if (msg.opening) {
            session.sendRealtimeInput({ text: msg.opening });
          }
          ws.once('close', () => clearTimeout(setupTimer));
        } catch (e) {
          send({ type: 'error', message: String(e.message || e).slice(0, 300) });
        }
        return;
      }

      /* ---------------- audio from browser ---------------- */
      if (msg.type === 'audio') {
        if (!session) return;
        try {
          session.sendRealtimeInput({
            audio: { data: msg.pcm, mimeType: msg.mimeType || 'audio/pcm;rate=16000' },
          });
        } catch (e) {
          send({ type: 'error', message: String(e.message || e).slice(0, 200) });
        }
        return;
      }

      /* ---------------- text from browser ---------------- */
      if (msg.type === 'text') {
        if (!session) return;
        try { session.sendRealtimeInput({ text: msg.text }); } catch { /* noop */ }
        return;
      }

      /* ---------------- update system instruction mid-session ---------------- */
      if (msg.type === 'updateInstruction') {
        if (!session) return;
        try {
          session.sendClientContent({
            turns: [{
              role: 'user',
              parts: [{ text: `[COACH NOTE] ${msg.instruction}` }],
            }],
            turnComplete: false,
          });
        } catch { /* noop */ }
        return;
      }

      /* ---------------- end of take: ask for the summary ---------------- */
      if (msg.type === 'finalize') {
        if (!session) return;
        try {
          session.sendRealtimeInput({ text: msg.prompt || 'Wrap up with one sentence of coaching.' });
        } catch { /* noop */ }
        return;
      }

      if (msg.type === 'stop') {
        teardown();
        send({ type: 'stopped' });
      }
    });
  });

  return wss;
}
