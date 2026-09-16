export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { symbol, resolution, access_token, seenPatterns } = req.body
  if (!symbol || !access_token) return res.status(400).json({ error: 'symbol and access_token required' })

  const APP_ID = process.env.FYERS_APP_ID
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

  try {
    // Step 1: Fetch latest candles
    const params = new URLSearchParams({
      symbol, resolution: resolution || '5',
      date_format: '1',
      range_from: getDateNDaysAgo(5),
      range_to: getToday(),
      cont_flag: '1'
    })

    const fyersRes = await fetch(`https://api-t1.fyers.in/data/history?${params}`, {
      headers: { Authorization: `${APP_ID}:${access_token}` }
    })
    const fyersText = await fyersRes.text()
    let fyersData
    try { fyersData = JSON.parse(fyersText) } catch(e) {
      return res.status(500).json({ error: 'Fyers error', raw: fyersText.slice(0, 200) })
    }
    if (fyersData.s !== 'ok') return res.status(400).json({ error: fyersData.message || 'Fyers error' })

    const raw = fyersData.candles || []
    const seen = new Map()
    raw.forEach(c => {
      const ts = new Date(c[0] * 1000).toISOString()
      seen.set(ts, { timestamp: ts, open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })
    })
    const candles = Array.from(seen.values()).slice(-100)
    if (candles.length < 20) return res.json({ patterns: [], candles })

    // Step 2: Run Claude pattern detection on OHLCV
    const ohlcvText = candles.map((c, i) =>
      `${i},${c.timestamp.slice(0,10)},${c.open},${c.high},${c.low},${c.close},${c.volume}`
    ).join('\n')

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Analyze OHLCV data for ${symbol} ${resolution}min. Find ONLY these patterns:
Double Top, Double Bottom, Head and Shoulders, Inverted Head and Shoulders,
Ascending Triangle, Descending Triangle, Symmetrical Triangle,
Rising Wedge, Falling Wedge, Bullish Pennant, Bearish Pennant,
Bullish Rectangle, Bearish Rectangle

Data (index,date,open,high,low,close,volume):
${ohlcvText}

Return ONLY JSON array of HIGH confidence patterns with 2+ confluences:
[{"pattern":"Double Top","signal":"Bearish","confidence":"High","startIndex":40,"endIndex":75,
"confluences":["two equal peaks","volume declining"],"entry":23780,"stopLoss":24200,
"target1":23450,"target2":23100,"notes":"Brief description",
"drawLines":[{"type":"resistance","price":24150,"label":"Resistance"},{"type":"support","price":23800,"label":"Neckline"},{"type":"entry","price":23780,"label":"Entry"},{"type":"sl","price":24200,"label":"SL"},{"type":"target","price":23450,"label":"T1"}]}]

Return [] if nothing clear. Only High confidence with 2+ confluences.`
        }]
      })
    })

    const claudeData = await claudeRes.json()
    let patterns = []
    if (claudeRes.ok) {
      const text = claudeData.content[0]?.text || ''
      try {
        const match = text.match(/\[[\s\S]*\]/)
        if (match) patterns = JSON.parse(match[0])
      } catch(e) {}
    }

    // Map index to dates
    patterns = patterns.map(p => {
      if (p.startIndex !== undefined && candles[p.startIndex]) p.startDate = candles[p.startIndex].timestamp.slice(0,10)
      if (p.endIndex !== undefined && candles[p.endIndex]) p.endDate = candles[p.endIndex].timestamp.slice(0,10)
      return p
    })

    // Deduplicate -- filter out already seen patterns
    const seen2 = new Set(seenPatterns || [])
    const newPatterns = patterns.filter(p => {
      const key = `${p.pattern}-${p.startDate}-${p.endDate}`
      if (seen2.has(key)) return false
      seen2.add(key)
      return true
    })

    return res.json({
      patterns: newPatterns,
      allPatterns: patterns,
      candles,
      timestamp: new Date().toISOString()
    })
  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}

function getToday() { return new Date().toISOString().split('T')[0] }
function getDateNDaysAgo(n) { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0] }
