import { Link } from 'react-router-dom';
import './LandingPage.css';

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen bg-[#09090B] text-white">
      <header className="landing-nav mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
        <Link to="/" className="flex items-center gap-3" aria-label="SaudaSakshi home">
          <span className="landing-mark" aria-hidden="true"><span /></span>
          <span className="text-sm font-semibold tracking-tight">SaudaSakshi</span>
        </Link>
        <Link to="/app" className="landing-nav-link">Open the app <span aria-hidden="true">↗</span></Link>
      </header>

      <main>
        <section className="landing-hero mx-auto grid w-full max-w-6xl items-center gap-14 px-6 pb-24 pt-12 sm:px-10 md:grid-cols-[1fr_0.9fr] md:gap-16 md:pb-32 md:pt-20">
          <div className="landing-copy">
            <h1>Good work.<br /><span>Clear terms.</span></h1>
            <p>Turn a spoken agreement into a record you can both rely on.</p>
            <Link to="/app" className="landing-cta">Create an agreement <span aria-hidden="true">→</span></Link>
          </div>

          <div className="landing-visual">
            <img src="/landing-voice-screen.svg" alt="SaudaSakshi voice agreement screen with language detection, microphone, and transcript field" />
          </div>
        </section>

        <section className="landing-about mx-auto w-full max-w-6xl border-t border-[#27272A] px-6 py-10 sm:px-10 md:py-12">
          <p>Speak an agreement in Kannada, Hindi, Tamil, or English.</p>
          <p>SaudaSakshi turns it into clear work and payment terms.</p>
          <p>Review and confirm the details together.</p>
          <p>Track advances, verify payments, and set balance reminders.</p>
        </section>
      </main>

      <footer className="landing-footer mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 sm:px-10">
        <span>SaudaSakshi</span><span>From verbal agreements to verified payments.</span>
      </footer>
    </div>
  );
}
