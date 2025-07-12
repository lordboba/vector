'use client';

import dynamic from 'next/dynamic';

const SecurityCamera = dynamic(() => import('@/components/SecurityCamera'), {
  ssr: false,
  loading: () => <div className="h-screen w-screen flex items-center justify-center bg-gray-900 text-white">Loading Security Camera...</div>,
});

export default function Home() {
  return <SecurityCamera />;
}
