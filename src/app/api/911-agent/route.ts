import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  console.log('✅ 911 Agent called');
  // This agent just returns a constant JSON response.
  return NextResponse.json({ 
    status: 'dispatched',
    unit: 'Police Unit 123',
    eta_minutes: 5
  });
} 