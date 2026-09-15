export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { imageBase64, symbol, resolution, timestamps } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' })

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

  const ALLOWED_PATTERNS = `
CANDLESTICK PATTERNS (single or multi-candle):
- Morning Star (bullish, forms at support)
- Evening Star (bearish, forms at resistance)
- Bullish Engulfing (bullish, forms at support)
- Bearish Engulfing (bearish, forms at resistance)
- Hammer (bullish, forms at support)
- Hanging Man (bearish, forms at resistance)
- Inverted Hammer (bullish, forms at support)
- Shooting Star (bearish, forms at resistance)
- Doji (indecision, anywhere)
- Spinning Top (indecision, anywhere)
- Harami (indecision, anywhere)
- Marubozu (strong momentum, direction depends on color)

CHART PATTERNS:
- Rising Wedge (bearish reversal/continuation)
- Falling Wedge (bullish reversal/continuation)
- Bullish Pennant (bullish continuation, after strong breakout)
- Bearish Pennant (bearish continuation, after strong breakdown)
- Bullish Rectangle (bullish continuation)
- Bearish Rectangle (bearish continuation)
- Double Bottom (bullish reversal, W shape)
- Double Top (bearish reversal, M shape)
- Head and Shoulders (bearish reversal)
- Inverted Head and Shoulders (bullish reversal)
- Descending Triangle (bearish, flat support + falling resistance)
- Ascending Triangle (bullish, flat resistance + rising support)
- Symmetrical Triangle (indecision, wait for breakout)
`

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

${timestamps ? `Date range visible: ${timestamps[0]} to ${timestamps[timestamps.length-1]}` : ''}

STRICT RULE: You must ONLY identify patterns from this exact list. Do NOT identify any other patterns not in this list:
${ALLOWED_PATTERNS}

TRADING RULES (from the methodology):
- Bullish patterns are valid ONLY when formed at support zones
- Bearish patterns are valid ONLY when formed at resistance zones
- Indecision patterns (Doji, Spinning Top, Harami, Symmetrical Triangle): wait for confirmation, protect capital
- Entry: ALWAYS after confirmation candle closes
- Stop Loss: previous swing low (for buys) or previous swing high (for sells)
- Need 2 or more confluences before signaling a trade
- For uptrend: buy at pullback with bullish signal, SL = previous low, target = next resistance
- For downtrend: sell at pullback with bearish signal, SL = previous high, target = next support

Read the X-axis dates carefully. For each pattern found, provide the exact date range where it appears.

If NO patterns from the allowed list are found, return an empty array [].

Return ONLY a valid JSON array, no other text:
[
  {
    "pattern": "Hammer",
    "signal": "Bullish",
    "confidence": "High",
    "location": "at support zone",
    "notes": "Hammer formed at key support, long lower wick rejecting sellers",
    "startDate": "2024-06-10",
    "endDate": "2024-06-10",
    "confluences": ["at support level", "after downtrend", "high volume candle"],
    "tradeValid": true,
    "entry": 23150,
    "stopLoss": 22950,
    "target1": 23400,
    "target2": 23650,
    "drawLines": [
      {"type": "support", "price": 23000, "label": "Support Zone"},
      {"type": "entry", "price": 23150, "label": "Entry"},
      {"type": "sl", "price": 22950, "label": "Stop Loss"},
      {"type": "target", "price": 23400, "label": "Target 1"},
      {"type": "target", "price": 23650, "label": "Target 2"}
    ]
  }
]

For indecision patterns (Doji, Spinning Top, Harami, Symmetrical Triangle), set "tradeValid": false and omit entry/SL/target.
Only include patterns you are confident about. Return [] if nothing clear from the allowed list.`
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
      else patterns = []
    } catch (e) {
      patterns = []
    }

    return res.json({ patterns })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
