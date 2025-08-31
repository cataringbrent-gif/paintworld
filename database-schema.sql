-- Multiplayer Paint Database Schema - Updated to match existing structure
-- This file shows the current schema that's already in your database
-- Run this in your Supabase SQL editor if you need to recreate the structure

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Paints table - stores all pixel data (matches your existing structure)
CREATE TABLE IF NOT EXISTS public.paints (
    id BIGSERIAL PRIMARY KEY,
    x INTEGER NOT NULL,                    -- Grid X coordinate (int4)
    y INTEGER NOT NULL,                    -- Grid Y coordinate (int4)
    color TEXT,                            -- Hex color code or null for erased
    owner UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    owner_name TEXT,                       -- User's display name
    owner_avatar TEXT,                     -- User's avatar URL
    
    -- Composite unique constraint for coordinates
    UNIQUE(x, y)
);

-- User paints table - stores user resources and stats (matches your existing structure)
CREATE TABLE IF NOT EXISTS public.user_paints (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    capacity INTEGER NOT NULL DEFAULT 100,
    charges INTEGER NOT NULL DEFAULT 100,
    regen_seconds INTEGER NOT NULL DEFAULT 30,
    last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pigments INTEGER DEFAULT 0             -- Resource currency
);

-- Indexes for performance (matching your existing setup)
CREATE INDEX IF NOT EXISTS idx_paints_coordinates ON public.paints(x, y);
CREATE INDEX IF NOT EXISTS idx_paints_owner ON public.paints(owner);
CREATE INDEX IF NOT EXISTS idx_paints_updated_at ON public.paints(updated_at);
CREATE INDEX IF NOT EXISTS idx_user_paints_user_id ON public.user_paints(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to automatically update updated_at
DROP TRIGGER IF EXISTS set_paints_updated_at ON public.paints;
CREATE TRIGGER set_paints_updated_at 
    BEFORE UPDATE ON public.paints 
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_user_paints_updated_at ON public.user_paints;
CREATE TRIGGER set_user_paints_updated_at 
    BEFORE UPDATE ON public.user_paints 
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Row Level Security (RLS) policies - matching your existing setup
ALTER TABLE public.paints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_paints ENABLE ROW LEVEL SECURITY;

-- Paints table policies (matching your existing setup)
-- Public read
CREATE POLICY "paints_select_public" ON public.paints
    FOR SELECT USING (true);

-- Only owner can insert
CREATE POLICY "paints_insert_owner" ON public.paints
    FOR INSERT WITH CHECK (owner = auth.uid());

-- Only owner can update
CREATE POLICY "paints_update_owner" ON public.paints
    FOR UPDATE USING (owner = auth.uid())
    WITH CHECK (owner = auth.uid());

-- Only owner can delete
CREATE POLICY "paints_delete_owner" ON public.paints
    FOR DELETE USING (owner = auth.uid());

-- User_paints table policies (matching your existing setup)
-- Users can read their own data
CREATE POLICY "user_paints_select_self" ON public.user_paints
    FOR SELECT USING (user_id = auth.uid());

-- Users can insert their own data
CREATE POLICY "user_paints_insert_self" ON public.user_paints
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own data
CREATE POLICY "user_paints_update_self" ON public.user_paints
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Function to get paints in viewport efficiently
CREATE OR REPLACE FUNCTION get_paints_in_viewport(
    west_lng DOUBLE PRECISION,
    east_lng DOUBLE PRECISION,
    south_lat DOUBLE PRECISION,
    north_lat DOUBLE PRECISION,
    cell_size_meters DOUBLE PRECISION DEFAULT 20.0375
)
RETURNS TABLE (
    x INTEGER,
    y INTEGER,
    color TEXT,
    owner UUID,
    owner_name TEXT,
    owner_avatar TEXT,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.x,
        p.y,
        p.color,
        p.owner,
        p.owner_name,
        p.owner_avatar,
        p.updated_at
    FROM public.paints p
    WHERE p.x >= FLOOR(west_lng / cell_size_meters)
      AND p.x <= CEIL(east_lng / cell_size_meters)
      AND p.y >= FLOOR(south_lat / cell_size_meters)
      AND p.y <= CEIL(north_lat / cell_size_meters)
      AND p.color IS NOT NULL  -- Only return painted pixels
    ORDER BY p.updated_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get paint statistics
CREATE OR REPLACE FUNCTION get_paint_stats()
RETURNS TABLE (
    total_paints BIGINT,
    unique_users BIGINT,
    most_used_color TEXT,
    last_paint_time TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_paints,
        COUNT(DISTINCT owner)::BIGINT as unique_users,
        (SELECT color FROM public.paints WHERE color IS NOT NULL GROUP BY color ORDER BY COUNT(*) DESC LIMIT 1) as most_used_color,
        MAX(updated_at) as last_paint_time
    FROM public.paints
    WHERE color IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to cleanup old paints (optional, for maintenance)
CREATE OR REPLACE FUNCTION cleanup_old_paints(days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.paints 
    WHERE updated_at < NOW() - INTERVAL '1 day' * days_old
      AND color IS NULL;  -- Only cleanup erased pixels
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
