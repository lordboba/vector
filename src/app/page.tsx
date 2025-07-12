import SecurityCamera from '@/components/SecurityCamera'

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Intelligent Security Camera</h1>
        <SecurityCamera />
      </div>
    </div>
  );
}
