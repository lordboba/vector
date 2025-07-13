import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    console.log('✅ 911 API CALLED. Payload:', JSON.stringify(payload, null, 2));
    
    // Forward the call to the 911 agent
    const url = new URL(request.url);
    const agentUrl = `${url.protocol}//${url.host}/api/911-agent`;

    console.log(`✅ Calling 911 Agent at: ${agentUrl}`);

    const agentResponse = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!agentResponse.ok) {
      throw new Error(`911 Agent call failed with status: ${agentResponse.status}`);
    }

    const agentData = await agentResponse.json();
    
    return NextResponse.json(agentData);
  } catch (error) {
    console.error('Error processing 911 call:', error);
    return NextResponse.json({ message: 'Error processing request', error: (error as Error).message }, { status: 500 });
  }
}