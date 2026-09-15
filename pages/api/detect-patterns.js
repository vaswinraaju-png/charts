export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { imageBase64, symbol, resolution, timeframe } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' })

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: imageBase64
                }
              },
              {
                type: 'text',
                text: `You are an expert technical analyst. Analyze this candlestick chart for ${symbol} on ${resolution} timeframe.

Identify any of these chart patterns if present:
- Triangle patterns (Ascending, Descending, Symmetrical)
- Double Top / Double Bottom
- Head and Shoulders / Inverse Head and Shoulders
- Flag / Pennant
- Cup and Handle
- Wedge (Rising, Falling)
- Channel (Uptrend, Downtrend)
- Support / Resistance levels

For each pattern found, provide:
1. Pattern name
2. Where it appears (recent, middle, early part of chart)
3. Bullish or Bearish signal
4. Suggested entry price zone
5. Stop loss zone
6. Target price zone
7. Confidence level (High/Medium/Low)

If no clear patterns, say so honestly. Be concise and specific. Format as JSON array like:
[
  {
    "pattern": "Ascending Triangle",
    "location": "recent",
    "signal": "Bullish",
    "entry": "24200-24250",
    "stopLoss": "23950",
    "target": "24650",
    "confidence": "High",
    "notes": "Flat resistance at 24250 with higher lows forming"
  }
]`
              }
            ]
          }
        ]
      })
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || 'Claude API error', details: data })
    }

    const text = data.content[0]?.text || ''

    // Extract JSON from response
    let patterns = []
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        patterns = JSON.parse(jsonMatch[0])
      } else {
        patterns = [{ pattern: 'Analysis', signal: 'See notes', notes: text, confidence: 'N/A' }]
      }
    } catch (e) {
      patterns = [{ pattern: 'Analysis', signal: 'See notes', notes: text, confidence: 'N/A' }]
    }

    return res.json({ patterns, raw: text })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
