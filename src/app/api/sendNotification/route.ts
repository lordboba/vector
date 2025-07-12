import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    console.log('Notification sent with payload:', payload);
    
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Error processing notification:', error);
    return NextResponse.json({ status: 'error' }, { status: 400 });
  }
}