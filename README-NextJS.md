# Multiplayer Paint - Next.js Version

A high-performance, real-time collaborative painting application built with Next.js, Supabase Realtime, and MapLibre GL. This version provides instant, responsive painting like r/place with optimistic rendering and efficient real-time synchronization.

## ✨ Features

- **Instant Painting**: Optimistic rendering for immediate visual feedback
- **Real-time Sync**: Supabase Realtime channels for live collaboration
- **Efficient Rendering**: Canvas-based rendering with requestAnimationFrame batching
- **Viewport Loading**: Only loads paints for the current map view
- **Responsive UI**: Modern, clean interface with color palette
- **Performance Optimized**: 60fps rendering with efficient update batching

## 🚀 Performance Improvements

- **Optimistic Rendering**: Paints appear instantly without waiting for database
- **Realtime Broadcasting**: Uses Supabase channels instead of polling
- **Efficient Canvas Updates**: Only redraws changed pixels
- **RequestAnimationFrame Batching**: Smooth rendering under high update loads
- **Viewport-based Loading**: Loads only visible paints, not entire canvas

## 🛠️ Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript
- **Backend**: Supabase (PostgreSQL + Realtime)
- **Maps**: MapLibre GL
- **Styling**: Tailwind CSS
- **State Management**: React hooks with optimized re-renders

## 📋 Prerequisites

- Node.js 18+ 
- Supabase project with Realtime enabled
- MapTiler API key (optional, for custom map styles)

## 🏗️ Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo>
cd multiplayer-paint-nextjs
npm install
```

### 2. Configure Supabase

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Create a new project or use existing one
3. Enable Realtime in Database > Replication
4. Run the SQL schema from `database-schema.sql` in the SQL Editor

### 3. Environment Configuration

Copy `env.example` to `.env.local` and fill in your values:

```bash
cp env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
NEXT_PUBLIC_MAP_STYLE=https://api.maptiler.com/maps/your-style/style.json?key=your-key
```

### 4. Database Schema

Run the SQL commands from `database-schema.sql` in your Supabase SQL Editor. This creates:

- `paints` table for pixel data
- `user_paints` table for user resources
- Proper indexes for performance
- Row Level Security policies
- Helper functions for viewport queries

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## 🎨 How It Works

### Optimistic Rendering
1. User clicks to paint a pixel
2. Canvas updates immediately (optimistic)
3. Paint is broadcast to other users via Realtime
4. Paint is saved to database in background batch

### Real-time Updates
1. Supabase Realtime channel receives paint updates
2. Updates are batched using requestAnimationFrame
3. Canvas re-renders efficiently with new paints
4. No polling - instant synchronization

### Performance Optimizations
- **Canvas Overlay**: Separate canvas for paints, not map tiles
- **Efficient Updates**: Only redraws changed areas
- **Batched Processing**: Groups database operations
- **Viewport Loading**: Loads only visible paints

## 🚀 Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Connect repository in Vercel
3. Set environment variables
4. Deploy

### Manual Deployment

```bash
npm run build
npm start
```

## 🔧 Configuration

### Custom Map Styles
Update the `mapStyle` prop in `PaintCanvas` or use environment variable:

```tsx
<PaintCanvas 
  mapStyle="https://your-custom-style.json"
/>
```

### Cell Size
Modify `CELL_SIZE_METERS` in `PaintCanvas.tsx`:

```tsx
const CELL_SIZE_METERS = 20.0375 // meters per cell
```

### Batch Processing
Adjust batch timing in `PaintCanvas.tsx`:

```tsx
const PAINT_BATCH_DELAY = 100 // milliseconds
```

## 📊 Database Schema

### Paints Table
```sql
CREATE TABLE paints (
    id BIGSERIAL PRIMARY KEY,
    x BIGINT NOT NULL,           -- Grid X coordinate
    y BIGINT NOT NULL,           -- Grid Y coordinate
    color VARCHAR(7) NOT NULL,   -- Hex color code
    user_id UUID NOT NULL,       -- User who placed the paint
    user_name TEXT,              -- Display name
    user_avatar TEXT,            -- Avatar URL
    created_at TIMESTAMPTZ,      -- Creation timestamp
    updated_at TIMESTAMPTZ       -- Last update timestamp
);
```

### User Paints Table
```sql
CREATE TABLE user_paints (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE,
    pigments INTEGER DEFAULT 1000,    -- Resource currency
    capacity INTEGER DEFAULT 100,     -- Paint capacity
    charges INTEGER DEFAULT 50,       -- Paint charges
    last_refill_at TIMESTAMPTZ       -- Last resource refill
);
```

## 🔒 Security

- Row Level Security (RLS) enabled
- Users can only modify their own paints
- Anonymous authentication for demo purposes
- Proper input validation and sanitization

## 🧪 Testing

### Manual Testing
1. Open multiple browser tabs
2. Start painting in one tab
3. Verify updates appear in other tabs instantly
4. Check database persistence

### Performance Testing
- Monitor FPS during high-activity painting
- Test with multiple simultaneous users
- Verify canvas rendering performance

## 🐛 Troubleshooting

### Common Issues

**Paints not appearing**
- Check Supabase Realtime connection
- Verify database permissions
- Check browser console for errors

**Slow performance**
- Ensure proper indexes are created
- Check network latency to Supabase
- Verify canvas rendering performance

**Authentication errors**
- Check environment variables
- Verify Supabase project settings
- Check RLS policies

### Debug Mode
Enable debug logging by setting in browser console:
```javascript
localStorage.setItem('debug', 'paint:*')
```

## 📈 Performance Metrics

- **Rendering**: 60fps target with requestAnimationFrame
- **Latency**: <100ms for paint updates
- **Database**: Batched operations every 100ms
- **Memory**: Efficient canvas management
- **Network**: Only loads visible paints

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Supabase for the excellent realtime infrastructure
- MapLibre GL for open-source mapping
- r/place for inspiration on collaborative canvas design
