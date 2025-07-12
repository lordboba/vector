import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    console.log('911 called with payload:', payload);
    
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Error processing 911 call:', error);
    return NextResponse.json({ status: 'error' }, { status: 400 });
  }
}