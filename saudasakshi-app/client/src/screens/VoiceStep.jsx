import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { api } from '../api.js';
import { scenarioFor } from '../lib/scenarios.js';
import { detectLanguage } from '../lib/format.js';

/**
 * STEP 1 — Voice capture.
 *
 * Live mode (SARVAM_API_KEY set on the server): records the real microphone via
 * MediaRecorder and transcribes through the server proxy (POST /api/transcribe).
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

  // Real-capture refs
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const tickerRef = useRef(null);

  useEffect(
    () => () => {
      clearInterval(tickerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const detected = transcript.trim().length >= 5 ? detectLanguage(transcript) : null;
  const detectedScenario = detected ? scenarioFor(detected) : null;
  const canExtract = !!capabilities?.sarvamLlm;

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
          const recordingType = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: recordingType });
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
      let elapsed = 0;
      tickerRef.current = setInterval(() => {
        elapsed += 1;
        setRecordingSecs(elapsed);
        if (elapsed >= 29) {
          clearInterval(tickerRef.current);
          recorderRef.current?.stop();
          pushToast('Recording stopped before Sarvam’s 30-second limit');
        }
      }, 1000);
    } catch (err) {
      pushToast('Microphone unavailable: ' + (err.message || 'permission denied'));
    }
  };

  /* ------------------------------ shared ------------------------------ */

  const stop = () => stopLive();
  const start = () => liveVoice ? startLive() : pushToast('Voice transcription is not configured. Enter the transcript manually.');
  const onGenerate = async () => {
    if (transcript.trim().length < 5) return;
    setBusy(true);
    try {
      await generateAgreement({ transcript: transcript.trim() });
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
        : 'Enter an agreement transcript below';

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
            <span>{liveVoice ? 'Sarvam STT connected' : 'Sarvam STT not configured'}</span>
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
                : 'Type an agreement transcript here. Configure Sarvam STT on the server to use microphone transcription.'
            }
            className="w-full bg-transparent text-sm leading-relaxed text-white placeholder-zinc-600 focus:outline-none resize-none"
          />
        </div>

        {!canExtract && (
          <p className="mt-3 text-xs leading-relaxed text-amber-200">
            Sarvam LLM is not configured. Add SARVAM_API_KEY to the server environment and restart it to extract and save agreements.
          </p>
        )}

      </div>

      {/* Generate CTA */}
      <div className="mt-8 pt-2">
        <button
          onClick={onGenerate}
          disabled={transcript.trim().length < 5 || busy || !canExtract}
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
