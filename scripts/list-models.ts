import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function listModels() {
    try {
        const response = await ai.models.list();
        console.log('Response:', JSON.stringify(response, null, 2));
    } catch (e) {
        console.error('Error listing models:', e);
    }
}

listModels();
