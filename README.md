🌌 ANVAYA

🔐 Private by default. Intelligent by choice.

Anvaya is a privacy-first personal super app that brings communication, personal organization, secure storage, and optional AI assistance into one unified workspace.

💚 Built to keep your digital life connected without forcing everything into separate applications.


✨ FEATURES

💬 Messaging
• Private one-to-one conversations
• Group conversations
• Real-time messaging
• Typing indicators
• Online and offline presence
• Message reactions
• Threads and replies
• Pinned messages
• Message search
• Read and delivery receipts
• Voice notes
• Location sharing
• Media and file sharing
• Polls

📝 Personal Life
• Notes
• Reminders
• Calendar and tasks
• Birthday tracking
• Money and expense tracking
• Subscription tracking
• Command Center

🔐 Privacy & Storage
• Anvaya Vault
• Account-specific data
• Privacy controls
• Read receipt controls
• Last-seen controls
• Account deletion
• Private storage

🤖 Astra AI
• Optional contextual AI assistant
• Gemini-powered intelligence
• Designed to assist without making AI mandatory
• Users provide their own Gemini API key


🛠️ TECHNOLOGY

⚛️ React
⚡ Vite
🎨 Tailwind CSS
🟢 Node.js
🚀 Express
🔐 Supabase
🐳 Docker
✨ Gemini API
🌤️ OpenWeather API
📧 Resend


🚀 GETTING STARTED

Clone the repository:

git clone https://github.com/punisher-ram/AuroraCloud-Anvaya.git

cd AuroraCloud-Anvaya

Create your environment file:

copy .env.example .env

Open the .env file and add your own credentials.


🔑 API KEYS & SERVICES

🤖 GEMINI API

Required only if you want to use Astra AI.

Get your own Gemini API key from:

https://aistudio.google.com/app/apikey

Add it to:

GEMINI_API_KEY=your_key_here


🌤️ OPENWEATHER API

Used for weather information.

Create an account and get your API key from:

https://home.openweathermap.org/api_keys

Add it to:

OPENWEATHER_API_KEY=your_key_here


📧 RESEND API

Used for email functionality.

Create an account and get your API key from:

https://resend.com/api-keys

Add it to:

RESEND_API_KEY=your_key_here


🔐 SUPABASE

Create your own Supabase project:

https://supabase.com

Your Supabase project URL and Publishable key can be found under:

Supabase Dashboard → Project Settings → API Keys

Add them to:

SUPABASE_URL=your_project_url
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key


🐳 RUN WITH DOCKER

Start Anvaya:

docker compose up --build

Then open:

http://localhost:5173

The backend runs on:

http://localhost:4000


⚠️ SECURITY

Never commit your .env file to GitHub.

Never publish your API keys, Supabase Secret keys, or service-role credentials.

Use .env.example as the public configuration template.

Supabase Secret keys must remain server-side and must never be placed inside client-side code.

Astra AI is optional and Anvaya's core functionality does not require a Gemini API key.


🔒 PRIVACY NOTE

Anvaya is designed around privacy and user control.

However, Anvaya messaging should not currently be represented as providing Signal-level end-to-end encryption.

Some functionality is experimental and should be reviewed and hardened before production deployment.


📦 PROJECT STATUS

Anvaya is an evolving project focused on bringing communication, organization, storage, and contextual intelligence into one private workspace.

Built with the goal of making personal software feel more connected, more useful, and more respectful of user control.


🌌 ANVAYA

One private space for your conversations, files, finances, plans, and intelligence.

💚 Private by default.
✨ Intelligent by choice.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ Aurora Cloud by hash
