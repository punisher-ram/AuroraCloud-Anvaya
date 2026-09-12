# Anvaya security notes

- Never place Gemini, Resend, OpenWeather or Supabase service-role/secret keys in the client.
- The Supabase publishable key is intended for the client and is protected by RLS.
- Chat media is stored in a private Supabase Storage bucket and access is limited to the uploading user or members of the conversation.
- Browser location sharing is opt-in through the browser permission prompt.
- Voice notes require browser microphone permission and are stored as private conversation media.
- This prototype is not Signal-level end-to-end encrypted. Do not describe it as unhackable or E2EE.
