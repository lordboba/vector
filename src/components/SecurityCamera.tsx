'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, Tool, FunctionDeclaration } from '@google/genai';

// --- Type Definitions ---
interface Transcription {
  id: string;
  text: string;
  type: 'analysis' | 'tool-call' | 'tool-result' | 'error' | 'status';
}

type RiskLevel = 'SAFE' | 'WARNING' | 'DANGER';
type ConnectionStatus = 'Disconnected' | 'Connecting' | 'Connected' | 'Error';

// --- Tool Schemas ---
const call911Tool: FunctionDeclaration = {
  name: 'call911',
  description: 'Calls 911 in case of a major emergency like a fire or intruder.',
  parameters: {
    type: 'OBJECT',
    properties: {
      reason: {
        type: 'STRING',
        description: 'A detailed description of the emergency.',
      },
    },
    required: ['reason'],
  } as any,
};

const sendNotificationTool: FunctionDeclaration = {
  name: 'sendNotification',
  description: 'Sends a notification about a delivered package.',
  parameters: {
    type: 'OBJECT',
    properties: {
      package_size: {
        type: 'STRING',
        description: 'Estimated size of the package (e.g., small, medium, large).',
      },
      delivery_time: {
        type: 'STRING',
        description: 'The time of the delivery in ISO 8601 format.',
      },
    },
    required: ['package_size', 'delivery_time'],
  } as any,
};

const doorTool: FunctionDeclaration = {
  name: 'door',
  description: 'Controls a door, either opening or closing it.',
  parameters: {
    type: 'OBJECT',
    properties: {
      action: {
        type: 'STRING',
        description: 'The action to perform: "OPEN" or "CLOSE".',
      },
    },
    required: ['action'],
  } as any,
};

