import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import * as weave from "weave";

const getGeminiAnalysis = async (events: any, transcriptions: any) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable not set");
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite-preview-06-17",
  });

  const prompt = `
      You are a security analyst AI. You are receiving a stream of events and transcriptions from a security camera.
      Your task is to provide a deeper analysis of the situation based on the provided data.

      Here are the recent events:
      ${JSON.stringify(events, null, 2)}

      Here are the recent transcriptions:
      ${JSON.stringify(transcriptions, null, 2)}

      Based on this information, provide a detailed analysis.
      What is happening? What is the potential risk? What are the recommended actions?
      Be concise and to the point. Return your analysis in a JSON object with the following structure:
      {
        "analysis": "your detailed analysis",
        "risk": "SAFE | WARNING | DANGER",
        "actions": ["action 1", "action 2"]
      }
    `;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();

  // The model might return the JSON wrapped in markdown, so we need to extract it.
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
  const jsonString = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsedJson = JSON.parse(jsonString);
    return parsedJson;
  } catch (e) {
    console.error("Failed to parse JSON from Gemini:", jsonString);
    // Return the raw text if it's not valid JSON
    return { analysis: jsonString };
  }
};

const getGeminiAnalysisOp = weave.op(getGeminiAnalysis);

export async function POST(req: NextRequest) {
  try {
    await weave.init("gemini-pro-analysis");
    const { events, transcriptions } = await req.json();
    console.log("Received data for Gemini Pro analysis:", {
      events,
      transcriptions,
    });

    const result = await getGeminiAnalysisOp(events, transcriptions);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error in gemini-pro route:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
} 