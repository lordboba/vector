import { NextResponse } from 'next/server';
import Exa from 'exa-js';

const exa = new Exa(process.env.EXA_API_KEY);

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    console.log('✅ Notification API CALLED. Payload:', JSON.stringify(payload, null, 2));

    // Fire-and-forget Exa search
    (async () => {
      try {
        if (payload.package_info) {
          console.log('🔍 Performing Exa search for:', payload.package_info);
          const searchResponse = await exa.search(payload.package_info, {
            numResults: 5,
            type: 'neural'
          });
          console.log('✅ Exa search results:', JSON.stringify(searchResponse, null, 2));
        }
      } catch (exaError) {
        console.error('Error during Exa search:', exaError);
      }
    })();
    
    return NextResponse.json({ 
      message: 'Notification sent successfully.',
      received: payload 
    });
  } catch (error) {
    console.error('Error processing notification:', error);
    return NextResponse.json({ message: 'Error processing request', error: (error as Error).message }, { status: 500 });
  }
}