import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    console.log('✅ Door API CALLED. Payload:', JSON.stringify(payload, null, 2));
    
    return NextResponse.json({ 
      message: `Door action '${payload.action}' received successfully.`,
      received: payload 
    });
  } catch (error) {
    console.error('Error processing door API call:', error);
    return NextResponse.json({ message: 'Error processing request', error: (error as Error).message }, { status: 500 });
  }
}