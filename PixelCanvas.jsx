import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// Constants
const CELL_SIZE = 20; // 20x20 pixels per cell
const BATCH_INTERVAL = 150; // 150ms batching
const MAX_CELLS = 10000; // Maximum cells per user

// Supabase client (replace with your actual config)
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL || '',
  process.env.REACT_APP_SUPABASE_ANON_KEY || ''
);

const PixelCanvas = () => {
  const canvasRef = useRef(null);
  const [pixels, setPixels] = useState(new Map()); // pixelKey -> color
  const [isPainting, setIsPainting] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#FF4500');
  const [user, setUser] = useState(null);
  const [charges, setCharges] = useState(100);

  // Batch write buffer
  const batchBuffer = useRef(new Map()); // pixelKey -> {x, y, color}
  const batchTimeout = useRef(null);

  // Throttled mouse event state
  const lastMousePos = useRef({ x: 0, y: 0 });
  const lastUpdateTime = useRef(0);

  // Get canvas context
  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext('2d') : null;
  }, []);

  // Convert screen coordinates to grid coordinates
  const screenToGrid = useCallback((screenX, screenY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((screenX - rect.left) * scaleX / CELL_SIZE);
    const y = Math.floor((screenY - rect.top) * scaleY / CELL_SIZE);

    return { x, y };
  }, []);

  // Draw a single pixel instantly
  const drawPixel = useCallback((x, y, color) => {
    const ctx = getContext();
    if (!ctx) return;

    ctx.fillStyle = color;
    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }, [getContext]);

  // Draw multiple pixels efficiently
  const drawPixels = useCallback((pixelMap) => {
    const ctx = getContext();
    if (!ctx) return;

    pixelMap.forEach((color, pixelKey) => {
      const [x, y] = pixelKey.split(',').map(Number);
      ctx.fillStyle = color;
      ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });
  }, [getContext]);

  // Paint a pixel with instant rendering
  const paintPixel = useCallback((x, y, color) => {
    const pixelKey = `${x},${y}`;

    // Check charges for authenticated users
    if (user && charges <= 0) return false;

    // Skip if already painted with same color
    const existingColor = pixels.get(pixelKey);
    if (existingColor === color) return false;

    // Instant local rendering
    drawPixel(x, y, color);

    // Update local state
    setPixels(prev => new Map(prev).set(pixelKey, color));

    // Add to batch buffer
    batchBuffer.current.set(pixelKey, { x, y, color, timestamp: Date.now() });

    // Deduct charge locally
    if (user) {
      setCharges(prev => Math.max(0, prev - 1));
    }

    // Schedule batch write
    scheduleBatchWrite();

    return true;
  }, [pixels, user, charges, drawPixel]);

  // Batch write to Supabase
  const scheduleBatchWrite = useCallback(() => {
    if (batchTimeout.current) return;

    batchTimeout.current = setTimeout(async () => {
      if (batchBuffer.current.size === 0) return;

      const batch = Array.from(batchBuffer.current.values());
      const upserts = batch.map(pixel => ({
        x: pixel.x,
        y: pixel.y,
        color: pixel.color,
        owner: user?.id || null,
        owner_name: user?.user_metadata?.name || null,
        owner_avatar: user?.user_metadata?.avatar_url || null
      }));

      try {
        const { error } = await supabase
          .from('paints')
          .upsert(upserts, { onConflict: 'x,y' });

        if (error) {
          console.error('Batch write error:', error);
          // Could implement retry logic here
        }
      } catch (err) {
        console.error('Batch write failed:', err);
      }

      // Clear buffer after successful write
      batchBuffer.current.clear();
      batchTimeout.current = null;
    }, BATCH_INTERVAL);
  }, [user]);

  // Handle mouse events with throttling
  const handleMouseMove = useCallback((e) => {
    const now = performance.now();

    // Throttle to ~10ms per update
    if (now - lastUpdateTime.current < 10) return;

    const { x, y } = screenToGrid(e.clientX, e.clientY);

    // Skip if position hasn't changed
    if (x === lastMousePos.current.x && y === lastMousePos.current.y) return;

    lastMousePos.current.x = x;
    lastMousePos.current.y = y;
    lastUpdateTime.current = now;

    if (isPainting) {
      paintPixel(x, y, selectedColor);
    }
  }, [isPainting, selectedColor, screenToGrid, paintPixel]);

  const handleMouseDown = useCallback((e) => {
    setIsPainting(true);
    const { x, y } = screenToGrid(e.clientX, e.clientY);
    paintPixel(x, y, selectedColor);
  }, [selectedColor, screenToGrid, paintPixel]);

  const handleMouseUp = useCallback(() => {
    setIsPainting(false);
  }, []);

  // Realtime sync - only update changed pixels
  useEffect(() => {
    const channel = supabase
      .channel('paints')
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'paints'
        },
        (payload) => {
          const { new: newPixel, old: oldPixel } = payload;

          if (newPixel) {
            // Draw new pixel instantly
            const pixelKey = `${newPixel.x},${newPixel.y}`;
            setPixels(prev => new Map(prev).set(pixelKey, newPixel.color));
            drawPixel(newPixel.x, newPixel.y, newPixel.color);
          }

          if (oldPixel && payload.eventType === 'DELETE') {
            // Erase pixel
            const pixelKey = `${oldPixel.x},${oldPixel.y}`;
            setPixels(prev => {
              const newMap = new Map(prev);
              newMap.delete(pixelKey);
              return newMap;
            });

            // Clear the pixel by drawing transparent
            const ctx = getContext();
            if (ctx) {
              ctx.clearRect(oldPixel.x * CELL_SIZE, oldPixel.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [drawPixel, getContext]);

  // Initial load
  useEffect(() => {
    const loadExistingPixels = async () => {
      try {
        const { data, error } = await supabase
          .from('paints')
          .select('x, y, color')
          .order('updated_at', { ascending: false });

        if (error) {
          console.error('Error loading pixels:', error);
          return;
        }

        // Create pixel map and draw all pixels
        const pixelMap = new Map();
        data.forEach(pixel => {
          const pixelKey = `${pixel.x},${pixel.y}`;
          pixelMap.set(pixelKey, pixel.color);
        });

        setPixels(pixelMap);
        drawPixels(pixelMap);
      } catch (err) {
        console.error('Failed to load pixels:', err);
      }
    };

    loadExistingPixels();

    // Get current user
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, [drawPixels]);

  // Canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas size
    canvas.width = 2000; // Large canvas for smooth painting
    canvas.height = 2000;

    // Set CSS size
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    // Clear canvas initially
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          cursor: isPainting ? 'crosshair' : 'default',
          background: '#f0f0f0'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Color Palette */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        display: 'flex',
        gap: '10px',
        flexWrap: 'wrap',
        maxWidth: '400px'
      }}>
        {[
          '#FF4500', '#BE0039', '#FF4500', '#FFA800', '#FFD635', '#FFF8B8',
          '#00A368', '#00CC78', '#7EED56', '#00756F', '#009EAA', '#00CCC0',
          '#2450A4', '#3690EA', '#51E9F4', '#493AC1', '#6A5CFF', '#811E9F',
          '#B44AC0', '#FF3881', '#FF99AA', '#6D482F', '#9C6926', '#FFB470'
        ].map(color => (
          <button
            key={color}
            onClick={() => setSelectedColor(color)}
            style={{
              width: '30px',
              height: '30px',
              backgroundColor: color,
              border: selectedColor === color ? '3px solid #000' : '2px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          />
        ))}
      </div>

      {/* Status */}
      {user && (
        <div style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'rgba(255,255,255,0.9)',
          padding: '10px',
          borderRadius: '8px',
          fontSize: '14px'
        }}>
          Charges: {charges}
        </div>
      )}
    </div>
  );
};

export default PixelCanvas;
