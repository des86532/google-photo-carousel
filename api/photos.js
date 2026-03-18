/* global process */

/**
 * Google Drive API - List images from a specific folder
 * 
 * Replaces the deprecated Google Photos Library API (deprecated March 31, 2025).
 * 
 * Setup:
 * 1. Create a folder in Google Drive
 * 2. Put your photos in it
 * 3. Set GOOGLE_DRIVE_FOLDER_ID in your environment variables
 * 4. Use a refresh token with `drive.readonly` scope
 */
export default async function handler(req, res) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID } = process.env;

  // Debug: list all GOOGLE_* env vars (keys only)
  const googleEnvKeys = Object.keys(process.env).filter(k => k.startsWith('GOOGLE'));
  console.log('Available GOOGLE_* env vars:', googleEnvKeys);
  console.log('GOOGLE_DRIVE_FOLDER_ID value:', GOOGLE_DRIVE_FOLDER_ID ? `"${GOOGLE_DRIVE_FOLDER_ID}"` : 'UNDEFINED');

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'Missing Google authentication environment variables' });
  }

  if (!GOOGLE_DRIVE_FOLDER_ID) {
    return res.status(500).json({ error: 'Missing GOOGLE_DRIVE_FOLDER_ID environment variable' });
  }

  try {
    // 1. Get Access Token from Refresh Token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Error fetching access token:', errorData);
      return res.status(500).json({ error: 'Failed to obtain access token', details: errorData });
    }

    const { access_token } = await tokenResponse.json();

    // 2. List image files from the specified Google Drive folder
    const urlParams = new URL(req.url, `http://${req.headers.host}`);
    const pageToken = urlParams.searchParams.get('pageToken') || '';

    // Query: files in the specified folder that are images
    // Query: files in the specified folder that are images OR videos
    const query = `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`;
    
    const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
    driveUrl.searchParams.set('q', query);
    driveUrl.searchParams.set('pageSize', '50');
    // Added webContentLink to support direct video streaming/downloading
    driveUrl.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,thumbnailLink,webContentLink,imageMediaMetadata,videoMediaMetadata)');
    driveUrl.searchParams.set('orderBy', 'createdTime desc');
    
    if (pageToken) {
      driveUrl.searchParams.set('pageToken', pageToken);
    }

    const driveResponse = await fetch(driveUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    });

    if (!driveResponse.ok) {
      const errorText = await driveResponse.text();
      console.error('Error fetching files from Drive:', driveResponse.status, errorText);
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { raw: errorText };
      }
      return res.status(500).json({ error: 'Failed to fetch files from Drive', status: driveResponse.status, details: errorData });
    }

    const driveData = await driveResponse.json();

    // 3. Transform Drive files into a format similar to Google Photos API
    const mediaItems = (driveData.files || []).map(file => {
      let mediaUrl = '';
      
      if (file.mimeType.startsWith('video/')) {
        // For videos, use webContentLink for playing
        // (Note: webContentLink downloads the file, but standard HTML5 video player can stream it)
        mediaUrl = file.webContentLink;
      } else if (file.thumbnailLink) {
        // Replace size parameter for high-res (2048px)
        mediaUrl = file.thumbnailLink.replace(/=s\d+$/, '=s2048');
      }

      return {
        id: file.id,
        filename: file.name,
        mimeType: file.mimeType,
        baseUrl: mediaUrl,
        mediaMetadata: file.imageMediaMetadata || file.videoMediaMetadata || {},
      };
    }).filter(item => item.baseUrl); // Only include items with valid URLs

    console.log(`Fetched ${mediaItems.length} media items from Google Drive folder`);

    return res.status(200).json({
      mediaItems,
      nextPageToken: driveData.nextPageToken || null,
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

