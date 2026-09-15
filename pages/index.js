import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import styles from '../styles/Home.module.css'

const BULL = '#1baf7a'
const BEAR = '#e34948'
const CPR_COLOR = '#f59e0b'
const SR_COLOR = '#6366f1'
const TRI_COLOR = '#22d3ee'
const PAD = { t: 20, r: 16, b: 30, l: 65 }

// Linear regression: returns {slope, intercept}
function linReg(points) {
  const n = points.length
  if (n < 2) return null
  let sx = 0, sy = 0, sxy = 0, sx2 = 0
  points.forEach(([x, y]) => { sx += x; sy += y; sxy += x * y; sx2 += x * x })
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx)
  const intercept = (sy - slope * sx) / n
  return { slope, intercept }
}

function detectTriangles(data, lookback = 30) {
  const results = []
  if (data.length < lookback) return results

  const start = Math.max(0, data.length - lookback)
  const window = data.slice(start)
  const n = window.length

  // Find swing highs and lows
  const swingHighs = [], swingLows = []
  for (let i = 2; i < n - 2; i++) {
    if (window[i].high >= window[i-1].high && window[i].high >= window[i-2].high &&
        window[i].high >= window[i+1].high && window[i].high >= window[i+2].high) {
      swingHighs.push([i, window[i].high])
    }
    if (window[i].low <= window[i-1].low && window[i].low <= window[i-2].low &&
        window[i].low <= window[i+1].low && window[i].low <= window[i+2].low) {
      swingLows.push([i, window[i].low])
    }
  }

  if (swingHighs.length < 2 || swingLows.length < 2) return results

  const highReg = linReg(swingHighs)
  const lowReg = linReg(swingLows)
  if (!highReg || !lowReg) return results

  const highSlope = highReg.slope
  const lowSlope = lowReg.slope

  const FLAT = 0.15 // threshold for "flat" slope relative to price
  const priceRange = Math.max(...data.map(d => d.high)) - Math.min(...data.map(d => d.low))
  const flatThresh = priceRange * FLAT / n

  let type = null
  if (Math.abs(highSlope) < flatThresh && lowSlope > flatThresh) {
    type = 'Ascending Triangle'
  } else if (highSlope < -flatThresh && Math.abs(lowSlope) < flatThresh) {
    type = 'Descending Triangle'
  } else if (highSlope < -flatThresh && lowSlope > flatThresh) {
    type = 'Symmetrical Triangle'
  }

  if (type) {
    results.push({
      type,
      bullish: type === 'Ascending Triangle' ? true : type === 'Descending Triangle' ? false : null,
      startIndex: start,
      endIndex: data.length - 1,
      highReg: { ...highReg, points: swingHighs.map(([i, v]) => [i + start, v]) },
      lowReg: { ...lowReg, points: swingLows.map(([i, v]) => [i + start, v]) },
      n,
      start
    })
  }

  return results
}

