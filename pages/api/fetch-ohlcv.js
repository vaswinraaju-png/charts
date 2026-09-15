import { supabase } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { symbol, resolution, date_from, date_to, access_token } = req.body

  if (!symbol || !access_token) {
    return res.status(400).json({ error: 'symbol and access_token required' })
  }

  const APP_ID = process.env.FYERS_APP_ID

  try {
    // Fetch from Fyers
    const params = new URLSearchParams({
      symbol,
      resolution: resolution || 'D',
      date_format: '1',
      range_from: date_from || getDateNDaysAgo(365),
      range_to: date_to || getToday(),
      cont_flag: '1'
    })

    const fyersRes = await fetch(
      `https://api-t1.fyers.in/api/v3/history?${params}`,
      {
        headers: {
          Authorization: `${APP_ID}:${access_token}`,
          'Content-Type': 'application/json'
        }
      }
    )

    const fyersData = await fyersRes.json()

    if (fyersData.s !== 'ok') {
      return res.status(400).json({ error: fyersData.message || 'Fyers API error', details: fyersData })
    }

    const candles = fyersData.candles.map(c => ({
      symbol,
      resolution: resolution || 'D',
      timestamp: new Date(c[0] * 1000).toISOString(),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }))

    // Upsert into Supabase
    const { error } = await supabase
      .from('candles')
      .upsert(candles, { onConflict: 'symbol,resolution,timestamp' })

    if (error) return res.status(500).json({ error: error.message })

    return res.json({ success: true, count: candles.length })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

function getDateNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}
