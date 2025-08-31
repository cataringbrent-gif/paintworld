import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { createClient } from '@supabase/supabase-js';

const CollaborativeCanvas = () => {
  // Core refs
  const mapContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const supabaseRef = useRef(null);

  // State management
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPaintingMode, setIsPaintingMode] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#FF4500');
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isRightMouseDown, setIsRightMouseDown] = useState(false);
  const [currentHoveredCell, setCurrentHoveredCell] = useState(null);
  const [gridVisible, setGridVisible] = useState(false);
  const [isPaintingEnabled, setIsPaintingEnabled] = useState(false);
  const [paintedCells, setPaintedCells] = useState(new Map());
  const [user, setUser] = useState(null);
  const [userCharges, setUserCharges] = useState(0);
  const [userCapacity, setUserCapacity] = useState(10);
  const [isColorPaletteVisible, setIsColorPaletteVisible] = useState(false);

  // Instant painting state
  const [paintBuffer, setPaintBuffer] = useState(new Map());
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPaintedCell, setLastPaintedCell] = useState(null);

  // Constants (extracted from original)
  const CELL_SIZE_METERS = 20.0375;
  const HOVER_THRESHOLD = 4000;
  const PAINTING_THRESHOLD = 1000;
  const MAX_CELLS = 10000;

  // Color palette
  const colorPalette = [
    '#6D001A', '#BE0039', '#FF4500', '#FFA800', '#FFD635', '#FFF8B8', '#00A368', '#00CC78',
    '#7EED56', '#00756F', '#009EAA', '#00CCC0', '#2450A4', '#3690EA', '#51E9F4', '#493AC1',
    '#6A5CFF', '#811E9F', '#B44AC0', '#FF3881', '#FF99AA', '#6D482F', '#9C6926', '#FFB470',
    '#000000', '#515252', '#898D90', '#D4D7D9', '#FFFFFF', '#FF6B6B', '#4ECDC4', '#45B7D1',
    '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8C471'
  ];

  // Initialize Supabase
  useEffect(() => {
    supabaseRef.current = createClient(
      process.env.REACT_APP_SUPABASE_URL || 'https://bfyuaujkbzqaqyhzdbxz.supabase.co',
      process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmeXVhdWprYnpxYXF5aHpkYnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5MTcyNzcsImV4cCI6MjA3MTQ5MzI3N30.904S0Y_EAUCR3XJVOun2qYB-3F__yQVBm970xfB8nrc'
    );
  }, []);

  // Coordinate conversion functions
  const toWebMercator = useCallback((lng, lat) => {
    const x = lng * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
    const yMercator = y * 20037508.34 / 180;
    return { x: x, y: yMercator };
  }, []);

  const gridCoordsFromLatLng = useCallback((lng, lat) => {
    const { x, y } = toWebMercator(lng, lat);
    const gridX = Math.floor((x + 20037508.34) / CELL_SIZE_METERS);
    const gridY = Math.floor((y + 20037508.34) / CELL_SIZE_METERS);
    return { gridX: Math.max(0, Math.min(1999999, gridX)), gridY: Math.max(0, Math.min(1999999, gridY)) };
  }, [toWebMercator]);

  // Canvas painting functions
  const drawPixel = useCallback((gridX, gridY, color, ctx) => {
    if (!ctx || !mapRef.current) return;

    // Convert grid coordinates to screen coordinates
    const bounds = mapRef.current.getBounds();
    const topLeft = toWebMercator(bounds.getWest(), bounds.getNorth());
    const bottomRight = toWebMercator(bounds.getEast(), bounds.getSouth());

    const gridXWorld = gridX * CELL_SIZE_METERS - 20037508.34;
    const gridYWorld = gridY * CELL_SIZE_METERS - 20037508.34;

    const pixelX = ((gridXWorld - topLeft.x) / (bottomRight.x - topLeft.x)) * ctx.canvas.width;
    const pixelY = ((topLeft.y - gridYWorld) / (topLeft.y - bottomRight.y)) * ctx.canvas.height;

    const pixelSize = CELL_SIZE_METERS / ((bottomRight.x - topLeft.x) / ctx.canvas.width);

    ctx.fillStyle = color;
    ctx.fillRect(pixelX, pixelY, pixelSize, pixelSize);
  }, [toWebMercator]);

  const clearPixel = useCallback((gridX, gridY, ctx) => {
    if (!ctx || !mapRef.current) return;

    const bounds = mapRef.current.getBounds();
    const topLeft = toWebMercator(bounds.getWest(), bounds.getNorth());
    const bottomRight = toWebMercator(bounds.getEast(), bounds.getSouth());

    const gridXWorld = gridX * CELL_SIZE_METERS - 20037508.34;
    const gridYWorld = gridY * CELL_SIZE_METERS - 20037508.34;

    const pixelX = ((gridXWorld - topLeft.x) / (bottomRight.x - topLeft.x)) * ctx.canvas.width;
    const pixelY = ((topLeft.y - gridYWorld) / (topLeft.y - bottomRight.y)) * ctx.canvas.height;

    const pixelSize = CELL_SIZE_METERS / ((bottomRight.x - topLeft.x) / ctx.canvas.width);

    // Clear the pixel area (transparent)
    ctx.clearRect(pixelX, pixelY, pixelSize, pixelSize);
  }, [toWebMercator]);

  // Instant painting function
  const paintPixelInstant = useCallback((gridX, gridY, color) => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    const cellKey = `${gridX},${gridY}`;

    // Update local state instantly
    setPaintedCells(prev => {
      const newCells = new Map(prev);
      if (color === null) {
        newCells.delete(cellKey);
        clearPixel(gridX, gridY, ctx);
      } else {
        newCells.set(cellKey, {
          color,
          owner: user?.id,
          owner_name: user?.user_metadata?.name || user?.email?.split('@')[0] || 'Anonymous',
          owner_avatar: user?.user_metadata?.avatar_url
        });
        drawPixel(gridX, gridY, color, ctx);
      }
      return newCells;
    });

    // Add to buffer for batched database write
    setPaintBuffer(prev => {
      const newBuffer = new Map(prev);
      newBuffer.set(cellKey, {
        gridX,
        gridY,
        color,
        timestamp: Date.now(),
        spendCharge: color !== null
      });
      return newBuffer;
    });
  }, [drawPixel, clearPixel, user]);

  // Batched database writes
  useEffect(() => {
    if (paintBuffer.size === 0) return;

    const timeoutId = setTimeout(async () => {
      if (!supabaseRef.current || !user) return;

      const batch = Array.from(paintBuffer.values());
      setPaintBuffer(new Map());

      // Process paints and erases separately
      const paints = batch.filter(p => p.color !== null);
      const erases = batch.filter(p => p.color === null);

      try {
        // Handle paints
        if (paints.length > 0) {
          const paintInserts = paints.map(p => ({
            x: p.gridX,
            y: p.gridY,
            color: p.color,
            owner: user.id,
            owner_name: user.user_metadata?.name || user.email?.split('@')[0] || 'Anonymous',
            owner_avatar: user.user_metadata?.avatar_url
          }));

          await supabaseRef.current.from('paints').upsert(paintInserts, { onConflict: 'x,y' });

          // Update charges
          if (userCharges > 0) {
            setUserCharges(prev => Math.max(0, prev - paints.length));
          }
        }

        // Handle erases
        if (erases.length > 0) {
          for (const erase of erases) {
            const { data: existingPaint } = await supabaseRef.current
              .from('paints')
              .select('id')
              .eq('x', erase.gridX)
              .eq('y', erase.gridY)
              .eq('owner', user.id)
              .single();

            if (existingPaint) {
              await supabaseRef.current.from('paints').delete().eq('id', existingPaint.id);

              // Restore charge
              if (userCharges < userCapacity) {
                setUserCharges(prev => Math.min(userCapacity, prev + 1));
              }
            }
          }
        }
      } catch (error) {
        console.error('Batch write error:', error);
      }
    }, 150); // 150ms batch interval

    return () => clearTimeout(timeoutId);
  }, [paintBuffer, user, userCharges, userCapacity]);

  // Mouse/touch event handlers for instant painting
  const handleCanvasInteraction = useCallback((e) => {
    if (!isPaintingMode || !mapRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const lngLat = mapRef.current.unproject([x, y]);
    const { gridX, gridY } = gridCoordsFromLatLng(lngLat.lng, lngLat.lat);

    // Handle different interaction types
    if (e.type === 'mousedown' || e.type === 'touchstart') {
      if (e.button === 2 || isRightMouseDown) {
        // Erase mode
        paintPixelInstant(gridX, gridY, null);
      } else if (isSpacePressed && selectedColor) {
        // Paint mode
        paintPixelInstant(gridX, gridY, selectedColor);
        setLastPaintedCell({ x: gridX, y: gridY });
        setIsDrawing(true);
      }
    } else if ((e.type === 'mousemove' || e.type === 'touchmove') && isDrawing) {
      if (lastPaintedCell) {
        // Interpolate between points for smooth drawing
        const interpolatedCells = getLineCells(lastPaintedCell.x, lastPaintedCell.y, gridX, gridY);
        interpolatedCells.forEach(cell => {
          const cellKey = `${cell.x},${cell.y}`;
          if (!paintBuffer.has(cellKey)) {
            paintPixelInstant(cell.x, cell.y, selectedColor);
          }
        });
      }
      setLastPaintedCell({ x: gridX, y: gridY });
    }
  }, [isPaintingMode, isSpacePressed, isRightMouseDown, selectedColor, gridCoordsFromLatLng, paintPixelInstant, paintBuffer, isDrawing, lastPaintedCell]);

  // Bresenham's line algorithm for smooth painting
  const getLineCells = useCallback((x0, y0, x1, y1) => {
    const cells = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      cells.push({ x, y });

      if (x === x1 && y === y1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }

    return cells;
  }, []);

  // Initialize map and canvas
  useEffect(() => {
    if (!mapContainerRef.current || !canvasRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://api.maptiler.com/maps/0198b6c2-2bd8-73e7-8d52-98bec753acb5/style.json?key=cnLd5cDF8MjR4DD1YOHi',
      center: [120.75754, 13.89790],
      zoom: 7.3,
      dragRotate: false,
      antialias: true,
      fadeDuration: 0,
      crossSourceCollisions: false,
      optimizeForTerrain: false,
      renderWorldCopies: false,
      maxTileCacheSize: 500,
      localIdeographFontFamily: false,
      preserveDrawingBuffer: false,
      refreshExpiredTiles: false,
      trackResize: true
    });

    mapRef.current.on('load', () => {
      setIsInitialized(true);

      // Initialize canvas context
      const ctx = canvasRef.current.getContext('2d');

      // Load existing paints from database
      if (supabaseRef.current) {
        loadExistingPaints();
      }

      // Set up realtime subscription for other users' changes
      if (supabaseRef.current) {
        const channel = supabaseRef.current
          .channel('paints')
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'paints'
          }, (payload) => {
            handleRealtimeUpdate(payload);
          })
          .subscribe();
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
      }
    };
  }, []);

  // Load existing paints from database
  const loadExistingPaints = useCallback(async () => {
    if (!supabaseRef.current) return;

    try {
      const { data, error } = await supabaseRef.current
        .from('paints')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const newPaintedCells = new Map();
      data.forEach(paint => {
        const cellKey = `${paint.x},${paint.y}`;
        newPaintedCells.set(cellKey, {
          color: paint.color,
          owner: paint.owner,
          owner_name: paint.owner_name,
          owner_avatar: paint.owner_avatar
        });
      });

      setPaintedCells(newPaintedCells);

      // Draw all existing paints on canvas
      const ctx = canvasRef.current.getContext('2d');
      newPaintedCells.forEach((cell, cellKey) => {
        const [gridX, gridY] = cellKey.split(',').map(Number);
        drawPixel(gridX, gridY, cell.color, ctx);
      });
    } catch (error) {
      console.error('Error loading paints:', error);
    }
  }, [drawPixel]);

  // Handle realtime updates from other users
  const handleRealtimeUpdate = useCallback((payload) => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    const { new: newPaint, old: oldPaint, eventType } = payload;

    if (eventType === 'INSERT' && newPaint) {
      const cellKey = `${newPaint.x},${newPaint.y}`;
      setPaintedCells(prev => {
        const newCells = new Map(prev);
        newCells.set(cellKey, {
          color: newPaint.color,
          owner: newPaint.owner,
          owner_name: newPaint.owner_name,
          owner_avatar: newPaint.owner_avatar
        });
        return newCells;
      });
      drawPixel(newPaint.x, newPaint.y, newPaint.color, ctx);
    } else if (eventType === 'DELETE' && oldPaint) {
      const cellKey = `${oldPaint.x},${oldPaint.y}`;
      setPaintedCells(prev => {
        const newCells = new Map(prev);
        newCells.delete(cellKey);
        return newCells;
      });
      clearPixel(oldPaint.x, oldPaint.y, ctx);
    }
  }, [drawPixel, clearPixel]);

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsDrawing(false);
        setLastPaintedCell(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Map Container */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Canvas for Instant Painting */}
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          zIndex: 2
        }}
      />

      {/* Paint Mode Toggle */}
      <button
        onClick={() => setIsPaintingMode(!isPaintingMode)}
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '16px 24px',
          background: isPaintingMode ? '#4CAF50' : '#FF4500',
          color: 'white',
          border: 'none',
          borderRadius: '12px',
          fontSize: '16px',
          fontWeight: '600',
          cursor: 'pointer',
          zIndex: 1000
        }}
      >
        {isPaintingMode ? '🎨 Painting Mode' : '👁️ View Mode'}
      </button>

      {/* Color Palette */}
      {isPaintingMode && (
        <div style={{
          position: 'fixed',
          bottom: '80px',
          left: 0,
          right: 0,
          background: 'rgba(255, 255, 255, 0.95)',
          borderRadius: '16px',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          margin: '0 20px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
          border: '1px solid rgba(0, 0, 0, 0.1)',
          zIndex: 1000
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#333', margin: 0 }}>
              Color Palette
            </h3>
            <button
              onClick={() => setIsColorPaletteVisible(!isColorPaletteVisible)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#666'
              }}
            >
              ×
            </button>
          </div>

          {isColorPaletteVisible && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(52px, 1fr))',
              gap: '12px',
              padding: '5px 0'
            }}>
              {colorPalette.map((color, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedColor(color)}
                  style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '12px',
                    border: selectedColor === color ? '3px solid #FF4500' : '3px solid transparent',
                    background: color,
                    cursor: 'pointer',
                    transition: 'all 0.3s ease'
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status Indicator */}
      <div style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '10px 15px',
        borderRadius: '8px',
        fontSize: '14px',
        zIndex: 1000
      }}>
        {isPaintingMode ? (
          <span style={{ color: '#4CAF50' }}>🎨 Painting: {selectedColor}</span>
        ) : (
          <span style={{ color: '#666' }}>👁️ View Mode</span>
        )}
        {user && (
          <div style={{ marginTop: '5px', color: '#333' }}>
            Charges: {userCharges}/{userCapacity}
          </div>
        )}
      </div>
    </div>
  );
};

export default CollaborativeCanvas;
