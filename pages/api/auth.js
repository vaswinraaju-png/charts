import crypto from 'crypto'

const APP_ID = process.env.FYERS_APP_ID
const SECRET_KEY = process.env.FYERS_SECRET_KEY
const REDIRECT_URL = process.env.FYERS_REDIRECT_URL || 'https://127.0.0.1'

export default async function handler(req, res) {
  // GET - return auth URL for user to login
  if (req.method === 'GET') {
    const authURL = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URL)}&response_type=code&state=charter`
    return res.json({ authURL })
  }

  // POST - exchange auth_code for access_token
  if (req.method === 'POST') {
    const { auth_code } = req.body
    if (!auth_code) return res.status(400).json({ error: 'auth_code required' })

    const appIdHash = crypto
      .createHash('sha256')
      .update(`${APP_ID}:${SECRET_KEY}`)
      .digest('hex')

    try {
      const response = await fetch('https://api-t1.fyers.in/api/v3/validate-authcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', appIdHash, code: auth_code })
      })
      const data = await response.json()
      if (data.access_token) {
        return res.json({ access_token: data.access_token })
      }
      return res.status(400).json({ error: data.message || 'Auth failed' })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  res.status(405).json({ error: 'Method not allowed' })
}
