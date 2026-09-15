import { supabase } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { symbol, resolution, limit } = req.query

  if (!symbol) return res.status(400).json({ error: 'symbol required' })

  const { data, error } = await supabase
    .from('candles')
    .select('timestamp, open, high, low, close, volume')
    .eq('symbol', symbol)
    .eq('resolution', resolution || 'D')
    .order('timestamp', { ascending: true })
    .limit(parseInt(limit) || 500)

  if (error) return res.status(500).json({ error: error.message })

  return res.json({ candles: data })
}
