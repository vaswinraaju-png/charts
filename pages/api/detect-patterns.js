export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { imageBase64, symbol, resolution } = req.body
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
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: imageBase64 }
              },
              {
                type: 'text',
                text: `You are an expert technical analyst. Analyze this candlestick chart for ${symbol} on ${resolution} timeframe.

Identify chart patterns and key price levels. For EVERY pattern and level, you MUST provide exact price numbers so they can be drawn on the chart.

Return ONLY a JSON array, no other text:
[
  {
    "pattern": "Double Top",
    "signal": "Bearish",
    "confidence": "High",
    "notes": "Brief description",
    "priceLevel": 23430,
    "entry": 23200,
    "entryHigh": 23220,
    "stopLoss": 23450,
    "target1": 23050,
    "target2": 22900,
    "drawLines": [
      {"type": "resistance", "price": 23430, "label": "Double Top Resistance"},
      {"type": "support", "price": 23200, "label": "Neckline"},
      {"type": "entry", "price": 23200, "label": "Entry"},
      {"type": "sl", "price": 23450, "label": "Stop Loss"},
      {"type": "target", "price": 23050, "label": "Target 1"},
      {"type": "target", "price": 22900, "label": "Target 2"}
    ]
  }
]

Line types: "resistance" (purple dashed), "support" (blue dashed), "entry" (white solid), "sl" (red solid), "target" (green solid), "trendline_high" (orange), "trendline_low" (orange).

Be specific with prices. Read the Y-axis carefully. Return valid JSON only.`
              }
            ]
          }
        ]
      })
    })

    const data = await response.json()
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' })

    const text = data.content[0]?.text || ''
    let patterns = []
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) patterns = JSON.parse(jsonMatch[0])
      else patterns = [{ pattern: 'Analysis', signal: 'Neutral', notes: text, confidence: 'N/A', drawLines: [] }]
    } catch (e) {
      patterns = [{ pattern: 'Analysis', signal: 'Neutral', notes: text, confidence: 'N/A', drawLines: [] }]
    }

    return res.json({ patterns })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
