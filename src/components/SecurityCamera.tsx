'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface Transcription {
  id: string
  text: string
  timestamp: Date
}

type RiskLevel = 'SAFE' | 'WARNING' | 'DANGER'

export default function SecurityCamera() {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('SAFE')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<any>(null)
  const idCounterRef = useRef(0)

  // Ensure client-side only rendering
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Tool definitions for Gemini - using a simplified format
  const systemPrompt = `You are an AI security system monitoring a live video and audio feed.
  Your responsibilities are:
  1. Analyze the video and audio feed for security risks
  2. Transcribe any speech you hear
  3. Identify potential security threats (intruders, suspicious behavior, emergencies)
  4. When you need to take action, output commands in this format:
     - TOOL_CALL: call911 {"reason": "description of emergency"}
     - TOOL_CALL: sendNotification {"message": "notification text"}
     - TOOL_CALL: door {"action": "lock" or "unlock"}
  5. Output the current risk level as "RISK_LEVEL: [SAFE|WARNING|DANGER]"
     - SAFE: Normal activity
     - WARNING: Suspicious activity that needs attention
     - DANGER: Immediate threat requiring action
  
  Always transcribe speech and assess risks continuously.`

  const startLiveSession = async () => {
    if (!isClient) return
    
    try {
      // Check if API key is available
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY
      console.log('API Key status:', apiKey ? 'Present' : 'Missing')
      
      if (!apiKey) {
        console.error('❌ Gemini API key is missing! Please check your .env.local file.')
        alert('Gemini API key is missing. Please add NEXT_PUBLIC_GEMINI_API_KEY to your .env.local file.')
        return
      }
      
      // Check if it looks like a valid AI Studio key
      if (!apiKey.startsWith('AIza')) {
        console.error('❌ Invalid AI Studio key format. AI Studio keys should start with "AIza"')
        alert('Invalid AI Studio API key format. Please check your key from https://makersuite.google.com/app/apikey')
        return
      }
      
      // Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      
      streamRef.current = stream
      setIsStreaming(true)

      // Initialize Gemini with AI Studio key
      console.log('🔧 Initializing Gemini AI (AI Studio)...')
      const genAI = new GoogleGenerativeAI(apiKey)
      
      // Try models in order of preference (newest to oldest)
      const modelNames = [
        'gemini-2.5-flash',      // Newest, fastest
        'gemini-1.5-flash',      // Stable fallback
        'gemini-1.5-pro',        // More capable fallback
        'gemini-pro'             // Legacy fallback
      ]
      
      let model = null
      let selectedModel = ''
      
      for (const modelName of modelNames) {
        try {
          console.log(`🔧 Trying model: ${modelName}`)
          model = genAI.getGenerativeModel({ model: modelName })
          
          // Test the model with a simple request
          await model.generateContent('Hello')
          selectedModel = modelName
          console.log(`✅ Successfully initialized model: ${modelName}`)
          break
        } catch (error) {
          console.log(`❌ Model ${modelName} failed:`, error instanceof Error ? error.message : 'Unknown error')
          continue
        }
      }
      
      if (!model) {
        throw new Error('No available Gemini models found. Please check your API key permissions.')
      }
      
      // Start chat session
      console.log('🔧 Starting chat session...')
      const session = await model.startChat({
        history: [
          {
            role: 'user',
            parts: [{ text: systemPrompt }]
          },
          {
            role: 'model',
            parts: [{ text: 'Understood. I will monitor the video and audio feed for security risks, transcribe speech, and use the specified command format for tool calls.' }]
          }
        ]
      })
      
      console.log(`✅ Chat session started successfully with ${selectedModel}`)
      sessionRef.current = session

      // Create video and audio streams for Gemini
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      // Send frames periodically
      const frameInterval = setInterval(async () => {
        if (!videoRef.current || !ctx || !sessionRef.current) return
        
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        ctx.drawImage(videoRef.current, 0, 0)
        
        const imageData = canvas.toDataURL('image/jpeg')
        
        try {
          const result = await sessionRef.current.sendMessageStream([
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageData.split(',')[1]
              }
            },
            {
              text: 'Analyze this frame for security risks and transcribe any speech.'
            }
          ])
          
          for await (const chunk of result.stream) {
            const text = chunk.text()
            
            // Check for risk level updates
            const riskMatch = text.match(/RISK_LEVEL:\s*(SAFE|WARNING|DANGER)/)
            if (riskMatch) {
              setRiskLevel(riskMatch[1] as RiskLevel)
            }
            
            // Check for tool calls
            const toolCallMatches = text.matchAll(/TOOL_CALL:\s*(\w+)\s*({[^}]+})/g)
            for (const match of toolCallMatches) {
              const toolName = match[1]
              const argsStr = match[2]
              try {
                const args = JSON.parse(argsStr)
                await handleToolCall(toolName, args)
              } catch (error) {
                console.error('Error parsing tool call:', error)
              }
            }
            
            // Extract transcriptions (remove risk level and tool call text)
            const cleanText = text
              .replace(/RISK_LEVEL:\s*(SAFE|WARNING|DANGER)/g, '')
              .replace(/TOOL_CALL:\s*\w+\s*{[^}]+}/g, '')
              .trim()
            
            if (cleanText) {
              setTranscriptions(prev => [...prev, {
                id: `transcription-${++idCounterRef.current}`,
                text: cleanText,
                timestamp: new Date()
              }])
            }
          }
        } catch (error) {
          console.error('❌ Error processing frame:', error)
          // More specific error handling
          if (error instanceof Error && error.message?.includes('API key')) {
            console.error('❌ API Key validation failed. Please check your Gemini API key.')
          }
        }
      }, 1000) // Send frame every second

      // Store interval ID for cleanup
      sessionRef.current.frameInterval = frameInterval
      
    } catch (error) {
      console.error('❌ Error starting camera:', error)
      
      // More specific error handling for AI Studio
      if (error instanceof Error) {
        if (error.message?.includes('API key') || error.message?.includes('403')) {
          alert('Invalid AI Studio API key. Please:\n1. Go to https://makersuite.google.com/app/apikey\n2. Create a new API key\n3. Add it to your .env.local file')
        } else if (error.message?.includes('model') || error.message?.includes('404')) {
          alert('Model access issue. Please check that your AI Studio API key has access to Gemini models.')
        } else if (error.message?.includes('quota') || error.message?.includes('429')) {
          alert('API quota exceeded. Please check your AI Studio usage limits.')
        } else {
          alert('Error starting camera: ' + error.message)
        }
      } else {
        alert('Error starting camera: Unknown error occurred')
      }
      
      setIsStreaming(false)
    }
  }

  const handleToolCall = async (toolName: string, args: any) => {
    let endpoint = ''
    
    switch (toolName) {
      case 'call911':
        endpoint = '/api/call911'
        break
      case 'sendNotification':
        endpoint = '/api/sendNotification'
        break
      case 'door':
        endpoint = '/api/door'
        break
      default:
        console.error('Unknown tool:', toolName)
        return
    }
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      })
      
      if (!response.ok) {
        console.error('Tool call failed:', await response.text())
      }
    } catch (error) {
      console.error('Error calling tool:', error)
    }
  }

  const stopLiveSession = () => {
    // Stop camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    
    // Clear interval
    if (sessionRef.current?.frameInterval) {
      clearInterval(sessionRef.current.frameInterval)
    }
    
    // Clear session
    sessionRef.current = null
    setIsStreaming(false)
    
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  const getRiskLevelColor = () => {
    switch (riskLevel) {
      case 'SAFE':
        return 'bg-green-500'
      case 'WARNING':
        return 'bg-yellow-500'
      case 'DANGER':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  // Show loading state until client-side rendering is ready
  if (!isClient) {
    return (
      <div className="space-y-6">
        <div className="bg-gray-900 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Loading...</h2>
          <div className="w-full h-96 bg-black rounded-lg flex items-center justify-center">
            <span className="text-gray-500">Initializing camera...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Camera Feed */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Live Camera Feed</h2>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-96 bg-black rounded-lg"
        />
        <button
          onClick={isStreaming ? stopLiveSession : startLiveSession}
          className={`mt-4 px-6 py-2 rounded-lg font-medium ${
            isStreaming 
              ? 'bg-red-600 hover:bg-red-700' 
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isStreaming ? 'Stop Camera' : 'Start Camera'}
        </button>
      </div>

      {/* Live Transcription */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Live Transcription</h2>
        <div className="h-48 overflow-y-auto bg-gray-800 rounded-lg p-4">
          {transcriptions.length === 0 ? (
            <p className="text-gray-400">No transcriptions yet...</p>
          ) : (
            <ul className="space-y-2">
              {transcriptions.map((transcription) => (
                <li key={transcription.id} className="text-sm">
                  <span className="text-gray-500">
                    {transcription.timestamp.toLocaleTimeString()}:
                  </span>{' '}
                  {transcription.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Risk Level Indicator */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Security Status</h2>
        <div className={`${getRiskLevelColor()} rounded-lg p-8 text-center`}>
          <p className="text-2xl font-bold text-white">
            Risk Level: {riskLevel}
          </p>
        </div>
      </div>
    </div>
  )
}