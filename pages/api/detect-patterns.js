export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { imageBase64, symbol, resolution, timestamps } = req.body
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
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: imageBase64 }
            },
            {
              type: 'text',
              text: `You are an expert technical analyst. Analyze this candlestick chart for ${symbol} on ${resolution} timeframe.

The X-axis shows dates. The chart has ${timestamps ? timestamps.length : 'multiple'} candles.
${timestamps ? `Date range: ${timestamps[0]} to ${timestamps[timestamps.length-1]}` : ''}

IMPORTANT: For each pattern, identify EXACTLY when it appears by reading the X-axis dates carefully.
Provide startDate and endDate so the pattern can be highlighted on the correct portion of the chart.

Return ONLY a valid JSON array:
[
  {
    "pattern": "Double Top",
    "signal": "Bearish",
    "confidence": "High",
    "notes": "Two peaks at same resistance level",
    "startDate": "2024-06-10",
    "endDate": "2024-06-18",
    "entry": 24020,
    "stopLoss": 24200,
    "target1": 23800,
    "target2": 23600,
    "drawLines": [
      {"type": "resistance", "price": 24150, "label": "Double Top"},
      {"type": "support", "price": 23900, "label": "Neckline"},
      {"type": "entry", "price": 24020, "label": "Entry"},
      {"type": "sl", "price": 24200, "label": "SL"},
      {"type": "target", "price": 23800, "label": "T1"},
      {"type": "target", "price": 23600, "label": "T2"}
    ]
  }
]

Line types: resistance, support, entry, sl, target, trendline_high, trendline_low
Read X-axis dates carefully for startDate/endDate. Return valid JSON only.`
            }
          ]
        }]
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
