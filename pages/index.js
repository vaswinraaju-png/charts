import { useEffect, useRef, useState, useCallback } from 'react'
import Head from 'next/head'
import styles from '../styles/Home.module.css'

const BULL = '#1baf7a'
const BEAR = '#e34948'
const CPR_COLOR = '#f59e0b'
const SR_COLOR = '#6366f1'
const LINE_COLOR = '#60a5fa'
const PAD = { t: 20, r: 16, b: 30, l: 65 }

const LINE_COLORS = {
  resistance: '#a78bfa', support: '#60a5fa', entry: '#e2e8f0',
  sl: '#e34948', target: '#1baf7a', trendline_high: '#f97316', trendline_low: '#f97316',
}

function resolutionLabel(r) {
  const map = { '1':'1 min','3':'3 min','5':'5 min','10':'10 min','15':'15 min','30':'30 min','45':'45 min','60':'1 hr','120':'2 hr','240':'4 hr','D':'Daily','1W':'Weekly','1M':'Monthly' }
  return map[r] || r
}

function findIndexByDate(candles, dateStr) {
  if (!dateStr) return -1
  const target = dateStr.slice(0, 10)
  let best = -1, bestDiff = Infinity
  candles.forEach((c, i) => {
    const diff = Math.abs(new Date(c.timestamp.slice(0,10)) - new Date(target))
    if (diff < bestDiff) { bestDiff = diff; best = i }
  })
  return best
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
  const [chartType, setChartType] = useState('candle') // 'candle' | 'line'
  const [candles, setCandles] = useState([])
  const [stats, setStats] = useState(null)
  const [patterns, setPatterns] = useState([])
  const [detecting, setDetecting] = useState(false)
  const [activePattern, setActivePattern] = useState(null)

  // Viewport state
  const viewRef = useRef({ startIdx: 0, count: 100 })
  const dragRef = useRef({ dragging: false, startX: 0, startIdx: 0 })
  const pinchRef = useRef({ active: false, startDist: 0, startCount: 0 })

  async function getAuthURL() {
    const res = await fetch('/api/auth')
    const { authURL } = await res.json()
    window.open(authURL, '_blank')
    setStatus('Login in the opened tab, copy the auth_code from redirect URL')
  }

  async function exchangeToken() {
    if (!authCode) return setStatus('Paste auth_code first')
    setStatus('Exchanging token...')
    const res = await fetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: authCode.trim() })
    })
    const data = await res.json()
    if (data.access_token) {
      setToken(data.access_token)
      localStorage.setItem('fyers_token', data.access_token)
      setStatus('Token saved!')
    } else setStatus('Error: ' + (data.error || 'Auth failed'))
  }

  async function fetchAndLoad() {
    if (!token) return setStatus('Get token first')
    setStatus('Fetching from Fyers...')
    const res = await fetch('/api/fetch-ohlcv', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      setPatterns([]); setActivePattern(null)
      // Reset viewport to show last 100 candles
      const n = data.candles.length
      viewRef.current = { startIdx: Math.max(0, n - 100), count: Math.min(100, n) }
      setStatus(`Loaded ${data.candles.length} candles`)
    } else setStatus('No data. Fetch first.')
  }

  function computeStats(c) {
    if (!c.length) return
    const closes = c.map(d => d.close)
    const chg = ((closes[closes.length-1] - c[0].open) / c[0].open * 100).toFixed(2)
    setStats({
      high: Math.max(...c.map(d => d.high)).toFixed(2),
      low: Math.min(...c.map(d => d.low)).toFixed(2),
      last: closes[closes.length-1].toFixed(2),
      chg, bull: parseFloat(chg) >= 0
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
    data.forEach(d => { [d.high, d.low, d.close].forEach(p => { const b = Math.round(p/bSize)*bSize; clusters[b]=(clusters[b]||0)+1 }) })
    return Object.entries(clusters).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([p])=>parseFloat(p))
  }

  function resetView() {
    if (!candles.length) return
    const n = candles.length
    viewRef.current = { startIdx: Math.max(0, n-100), count: Math.min(100, n) }
    renderChart()
  }

  function fitAll() {
    if (!candles.length) return
    viewRef.current = { startIdx: 0, count: candles.length }
    renderChart()
  }

  async function detectPatterns() {
    if (!mainRef.current) return
    setDetecting(true); setPatterns([]); setActivePattern(null)
    try {
      const mainCanvas = mainRef.current
      const volCanvas = volRef.current
      const W = mainCanvas.width / devicePixelRatio
      const MH = mainCanvas.height / devicePixelRatio
      const VH = volCanvas.height / devicePixelRatio
      const combined = document.createElement('canvas')
      combined.width = W * devicePixelRatio
      combined.height = (MH + VH) * devicePixelRatio
      const ctx = combined.getContext('2d')
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, combined.width, combined.height)
      ctx.drawImage(mainCanvas, 0, 0)
      ctx.drawImage(volCanvas, 0, mainCanvas.height)
      const base64 = combined.toDataURL('image/png').split(',')[1]
      const { startIdx, count } = viewRef.current
      const visibleCandles = candles.slice(startIdx, startIdx + count)
      const timestamps = visibleCandles.map(c => c.timestamp.slice(0,10))
      const res = await fetch('/api/detect-patterns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, symbol, resolution, timestamps, candles: candles.slice(-100) })
      })
      const data = await res.json()
      if (data.error) setStatus('Error: ' + data.error)
      else {
        setPatterns(data.patterns||[])
        setStatus(`Found ${data.patterns?.length||0} pattern(s) — ${data.chartPatternCount||0} chart, ${data.candlePatternCount||0} candlestick`)
      }
    } catch(e) { setStatus('Error: ' + e.message) }
    setDetecting(false)
  }

  function togglePattern(idx) { setActivePattern(prev => prev === idx ? null : idx) }

  const renderChart = useCallback(() => {
    if (!candles.length || !mainRef.current) return
    const { startIdx, count } = viewRef.current
    const data = candles.slice(startIdx, startIdx + count)
    if (!data.length) return

    const mainCanvas = mainRef.current
    const volCanvas = volRef.current
    const W = mainCanvas.parentElement.offsetWidth || 680
    const MH = 340, VH = 80

    mainCanvas.width = W * devicePixelRatio; mainCanvas.height = MH * devicePixelRatio
    mainCanvas.style.width = W + 'px'; mainCanvas.style.height = MH + 'px'
    const ctx = mainCanvas.getContext('2d')
    ctx.scale(devicePixelRatio, devicePixelRatio)

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff'
    ctx.fillRect(0, 0, W, MH)

    const gridC = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
    const textC = '#898781'
    const axisC = isDark ? '#383835' : '#c3c2b7'

    const n = data.length
    const maxH = Math.max(...data.map(d => d.high))
    const minL = Math.min(...data.map(d => d.low))
    const pad = (maxH - minL) * 0.08
    const priceMax = maxH + pad, priceMin = minL - pad
    const priceRange = priceMax - priceMin || 1

    const cw = W - PAD.l - PAD.r
    const ch = MH - PAD.t - PAD.b
    const slotW = cw / n
    const bodyW = Math.max(1, slotW * 0.55)

    const py = p => PAD.t + ch * (1 - (p - priceMin) / priceRange)
    const cx = i => PAD.l + slotW * i + slotW / 2

    // Grid
    for (let i = 0; i <= 5; i++) {
      const p = priceMin + priceRange * i / 5
      const y = py(p)
      ctx.strokeStyle = gridC; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
      ctx.fillStyle = textC; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
      ctx.fillText(p.toFixed(1), PAD.l - 4, y + 3)
    }
    ctx.strokeStyle = axisC; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, MH-PAD.b); ctx.lineTo(W-PAD.r, MH-PAD.b); ctx.stroke()

    // X labels
    ctx.fillStyle = textC; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    const step = Math.ceil(n / 8)
    data.forEach((d, i) => {
      if (i % step !== 0) return
      const ts = d.timestamp.includes('T') ? d.timestamp.split('T') : [d.timestamp, '']
      const label = resolution === 'D' || resolution === '1W' || resolution === '1M'
        ? ts[0].slice(5)
        : ts[1]?.slice(0, 5) || ts[0].slice(5)
      ctx.fillText(label, cx(i), MH - PAD.b + 14)
    })

    // S/R
    if (showSR) {
      calcSR(data).forEach(level => {
        const y = py(level)
        if (y < PAD.t || y > MH-PAD.b) return
        ctx.strokeStyle = SR_COLOR; ctx.setLineDash([4,4]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W-PAD.r, y); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = SR_COLOR; ctx.font = '9px sans-serif'; ctx.textAlign = 'left'
        ctx.fillText('S/R ' + level.toFixed(1), W-PAD.r+2, y+3)
      })
    }

    // CPR
    if (showCPR && candles.length > 1) {
      const prev = candles[startIdx + count - 2] || candles[candles.length - 2]
      const cpr = calcCPR(prev)
      if (cpr) {
        [{ label: 'P', value: cpr.P }, { label: 'TC', value: cpr.TC }, { label: 'BC', value: cpr.BC }].forEach(({ label, value }) => {
          const y = py(value)
          if (y < PAD.t || y > MH-PAD.b) return
          ctx.strokeStyle = CPR_COLOR; ctx.setLineDash([6,3]); ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W-PAD.r, y); ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = CPR_COLOR; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'right'
          ctx.fillText(`${label} ${value.toFixed(1)}`, PAD.l-4, y+3)
        })
      }
    }

    // LINE CHART
    if (chartType === 'line') {
      ctx.strokeStyle = LINE_COLOR
      ctx.lineWidth = 1.5
      ctx.beginPath()
      data.forEach((d, i) => {
        const x = cx(i), y = py(d.close)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Fill under line
      ctx.lineTo(cx(n-1), MH-PAD.b)
      ctx.lineTo(cx(0), MH-PAD.b)
      ctx.closePath()
      ctx.fillStyle = LINE_COLOR + '18'
      ctx.fill()
    }

    // CANDLE CHART
    if (chartType === 'candle') {
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
        ctx.fillRect(x - bodyW/2, top, bodyW, bodyH)
      })
    }

    // Active pattern overlay -- localized
    if (activePattern !== null && patterns[activePattern]) {
      const p = patterns[activePattern]
      // Find indices within visible data
      const visibleStart = startIdx
      const absStartIdx = findIndexByDate(candles, p.startDate)
      const absEndIdx = findIndexByDate(candles, p.endDate)
      const relStart = absStartIdx - visibleStart
      const relEnd = absEndIdx - visibleStart

      if (relStart >= 0 && relEnd >= 0 && relStart < n) {
        const clampedStart = Math.max(0, relStart)
        const clampedEnd = Math.min(n-1, relEnd)
        const x0 = cx(clampedStart) - slotW/2
        const x1 = cx(clampedEnd) + slotW/2
        const zoneW = x1 - x0
        const signalColor = p.signal === 'Bullish' ? BULL : p.signal === 'Bearish' ? BEAR : '#6366f1'

        ctx.fillStyle = signalColor + '18'
        ctx.fillRect(x0, PAD.t, zoneW, ch)
        ctx.strokeStyle = signalColor + '60'; ctx.lineWidth = 1; ctx.setLineDash([4,4])
        ctx.beginPath(); ctx.moveTo(x0, PAD.t); ctx.lineTo(x0, MH-PAD.b); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x1, PAD.t); ctx.lineTo(x1, MH-PAD.b); ctx.stroke()
        ctx.setLineDash([])

        // Pattern label inside zone
        const labelX = Math.min(Math.max(x0 + zoneW/2, PAD.l+40), W-PAD.r-40)
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'
        const lw = ctx.measureText(p.pattern).width + 16
        ctx.fillStyle = isDark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.9)'
        ctx.fillRect(labelX - lw/2, PAD.t+4, lw, 18)
        ctx.fillStyle = signalColor
        ctx.fillText(p.pattern, labelX, PAD.t+16)

        // Lines within zone
        if (p.drawLines) {
          const labelYUsed = []
          p.drawLines.forEach(line => {
            const price = parseFloat(line.price)
            if (!price || isNaN(price) || price < priceMin || price > priceMax) return
            const y = py(price)
            if (y < PAD.t || y > MH-PAD.b) return
            const color = LINE_COLORS[line.type] || '#888'
            const isDashed = line.type === 'resistance' || line.type === 'support'
            ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9
            ctx.setLineDash(isDashed ? [6,4] : [])
            ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke()
            ctx.setLineDash([]); ctx.globalAlpha = 1
            let labelY = y - 3
            while (labelYUsed.some(ly => Math.abs(ly-labelY) < 14)) labelY -= 14
            labelYUsed.push(labelY)
            const label = `${line.label}  ${price.toFixed(0)}`
            ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left'
            const tw = ctx.measureText(label).width
            ctx.fillStyle = isDark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.9)'
            ctx.fillRect(x1+4, labelY-9, tw+8, 13)
            ctx.fillStyle = color
            ctx.fillText(label, x1+6, labelY)
          })
        }
      }
    }

    // Volume
    volCanvas.width = W * devicePixelRatio; volCanvas.height = VH * devicePixelRatio
    volCanvas.style.width = W + 'px'; volCanvas.style.height = VH + 'px'
    const vctx = volCanvas.getContext('2d')
    vctx.scale(devicePixelRatio, devicePixelRatio)
    vctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff'
    vctx.fillRect(0, 0, W, VH)
    const vols = data.map(d => d.volume)
    const maxV = Math.max(...vols) || 1
    const vch = VH - 24
    const fmtV = v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v
    vctx.strokeStyle = axisC; vctx.lineWidth = 0.5
    vctx.beginPath(); vctx.moveTo(PAD.l, VH-20); vctx.lineTo(W-PAD.r, VH-20); vctx.stroke()
    vctx.fillStyle = textC; vctx.font = '9px sans-serif'; vctx.textAlign = 'right'
    vctx.fillText(fmtV(maxV), PAD.l-4, 12)
    data.forEach((d, i) => {
      const bull = d.close >= d.open
      const bh = vch * (d.volume / maxV)
      const x = cx(i)
      vctx.fillStyle = bull ? 'rgba(27,175,122,0.35)' : 'rgba(227,73,72,0.35)'
      vctx.fillRect(x-bodyW/2, VH-20-bh, bodyW, bh)
      vctx.strokeStyle = bull ? BULL : BEAR; vctx.lineWidth = 0.5
      vctx.strokeRect(x-bodyW/2, VH-20-bh, bodyW, bh)
    })
  }, [candles, showCPR, showSR, chartType, activePattern, patterns])

  // Zoom handler
  function handleWheel(e) {
    e.preventDefault()
    const { startIdx, count } = viewRef.current
    const n = candles.length
    const delta = e.deltaY > 0 ? 1.15 : 0.87
    let newCount = Math.round(count * delta)
    newCount = Math.max(10, Math.min(n, newCount))
    // Zoom toward cursor position
    const rect = mainRef.current.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    let newStart = Math.round(startIdx + (count - newCount) * ratio)
    newStart = Math.max(0, Math.min(n - newCount, newStart))
    viewRef.current = { startIdx: newStart, count: newCount }
    renderChart()
  }

  // Mouse drag handlers
  function handleMouseDown(e) {
    dragRef.current = { dragging: true, startX: e.clientX, startIdx: viewRef.current.startIdx }
  }

  function handleMouseMove(e) {
    if (!dragRef.current.dragging) return
    const { startX, startIdx } = dragRef.current
    const { count } = viewRef.current
    const n = candles.length
    const W = mainRef.current.offsetWidth
    const pxPerCandle = (W - PAD.l - PAD.r) / count
    const delta = Math.round((startX - e.clientX) / pxPerCandle)
    let newStart = startIdx + delta
    newStart = Math.max(0, Math.min(n - count, newStart))
    viewRef.current = { ...viewRef.current, startIdx: newStart }
    renderChart()
  }

  function handleMouseUp() { dragRef.current.dragging = false }

  // Touch handlers for mobile
  function handleTouchStart(e) {
    if (e.touches.length === 1) {
      dragRef.current = { dragging: true, startX: e.touches[0].clientX, startIdx: viewRef.current.startIdx }
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
      pinchRef.current = { active: true, startDist: dist, startCount: viewRef.current.count }
      dragRef.current.dragging = false
    }
  }

  function handleTouchMove(e) {
    e.preventDefault()
    if (e.touches.length === 1 && dragRef.current.dragging) {
      const { startX, startIdx } = dragRef.current
      const { count } = viewRef.current
      const n = candles.length
      const W = mainRef.current.offsetWidth
      const pxPerCandle = (W - PAD.l - PAD.r) / count
      const delta = Math.round((startX - e.touches[0].clientX) / pxPerCandle)
      let newStart = startIdx + delta
      newStart = Math.max(0, Math.min(n - count, newStart))
      viewRef.current = { ...viewRef.current, startIdx: newStart }
      renderChart()
    } else if (e.touches.length === 2 && pinchRef.current.active) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
      const scale = pinchRef.current.startDist / dist
      const n = candles.length
      let newCount = Math.round(pinchRef.current.startCount * scale)
      newCount = Math.max(10, Math.min(n, newCount))
      const { startIdx } = viewRef.current
      const newStart = Math.max(0, Math.min(n - newCount, startIdx))
      viewRef.current = { startIdx: newStart, count: newCount }
      renderChart()
    }
  }

  function handleTouchEnd() {
    dragRef.current.dragging = false
    pinchRef.current.active = false
  }

  // Attach events
  useEffect(() => {
    const canvas = mainRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('touchmove', handleTouchMove)
    }
  }, [candles, renderChart])

  useEffect(() => { if (candles.length) renderChart() }, [renderChart])
  useEffect(() => {
    const saved = localStorage.getItem('fyers_token')
    if (saved) { setToken(saved); setStatus('Token loaded from storage') }
  }, [])
  useEffect(() => {
    window.addEventListener('resize', renderChart)
    return () => window.removeEventListener('resize', renderChart)
  }, [renderChart])

  const { startIdx, count } = viewRef.current

  return (
    <>
      <Head><title>Trading Chart</title></Head>
      <div className={styles.app}>
        <h1 className={styles.title}>Trading Chart</h1>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Fyers Auth</div>
          <div className={styles.row}>
            <button className={styles.btn} onClick={getAuthURL}>1. Open Login</button>
            <input className={styles.input} placeholder="Paste auth_code from redirect URL"
              value={authCode} onChange={e => setAuthCode(e.target.value)} />
            <button className={styles.btn} onClick={exchangeToken}>2. Get Token</button>
          </div>
          {token && <div className={styles.tokenBadge}>Token active</div>}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Fetch Data</div>
          <div className={styles.row}>
            <input className={styles.input} value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="NSE:NIFTY50-INDEX" />
            <select className={styles.select} value={resolution} onChange={e => setResolution(e.target.value)}>
              <option value="1">1 min</option><option value="3">3 min</option><option value="5">5 min</option>
              <option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option>
              <option value="45">45 min</option><option value="60">1 hr</option><option value="120">2 hr</option>
              <option value="240">4 hr</option><option value="D">Daily</option><option value="1W">Weekly</option><option value="1M">Monthly</option>
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
              <input type="checkbox" checked={showCPR} onChange={e => setShowCPR(e.target.checked)} /><span>CPR</span>
            </label>
            <label className={styles.toggle}>
              <input type="checkbox" checked={showSR} onChange={e => setShowSR(e.target.checked)} /><span>S/R</span>
            </label>
            {/* Chart type toggle */}
            <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
              <button onClick={() => setChartType('candle')} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${chartType === 'candle' ? BULL : '#444'}`,
                background: chartType === 'candle' ? BULL + '22' : 'transparent',
                color: chartType === 'candle' ? BULL : '#888'
              }}>Candle</button>
              <button onClick={() => setChartType('line')} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${chartType === 'line' ? LINE_COLOR : '#444'}`,
                background: chartType === 'line' ? LINE_COLOR + '22' : 'transparent',
                color: chartType === 'line' ? LINE_COLOR : '#888'
              }}>Line</button>
            </div>
            {/* Zoom controls */}
            <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
              <button onClick={resetView} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid #444', background: 'transparent', color: '#888' }}>Reset</button>
              <button onClick={fitAll} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid #444', background: 'transparent', color: '#888' }}>Fit All</button>
            </div>
            <span className={styles.candleCount}>
              {candles.length > 0 ? `${Math.min(count, candles.length - startIdx)} of ${candles.length}` : ''}
            </span>
          </div>
        )}

        <div className={styles.chartWrap} style={{ cursor: 'crosshair' }}>
          <canvas ref={mainRef} style={{ display: 'block', width: '100%', touchAction: 'none' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          />
          <canvas ref={volRef} style={{ display: 'block', width: '100%', marginTop: 4 }} />
        </div>

        {candles.length > 0 && (
          <div style={{ fontSize: 11, color: '#555', textAlign: 'center', marginTop: 4 }}>
            Scroll to zoom · Drag to pan · Pinch on mobile
          </div>
        )}

        {candles.length > 0 && (
          <button className={styles.btnPrimary} onClick={detectPatterns} disabled={detecting}
            style={{ marginTop: 12, width: '100%', padding: '10px', fontSize: 14 }}>
            {detecting ? 'Analysing chart with AI...' : 'Detect Patterns with AI'}
          </button>
        )}

        {patterns.length > 0 && (
          <div className={styles.card} style={{ marginTop: 12 }}>
            <div className={styles.cardTitle}>
              AI Pattern Analysis -- {symbol} {resolutionLabel(resolution)}
              <span style={{ fontSize: 11, color: '#888', marginLeft: 8, fontWeight: 400 }}>click Preview to highlight on chart</span>
            </div>
            {patterns.map((p, i) => {
              const isActive = activePattern === i
              const signalColor = p.signal === 'Bullish' ? BULL : p.signal === 'Bearish' ? BEAR : '#6366f1'
              const confColor = p.confidence === 'High' ? BULL : p.confidence === 'Low' ? BEAR : '#f59e0b'
              return (
                <div key={i} style={{ padding: '12px 0', borderBottom: i < patterns.length-1 ? '0.5px solid var(--border,#333)' : 'none', opacity: activePattern !== null && !isActive ? 0.35 : 1, transition: 'opacity 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ background: p.signal === 'Bullish' ? 'rgba(27,175,122,0.15)' : p.signal === 'Bearish' ? 'rgba(227,73,72,0.15)' : 'rgba(99,102,241,0.15)', color: signalColor, padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>{p.pattern}</span>
                    <span style={{ fontSize: 12, color: signalColor }}>{p.signal === 'Bullish' ? '↑' : p.signal === 'Bearish' ? '↓' : '↕'} {p.signal}</span>
                    <span style={{ fontSize: 11, color: confColor }}>{p.confidence} confidence</span>
                    {p.startDate && <span style={{ fontSize: 11, color: '#555' }}>{p.startDate} → {p.endDate}</span>}
                    <button onClick={() => togglePattern(i)} style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, border: `1px solid ${isActive ? signalColor : '#444'}`, background: isActive ? signalColor+'22' : 'transparent', color: isActive ? signalColor : '#888', fontSize: 12, cursor: 'pointer', fontWeight: isActive ? 600 : 400, transition: 'all 0.15s' }}>
                      {isActive ? '✓ Previewing' : 'Preview'}
                    </button>
                  </div>
                  {/* Trade validity badge */}
                  {p.tradeValid === false && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '3px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
                      ⏳ Indecision -- wait for confirmation, protect capital
                    </div>
                  )}
                  {p.tradeValid === true && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(27,175,122,0.12)', color: BULL, padding: '3px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
                      ✓ Trade valid -- enter after confirmation candle
                    </div>
                  )}
                  {p.location && <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>📍 {p.location}</div>}
                  {p.notes && <div style={{ fontSize: 12, color: '#999', marginBottom: 8, lineHeight: 1.5 }}>{p.notes}</div>}
                  {/* Confluences */}
                  {p.confluences && p.confluences.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Confluences ({p.confluences.length})</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {p.confluences.map((c, ci) => (
                          <span key={ci} style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>✓ {c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(p.entry || p.stopLoss || p.target1) && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {p.entry && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry</span><span style={{ fontSize: 14, color: LINE_COLORS.entry, fontWeight: 600 }}>{p.entry}</span></div>}
                      {p.stopLoss && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stop Loss</span><span style={{ fontSize: 14, color: BEAR, fontWeight: 600 }}>{p.stopLoss}</span></div>}
                      {p.target1 && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target 1</span><span style={{ fontSize: 14, color: BULL, fontWeight: 600 }}>{p.target1}</span></div>}
                      {p.target2 && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target 2</span><span style={{ fontSize: 14, color: BULL, fontWeight: 600 }}>{p.target2}</span></div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