// --- Component ---
export default function SecurityCamera() {
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('SAFE');
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('Disconnected');
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const liveSessionRef = useRef<any>(null); // Live API session
  const responseQueueRef = useRef<any[]>([]);
  const isProcessingQueueRef = useRef(false);
  const isStreamingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // --- Utility Functions ---
  const addTranscription = useCallback((text: string, type: Transcription['type']) => {
    const id = `transcription-${Date.now()}-${Math.random()}`;
    setTranscriptions((prev) => [...prev, { id, text, type }]);
  }, []);

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // --- Live API Response Handling ---
  const processResponseQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || responseQueueRef.current.length === 0) {
      return;
    }
    isProcessingQueueRef.current = true;
    console.log(`[DEBUG] Processing queue. Size: ${responseQueueRef.current.length}`);

    while (responseQueueRef.current.length > 0) {
      const message = responseQueueRef.current.shift();
      if (!message) continue;

      try {
        if (message.serverContent?.modelTurn?.parts) {
          for (const part of message.serverContent.modelTurn.parts) {
            if (part.text) {
              addTranscription(part.text, 'analysis');
              const lowerText = part.text.toLowerCase();
              if (lowerText.includes('danger')) setRiskLevel('DANGER');
              else if (lowerText.includes('warning')) setRiskLevel('WARNING');
            } else if (part.functionCall) {
              await handleToolCall(part.functionCall.name, part.functionCall.args);
            }
          }
        }
      } catch (e: any) {
        const errorMessage = `Error processing API response: ${e.message}`;
        console.error(errorMessage, e);
        setError(errorMessage);
        addTranscription(errorMessage, 'error');
      }
    }

    isProcessingQueueRef.current = false;
  }, [addTranscription]);

  // --- Tool Implementations ---
  const toolImplementations: { [key: string]: (args: any) => Promise<any> } = {
    call911: async (args: { reason: string }) => {
      setRiskLevel('DANGER');
      const response = await fetch('/api/call911', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      return await response.json();
    },
    sendNotification: async (args: { package_size: string, delivery_time: string }) => {
      setRiskLevel('WARNING');
      const response = await fetch('/api/sendNotification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      return await response.json();
    },
    door: async (args: { action: 'OPEN' | 'CLOSE' }) => {
      const response = await fetch('/api/door', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      return await response.json();
    },
  };

  const handleToolCall = async (toolName: string, args: any) => {
    addTranscription(`Tool call: ${toolName}(${JSON.stringify(args)})`, 'tool-call');
    const implementation = toolImplementations[toolName];
    if (!implementation) {
      const errorMsg = `Error: Tool '${toolName}' not found.`;
      addTranscription(errorMsg, 'error');
      console.error(errorMsg);
      return;
    }
    try {
      const result = await implementation(args);
      addTranscription(`Tool result: ${result.message || JSON.stringify(result)}`, 'tool-result');
      // The Live API does not currently support sending tool results back to the model.
    } catch (e: any) {
      const errorMsg = `Error executing tool '${toolName}': ${e.message}`;
      addTranscription(errorMsg, 'error');
      console.error(errorMsg, e);
    }
  };

  // --- Core Streaming Logic ---
  const captureAndSendAudio = useCallback(async (event: AudioProcessingEvent) => {
    if (!isStreamingRef.current || !liveSessionRef.current) {
      return;
    }

    const inputData = event.inputBuffer.getChannelData(0);
    const targetSampleRate = 16000;
    const sourceSampleRate = event.inputBuffer.sampleRate;
    
    // Simple downsampling
    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputData.length; i++) {
        accum += inputData[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }

    // Convert to 16-bit PCM
    const pcmData = new Int16Array(result.length);
    for (let i = 0; i < result.length; i++) {
      let s = Math.max(-1, Math.min(1, result[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      pcmData[i] = s;
    }

    // Convert to base64
    const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData.buffer) as any));

    try {
      await liveSessionRef.current.sendRealtimeInput({
        audio: { data: base64Audio, mimeType: 'audio/pcm;rate=16000' },
      });
    } catch (e: any) {
      // Don't log every audio error to avoid spamming the user
      console.error(`Failed to send audio chunk: ${e.message}`);
    }
  }, []);

  const captureAndSendFrame = useCallback(async () => {
    if (!isStreamingRef.current || !liveSessionRef.current) {
        return;
    }

    if (!videoRef.current || videoRef.current.readyState < 2) {
        console.log(`[DEBUG] Video not ready. State: ${videoRef.current?.readyState}`);
        return;
    }
    
    console.log(`[DEBUG] Capturing frame. Video dimensions: ${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
  
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg'));
  
    if (blob) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          await liveSessionRef.current.sendRealtimeInput({
            image: { data: base64Data, mimeType: 'image/jpeg' },
          });
          console.log('[DEBUG] Frame sent to Live API.');
        } catch (e: any) {
          const errorMsg = `Failed to send video frame: ${e.message}`;
          console.error(errorMsg, e);
          setError(errorMsg);
          addTranscription(errorMsg, 'error');
          // Don't stop streaming for a single failed frame
        }
      };
      reader.readAsDataURL(blob);
    }
  }, []);

  const stopStreaming = useCallback(() => {
    isStreamingRef.current = false;
    setStatus('Disconnected');

    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    responseQueueRef.current = [];
    isProcessingQueueRef.current = false;
    addTranscription('Security feed stopped.', 'status');
  }, [addTranscription]);


  const handleStreamToggle = async () => {
    if (isStreamingRef.current) {
      stopStreaming();
      return;
    }

    setError(null);
    setStatus('Connecting');
    isStreamingRef.current = true;
    addTranscription('Starting security feed...', 'status');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // --- Set up Audio Processing ---
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      scriptProcessor.onaudioprocess = captureAndSendAudio;
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      // --- End Audio Processing Setup ---

      const genAI = new GoogleGenAI({apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY!});

      const config = {
        responseModalities: [Modality.TEXT],
        systemInstruction: `You are Sentinel AI, a security guard for a live demonstration. Your primary goal is to demonstrate your capabilities by reacting to simulated events.

**DEMO INSTRUCTIONS:**
*   **Treat all inputs as real:** You MUST react to acted scenarios, verbal threats, and test events as if they are genuine security risks.
*   **Be decisive:** Act according to the rules below without hesitation. Your analysis must be concise and clear for the demo.

**Your Task:**
1.  Analyze the combined video and audio feed.
2.  Describe observations in short, factual statements.
3.  Evaluate the risk level based on the rules below.
4.  Use tools immediately when conditions are met.

**Risk Levels & Triggers:**
*   **SAFE:** The default state. No activity or normal passersby.
*   **WARNING:** A situation requiring attention. Trigger IMMEDIATELY for:
    *   A person loitering or peering into windows.
    *   Any package delivery.
    *   Any mention of violence, threats (e.g., "I'm going to break in"), or aggressive shouting.
    *   A car alarm or dog barking continuously.
*   **DANGER:** An immediate threat. Trigger IMMEDIATELY for:
    *   Seeing fire, smoke, or a weapon.
    *   Seeing someone attempting to force a door or window.
    *   Hearing glass shatter, an explosion, or a direct physical attack.

**Tool Rules:**
*   \`sendNotification\`: Use ONLY for a package delivery (sets WARNING).
*   \`call911\`: Use ONLY for a DANGER-level event. State the exact reason in the \`reason\` parameter.`,
        toolConfig: {
          functionDeclarations: [call911Tool, sendNotificationTool, doorTool],
        },
      };

      liveSessionRef.current = await genAI.live.connect({
        model: 'gemini-live-2.5-flash-preview',
        config: config,
        callbacks: {
          onopen: () => {
            setStatus('Connected');
            addTranscription('Live connection opened.', 'status');
          },
          onmessage: (message) => {
            console.log('[DEBUG] Message received from server:', JSON.stringify(message, null, 2));
            responseQueueRef.current.push(message);
          },
          onclose: () => {
            addTranscription('Live connection closed.', 'status');
            stopStreaming();
          },
          onerror: (e: any) => {
            const errorMsg = `Live connection error: ${e.message || 'Unknown error'}`;
            console.error(errorMsg, e);
            setError(errorMsg);
            addTranscription(errorMsg, 'error');
            stopStreaming();
          },
        },
      });

    } catch (e: any) {
      const errorMsg = `Failed to start streaming: ${e.message}`;
      console.error(errorMsg, e);
      setError(errorMsg);
      addTranscription(errorMsg, 'error');
      stopStreaming();
    }
  };
  
  // --- Effects ---
  useEffect(() => {
    const frameInterval = setInterval(captureAndSendFrame, 1000);
    const queueInterval = setInterval(processResponseQueue, 100);
    return () => {
      clearInterval(frameInterval);
      clearInterval(queueInterval);
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (isStreamingRef.current) {
        stopStreaming();
      }
    };
  }, [captureAndSendFrame, processResponseQueue, stopStreaming]);

  // --- UI Rendering ---
  const getRiskLevelColor = () => {
    switch (riskLevel) {
      case 'DANGER': return 'text-red-500';
      case 'WARNING': return 'text-yellow-500';
      default: return 'text-green-500';
    }
  };

  const getTranscriptionColor = (type: Transcription['type']) => {
    switch (type) {
        case 'analysis': return 'text-gray-300';
        case 'tool-call': return 'text-blue-400';
        case 'tool-result': return 'text-purple-400';
        case 'status': return 'text-gray-500';
        case 'error': return 'text-red-400';
        default: return 'text-gray-500';
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white font-sans">
      <header className="p-4 border-b border-gray-700 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Intelligent Security Camera (Live API)</h1>
        <div className="flex items-center gap-4">
          <div className="text-sm">STATUS: {status}</div>
          <div className={`text-xl font-bold ${getRiskLevelColor()}`}>
            RISK LEVEL: {riskLevel}
          </div>
        </div>
      </header>
      <main className="flex flex-1 p-4 gap-4 overflow-hidden">
        <div className="flex-1 flex flex-col">
          <div className="bg-black rounded-lg overflow-hidden aspect-video relative">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover"></video>
            {status !== 'Connected' && <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center text-xl">Camera Off</div>}
          </div>
          <div className="flex-grow-0 pt-4">
            <button
              onClick={handleStreamToggle}
              className={`w-full py-3 text-lg font-bold rounded-lg transition-colors ${
                isStreamingRef.current
                  ? 'bg-red-600 hover:bg-red-700' 
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isStreamingRef.current ? 'Stop Streaming' : 'Start Streaming'}
            </button>
            {error && <p className="text-red-500 mt-2 text-center">{error}</p>}
          </div>
        </div>
        <div className="w-1/3 flex flex-col bg-gray-800 rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-2 border-b border-gray-600 pb-2">Live Transcription</h2>
          <div className="flex-1 overflow-y-auto pr-2">
            {transcriptions.map((t) => (
              <p key={t.id} className={`mb-1 ${getTranscriptionColor(t.type)}`}>
                <span className="font-mono text-xs">{`[${t.type.toUpperCase()}] `}</span>
                {t.text}
              </p>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}