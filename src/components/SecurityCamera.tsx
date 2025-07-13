'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, Tool, FunctionDeclaration } from '@google/genai';
import Popup from '@/components/popup';
import icon from "@/components/icon.png";

// --- Type Definitions ---
interface Transcription {
  id: string;
  text: string;
  type: 'analysis' | 'tool-call' | 'tool-result' | 'error' | 'status' | 'transcription';
  timestamp: Date;
}

interface Event {
  id: string;
  text: string;
  type: 'DANGER' | 'SAFE' | 'WARNING' |'tool-executed' | 'connection' | 'error';
  timestamp: Date;
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

// --- Response Schema ---
const responseSchema = {
  type: 'OBJECT',
  properties: {
    thought: {
      type: 'STRING',
      description: 'Internal monologue and reasoning for the analysis and risk assessment. This is for debugging and not shown to the user.'
    },
    analysis: {
      type: 'STRING',
      description: 'A description of visual observations and events, to be displayed to the user.'
    },
    transcription: {
      type: 'STRING',
      description: 'A live transcription of any spoken words. Should be an empty string if no speech is detected.'
    },
    riskLevel: {
      type: 'STRING',
      enum: ['SAFE', 'WARNING', 'DANGER'],
      description: 'The current assessed risk level.'
    }
  },
  required: ['thought', 'analysis', 'riskLevel']
} as any;

// --- Component ---
export default function SecurityCamera() {
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('SAFE');
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('Disconnected');
  const [error, setError] = useState<string | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const liveSessionRef = useRef<any>(null); // Live API session
  const responseQueueRef = useRef<any[]>([]);
  const isProcessingQueueRef = useRef(false);
  const isStreamingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const transcriptionsRef = useRef<HTMLDivElement>(null);
  const analysisRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLDivElement>(null);
  const partialJsonResponse = useRef('');
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  // Refs to hold the current state for access in intervals
  const eventsStateRef = useRef<Event[]>(events);
  const transcriptionsStateRef = useRef<Transcription[]>(transcriptions);

  useEffect(() => {
    eventsStateRef.current = events;
  }, [events]);

  useEffect(() => {
    transcriptionsStateRef.current = transcriptions;
  }, [transcriptions]);


  // --- Send data to Gemini Pro for analysis ---
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (!isStreamingRef.current) return;

      const now = new Date();
      const twentySecondsAgo = new Date(now.getTime() - 10000);

      const recentEvents = eventsStateRef.current.filter(e => e.timestamp > twentySecondsAgo);
      const recentTranscriptions = transcriptionsStateRef.current.filter(t => t.timestamp > twentySecondsAgo);

      if (recentEvents.length === 0 && recentTranscriptions.length === 0) {
        return;
      }

      console.log('[DEBUG] Sending data to Gemini Pro for analysis...');

      try {
        const response = await fetch('/api/gemini-pro', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            events: recentEvents,
            transcriptions: recentTranscriptions,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[DEBUG] Gemini Pro analysis received:', data);
          // For now, we don't do anything with the response in the UI.
        } else {
          console.error('[DEBUG] Error sending data to Gemini Pro:', response.statusText);
        }
      } catch (error) {
        console.error('[DEBUG] Exception sending data to Gemini Pro:', error);
      }
    }, 20000);

    return () => clearInterval(intervalId);
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- Utility Functions ---
  const addTranscription = useCallback((text: string, type: Transcription['type']) => {
    const id = `transcription-${Date.now()}-${Math.random()}`;
    setTranscriptions((prev) => [...prev, { id, text, type, timestamp: new Date() }]);
    // Auto-scroll to bottom after state update
    setTimeout(() => {
      let refToScroll;
      // Decide which container to scroll
      if (type === 'transcription') {
        refToScroll = transcriptionsRef;
      } else {
        // Scroll analysis box for analysis, tools, status, errors
        refToScroll = analysisRef;
      }
      
      if (refToScroll?.current) {
        refToScroll.current.scrollTop = refToScroll.current.scrollHeight;
      }
    }, 0);
  }, []);

  const addEvent = useCallback((text: string, type: Event['type']) => {
    const id = `event-${Date.now()}-${Math.random()}`;
    setEvents((prev) => [...prev, { id, text, type, timestamp: new Date() }]);
    // Auto-scroll to bottom after state update
    setTimeout(() => {
      if (eventsRef.current) {
        eventsRef.current.scrollTop = eventsRef.current.scrollHeight;
      }
    }, 0);
  }, []);

  const wait = useCallback((ms: number) => new Promise(resolve => setTimeout(resolve, ms)), []);

  // --- Live API Response Handling ---
  const processResponseQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || responseQueueRef.current.length === 0) {
      return;
    }
    isProcessingQueueRef.current = true;
    console.log(`[DEBUG] Processing queue. Size: ${responseQueueRef.current.length}`);

    const processJson = (json: any) => {
      console.log('[DEBUG] JSON response processed:', json);
      const { thought, analysis, transcription, riskLevel: newRiskLevel } = json;

      if (transcription) {
        addTranscription(transcription, 'transcription');
      }
      if (analysis) {
        addTranscription(analysis, 'analysis');
        console.log(`[AI Thought] ${thought}`);
      }
      if (newRiskLevel) {
        setRiskLevel(prevRiskLevel => {
          if (prevRiskLevel !== newRiskLevel) {
            addEvent(`Risk level changed to ${newRiskLevel}`, newRiskLevel === 'DANGER' ? 'DANGER' : newRiskLevel === 'WARNING' ? 'WARNING' : 'SAFE');
          }
          return newRiskLevel as RiskLevel;
        });
      }
    };

    while (responseQueueRef.current.length > 0) {
      const message = responseQueueRef.current.shift();
      if (!message) continue;

      try {
        console.log('[DEBUG] Processing message:', JSON.stringify(message, null, 2));

        if (message.serverContent?.modelTurn?.parts) {
          for (const part of message.serverContent.modelTurn.parts) {
            if (part.functionCall) {
              console.log('[DEBUG] Function call detected:', part.functionCall);
              await handleToolCall(part.functionCall.name, part.functionCall.args);
              partialJsonResponse.current = ''; // Clear buffer on tool call
              continue;
            }

            if (part.json) {
              processJson(part.json);
              partialJsonResponse.current = '';
            } else if (part.text) {
              partialJsonResponse.current += part.text;

              const startFence = '```json';
              const endFence = '```';
              let buffer = partialJsonResponse.current;
              
              // Process all complete JSON blocks in the buffer
              while (true) {
                const startIndex = buffer.indexOf(startFence);
                const endIndex = buffer.indexOf(endFence, startIndex + startFence.length);

                // If a full block isn't found, wait for more data
                if (startIndex === -1 || endIndex === -1) {
                  break;
                }
                
                const jsonString = buffer.substring(startIndex + startFence.length, endIndex).trim();
                
                try {
                  const parsedJson = JSON.parse(jsonString);
                  processJson(parsedJson);
                  // Successfully parsed, so remove the block from the buffer and continue
                  buffer = buffer.substring(endIndex + endFence.length);
                } catch (e) {
                  // This is expected if the JSON is streaming and incomplete.
                  if (e instanceof SyntaxError) {
                    // It's possible to find fences but have incomplete JSON.
                    // Break and wait for more data.
                  } else {
                    console.error('[DEBUG] Error parsing JSON object.', { jsonString, error: e });
                  }
                  break; 
                }
              }
              
              partialJsonResponse.current = buffer;
            }
          }
        }
      } catch (e: any) {
        const errorMessage = `Error processing API response: ${e.message}`;
        console.error('[DEBUG] Error in processResponseQueue:', errorMessage, e);
        setError(errorMessage);
        addTranscription(errorMessage, 'error');
        addEvent(errorMessage, 'error');
        partialJsonResponse.current = '';
      }
    }

    isProcessingQueueRef.current = false;
  }, [addTranscription, addEvent]);

  // --- Tool Implementations ---
  const toolImplementations: { [key: string]: (args: any) => Promise<any> } = {
    call911: async (args: { reason: string }) => {
      console.log('[DEBUG] Executing call911 tool with args:', args);
      setRiskLevel(prevRiskLevel => {
        if (prevRiskLevel !== 'DANGER') {
          addEvent('Risk level elevated to DANGER', 'DANGER');
        }
        return 'DANGER';
      });
      addEvent(`911 called: ${args.reason}`, 'tool-executed');
      const response = await fetch('/api/call911', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const result = await response.json();
      console.log('[DEBUG] call911 tool result:', result);
      return result;
    },
    sendNotification: async (args: { package_size: string, delivery_time: string }) => {
      console.log('[DEBUG] Executing sendNotification tool with args:', args);
      setRiskLevel(prevRiskLevel => {
        if (prevRiskLevel !== 'WARNING') {
          addEvent('Risk level elevated to WARNING', 'WARNING');
        }
        return 'WARNING';
      });
      addEvent(`Package notification sent: ${args.package_size} package at ${args.delivery_time}`, 'tool-executed');
      const response = await fetch('/api/sendNotification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const result = await response.json();
      console.log('[DEBUG] sendNotification tool result:', result);
      return result;
    },
    door: async (args: { action: 'OPEN' | 'CLOSE' }) => {
      console.log('[DEBUG] Executing door tool with args:', args);
      addEvent(`Door ${args.action.toLowerCase()}ed`, 'tool-executed');
      const response = await fetch('/api/door', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const result = await response.json();
      console.log('[DEBUG] door tool result:', result);
      return result;
    },
  };

  const handleToolCall = async (toolName: string, args: any) => {
    console.log(`[DEBUG] handleToolCall called for ${toolName} with args:`, args);
    addTranscription(`Tool call: ${toolName}(${JSON.stringify(args)})`, 'tool-call');
    addEvent(`Tool called: ${toolName}`, 'tool-executed');
    const implementation = toolImplementations[toolName];
    if (!implementation) {
      const errorMsg = `Error: Tool '${toolName}' not found.`;
      addTranscription(errorMsg, 'error');
      addEvent(errorMsg, 'error');
      console.error(errorMsg);
      return;
    }
    try {
      console.log(`[DEBUG] Executing tool implementation for ${toolName}`);
      const result = await implementation(args);
      console.log(`[DEBUG] Tool ${toolName} completed successfully:`, result);
      addTranscription(`Tool result: ${result.message || JSON.stringify(result)}`, 'tool-result');
      // The Live API does not currently support sending tool results back to the model.
    } catch (e: any) {
      const errorMsg = `Error executing tool '${toolName}': ${e.message}`;
      console.error(`[DEBUG] Tool ${toolName} failed:`, errorMsg, e);
      addTranscription(errorMsg, 'error');
      addEvent(errorMsg, 'error');
      // Don't let tool errors stop the stream - they're non-critical
    }
  };

  // --- Core Streaming Logic ---
  const sendAudio = useCallback(async (pcmData: Int16Array) => {
    if (!isStreamingRef.current || !liveSessionRef.current) {
      return;
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

  const captureAndSendFrame = useCallback(async (frameCount = 1) => {
    for (let i = 0; i < frameCount; i++) {
        if (!isStreamingRef.current || !liveSessionRef.current) {
            return;
        }

        if (!videoRef.current || videoRef.current.readyState < 2) {
            console.log(`[DEBUG] Video not ready. State: ${videoRef.current?.readyState}`);
            return;
        }
        
        console.log(`[DEBUG] Capturing frame ${i + 1}/${frameCount}. Video dimensions: ${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);

        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
    
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    
        if (blob) {
        const reader = new FileReader();
        reader.onloadend = async () => {
            try {
            const base64Data = (reader.result as string).split(',')[1];
            await liveSessionRef.current.sendRealtimeInput({
                image: { data: base64Data, mimeType: 'image/jpeg' },
            });
            console.log(`[DEBUG] Frame ${i + 1}/${frameCount} sent to Live API.`);
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
        if (i < frameCount - 1) {
            await wait(500); // Wait between frames
        }
    }
  }, [addTranscription, setError, wait]);

  const stopStreaming = useCallback(() => {
    console.log('[DEBUG] stopStreaming called - checking if already stopped');
    if (!isStreamingRef.current) {
      console.log('[DEBUG] Stream already stopped, ignoring call');
      return;
    }
    
    console.log('[DEBUG] Stopping stream...');
    isStreamingRef.current = false;
    setStatus('Disconnected');
    setAnalyserNode(null);
    addEvent('Security feed stopped', 'connection');

    if (liveSessionRef.current) {
      console.log('[DEBUG] Closing live session');
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    if (mediaStreamRef.current) {
      console.log('[DEBUG] Stopping media tracks');
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    responseQueueRef.current = [];
    isProcessingQueueRef.current = false;
    addTranscription('Security feed stopped.', 'status');
    console.log('[DEBUG] Stream stopped successfully');
  }, [addTranscription, addEvent]);


  const handleStreamToggle = async () => {
    if (isStreamingRef.current) {
      stopStreaming();
      return;
    }

    setError(null);
    setStatus('Connecting');
    isStreamingRef.current = true;
    addTranscription('Starting security feed...', 'status');
    addEvent('Starting security feed', 'connection');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (e: any) {
          if (e.name !== 'AbortError') {
            throw e;
          }
          // Ignore AbortError (play() interrupted by new load request)
        }
      }

      // --- Set up Audio Processing ---
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);

      // --- Analyser for visualization ---
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64; // Fewer bars for a cleaner look
      source.connect(analyser);
      setAnalyserNode(analyser);
      // ---
      
      try {
        await audioContext.audioWorklet.addModule('/audio-processor.js');
      } catch (e: any) {
          throw new Error(`Failed to add audio worklet module: ${e.message}`);
      }
      
      const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
      audioWorkletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event) => {
        sendAudio(event.data);
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);
      // --- End Audio Processing Setup ---

      const genAI = new GoogleGenAI({apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY!});

      const config = {
        responseModalities: [Modality.TEXT],
        responseJsonSchema: responseSchema,
        temperature: 0,
        thinkingBudget: 0,
        systemInstruction: `You are Vector AI, a security guard for a live demonstration. Your primary goal is to demonstrate your capabilities by reacting to simulated events by providing structured JSON data.

**DEMO INSTRUCTIONS:**
*   **Treat all inputs as real:** You MUST react to acted scenarios, verbal threats, and test events as if they are genuine security risks.
*   **Be decisive:** Act according to the rules below without hesitation. Your analysis must be concise and clear for the demo.

**Your Task:**
1.  Analyze the combined video and audio feed.
2.  Respond with a valid JSON object that conforms to the provided schema. Ensure that any double quotes inside a JSON string value are properly escaped with a backslash (e.g., "description": "He said, \\"hello\\".").
3.  **thought:** Explain your reasoning for the analysis and risk level. This is for debugging and not shown to the user.
4.  **analysis:** Describe visual observations in short, factual statements.
5.  **transcription:** Provide a live transcription of any spoken English words, ignoring all other languages. If no speech is detected, provide an empty string.
6.  **riskLevel:** Evaluate and state the current risk level: "SAFE", "WARNING", or "DANGER".
7.  Use the provided tool-calling functions when conditions are met. **Do not include tool calls or related information in the JSON response.**

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

**Risk Evaluation Rules:**
*   **Constant Re-evaluation:** You MUST re-evaluate the risk level with every piece of new information from the audio and video stream.
*   **Risk Downgrade:** If a threat has clearly passed (e.g., a person leaves, a noise stops), you MUST downgrade the risk level. For example, after a package is delivered and the delivery person has left the scene, the risk should return from WARNING to SAFE.

**Tool Rules:**
*   \`sendNotification\`: Use ONLY for a package delivery (sets WARNING).
*   \`call911\`: Use ONLY for a DANGER-level event. Call the function with the \`reason\` parameter detailing the emergency.`,
        toolConfig: {
          functionDeclarations: [call911Tool, sendNotificationTool, doorTool],
        },
      };

      liveSessionRef.current = await genAI.live.connect({
        model: 'gemini-live-2.5-flash-preview',
        config: config,
        callbacks: {
          onopen: () => {
            console.log('[DEBUG] Live API connection opened');
            setStatus('Connected');
            addTranscription('Live connection opened.', 'status');
            addEvent('Live connection established', 'connection');
          },
          onmessage: (message) => {
            console.log('[DEBUG] Message received from server:', JSON.stringify(message, null, 2));
            responseQueueRef.current.push(message);
          },
          onclose: () => {
            console.log('[DEBUG] Live API connection closed');
            addTranscription('Live connection closed.', 'status');
            addEvent('Live connection closed', 'connection');
            stopStreaming();
          },
          onerror: (e: any) => {
            const errorMsg = `Live connection error: ${e.message || 'Unknown error'}`;
            console.error('[DEBUG] Live API error:', errorMsg, e);
            setError(errorMsg);
            addTranscription(errorMsg, 'error');
            addEvent(errorMsg, 'error');
            // Only stop streaming for critical connection errors, not tool execution errors
            if (e.message && (e.message.includes('connection') || e.message.includes('network') || e.message.includes('timeout'))) {
              console.log('[DEBUG] Critical connection error detected, stopping stream');
              stopStreaming();
            } else {
              console.log('[DEBUG] Non-critical error, continuing stream');
            }
          },
        },
      });

    } catch (e: any) {
      const errorMsg = `Failed to start streaming: ${e.message}`;
      console.error(errorMsg, e);
      setError(errorMsg);
      addTranscription(errorMsg, 'error');
      addEvent(errorMsg, 'error');
      stopStreaming();
    }
  };
  
  // --- Effects ---
  useEffect(() => {
    // Automatically start the livestream on mount
    handleStreamToggle();
  }, []);

  useEffect(() => {
    const frameInterval = setInterval(() => captureAndSendFrame(1), 1000); // Send 1 frame every 2 seconds
    const queueInterval = setInterval(processResponseQueue, 100);
    return () => {
      clearInterval(frameInterval);
      clearInterval(queueInterval);
      if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.port.onmessage = null;
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (isStreamingRef.current) {
        stopStreaming();
      }
    };
  }, [captureAndSendFrame, processResponseQueue, stopStreaming, sendAudio]);

  // --- Sound Wave Component ---
  const SoundWave = ({ analyserNode, isConnected }: { analyserNode: AnalyserNode | null, isConnected: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
      if (!analyserNode || !isConnected || !canvasRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          const context = canvas.getContext('2d');
          context?.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      analyserNode.fftSize = 64; // Fewer bars for a cleaner look
      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      let animationFrameId: number;

      const draw = () => {
        animationFrameId = requestAnimationFrame(draw);
        analyserNode.getByteFrequencyData(dataArray);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        
        const barWidth = 10;
        const barSpacing = 10;
        const totalBarsWidth = bufferLength * (barWidth + barSpacing) - barSpacing;
        let x = (canvasWidth - totalBarsWidth) / 2;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = dataArray[i] / 2.0;
          context.fillStyle = '#404040';
          context.fillRect(x, canvasHeight - barHeight, barWidth, barHeight);
          x += barWidth + barSpacing;
        }
      };

      draw();

      return () => {
        cancelAnimationFrame(animationFrameId);
      };
    }, [analyserNode, isConnected]);

    return <canvas ref={canvasRef} width="120" height="24" className="ml-2" />;
  };

  // --- UI Rendering ---
  const getRiskLevelColor = () => {
    switch (riskLevel) {
      case 'DANGER': return 'text-red-600';
      case 'WARNING': return 'text-yellow-500';
      default: return 'text-emerald-600';
    }
  };

  const getTranscriptionColor = (type: Transcription['type']) => {
    switch (type) {
        case 'analysis': return 'text-neutral-700';
        case 'transcription': return 'text-neutral-700';
        case 'tool-call': return 'text-neutral-700';
        case 'tool-result': return 'text-neutral-700';
        case 'status': return 'text-neutral-700';
        case 'error': return 'text-red-600';
        default: return 'text-neutral-700';
    }
  }

  const getEventColor = (type: Event['type']) => {
    switch (type) {
        case 'SAFE': return 'text-emerald-600';
        case 'WARNING': return 'text-yellow-600';
        case 'DANGER': return 'text-red-600';
        case 'tool-executed': return 'text-neutral-700';
        case 'connection': return 'text-neutral-700';
        case 'error': return 'text-red-600';
        default: return 'text-neutral-700';
    }
  }

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  }

  const [isTalking, setIsTalking] = useState(false);



  return (
    <div className="flex flex-col h-screen bg-neutral-100 text-neutral-700 font-mono">
      <header className="p-4 border-b border-gray-700 flex justify-between items-center">
        <img src={icon.src} alt="Vector Logo" className="h-12 w-auto"/>
        <h1 className="absolute translate-x-10 translate-y-1 text-2xl"><em>ector</em></h1>
        <div className="flex items-center gap-4">
          <button onClick={() => setIsPopupOpen(true)}><h2 className="text-2xl -translate-x-4 underline hover:text-neutral-800 cursor-pointer">about</h2></button>
          <Popup isOpen={isPopupOpen} onClose={() => setIsPopupOpen(false)}>
            <h2 className="text-2xl font-bold text-neutral-700 mb-2 underline">about</h2>
            <p>Vector is a AI security camera integrated with Weave and A2A to provide security and real-time video monitoring powered by Gemini-Live 2.5 for offices and homes.</p>
            <button
              onClick={() => setIsPopupOpen(false)}
              className="cursor-pointer mt-4 px-3 py-1 bg-red-600 text-neutral-100 rounded hover:bg-red-700"
            >
              Close
            </button>
          </Popup>
        </div>
      </header>
      <main className="flex flex-col flex-1 p-4 gap-4 overflow-hidden">
        {/* Main content area with vertical stacking */}
        <div className="flex flex-col gap-4 flex-1 overflow-hidden">
          
          {/* Top Row: Camera + Transcription */}
          <div className="flex-1 flex flex-row gap-4 overflow-hidden">
            <div className="flex-1 flex items-center justify-center">
              <div className="bg-black rounded-lg overflow-hidden aspect-video relative w-full">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover"></video>
                {status !== 'Connected' && <div className="absolute inset-0 bg-neutral-800 bg-opacity-50 flex items-center justify-center text-xl text-neutral-100">Camera Off</div>}
              </div>
            </div>
            <div className="flex flex-col w-1/2">
              <div className="flex items-center border-b border-gray-600 p-3 pb-2">
                <h3 className="text-sm font-semibold">Transcription</h3>
                <SoundWave analyserNode={analyserNode} isConnected={status === 'Connected'} />
              </div>
              <div ref={transcriptionsRef} className="flex-1 overflow-y-auto p-3 pt-3 space-y-1">
                {transcriptions.filter(t => t.type === 'transcription').map((t) => (
                  <p key={t.id} className={`text-sm animate-fade-in ${getTranscriptionColor(t.type)}`}>
                    <span className="font-mono text-xs">{`[${formatTimestamp(new Date())}] `}</span>
                    {`"${t.text}"`}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
          {/* Risk Banner */}
        <div className="w-full flex flex-col items-center">
          <div className={`w-full py-3 text-lg font-bold rounded-lg text-center text-neutral-100 ${
            riskLevel === 'DANGER' ? 'bg-rose-700' : riskLevel === 'WARNING' ? 'bg-yellow-400 text-black' : 'bg-emerald-600'
          }`}>
            Risk Level: {riskLevel}
          </div>
        </div>
          {/* Bottom Row: Log panels */}
          <div className="flex-1 flex flex-row gap-4 overflow-hidden">
            {/* Analysis Box */}
            <div className="flex-1 bg-neutral-300 rounded-lg flex flex-col overflow-hidden">
              <h3 className="text-sm font-semibold border-b border-gray-600 p-3 pb-2">Analysis & Logs</h3>
              <div ref={analysisRef} className="flex-1 overflow-y-auto p-3 pt-2 space-y-1">
                 {transcriptions.filter(t => t.type !== 'transcription').map((t) => (
                  <p key={t.id} className={`text-sm animate-fade-in ${getTranscriptionColor(t.type)}`}>
                    <span className="font-mono text-xs">{`[${t.type.toUpperCase()}] `}</span>
                    {t.text}
                  </p>
                ))}
              </div>
            </div>

            {/* Events Box */}
            <div className="flex-1 bg-neutral-300 rounded-lg flex flex-col overflow-hidden">
                <h2 className="text-sm font-semibold border-b border-gray-600 p-3 pb-2">Events</h2>
                <div ref={eventsRef} className="flex-1 overflow-y-auto p-3 pt-2 space-y-1">
                    {events.map((e) => (
                    <p key={e.id} className={`text-sm ${getEventColor(e.type)}`}>
                        <span className="font-mono text-xs">{`[${e.type.toUpperCase()}] ${formatTimestamp(e.timestamp)} `}</span>
                        {e.text}
                    </p>
                    ))}
                </div>
            </div>
          </div>
        
      </main>
    </div>
  );
}