/**
 * Performance optimization utilities for the painting system
 */

// Throttle function calls to limit execution frequency
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null
  let lastExecTime = 0

  return (...args: Parameters<T>) => {
    const currentTime = Date.now()

    if (currentTime - lastExecTime > delay) {
      func(...args)
      lastExecTime = currentTime
    } else {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        func(...args)
        lastExecTime = Date.now()
      }, delay - (currentTime - lastExecTime))
    }
  }
}

// Debounce function calls to wait for pause in execution
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null

  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }
}

// Batch multiple function calls using requestAnimationFrame
export class AnimationFrameBatcher<T> {
  private items: T[] = []
  private isScheduled = false
  private callback: (items: T[]) => void

  constructor(callback: (items: T[]) => void) {
    this.callback = callback
  }

  add(item: T) {
    this.items.push(item)
    this.schedule()
  }

  private schedule() {
    if (this.isScheduled) return
    
    this.isScheduled = true
    requestAnimationFrame(() => {
      this.flush()
    })
  }

  private flush() {
    if (this.items.length === 0) return
    
    const itemsToProcess = [...this.items]
    this.items = []
    this.isScheduled = false
    
    this.callback(itemsToProcess)
  }

  clear() {
    this.items = []
    this.isScheduled = false
  }
}

// Efficient coordinate hashing for paint lookups
export function hashCoordinate(x: number, y: number): string {
  return `${x},${y}`
}

// Parse coordinate hash back to numbers
export function parseCoordinate(hash: string): [number, number] {
  const [x, y] = hash.split(',').map(Number)
  return [x, y]
}

// Calculate viewport bounds for efficient paint loading
export interface ViewportBounds {
  west: number
  east: number
  south: number
  north: number
}

export function calculateViewportBounds(
  center: [number, number],
  zoom: number,
  cellSize: number,
  containerSize: { width: number; height: number }
): ViewportBounds {
  // Calculate the visible area in meters
  const metersPerPixel = 156543.03392 * Math.cos(center[1] * Math.PI / 180) / Math.pow(2, zoom)
  const visibleWidthMeters = containerSize.width * metersPerPixel
  const visibleHeightMeters = containerSize.height * metersPerPixel

  // Convert to grid coordinates
  const centerX = center[0] * cellSize
  const centerY = center[1] * cellSize

  return {
    west: Math.floor((centerX - visibleWidthMeters / 2) / cellSize),
    east: Math.ceil((centerX + visibleWidthMeters / 2) / cellSize),
    south: Math.floor((centerY - visibleHeightMeters / 2) / cellSize),
    north: Math.ceil((centerY + visibleHeightMeters / 2) / cellSize),
  }
}

// Efficient paint batching for database operations
export class PaintBatcher {
  private paints: Map<string, any> = new Map()
  private deletes: Map<string, any> = new Map()
  private timeoutId: NodeJS.Timeout | null = null
  private batchDelay: number
  private onBatch: (batch: { paints: any[]; deletes: any[] }) => void

  constructor(
    batchDelay: number,
    onBatch: (batch: { paints: any[]; deletes: any[] }) => void
  ) {
    this.batchDelay = batchDelay
    this.onBatch = onBatch
  }

  addPaint(paint: any) {
    const key = hashCoordinate(paint.x, paint.y)
    this.paints.set(key, paint)
    this.scheduleBatch()
  }

  addDelete(deleteOp: any) {
    const key = hashCoordinate(deleteOp.x, deleteOp.y)
    this.deletes.set(key, deleteOp)
    this.scheduleBatch()
  }

  private scheduleBatch() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }

    this.timeoutId = setTimeout(() => {
      this.processBatch()
    }, this.batchDelay)
  }

  private processBatch() {
    if (this.paints.size === 0 && this.deletes.size === 0) return

    const batch = {
      paints: Array.from(this.paints.values()),
      deletes: Array.from(this.deletes.values()),
    }

    this.paints.clear()
    this.deletes.clear()
    this.timeoutId = null

    this.onBatch(batch)
  }

  clear() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
    this.paints.clear()
    this.deletes.clear()
  }
}

// Memory-efficient paint storage using TypedArrays for large datasets
export class PaintGrid {
  private grid: Map<string, Uint8Array> = new Map()
  private chunkSize = 1000 // pixels per chunk

  setPaint(x: number, y: number, color: string) {
    const chunkX = Math.floor(x / this.chunkSize)
    const chunkY = Math.floor(y / this.chunkSize)
    const chunkKey = `${chunkX},${chunkY}`

    if (!this.grid.has(chunkKey)) {
      this.grid.set(chunkKey, new Uint8Array(this.chunkSize * this.chunkSize * 3))
    }

    const chunk = this.grid.get(chunkKey)!
    const localX = x % this.chunkSize
    const localY = y % this.chunkSize
    const index = (localY * this.chunkSize + localX) * 3

    // Convert hex color to RGB
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)

    chunk[index] = r
    chunk[index + 1] = g
    chunk[index + 2] = b
  }

  getPaint(x: number, y: number): string | null {
    const chunkX = Math.floor(x / this.chunkSize)
    const chunkY = Math.floor(y / this.chunkSize)
    const chunkKey = `${chunkX},${chunkY}`

    if (!this.grid.has(chunkKey)) return null

    const chunk = this.grid.get(chunkKey)!
    const localX = x % this.chunkSize
    const localY = y % this.chunkSize
    const index = (localY * this.chunkSize + localX) * 3

    const r = chunk[index]
    const g = chunk[index + 1]
    const b = chunk[index + 2]

    if (r === 0 && g === 0 && b === 0) return null

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }

  clear() {
    this.grid.clear()
  }
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map()
  private startTimes: Map<string, number> = new Map()

  startTimer(name: string) {
    this.startTimes.set(name, performance.now())
  }

  endTimer(name: string) {
    const startTime = this.startTimes.get(name)
    if (!startTime) return

    const duration = performance.now() - startTime
    if (!this.metrics.has(name)) {
      this.metrics.set(name, [])
    }
    this.metrics.get(name)!.push(duration)

    this.startTimes.delete(name)
  }

  getAverageTime(name: string): number {
    const times = this.metrics.get(name)
    if (!times || times.length === 0) return 0

    return times.reduce((sum, time) => sum + time, 0) / times.length
  }

  getMetrics(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [name, times] of this.metrics) {
      result[name] = this.getAverageTime(name)
    }
    return result
  }

  reset() {
    this.metrics.clear()
    this.startTimes.clear()
  }
}
