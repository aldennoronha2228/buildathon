import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { api } from '../api.js';
import { AUTO_DETECT_ORDER, SCENARIOS, scenarioFor } from '../lib/scenarios.js';
import { detectLanguage } from '../lib/format.js';

/**
 * STEP 1 — Voice capture.
 *
 * Live mode (SARVAM_API_KEY set on the server): records the real microphone via
 * MediaRecorder and transcribes through the server proxy (POST /api/transcribe).
 * Demo mode (no key): cycles the scripted sample transcripts exactly like the MVP.
 * Typed input is always supported — language is detected from Unicode script ranges.
 */
export default function VoiceStep() {
  const { generateAgreement, pushToast, setLastDetected, setCardLang, capabilities } = useApp();
  const liveVoice = !!capabilities?.sarvamStt;

  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | listening | transcribing
  const [busy, setBusy] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const timersRef = useRef([]);
  const cycleRef = useRef(0);

  // Real-capture refs
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const tickerRef = useRef(null);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };
  useEffect(
    () => () => {
      clearTimers();
      clearInterval(tickerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const detected = transcript.trim().length >= 5 ? detectLanguage(transcript) : null;
  const detectedScenario = detected ? scenarioFor(detected) : null;

  /* ------------------------------ demo mode ------------------------------ */

  const stopDemo = (completedLang = null) => {
    clearTimers();
    setListening(false);
    setPhase('idle');
    if (completedLang) {
      setLastDetected({ code: completedLang, confidence: scenarioFor(completedLang).confidence });
      pushToast(`Captured in ${scenarioFor(completedLang).englishName}`);
    }
  };

  const startDemo = (forcedLang = null) => {
    clearTimers();
    const lang = forcedLang || AUTO_DETECT_ORDER[cycleRef.current % AUTO_DETECT_ORDER.length];
    cycleRef.current += 1;
    setListening(true);
    setPhase('listening');
    setTranscript('');
    setLastDetected(null);

    timersRef.current.push(
      setTimeout(() => {
        setPhase('transcribing');
        setLastDetected({ code: lang, confidence: scenarioFor(lang).confidence });
        const words = scenarioFor(lang).sample.split(' ');
        words.forEach((word, i) => {
          timersRef.current.push(
            setTimeout(() => {
              setTranscript((t) => (t ? t + ' ' : '') + word);
              if (i === words.length - 1) stopDemo(lang);
            }, i * 110)
          );
        });
      }, 650)
    );
  };

  /* ------------------------------ live mode ------------------------------ */

  const stopLive = () => {
    clearInterval(tickerRef.current);
    setRecordingSecs(0);
    recorderRef.current?.stop(); // onstop handler finishes the flow
  };

  const startLive = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        clearInterval(tickerRef.current);
        setRecordingSecs(0);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setListening(false);
        setPhase('transcribing');
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const { transcript: text } = await api.transcribe(blob);
          const clean = String(text || '').trim();
          if (!clean) {
            pushToast('Sarvam returned an empty transcript — try again');
          } else {
            setTranscript(clean);
            setLastDetected({ code: detectLanguage(clean), confidence: null });
            pushToast('Transcribed via Sarvam');
          }
        } catch (err) {
          pushToast(err.message);
        } finally {
          setPhase('idle');
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setListening(true);
      setPhase('recording');
      setTranscript('');
      setLastDetected(null);
      tickerRef.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000);
    } catch (err) {
      pushToast('Microphone unavailable: ' + (err.message || 'permission denied'));
    }
  };

  /* ------------------------------ shared ------------------------------ */

  const stop = () => (liveVoice ? stopLive() : stopDemo());
  const start = (forcedLang = null) => (liveVoice ? startLive() : startDemo(forcedLang));
  const onChip = (code) => start(code);
  const onGenerate = async () => {
    if (transcript.trim().length < 5) return;
    setBusy(true);
    try {
      const preset = Object.values(SCENARIOS).find((s) => s.sample === transcript.trim());
      await generateAgreement({
        transcript: transcript.trim(),
        service: preset?.serviceEn,
        serviceRegional: preset?.serviceRegional,
      });
      setCardLang('en');
    } catch (err) {
      pushToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const recLabel = `${Math.floor(recordingSecs / 60)}:${String(recordingSecs % 60).padStart(2, '0')}`;
  const statusText = listening
    ? liveVoice
      ? `Recording… ${recLabel}`
      : phase === 'listening'
        ? 'Listening & identifying language...'
        : null
    : phase === 'transcribing'
      ? 'Transcribing with Sarvam…'
      : detected
        ? null
        : 'Tap microphone & speak in any language';

  return (
    <div className="flex-1 flex flex-col justify-between screen-animate">
      <div>
        {/* Tagline & auto-detect pill */}
        <div className="text-center mt-2 mb-8">
          <h1 className="text-[22px] leading-snug font-semibold tracking-tight text-white">
            From Verbal Agreements
            <br />
            to Verified Payments.
          </h1>
          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#121215] border border-[#27272A] text-[11px] font-medium text-[#A1A1AA]">
            <span className={`w-1.5 h-1.5 rounded-full ${listening ? 'bg-white animate-pulse' : 'bg-white'}`} />
            <span>{liveVoice ? 'Sarvam STT Live • Speak in Kannada, Hindi, Tamil, or English' : 'Auto-Detect • Speak in Kannada, Hindi, Tamil, or English'}</span>
          </div>
        </div>

        {/* Microphone trigger */}
        <div className="flex flex-col items-center justify-center my-8">
          <div className="relative flex items-center justify-center">
            {listening && (
              <>
                <span className="absolute w-28 h-28 rounded-full border border-white/40 mic-ring-1 pointer-events-none" />
                <span className="absolute w-28 h-28 rounded-full border border-white/25 mic-ring-2 pointer-events-none" />
              </>
            )}
            <button
              onClick={() => (listening ? stop() : start())}
              className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg focus:outline-none active:scale-95 ${
                listening ? 'bg-[#18181B] border border-white' : 'bg-[#121215] border border-[#27272A] hover:border-zinc-400'
              }`}
              aria-label={listening ? 'Stop Voice Recording' : 'Toggle Voice Recording'}
            >
              {listening ? (
                <div className="w-6 h-6 rounded-md bg-white" />
              ) : (
                <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              )}
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full transition-colors ${
                listening || phase === 'transcribing' ? 'bg-white animate-pulse' : detected ? 'bg-white' : 'bg-[#27272A]'
              }`}
            />
            <span className="text-xs font-medium text-[#A1A1AA]">
              {statusText ||
                (listening
                  ? `Auto-Detected ${scenarioFor(detected || 'en').englishName} — transcribing...`
                  : `Captured in ${detectedScenario.englishName}. Ready to generate.`)}
            </span>
          </div>
        </div>

        {/* Transcript */}
        <div className="mt-6 bg-[#121215] border border-[#27272A] rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA]">Voice Transcript</span>
            {detectedScenario && !listening && phase !== 'transcribing' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-semibold text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                Auto-Detected: {detectedScenario.englishName}
                {detectedScenario.confidence ? ` (${detectedScenario.confidence} confidence)` : ''}
              </span>
            )}
          </div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={4}
            placeholder={
              liveVoice
                ? 'Tap the microphone and speak — Sarvam transcribes here. You can also type directly.'
                : 'Speak naturally in Kannada, Hindi, Tamil, or English... the transcript appears here. You can also type directly.'
            }
            className="w-full bg-transparent text-sm leading-relaxed text-white placeholder-zinc-600 focus:outline-none resize-none"
          />
        </div>

        {/* Quick demo chips (demo mode only) */}
        {!liveVoice && (
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2.5 px-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#A1A1AA]">Quick Demo Samples (Auto-Detect)</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {AUTO_DETECT_ORDER.map((code) => (
                <button
                  key={code}
                  onClick={() => onChip(code)}
                  className="py-2 px-2 rounded-lg bg-[#121215] border border-[#27272A] hover:border-zinc-500 text-[11px] font-medium text-zinc-300 hover:text-white transition-colors truncate"
                >
                  Test {code === 'en' ? 'EN' : scenarioFor(code).englishName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Generate CTA */}
      <div className="mt-8 pt-2">
        <button
          onClick={onGenerate}
          disabled={transcript.trim().length < 5 || busy}
          className="w-full py-3.5 px-5 rounded-xl bg-white text-[#09090B] font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-zinc-200 active:scale-[0.99] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg
            className={`w-4 h-4 animate-spin text-[#09090B] ${busy ? '' : 'hidden'}`}
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
          </svg>
          <span>{busy ? 'Extracting terms via AI...' : 'Generate Agreement'}</span>
          {!busy && (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
