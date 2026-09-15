export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { imageBase64, symbol, resolution, timestamps, candles } = req.body
  if (!candles || !candles.length) return res.status(400).json({ error: 'candles data required' })

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })

  // Format OHLCV as compact text for Claude
  const ohlcvText = candles.map((c, i) =>
    `${i},${c.timestamp.slice(0,10)},${c.open},${c.high},${c.low},${c.close},${c.volume}`
  ).join('\n')

  const priceStats = {
    high: Math.max(...candles.map(c => c.high)),
    low: Math.min(...candles.map(c => c.low)),
    first: candles[0].close,
    last: candles[candles.length-1].close,
    count: candles.length
  }

  try {
    // Step 1: Detect CHART PATTERNS from OHLCV data (text based)
    const chartResponse = await fetch('https://api.anthropic.com/v1/messages', {
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
          content: `You are an expert technical analyst. Analyze this OHLCV price data for ${symbol} on ${resolution} timeframe.

Data format: index,date,open,high,low,close,volume
Total candles: ${priceStats.count}
Price range: ${priceStats.low} to ${priceStats.high}
Trend: ${priceStats.last > priceStats.first ? 'Overall upward' : 'Overall downward'}

OHLCV DATA:
${ohlcvText}

Analyze the price structure and identify ONLY these chart patterns:
- Double Top: Two peaks at similar price level, bearish reversal (M shape)
- Double Bottom: Two troughs at similar price level, bullish reversal (W shape)
- Head and Shoulders: Three peaks, middle highest, bearish reversal
- Inverted Head and Shoulders: Three troughs, middle lowest, bullish reversal
- Ascending Triangle: Flat resistance + higher lows converging, bullish
- Descending Triangle: Flat support + lower highs converging, bearish
- Symmetrical Triangle: Lower highs + higher lows converging, breakout either way
- Rising Wedge: Both trendlines rising but converging, bearish
- Falling Wedge: Both trendlines falling but converging, bullish
- Bullish Pennant: Strong up move then small symmetrical triangle, bullish continuation
- Bearish Pennant: Strong down move then small symmetrical triangle, bearish continuation
- Bullish Rectangle: Price consolidating between flat support and resistance in uptrend
- Bearish Rectangle: Price consolidating between flat support and resistance in downtrend

For each pattern:
1. Find the exact start and end index from the data
2. Identify key price levels (resistance, support, neckline)
3. Determine if the pattern is complete or forming
4. Calculate entry, SL, target based on pattern rules:
   - Double Top: entry below neckline, SL above second peak, target = neckline - pattern height
   - Double Bottom: entry above neckline, SL below second trough, target = neckline + pattern height
   - Triangle: entry on breakout candle, SL opposite side of triangle, target = triangle height projected
   - Wedge: entry on breakout, SL at last swing, target = wedge start price

Return ONLY valid JSON array, no other text:
[
  {
    "pattern": "Double Top",
    "signal": "Bearish",
    "confidence": "High",
    "status": "Complete",
    "notes": "Two peaks at ~24150 on index 45 and 67, neckline at 23800",
    "startIndex": 40,
    "endIndex": 75,
    "startDate": "2024-06-01",
    "endDate": "2024-06-20",
    "keyLevels": {
      "resistance": 24150,
      "support": 23800,
      "neckline": 23800
    },
    "tradeValid": true,
    "confluences": ["two touches at same resistance", "volume declining on second peak", "bearish momentum after second peak"],
    "entry": 23780,
    "stopLoss": 24200,
    "target1": 23450,
    "target2": 23100,
    "drawLines": [
      {"type": "resistance", "price": 24150, "label": "Double Top"},
      {"type": "support", "price": 23800, "label": "Neckline"},
      {"type": "entry", "price": 23780, "label": "Entry"},
      {"type": "sl", "price": 24200, "label": "SL"},
      {"type": "target", "price": 23450, "label": "T1"},
      {"type": "target", "price": 23100, "label": "T2"}
    ]
  }
]

Return [] if no clear patterns found. Be strict -- only return high-quality, clear patterns.`
        }]
      })
    })

    const chartData = await chartResponse.json()
    if (!chartResponse.ok) return res.status(500).json({ error: chartData.error?.message || 'Claude API error' })

    let chartPatterns = []
    const chartText = chartData.content[0]?.text || ''
    try {
      const jsonMatch = chartText.match(/\[[\s\S]*\]/)
      if (jsonMatch) chartPatterns = JSON.parse(jsonMatch[0])
    } catch (e) { chartPatterns = [] }

    // Convert startIndex/endIndex to dates
    chartPatterns = chartPatterns.map(p => {
      if (p.startIndex !== undefined && candles[p.startIndex]) {
        p.startDate = candles[p.startIndex].timestamp.slice(0, 10)
      }
      if (p.endIndex !== undefined && candles[p.endIndex]) {
        p.endDate = candles[p.endIndex].timestamp.slice(0, 10)
      }
      return p
    })

    const allPatterns = [...chartPatterns]
    return res.json({ patterns: allPatterns, chartPatternCount: chartPatterns.length, candlePatternCount: 0 })

  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
