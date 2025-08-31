'use client'

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { supabase, paintChannel, Paint, PaintUpdate, PaintDelete, RealtimeMessage } from '@/lib/supabase'

interface PaintCanvasProps {
  center?: [number, number]
  zoom?: number
  mapStyle?: string
}

interface PendingPaint {
  x: number
  y: number
  color: string | null
  owner: string
  timestamp: number
}

interface PaintBatch {
  paints: PaintUpdate[]
  deletes: PaintDelete[]
}

const CELL_SIZE_METERS = 20.0375
const PAINT_BATCH_DELAY = 100 // ms
const MAX_BATCH_SIZE = 50

export default function PaintCanvas({ 
  center = [120.75754, 13.89790], 
  zoom = 7.3,
  mapStyle = 'https://api.maptiler.com/maps/0198b6c2-2bd8-73e7-8d52-98bec753acb5/style.json?key=cnLd5cDF8MjR4DD1YOHi'
}: PaintCanvasProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  
  // State
  const [isPainting, setIsPainting] = useState(false)
  const [selectedColor, setSelectedColor] = useState('#FF4500')
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [isLoading, setIsLoading] = useState(true)
  
  // Paint data
  const [paints, setPaints] = useState<Map<string, Paint>>(new Map())
  const [pendingPaints, setPendingPaints] = useState<Map<string, PendingPaint>>(new Map())
  
  // Batching and performance
  const [paintBatch, setPaintBatch] = useState<PaintBatch>({ paints: [], deletes: [] })
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastRenderTime = useRef<number>(0)
  
  // User state
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string>('Anonymous')
  const [userAvatar, setUserAvatar] = useState<string>('')

  // Generate unique key for paint coordinates
  const getPaintKey = useCallback((x: number, y: number) => `${x},${y}`, [])

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center,
      zoom,
      dragRotate: false,
    })

    mapRef.current = map

    map.on('load', () => {
      setIsLoading(false)
      initializeCanvas()
      loadVisiblePaints()
    })

    map.on('moveend', () => {
      loadVisiblePaints()
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [center, zoom, mapStyle])

  // Initialize canvas overlay
  const initializeCanvas = useCallback(() => {
    if (!mapRef.current) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvasRef.current = canvas
    ctxRef.current = ctx

    // Set canvas size to match map container
    const resizeCanvas = () => {
      if (!canvas || !mapRef.current) return
      const { width, height } = mapRef.current.getContainer().getBoundingClientRect()
      canvas.width = width
      canvas.height = height
      canvas.style.position = 'absolute'
      canvas.style.top = '0'
      canvas.style.left = '0'
      canvas.style.pointerEvents = 'none'
      canvas.style.zIndex = '2'
    }

    resizeCanvas()
    mapRef.current.getContainer().appendChild(canvas)

    // Handle window resize
    const handleResize = () => resizeCanvas()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      canvas.remove()
    }
  }, [])

  // Initialize authentication and realtime
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Sign in anonymously
        const { data: { user }, error } = await supabase.auth.signUp({
          email: `anonymous_${Date.now()}@example.com`,
          password: `password_${Date.now()}`,
        })

        if (error) {
          console.warn('Auth error:', error)
          // Try to sign in with existing session
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.user) {
            setUserId(session.user.id)
            setUserName(session.user.user_metadata?.full_name || 'Anonymous')
            setUserAvatar(session.user.user_metadata?.avatar_url || '')
          }
        } else if (user) {
          setUserId(user.id)
          setUserName(user.user_metadata?.full_name || 'Anonymous')
          setUserAvatar(user.user_metadata?.avatar_url || '')
        }

        // Connect to realtime channel
        await paintChannel.connect()
        setConnectionStatus('connected')

        // Subscribe to paint updates
        const unsubscribe = paintChannel.subscribe(handleRealtimeUpdate)
        return unsubscribe
      } catch (error) {
        console.error('Failed to initialize app:', error)
        setConnectionStatus('disconnected')
      }
    }

    initializeApp()
  }, [])

  // Load paints for current viewport
  const loadVisiblePaints = useCallback(async () => {
    if (!mapRef.current || !userId) return

    try {
      const bounds = mapRef.current.getBounds()
      const { data, error } = await supabase
        .from('paints')
        .select('*')
        .gte('x', Math.floor(bounds.getWest() / CELL_SIZE_METERS))
        .lte('x', Math.ceil(bounds.getEast() / CELL_SIZE_METERS))
        .gte('y', Math.floor(bounds.getSouth() / CELL_SIZE_METERS))
        .lte('y', Math.ceil(bounds.getNorth() / CELL_SIZE_METERS))

      if (error) {
        console.error('Failed to load paints:', error)
        return
      }

      const newPaints = new Map<string, Paint>()
      data?.forEach(paint => {
        newPaints.set(getPaintKey(paint.x, paint.y), paint)
      })

      setPaints(newPaints)
      renderCanvas()
    } catch (error) {
      console.error('Error loading paints:', error)
    }
  }, [userId, getPaintKey])

  // Handle realtime updates
  const handleRealtimeUpdate = useCallback((message: RealtimeMessage) => {
    if (message.type === 'paint') {
      const { x, y, color, owner } = message.data
      const key = getPaintKey(x, y)
      
      // Don't update if this is our own paint (already handled optimistically)
      if (owner === userId) return

      // Update paints state
      setPaints(prev => {
        const newPaints = new Map(prev)
        if (color === null) {
          // Delete paint if color is null (erased)
          newPaints.delete(key)
        } else {
          newPaints.set(key, {
            x,
            y,
            color,
            owner,
            owner_name: message.data.owner_name,
            owner_avatar: message.data.owner_avatar,
          })
        }
        return newPaints
      })

      // Schedule canvas render
      scheduleCanvasRender()
    } else if (message.type === 'delete') {
      const { x, y, owner } = message.data
      const key = getPaintKey(x, y)
      
      if (owner === userId) return

      setPaints(prev => {
        const newPaints = new Map(prev)
        newPaints.delete(key)
        return newPaints
      })

      scheduleCanvasRender()
    }
  }, [userId, getPaintKey])

  // Schedule canvas render with requestAnimationFrame
  const scheduleCanvasRender = useCallback(() => {
    if (animationFrameRef.current) return

    animationFrameRef.current = requestAnimationFrame(() => {
      renderCanvas()
      animationFrameRef.current = null
    })
  }, [])

  // Render canvas efficiently
  const renderCanvas = useCallback(() => {
    if (!ctxRef.current || !canvasRef.current) return

    const ctx = ctxRef.current
    const canvas = canvasRef.current
    const now = performance.now()

    // Throttle renders to 60fps max
    if (now - lastRenderTime.current < 16) return
    lastRenderTime.current = now

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Render all paints
    paints.forEach(paint => {
      if (paint.color === null) return // Skip erased pixels
      
      const pixelX = Math.floor((paint.x * CELL_SIZE_METERS - mapRef.current!.getBounds().getWest()) / mapRef.current!.getBounds().getWest() * canvas.width)
      const pixelY = Math.floor((paint.y * CELL_SIZE_METERS - mapRef.current!.getBounds().getSouth()) / mapRef.current!.getBounds().getSouth() * canvas.height)
      
      ctx.fillStyle = paint.color
      ctx.fillRect(pixelX, pixelY, 1, 1)
    })

    // Render pending paints on top
    pendingPaints.forEach(paint => {
      if (paint.color === null) return // Skip erased pixels
      
      const pixelX = Math.floor((paint.x * CELL_SIZE_METERS - mapRef.current!.getBounds().getWest()) / mapRef.current!.getBounds().getWest() * canvas.width)
      const pixelY = Math.floor((paint.y * CELL_SIZE_METERS - mapRef.current!.getBounds().getSouth()) / mapRef.current!.getBounds().getSouth() * canvas.height)
      
      ctx.fillStyle = paint.color
      ctx.fillRect(pixelX, pixelY, 1, 1)
    })
  }, [paints, pendingPaints])

  // Handle painting
  const handlePaint = useCallback(async (x: number, y: number, color: string) => {
    if (!userId || !mapRef.current) return

    const key = getPaintKey(x, y)
    const timestamp = Date.now()

    // Optimistic update - render immediately
    const pendingPaint: PendingPaint = { x, y, color, owner: userId, timestamp }
    setPendingPaints(prev => new Map(prev).set(key, pendingPaint))
    
    // Update paints state for immediate rendering
    setPaints(prev => {
      const newPaints = new Map(prev)
      newPaints.set(key, {
        x,
        y,
        color,
        owner: userId,
        owner_name: userName,
        owner_avatar: userAvatar,
      })
      return newPaints
    })

    // Render immediately
    renderCanvas()

    // Broadcast to other clients
    try {
      await paintChannel.broadcast({
        type: 'paint',
        data: {
          x,
          y,
          color,
          owner: userId,
          owner_name: userName,
          owner_avatar: userAvatar,
          timestamp,
        }
      })
    } catch (error) {
      console.error('Failed to broadcast paint:', error)
    }

    // Add to batch for database persistence
    setPaintBatch(prev => ({
      ...prev,
      paints: [...prev.paints, {
        x,
        y,
        color,
        owner: userId,
        owner_name: userName,
        owner_avatar: userAvatar,
        timestamp,
      }]
    }))

    // Schedule batch processing
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current)
    }
    batchTimeoutRef.current = setTimeout(processPaintBatch, PAINT_BATCH_DELAY)
  }, [userId, userName, userAvatar, getPaintKey, renderCanvas])

  // Process paint batch
  const processPaintBatch = useCallback(async () => {
    if (paintBatch.paints.length === 0 && paintBatch.deletes.length === 0) return

    try {
      // Process paints
      if (paintBatch.paints.length > 0) {
        const { error } = await supabase
          .from('paints')
          .upsert(paintBatch.paints.map(p => ({
            x: p.x,
            y: p.y,
            color: p.color,
            owner: p.owner,
            owner_name: p.owner_name,
            owner_avatar: p.owner_avatar,
          })), { onConflict: 'x,y' })

        if (error) {
          console.error('Failed to save paints:', error)
        }
      }

      // Process deletes
      if (paintBatch.deletes.length > 0) {
        for (const del of paintBatch.deletes) {
          const { error } = await supabase
            .from('paints')
            .delete()
            .eq('x', del.x)
            .eq('y', del.y)

          if (error) {
            console.error('Failed to delete paint:', error)
          }
        }
      }

      // Clear batch
      setPaintBatch({ paints: [], deletes: [] })
      
      // Remove from pending paints
      setPendingPaints(prev => {
        const newPending = new Map(prev)
        paintBatch.paints.forEach(p => {
          newPending.delete(getPaintKey(p.x, p.y))
        })
        paintBatch.deletes.forEach(d => {
          newPending.delete(getPaintKey(d.x, d.y))
        })
        return newPending
      })

      // Re-render to show final state
      renderCanvas()
    } catch (error) {
      console.error('Error processing paint batch:', error)
    }
  }, [paintBatch, getPaintKey, renderCanvas])

  // Handle map click for painting
  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    if (!isPainting || !mapRef.current) return

    const lngLat = e.lngLat
    const x = Math.floor(lngLat.lng / CELL_SIZE_METERS)
    const y = Math.floor(lngLat.lat / CELL_SIZE_METERS)

    handlePaint(x, y, selectedColor)
  }, [isPainting, selectedColor, handlePaint])

  // Add click handler to map
  useEffect(() => {
    if (!mapRef.current) return

    mapRef.current.on('click', handleMapClick)
    return () => {
      mapRef.current?.off('click', handleMapClick)
    }
  }, [handleMapClick])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      paintChannel.disconnect()
    }
  }, [])

  // Color palette
  const colors = [
    '#FF4500', '#FF6347', '#FF7F50', '#FF8C00', '#FFA500',
    '#FFD700', '#FFFF00', '#9ACD32', '#32CD32', '#00FF00',
    '#00FA9A', '#00CED1', '#00BFFF', '#1E90FF', '#4169E1',
    '#8A2BE2', '#9370DB', '#FF69B4', '#FF1493', '#DC143C'
  ]

  return (
    <div className="relative w-full h-full">
      {/* Map container */}
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Paint controls */}
      <div className="paint-controls">
        <div className="color-palette">
          {colors.map(color => (
            <div
              key={color}
              className={`color-swatch ${selectedColor === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => setSelectedColor(color)}
            />
          ))}
        </div>
        
        <button
          className={`paint-button ${isPainting ? 'bg-red-500 hover:bg-red-600' : ''}`}
          onClick={() => setIsPainting(!isPainting)}
        >
          {isPainting ? 'Stop Painting' : 'Start Painting'}
        </button>
      </div>

      {/* Connection status */}
      <div className={`status-indicator status-${connectionStatus}`}>
        {isLoading && <span className="loading-spinner" />}
        {connectionStatus === 'connecting' && 'Connecting...'}
        {connectionStatus === 'connected' && 'Connected'}
        {connectionStatus === 'disconnected' && 'Disconnected'}
      </div>

      {/* Instructions */}
      {!isPainting && (
        <div className="fixed bottom-20 left-20 z-1000 bg-white bg-opacity-90 rounded-lg p-4 text-sm">
          <p>Click "Start Painting" to begin drawing on the map</p>
          <p>Select a color from the palette</p>
          <p>Click anywhere on the map to place pixels</p>
        </div>
      )}
    </div>
  )
}
