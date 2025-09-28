require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const TMDBProvider = require('./src/tmdb-provider');
const TorrentScanner = require('./src/torrent-scanner');
const M3UGenerator = require('./src/m3u-generator');
const TorrentStreamer = require('./src/torrent-streamer');

class MovieProxyServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.movieCache = new Map();
    this.torrentCache = new Map();
    this.playlistCache = null;
    this.lastUpdate = null;
    
    this.tmdb = new TMDBProvider(process.env.TMDB_API_KEY);
    this.torrentScanner = new TorrentScanner();
    this.m3uGenerator = new M3UGenerator();
    this.streamer = new TorrentStreamer();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupScheduledTasks();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors());
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      message: 'Too many requests from this IP'
    });
    this.app.use(limiter);
    
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  setupRoutes() {
    // Main playlist endpoint
    this.app.get('/playlist.m3u', async (req, res) => {
      try {
        console.log('Generating M3U playlist...');
        const playlist = await this.generatePlaylist();
        
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Content-Disposition', 'attachment; filename="movies.m3u"');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(playlist);
      } catch (error) {
        console.error('Error generating playlist:', error);
        res.status(500).json({ error: 'Failed to generate playlist' });
      }
    });

    // Stream endpoint
    this.app.get('/stream/:movieId', async (req, res) => {
      try {
        const movieId = req.params.movieId;
        console.log(`Streaming request for movie: ${movieId}`);
        
        const movie = this.movieCache.get(movieId);
        if (!movie || !movie.torrent) {
          return res.status(404).json({ error: 'Movie not found or no torrent available' });
        }

        await this.streamer.streamTorrent(movie.torrent, res);
      } catch (error) {
        console.error('Streaming error:', error);
        res.status(500).json({ error: 'Streaming failed' });
      }
    });

    // Movie info endpoint
    this.app.get('/movie/:movieId', async (req, res) => {
      try {
        const movieId = req.params.movieId;
        const movie = this.movieCache.get(movieId);
        
        if (!movie) {
          return res.status(404).json({ error: 'Movie not found' });
        }
        
        res.json(movie);
      } catch (error) {
        console.error('Error fetching movie info:', error);
        res.status(500).json({ error: 'Failed to fetch movie info' });
      }
    });

    // Server status
    this.app.get('/status', async (req, res) => {
      res.json({
        status: 'running',
        moviesInCache: this.movieCache.size,
        lastUpdate: this.lastUpdate,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      });
    });

    // Refresh content manually
    this.app.post('/refresh', async (req, res) => {
      try {
        console.log('Manual refresh triggered...');
        await this.updateContent();
        res.json({ message: 'Content refreshed successfully' });
      } catch (error) {
        console.error('Refresh error:', error);
        res.status(500).json({ error: 'Failed to refresh content' });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });
  }

  setupScheduledTasks() {
    // Update content every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      console.log('Scheduled content update starting...');
      try {
        await this.updateContent();
        console.log('Scheduled content update completed');
      } catch (error) {
        console.error('Scheduled update failed:', error);
      }
    });
  }

  async generatePlaylist() {
    // Return cached playlist if recent
    if (this.playlistCache && this.lastUpdate) {
      const hoursSinceUpdate = (Date.now() - this.lastUpdate) / (1000 * 60 * 60);
      if (hoursSinceUpdate < (parseInt(process.env.CACHE_DURATION_HOURS) || 24)) {
        console.log('Returning cached playlist');
        return this.playlistCache;
      }
    }

    // Generate new playlist
    await this.updateContent();
    return this.playlistCache;
  }

  async updateContent() {
    try {
      console.log('Updating content library...');
      
      // Fetch popular movies and TV shows
      const [movies, tvShows] = await Promise.all([
        this.tmdb.getPopularMovies(1),
        this.tmdb.getPopularMovies(2),
        // this.tmdb.getTVSeries(1) // Uncomment when TV series support is needed
      ]);

      const allContent = [...movies, ...tvShows];
      console.log(`Found ${allContent.length} items from TMDB`);

      // Find torrents for each item
      const contentWithTorrents = [];
      for (let i = 0; i < Math.min(allContent.length, 100); i++) {
        const item = allContent[i];
        console.log(`Finding torrent for: ${item.title} (${item.year})`);
        
        try {
          const torrent = await this.torrentScanner.findBestTorrent(item.title, item.year);
          if (torrent) {
            item.torrent = torrent;
            contentWithTorrents.push(item);
            this.movieCache.set(item.id.toString(), item);
            console.log(`✓ Found torrent for ${item.title}: ${torrent.seeders} seeders`);
          } else {
            console.log(`✗ No suitable torrent found for ${item.title}`);
          }
        } catch (error) {
          console.error(`Error finding torrent for ${item.title}:`, error.message);
        }

        // Add delay to avoid overwhelming torrent sites
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`Successfully found torrents for ${contentWithTorrents.length} items`);

      // Generate M3U playlist
      this.playlistCache = await this.m3uGenerator.buildM3UContent(contentWithTorrents);
      this.lastUpdate = Date.now();

      console.log('Content update completed successfully');
    } catch (error) {
      console.error('Error updating content:', error);
      throw error;
    }
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Movie Proxy Server running on port ${this.port}`);
      console.log(`📺 Playlist URL: http://localhost:${this.port}/playlist.m3u`);
      console.log(`🔧 Status URL: http://localhost:${this.port}/status`);
      console.log(`🏥 Health Check: http://localhost:${this.port}/health`);
      
      // Initial content load
      this.updateContent().catch(error => {
        console.error('Initial content load failed:', error);
      });
    });
  }
}

// Start server
const server = new MovieProxyServer();
server.start();
