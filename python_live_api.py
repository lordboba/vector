#!/usr/bin/env python3
"""
Gemini Live API Security Camera Backend
Based on official documentation: https://ai.google.dev/gemini-api/docs/live-guide
"""

import asyncio
import base64
import json
import websockets
import logging
from pathlib import Path
import os
from google import genai
from google.genai import types

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SecurityCameraLiveAPI:
    def __init__(self):
        # Initialize Gemini client
        self.client = genai.Client()
        self.model = "gemini-live-2.5-flash-preview"
        self.session = None
        self.connected_clients = set()
        
    async def start_live_session(self):
        """Start a Live API session"""
        config = {
            "response_modalities": ["TEXT", "AUDIO"],
            "system_instruction": """You are a security camera AI assistant. 
            Analyze video frames and audio for potential security threats.
            Assess risk levels as SAFE, WARNING, or DANGER.
            Provide detailed descriptions of what you observe.
            Look for suspicious activities, unauthorized access, or safety hazards."""
        }
        
        try:
            logger.info(f"🔄 Connecting to Live API with model: {self.model}")
            
            # Create Live API session
            self.session = await self.client.aio.live.connect(
                model=self.model, 
                config=config
            )
            
            logger.info("✅ Live API session started successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to start Live API session: {e}")
            return False
    
    async def process_video_frame(self, frame_data):
        """Process a video frame through Live API"""
        if not self.session:
            await self.start_live_session()
            
        try:
            # Send image to Live API
            await self.session.send_realtime_input(
                image=types.Blob(
                    data=base64.b64decode(frame_data),
                    mime_type="image/jpeg"
                )
            )
            
            logger.info("📹 Sent video frame to Live API")
            
            # Get response
            response_text = ""
            async for response in self.session.receive():
                if response.server_content and response.server_content.model_turn:
                    for part in response.server_content.model_turn.parts:
                        if part.text:
                            response_text += part.text
                
                # Check if turn is complete
                if response.server_content and response.server_content.turn_complete:
                    break
            
            return {
                "type": "analysis",
                "content": response_text,
                "timestamp": asyncio.get_event_loop().time()
            }
            
        except Exception as e:
            logger.error(f"❌ Error processing video frame: {e}")
            return {
                "type": "error",
                "content": str(e),
                "timestamp": asyncio.get_event_loop().time()
            }
    
    async def process_audio_chunk(self, audio_data, mime_type="audio/webm"):
        """Process an audio chunk through Live API"""
        if not self.session:
            await self.start_live_session()
            
        try:
            # Convert audio for Live API (16-bit PCM, 16kHz, mono)
            await self.session.send_realtime_input(
                audio=types.Blob(
                    data=base64.b64decode(audio_data),
                    mime_type=mime_type
                )
            )
            
            logger.info("🎙️ Sent audio chunk to Live API")
            
            # Get response
            response_text = ""
            audio_response = None
            
            async for response in self.session.receive():
                if response.data:
                    # Audio response
                    audio_response = base64.b64encode(response.data).decode()
                
                if response.server_content and response.server_content.model_turn:
                    for part in response.server_content.model_turn.parts:
                        if part.text:
                            response_text += part.text
                
                if response.server_content and response.server_content.turn_complete:
                    break
            
            return {
                "type": "audio_analysis",
                "content": response_text,
                "audio_response": audio_response,
                "timestamp": asyncio.get_event_loop().time()
            }
            
        except Exception as e:
            logger.error(f"❌ Error processing audio: {e}")
            return {
                "type": "error", 
                "content": str(e),
                "timestamp": asyncio.get_event_loop().time()
            }
    
    async def close_session(self):
        """Close the Live API session"""
        if self.session:
            await self.session.close()
            self.session = None
            logger.info("🔌 Live API session closed")

# WebSocket server for React frontend
class WebSocketServer:
    def __init__(self):
        self.live_api = SecurityCameraLiveAPI()
    
    async def handle_client(self, websocket, path):
        """Handle WebSocket connection from React frontend"""
        self.live_api.connected_clients.add(websocket)
        logger.info(f"🔌 Client connected: {websocket.remote_address}")
        
        try:
            async for message in websocket:
                data = json.loads(message)
                
                if data["type"] == "video_frame":
                    result = await self.live_api.process_video_frame(data["data"])
                    await websocket.send(json.dumps(result))
                
                elif data["type"] == "audio_chunk":
                    result = await self.live_api.process_audio_chunk(
                        data["data"], 
                        data.get("mime_type", "audio/webm")
                    )
                    await websocket.send(json.dumps(result))
                
                elif data["type"] == "start_session":
                    success = await self.live_api.start_live_session()
                    await websocket.send(json.dumps({
                        "type": "session_status",
                        "status": "connected" if success else "error"
                    }))
                
                elif data["type"] == "stop_session":
                    await self.live_api.close_session()
                    await websocket.send(json.dumps({
                        "type": "session_status", 
                        "status": "disconnected"
                    }))
        
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"🔌 Client disconnected: {websocket.remote_address}")
        except Exception as e:
            logger.error(f"❌ WebSocket error: {e}")
        finally:
            self.live_api.connected_clients.discard(websocket)

async def main():
    """Start the WebSocket server"""
    server = WebSocketServer()
    
    # Start WebSocket server on port 8765
    logger.info("🚀 Starting WebSocket server on ws://localhost:8765")
    
    async with websockets.serve(server.handle_client, "localhost", 8765):
        logger.info("✅ WebSocket server started successfully")
        logger.info("🔗 React app can connect to: ws://localhost:8765")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    # Ensure API key is set
    if not os.getenv("GOOGLE_API_KEY"):
        logger.error("❌ GOOGLE_API_KEY environment variable not set")
        exit(1)
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🛑 Server stopped by user") 