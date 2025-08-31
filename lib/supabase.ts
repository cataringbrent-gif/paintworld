import { createClient } from '@supabase/supabase-js'
import { RealtimeChannel } from '@supabase/realtime-js'

// Environment variables - replace with your actual values
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bfyuaujkbzqaqyhzdbxz.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmeXVhdWprYnpxYXF5aHpkYnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5MTcyNzcsImV4cCI6MjA3MTQ5MzI3N30.904S0Y_EAUCR3XJVOun2qYB-3F__yQVBm970xfB8nrc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

// Database types - matching your existing schema exactly
export interface Paint {
  id?: number
  x: number
  y: number
  color: string | null // null for erased pixels
  owner: string // UUID referencing auth.users(id)
  updated_at?: string
  owner_name?: string
  owner_avatar?: string
}

export interface UserPaint {
  user_id: string // UUID primary key
  capacity: number
  charges: number
  regen_seconds: number
  last_refill_at?: string
  updated_at?: string
  pigments?: number
}

// Realtime channel types
export interface PaintUpdate {
  x: number
  y: number
  color: string | null
  owner: string
  owner_name?: string
  owner_avatar?: string
  timestamp: number
}

export interface PaintDelete {
  x: number
  y: number
  owner: string
  timestamp: number
}

// Realtime message types
export type RealtimeMessage = 
  | { type: 'paint'; data: PaintUpdate }
  | { type: 'delete'; data: PaintDelete }
  | { type: 'ping'; data: { timestamp: number } }

// Channel management
export class PaintChannel {
  private channel: RealtimeChannel | null = null
  private subscribers: Set<(message: RealtimeMessage) => void> = new Set()
  private isConnected = false

  async connect() {
    if (this.channel) return

    try {
      this.channel = supabase
        .channel('paint-updates')
        .on('broadcast', { event: 'paint-update' }, (payload) => {
          const message = payload.payload as RealtimeMessage
          this.notifySubscribers(message)
        })
        .subscribe((status) => {
          this.isConnected = status === 'SUBSCRIBED'
        })

      return this.channel
    } catch (error) {
      console.error('Failed to connect to paint channel:', error)
      throw error
    }
  }

  async disconnect() {
    if (this.channel) {
      await supabase.removeChannel(this.channel)
      this.channel = null
      this.isConnected = false
    }
  }

  async broadcast(message: RealtimeMessage) {
    if (!this.channel || !this.isConnected) {
      throw new Error('Channel not connected')
    }

    try {
      await this.channel.send({
        type: 'broadcast',
        event: 'paint-update',
        payload: message,
      })
    } catch (error) {
      console.error('Failed to broadcast message:', error)
      throw error
    }
  }

  subscribe(callback: (message: RealtimeMessage) => void) {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notifySubscribers(message: RealtimeMessage) {
    this.subscribers.forEach(callback => {
      try {
        callback(message)
      } catch (error) {
        console.error('Error in subscriber callback:', error)
      }
    })
  }

  get connected() {
    return this.isConnected
  }
}

// Singleton instance
export const paintChannel = new PaintChannel()
