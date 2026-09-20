import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {role: "user", parts: [{text: "Hello"}]}
            ],
            config: {
                systemInstruction: "You are a helpful assistant.",
                temperature: 1
            }
        });
        console.log("Success:", response.text);
    } catch(e) {
        console.error("Error:", e);
    }
}
test();
