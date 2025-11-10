<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1KZ0YLnxr18WcqhV0kxz1SORL3MFzKVvt

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` to your OpenAI API key (the server reads it from there).
3. (Optional) Update `.env.local` if you want to point the frontend at a remote API base via `VITE_API_BASE_URL`.
4. Run the app (starts both the Vite dev server and the OpenAI proxy):
   `npm run dev`
