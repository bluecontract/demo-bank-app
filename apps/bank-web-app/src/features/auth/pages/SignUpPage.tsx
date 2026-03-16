import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignUpForm } from '../components/SignUpForm';

export const SignUpPage: React.FC = () => {
  const navigate = useNavigate();
  const [videoError, setVideoError] = useState(false);
  const [videoResetCounter, setVideoResetCounter] = useState(0);
  const paynoteDemoVideoSource =
    __PAYNOTE_DEMO_VIDEO_URL__ || '/assets/login-demo-placeholder.mp4';

  const handleSignUpSuccess = () => {
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl w-full space-y-12">
        <div className="grid gap-12 lg:gap-16 lg:grid-cols-[minmax(0,1fr),minmax(0,1.5fr)] items-start">
          <div className="max-w-md w-full space-y-8 mx-auto">
            <div>
              <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                Join My Synchrony
              </h1>
              <p className="mt-2 text-center text-sm text-gray-600">
                Create your account to get started
              </p>
            </div>

            <SignUpForm onSuccess={handleSignUpSuccess} />

            <div className="text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{' '}
                <button
                  onClick={() => navigate('/signin')}
                  className="font-medium text-emerald-600 hover:text-emerald-500"
                >
                  Sign in here
                </button>
              </p>
            </div>
          </div>

          <aside className="shadow-lg rounded-2xl bg-white/80 backdrop-blur border border-transparent p-6 lg:p-8 lg:mt-10">
            <div className="mt-2 overflow-hidden rounded-xl bg-black">
              {!videoError ? (
                <video
                  key={`${paynoteDemoVideoSource}-${videoResetCounter}`}
                  className="h-full w-full aspect-video object-cover"
                  controls
                  preload="metadata"
                  playsInline
                  poster="/assets/paynote-demo-poster.svg"
                  onError={() => setVideoError(true)}
                  onEnded={() => setVideoResetCounter(counter => counter + 1)}
                >
                  <source src={paynoteDemoVideoSource} type="video/mp4" />
                  Your browser does not support MP4 playback.
                </video>
              ) : (
                <div className="aspect-video flex items-center justify-center bg-black/70 px-6 text-center text-sm text-gray-200">
                  PayNote demo video is unavailable in this environment.
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
