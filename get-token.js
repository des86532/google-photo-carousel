/**
 * Google Drive OAuth Token Generator
 * 
 * Usage:
 *   node get-token.js
 * 
 * This script will:
 * 1. Open a browser for Google OAuth consent
 * 2. Start a local server to receive the callback
 * 3. Exchange the auth code for a refresh token with drive.readonly scope
 * 4. Print the refresh token for you to put in .env.local
 */

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Read .env.local
const envContent = readFileSync('.env.local', 'utf8');
const getEnv = (key) => {
  const match = envContent.match(new RegExp(`${key}="([^"]+)"`));
  return match ? match[1] : null;
};

const CLIENT_ID = getEnv('GOOGLE_CLIENT_ID');
const CLIENT_SECRET = getEnv('GOOGLE_CLIENT_SECRET');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.local');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:3333/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
];

// Step 1: Generate auth URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\n🔐 Google Drive OAuth Token Generator\n');
console.log('Scope:', SCOPES.join(', '));
console.log('Opening browser for authorization...\n');

// Step 2: Start local server to receive callback
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>❌ 授權失敗</h1><p>${error}</p>`);
      console.error('❌ Authorization error:', error);
      server.close();
      process.exit(1);
    }
    
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>❌ No authorization code received</h1>');
      return;
    }
    
    // Step 3: Exchange code for tokens
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }).toString(),
      });
      
      const tokenData = await tokenResponse.json();
      
      if (tokenData.error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>❌ Token exchange failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
        console.error('❌ Token exchange error:', tokenData);
        server.close();
        process.exit(1);
      }
      
      console.log('\n✅ Success! Here is your new refresh token:\n');
      console.log(`GOOGLE_REFRESH_TOKEN="${tokenData.refresh_token}"`);
      console.log('\nScope:', tokenData.scope);
      console.log('\n📋 Please update your .env.local with the new GOOGLE_REFRESH_TOKEN above.\n');
      
      // Quick test: try listing Drive root to verify token works
      console.log('🧪 Testing Drive API access...');
      const testResponse = await fetch(
        'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)',
        { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } }
      );
      const testData = await testResponse.json();
      
      if (testData.files) {
        console.log(`✅ Drive API works! Can access your files.`);
      } else if (testData.error) {
        console.log('❌ Drive API test failed:', testData.error.message);
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html>
          <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: white;">
            <div style="text-align: center; max-width: 500px;">
              <h1>✅ 授權成功！</h1>
              <p>Refresh Token 已輸出在終端機。</p>
              <p style="color: #888;">你可以關閉這個頁面了。</p>
            </div>
          </body>
        </html>
      `);
      
      server.close();
      
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>❌ Error</h1><pre>${err.message}</pre>`);
      console.error('❌ Error:', err);
      server.close();
      process.exit(1);
    }
  }
});

server.listen(3333, () => {
  console.log(`Callback server listening on ${REDIRECT_URI}\n`);
  
  // Open browser
  try {
    execSync(`open "${authUrl.toString()}"`);
  } catch {
    console.log('⚠️ Could not open browser automatically. Please open this URL:\n');
    console.log(authUrl.toString());
  }
});
