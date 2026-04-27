# Google Photos PWA

A full-screen Google Photos frame built with React, Vite, and the Google Photos Picker API.

## Google setup

1. In Google Cloud Console, enable the Google Photos Picker API.
2. Create an OAuth 2.0 Client ID for a Web application.
3. Add your local and production origins to Authorized JavaScript origins.
4. Add this scope to the OAuth consent screen:

```text
https://www.googleapis.com/auth/photospicker.mediaitems.readonly
```

## Environment variables

Create `.env` from `.env.example`:

```text
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

The old `GOOGLE_REFRESH_TOKEN` flow is no longer used. Each user signs in with Google and picks the photos they want this frame to play.

## Development

```bash
npm install
npm run dev
```

The Vite dev server only serves the React app. To test the `/api/photos` serverless function locally, use your deployment platform's local server, such as Vercel CLI.

## Build

```bash
npm run build
```
