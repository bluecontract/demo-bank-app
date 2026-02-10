import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HealthStatus } from '../../ui/HealthStatus';

export function HomePage() {
  const navigate = useNavigate();
  const [videoError, setVideoError] = useState(false);
  const [introVideoResetCounter, setIntroVideoResetCounter] = useState(0);
  const introVideoSource =
    __INTRO_VIDEO_URL__ || '/assets/login-demo-placeholder.mp4';

  const handleSignUpClick = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isE2E = urlParams.get('e2e') === 'true';
    const signupUrl = isE2E ? '/signup?e2e=true' : '/signup';
    navigate(signupUrl);
  };

  const handleSignInClick = () => {
    navigate('/signin');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto max-w-4xl px-4 py-16">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            My Synchrony
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            The end-to-end reference for modelling banking workflows using
            PayNotes and processing them through MyOS.
          </p>
        </header>

        <div className="max-w-4xl mx-auto space-y-10">
          <div className="grid gap-4 sm:grid-cols-3">
            <a
              href="https://github.com/bluecontract/demo-bank-app/"
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col items-center rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-md"
            >
              <span className="text-sm font-medium text-gray-800 group-hover:text-blue-600">
                View the Repository
              </span>
              <span className="mt-1 text-xs text-gray-500">github.com</span>
            </a>
            <a
              href="https://paynotes.blue/"
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col items-center rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-md"
            >
              <span className="text-sm font-medium text-gray-800 group-hover:text-blue-600">
                Learn about PayNotes
              </span>
              <span className="mt-1 text-xs text-gray-500">paynotes.blue</span>
            </a>
            <a
              href="https://myos.blue/"
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col items-center rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-md"
            >
              <span className="text-sm font-medium text-gray-800 group-hover:text-blue-600">
                Explore MyOS
              </span>
              <span className="mt-1 text-xs text-gray-500">myos.blue</span>
            </a>
          </div>

          <div className="mt-10 p-6 bg-white rounded-lg shadow-sm border">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4 text-center">
              Welcome
            </h2>
            <p className="text-center text-gray-600 mb-6">
              Configure an account, submit a PayNote, and let MyOS process it.
            </p>

            <div className="flex flex-wrap justify-center gap-4 mb-6">
              <button
                onClick={handleSignUpClick}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Sign Up
              </button>
              <button
                onClick={handleSignInClick}
                className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-medium transition-colors"
              >
                Sign In
              </button>
            </div>

            <div className="text-sm text-gray-500">
              <p>
                <span role="img" aria-label="Security">
                  🔐
                </span>{' '}
                Secure authentication system
              </p>
              <p>
                <span role="img" aria-label="Credit card">
                  💳
                </span>{' '}
                Account management features
              </p>
              <p>
                <span role="img" aria-label="Money">
                  💰
                </span>{' '}
                Transaction history and capture flows powered by PayNote and
                MyOS
              </p>
            </div>

            <div className="flex justify-center mt-8">
              <HealthStatus />
            </div>
          </div>

          <section className="rounded-2xl bg-black shadow-lg overflow-hidden">
            {!videoError ? (
              <video
                key={`${introVideoSource}-${introVideoResetCounter}`}
                className="h-full w-full aspect-video object-cover"
                controls
                preload="metadata"
                playsInline
                poster="/assets/intro-video-poster.svg"
                onError={() => setVideoError(true)}
                onEnded={() =>
                  setIntroVideoResetCounter(counter => counter + 1)
                }
              >
                <source src={introVideoSource} type="video/mp4" />
                Your browser does not support MP4 playback.
              </video>
            ) : (
              <div className="aspect-video flex items-center justify-center bg-black px-6 text-center text-sm text-gray-200">
                Demo video preview is unavailable in this environment.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