export default function Home() {
  const mainRef = useRef(null)
  const volRef = useRef(null)
  const [token, setToken] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [symbol, setSymbol] = useState('NSE:NIFTY50-INDEX')
  const [resolution, setResolution] = useState('D')
  const [status, setStatus] = useState('')
  const [showCPR, setShowCPR] = useState(false)
  const [showSR, setShowSR] = useState(false)
  const [showTriangle, setShowTriangle] = useState(false)
  const [candles, setCandles] = useState([])
  const [stats, setStats] = useState(null)
  const [triangles, setTriangles] = useState([])

  async function getAuthURL() {
    const res = await fetch('/api/auth')
    const { authURL } = await res.json()
    window.open(authURL, '_blank')
    setStatus('Login in the opened tab, copy the auth_code from the redirect URL')
  }

  async function exchangeToken() {
    if (!authCode) return setStatus('Paste auth_code first')
    setStatus('Exchanging token...')
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: authCode.trim() })
    })
    const data = await res.json()
    if (data.access_token) {
      setToken(data.access_token)
      localStorage.setItem('fyers_token', data.access_token)
      setStatus('Token saved!')
    } else {
      setStatus('Error: ' + (data.error || 'Auth failed'))
    }
  }

  async function fetchAndLoad() {
    if (!token) return setStatus('Get token first')
    setStatus('Fetching from Fyers...')
    const res = await fetch('/api/fetch-ohlcv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, resolution, access_token: token })
    })
    const data = await res.json()
    if (data.error) return setStatus('Error: ' + data.error)
    setStatus(`Saved ${data.count} candles. Loading chart...`)
    await loadCandles()
  }

  async function loadCandles() {
    const res = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&limit=500`)
    const data = await res.json()
    if (data.candles && data.candles.length) {
      setCandles(data.candles)
      computeStats(data.candles)
      setTriangles(detectTriangles(data.candles))
      setStatus(`Loaded ${data.candles.length} candles`)
    } else {
      setStatus('No data. Fetch first.')
    }
  }

  function computeStats(c) {
    if (!c.length) return
    const highs = c.map(d => d.high), lows = c.map(d => d.low), closes = c.map(d => d.close)
    const chg = ((closes[closes.length - 1] - c[0].open) / c[0].open * 100).toFixed(2)
    setStats({
      high: Math.max(...highs).toFixed(2),
      low: Math.min(...lows).toFixed(2),
      last: closes[closes.length - 1].toFixed(2),
      chg,
      bull: parseFloat(chg) >= 0
    })
  }

  function calcCPR(prev) {
    if (!prev) return null
    const P = (prev.high + prev.low + prev.close) / 3
    const TC = (prev.high + prev.low) / 2
    const BC = 2 * P - TC
    return { P, TC: Math.max(TC, BC), BC: Math.min(TC, BC) }
  }

  function calcSR(data) {
    const bSize = (Math.max(...data.map(d => d.high)) - Math.min(...data.map(d => d.low))) / 20
    const clusters = {}
    data.forEach(d => {
      [d.high, d.low, d.close].forEach(p => {
        const bucket = Math.round(p / bSize) * bSize
        clusters[bucket] = (clusters[bucket] || 0) + 1
      })
    })
    return Object.entries(clusters)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([price]) => parseFloat(price))
  }

  useEffect(() => {
    const saved = localStorage.getItem('fyers_token')
    if (saved) { setToken(saved); setStatus('Token loaded from storage') }
  }, [])

  useEffect(() => {
    if (candles.length) renderChart()
  }, [candles, showCPR, showSR, showTriangle])

  function renderChart() {
    const data = candles
    if (!data.length || !mainRef.current) return

    const mainCanvas = mainRef.current
    const volCanvas = volRef.current
    const W = mainCanvas.parentElement.offsetWidth || 680
    const MH = 380, VH = 80

    mainCanvas.width = W * devicePixelRatio
    mainCanvas.height = MH * devicePixelRatio
    mainCanvas.style.width = W + 'px'
    mainCanvas.style.height = MH + 'px'
    const ctx = mainCanvas.getContext('2d')
    ctx.scale(devicePixelRatio, devicePixelRatio)

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const gridC = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
    const textC = '#898781'
    const axisC = isDark ? '#383835' : '#c3c2b7'

    const n = data.length
    const maxH = Math.max(...data.map(d => d.high))
    const minL = Math.min(...data.map(d => d.low))
    const pad = (maxH - minL) * 0.08
    const priceMax = maxH + pad, priceMin = minL - pad
    const priceRange = priceMax - priceMin

    const cw = W - PAD.l - PAD.r
    const ch = MH - PAD.t - PAD.b
    const slotW = cw / n
    const bodyW = Math.max(2, slotW * 0.55)

    const py = p => PAD.t + ch * (1 - (p - priceMin) / priceRange)
    const cx = i => PAD.l + slotW * i + slotW / 2

    // Grid
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 5; i++) {
      const p = priceMin + priceRange * i / 5
      const y = py(p)
      ctx.strokeStyle = gridC
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
      ctx.fillStyle = textC; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
      ctx.fillText(p.toFixed(1), PAD.l - 4, y + 3)
    }

    // Axis
    ctx.strokeStyle = axisC; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, MH - PAD.b); ctx.lineTo(W - PAD.r, MH - PAD.b); ctx.stroke()

    // X labels
    ctx.fillStyle = textC; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    const step = Math.ceil(n / 10)
    data.forEach((d, i) => {
      if (i % step !== 0) return
      const ts = d.timestamp.split('T')[0]
      ctx.fillText(ts.slice(5), cx(i), MH - PAD.b + 14)
    })

    // S/R
    if (showSR) {
      const levels = calcSR(data)
      levels.forEach(level => {
        const y = py(level)
        if (y < PAD.t || y > MH - PAD.b) return
        ctx.strokeStyle = SR_COLOR; ctx.setLineDash([4, 4]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = SR_COLOR; ctx.font = '9px sans-serif'; ctx.textAlign = 'left'
        ctx.fillText('S/R ' + level.toFixed(1), W - PAD.r + 2, y + 3)
      })
    }

    // CPR
    if (showCPR && data.length > 1) {
      const prev = data[data.length - 2]
      const cpr = calcCPR({ high: prev.high, low: prev.low, close: prev.close })
      if (cpr) {
        [{ label: 'P', value: cpr.P }, { label: 'TC', value: cpr.TC }, { label: 'BC', value: cpr.BC }].forEach(({ label, value }) => {
          const y = py(value)
          if (y < PAD.t || y > MH - PAD.b) return
          ctx.strokeStyle = CPR_COLOR; ctx.setLineDash([6, 3]); ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = CPR_COLOR; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'right'
          ctx.fillText(`${label} ${value.toFixed(1)}`, PAD.l - 4, y + 3)
        })
      }
    }

    // Triangle overlay
    if (showTriangle && triangles.length > 0) {
      triangles.forEach(tri => {
        const { highReg, lowReg, startIndex, endIndex } = tri
        const x0 = cx(startIndex)
        const x1 = cx(endIndex)

        // High trendline
        const highY0 = py(highReg.slope * (startIndex - tri.start) + highReg.intercept)
        const highY1 = py(highReg.slope * (endIndex - tri.start) + highReg.intercept)

        // Low trendline
        const lowY0 = py(lowReg.slope * (startIndex - tri.start) + lowReg.intercept)
        const lowY1 = py(lowReg.slope * (endIndex - tri.start) + lowReg.intercept)

        ctx.strokeStyle = TRI_COLOR
        ctx.lineWidth = 1.5
        ctx.setLineDash([])

        // Draw upper trendline
        ctx.beginPath(); ctx.moveTo(x0, highY0); ctx.lineTo(x1, highY1); ctx.stroke()
        // Draw lower trendline
        ctx.beginPath(); ctx.moveTo(x0, lowY0); ctx.lineTo(x1, lowY1); ctx.stroke()
        // Connect start
        ctx.beginPath(); ctx.moveTo(x0, highY0); ctx.lineTo(x0, lowY0); ctx.stroke()

        // Swing high dots
        highReg.points.forEach(([i, v]) => {
          ctx.beginPath(); ctx.arc(cx(i), py(v), 3, 0, Math.PI * 2)
          ctx.fillStyle = TRI_COLOR; ctx.fill()
        })
        // Swing low dots
        lowReg.points.forEach(([i, v]) => {
          ctx.beginPath(); ctx.arc(cx(i), py(v), 3, 0, Math.PI * 2)
          ctx.fillStyle = TRI_COLOR; ctx.fill()
        })

        // Label
        ctx.fillStyle = TRI_COLOR
        ctx.font = 'bold 11px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(tri.type, (x0 + x1) / 2, Math.min(highY0, highY1) - 10)
      })
    }

    // Candles
    data.forEach((d, i) => {
      const x = cx(i)
      const bull = d.close >= d.open
      const color = bull ? BULL : BEAR
      const top = py(Math.max(d.open, d.close))
      const bot = py(Math.min(d.open, d.close))
      const bodyH = Math.max(1, bot - top)

      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, slotW * 0.08)
      ctx.beginPath(); ctx.moveTo(x, py(d.high)); ctx.lineTo(x, py(d.low)); ctx.stroke()
      ctx.fillStyle = color
      ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH)
    })

    // Volume
    volCanvas.width = W * devicePixelRatio
    volCanvas.height = VH * devicePixelRatio
    volCanvas.style.width = W + 'px'
    volCanvas.style.height = VH + 'px'
    const vctx = volCanvas.getContext('2d')
    vctx.scale(devicePixelRatio, devicePixelRatio)

    const vols = data.map(d => d.volume)
    const maxV = Math.max(...vols) || 1
    const vch = VH - 24
    const fmtV = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v

    vctx.strokeStyle = axisC; vctx.lineWidth = 0.5
    vctx.beginPath(); vctx.moveTo(PAD.l, VH - 20); vctx.lineTo(W - PAD.r, VH - 20); vctx.stroke()
    vctx.fillStyle = textC; vctx.font = '9px sans-serif'; vctx.textAlign = 'right'
    vctx.fillText(fmtV(maxV), PAD.l - 4, 12)

    data.forEach((d, i) => {
      const bull = d.close >= d.open
      const bh = vch * (d.volume / maxV)
      const x = cx(i)
      vctx.fillStyle = bull ? 'rgba(27,175,122,0.35)' : 'rgba(227,73,72,0.35)'
      vctx.fillRect(x - bodyW / 2, VH - 20 - bh, bodyW, bh)
      vctx.strokeStyle = bull ? BULL : BEAR; vctx.lineWidth = 0.5
      vctx.strokeRect(x - bodyW / 2, VH - 20 - bh, bodyW, bh)
    })
  }

  useEffect(() => {
    window.addEventListener('resize', renderChart)
    return () => window.removeEventListener('resize', renderChart)
  }, [candles, showCPR, showSR, showTriangle])

  return (
    <>
      <Head><title>Trading Chart</title></Head>
      <div className={styles.app}>
        <h1 className={styles.title}>Trading Chart</h1>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Fyers Auth</div>
          <div className={styles.row}>
            <button className={styles.btn} onClick={getAuthURL}>1. Open Login</button>
            <input
              className={styles.input}
              placeholder="Paste auth_code from redirect URL"
              value={authCode}
              onChange={e => setAuthCode(e.target.value)}
            />
            <button className={styles.btn} onClick={exchangeToken}>2. Get Token</button>
          </div>
          {token && <div className={styles.tokenBadge}>Token active</div>}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Fetch Data</div>
          <div className={styles.row}>
            <input
              className={styles.input}
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="NSE:NIFTY50-INDEX"
            />
            <select className={styles.select} value={resolution} onChange={e => setResolution(e.target.value)}>
              <option value="1">1 min</option>
              <option value="3">3 min</option>
              <option value="5">5 min</option>
              <option value="10">10 min</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1 hr</option>
              <option value="120">2 hr</option>
              <option value="240">4 hr</option>
              <option value="D">Daily</option>
              <option value="1W">Weekly</option>
              <option value="1M">Monthly</option>
            </select>
            <button className={styles.btnPrimary} onClick={fetchAndLoad}>Fetch + Chart</button>
            <button className={styles.btn} onClick={loadCandles}>Load from DB</button>
          </div>
          {status && <div className={styles.status}>{status}</div>}
        </div>

        {stats && (
          <div className={styles.stats}>
            <div className={styles.stat}><div className={styles.statL}>High</div><div className={styles.statV}>{stats.high}</div></div>
            <div className={styles.stat}><div className={styles.statL}>Low</div><div className={styles.statV}>{stats.low}</div></div>
            <div className={styles.stat}><div className={styles.statL}>Last</div><div className={styles.statV}>{stats.last}</div></div>
            <div className={styles.stat}><div className={styles.statL}>Change</div><div className={styles.statV} style={{ color: stats.bull ? BULL : BEAR }}>{stats.chg}%</div></div>
          </div>
        )}

        {candles.length > 0 && (
          <div className={styles.toggleRow}>
            <label className={styles.toggle}>
              <input type="checkbox" checked={showCPR} onChange={e => setShowCPR(e.target.checked)} />
              <span>CPR (Daily)</span>
            </label>
            <label className={styles.toggle}>
              <input type="checkbox" checked={showSR} onChange={e => setShowSR(e.target.checked)} />
              <span>S/R Zones</span>
            </label>
            <label className={styles.toggle}>
              <input type="checkbox" checked={showTriangle} onChange={e => setShowTriangle(e.target.checked)} />
              <span style={{ color: TRI_COLOR }}>Triangles</span>
            </label>
            <span className={styles.candleCount}>{candles.length} candles</span>
          </div>
        )}

        <div className={styles.chartWrap}>
          <canvas ref={mainRef} style={{ display: 'block', width: '100%' }} />
          <canvas ref={volRef} style={{ display: 'block', width: '100%', marginTop: 4 }} />
        </div>

        {candles.length > 0 && (
          <div className={styles.legend}>
            <span><span className={styles.dot} style={{ background: BULL }} /> Bullish</span>
            <span><span className={styles.dot} style={{ background: BEAR }} /> Bearish</span>
            {showCPR && <span><span className={styles.dot} style={{ background: CPR_COLOR }} /> CPR</span>}
            {showSR && <span><span className={styles.dot} style={{ background: SR_COLOR }} /> S/R</span>}
            {showTriangle && <span><span className={styles.dot} style={{ background: TRI_COLOR }} /> Triangle</span>}
          </div>
        )}

        {showTriangle && (
          <div className={styles.card} style={{ marginTop: 12 }}>
            <div className={styles.cardTitle}>Triangle Patterns Detected</div>
            {triangles.length === 0 ? (
              <div style={{ fontSize: 13, color: '#888' }}>No triangle patterns found in last 30 candles. Try Daily or Weekly timeframe.</div>
            ) : triangles.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '0.5px solid var(--border, #e0e0e0)' }}>
                <span style={{
                  background: TRI_COLOR + '22', color: TRI_COLOR,
                  padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 500
                }}>{t.type}</span>
                <span style={{ fontSize: 13, color: t.bullish === true ? BULL : t.bullish === false ? BEAR : '#888' }}>
                  {t.bullish === true ? '↑ Bullish breakout expected' : t.bullish === false ? '↓ Bearish breakout expected' : '↕ Breakout either way'}
                </span>
                <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>
                  Last {t.n} candles
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
