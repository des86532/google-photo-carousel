/* global process */

export default async function handler(req, res) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  )

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'Missing environment variables for Google authentication' });
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

    // 2. Fetch Photos
    // Google Photos API configuration
    // We can use a pageToken to get subsequent pages
    // Using POST to /v1/mediaItems:search to support filtering
    const queryUrl = 'https://photoslibrary.googleapis.com/v1/mediaItems:search';
    
    // Parse pageToken from query parameters
    const urlParams = new URL(req.url, `http://${req.headers.host}`);
    const pageToken = urlParams.searchParams.get('pageToken') || '';

    const payload = {
      pageSize: 50,
      filters: {
        mediaTypeFilter: {
          mediaTypes: ['PHOTO']
        }
      }
    };

    if (pageToken) {
      payload.pageToken = pageToken;
    }

    const photosResponse = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!photosResponse.ok) {
      const errorData = await photosResponse.json();
      console.error('Error fetching photos:', errorData);
      return res.status(500).json({ error: 'Failed to fetch photos', details: errorData });
    }

    const photosData = await photosResponse.json();
    
    // Returns array of mediaItems and nextPageToken
    return res.status(200).json(photosData);

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
