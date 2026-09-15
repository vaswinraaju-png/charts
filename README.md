# Trading Chart

Candlestick chart with Fyers API + Supabase + Next.js on Vercel.

## Setup Steps

### 1. Supabase
- Go to Supabase SQL Editor
- Run `supabase-setup.sql`

### 2. Environment Variables
Copy `.env.local.example` to `.env.local` and fill:
```
FYERS_APP_ID=KRPAOI6871-100
FYERS_SECRET_KEY=your_secret_key
FYERS_REDIRECT_URL=https://127.0.0.1
NEXT_PUBLIC_SUPABASE_URL=https://mzydwcnbmeckmgeylvwh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000

### 4. Deploy to Vercel
- Push to GitHub
- Import repo in Vercel
- Add all env variables in Vercel dashboard
- Deploy

## Usage
1. Click "Open Login" — Fyers login opens
2. After login, copy auth_code from redirect URL (after `auth_code=`)
3. Paste and click "Get Token"
4. Enter symbol (e.g. `NSE:NIFTY50-INDEX`) and resolution
5. Click "Fetch + Chart"
6. Toggle CPR / S/R overlays

## Symbol format (Fyers)
- NIFTY: `NSE:NIFTY50-INDEX`
- BANKNIFTY: `NSE:NIFTYBANK-INDEX`
- Stock: `NSE:RELIANCE-EQ`
- F&O: `NSE:NIFTY2591823000CE`
