class TorrentStreamer {
  constructor() {
    this.activeTorrents = new Map();
    this.streamingClients = new Map();
    
    // Try to import WebTorrent dynamically
    this.initWebTorrent();
  }

  async initWebTorrent() {
    try {
      // Dynamic import for ESM compatibility
      const WebTorrentModule = await import('webtorrent');
      const WebTorrent = WebTorrentModule.default || WebTorrentModule;
      this.client = new WebTorrent();
      console.log('WebTorrent initialized successfully');
    } catch (error) {
      console.warn('WebTorrent not available, using fallback streaming:', error.message);
      this.client = null;
    }
  }

  async streamTorrent(torrentInfo, res) {
    try {
      // If WebTorrent is not available, redirect to magnet link
      if (!this.client) {
        return this.fallbackStream(torrentInfo, res);
      }

      const magnetLink = torrentInfo.magnetLink;
      const torrentId = this.getTorrentId(magnetLink);
      
      console.log(`Starting stream for torrent: ${torrentId}`);
      
      // Check if torrent is already being downloaded
      let torrent = this.activeTorrents.get(torrentId);
      
      if (!torrent) {
        // Add new torrent
        torrent = await this.addTorrent(magnetLink);
        this.activeTorrents.set(torrentId, torrent);
      }
      
      // Find the largest video file
      const videoFile = this.findVideoFile(torrent);
      
      if (!videoFile) {
        throw new Error('No video file found in torrent');
      }
      
      console.log(`Streaming file: ${videoFile.name}`);
      
      // Set up streaming response
      this.setupStreamResponse(videoFile, res, torrentId);
      
    } catch (error) {
      console.error('Torrent streaming error:', error);
      res.status(500).json({ error: 'Failed to stream torrent' });
    }
  }

  fallbackStream(torrentInfo, res) {
    // Fallback: redirect to magnet link or show message
    res.setHeader('Content-Type', 'application/json');
    res.json({
      error: 'Direct streaming not available',
      message: 'Please use a torrent client to download this content',
      magnetLink: torrentInfo.magnetLink,
      title: torrentInfo.title || 'Unknown',
      seeders: torrentInfo.seeders || 0
    });
  }

  addTorrent(magnetLink) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('WebTorrent client not available'));
        return;
      }

      const torrent = this.client.add(magnetLink, {
        strategy: 'sequential'
      });
      
      torrent.on('ready', () => {
        console.log(`Torrent ready: ${torrent.name}`);
        console.log(`Files: ${torrent.files.length}`);
        console.log(`Size: ${this.formatBytes(torrent.length)}`);
        
        // Prioritize the largest video file
        const videoFile = this.findVideoFile(torrent);
        if (videoFile) {
          videoFile.select();
          // Deselect other files to save bandwidth
          torrent.files.forEach(file => {
            if (file !== videoFile) {
              file.deselect();
            }
          });
        }
        
        resolve(torrent);
      });
      
      torrent.on('error', (err) => {
        console.error('Torrent error:', err);
        reject(err);
      });
      
      // Set timeout for torrent loading
      setTimeout(() => {
        if (!torrent.ready) {
          torrent.destroy();
          reject(new Error('Torrent loading timeout'));
        }
      }, 30000);
    });
  }

  findVideoFile(torrent) {
    const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    
    // Find all video files
    const videoFiles = torrent.files.filter(file => {
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      return videoExtensions.includes(ext);
    });
    
    if (videoFiles.length === 0) {
      return null;
    }
    
    // Return the largest video file
    return videoFiles.reduce((largest, current) => {
      return current.length > largest.length ? current : largest;
    });
  }

  setupStreamResponse(videoFile, res, torrentId) {
    const fileSize = videoFile.length;
    
    // Set appropriate headers
    res.setHeader('Content-Type', this.getContentType(videoFile.name));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Handle range requests for video seeking
    const range = res.req.headers.range;
    
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);
      
      this.streamFileRange(videoFile, res, start, end, torrentId);
    } else {
      // Stream entire file
      this.streamFileRange(videoFile, res, 0, fileSize - 1, torrentId);
    }
  }

  streamFileRange(videoFile, res, start, end, torrentId) {
    const streamId = `${torrentId}_${Date.now()}`;
    
    // Track active stream
    this.streamingClients.set(streamId, {
      torrentId,
      startTime: Date.now(),
      bytesStreamed: 0
    });
    
    try {
      // Create read stream
      const stream = videoFile.createReadStream({ start, end });
      
      stream.on('data', (chunk) => {
        const client = this.streamingClients.get(streamId);
        if (client) {
          client.bytesStreamed += chunk.length;
        }
      });
      
      stream.on('error', (error) => {
        console.error('Stream error:', error);
        this.streamingClients.delete(streamId);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
      
      stream.on('end', () => {
        console.log(`Stream completed: ${streamId}`);
        this.streamingClients.delete(streamId);
      });
      
      res.on('close', () => {
        console.log(`Client disconnected: ${streamId}`);
        this.streamingClients.delete(streamId);
        stream.destroy();
      });
      
      // Pipe the stream to response
      stream.pipe(res);
    } catch (error) {
      console.error('Stream setup error:', error);
      res.status(500).json({ error: 'Failed to setup stream' });
    }
  }

  getContentType(filename) {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    const contentTypes = {
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.webm': 'video/webm',
      '.m4v': 'video/x-m4v'
    };
    
    return contentTypes[ext] || 'video/mp4';
  }

  getTorrentId(magnetLink) {
    // Extract info hash from magnet link
    const match = magnetLink.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    return match ? match[1].toLowerCase() : magnetLink.substring(0, 40);
  }

  getStats() {
    const streamingCount = this.streamingClients.size;
    const activeTorrentCount = this.activeTorrents.size;
    
    let totalDownloaded = 0;
    let totalUploaded = 0;
    let totalPeers = 0;
    
    this.activeTorrents.forEach(torrent => {
      totalDownloaded += torrent.downloaded || 0;
      totalUploaded += torrent.uploaded || 0;
      totalPeers += torrent.numPeers || 0;
    });
    
    return {
      activeStreams: streamingCount,
      activeTorrents: activeTorrentCount,
      totalDownloaded: this.formatBytes(totalDownloaded),
      totalUploaded: this.formatBytes(totalUploaded),
      totalPeers,
      clientRatio: totalUploaded / (totalDownloaded || 1),
      webTorrentAvailable: !!this.client
    };
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Graceful shutdown
  async destroy() {
    console.log('Shutting down torrent client...');
    
    // Clear all streaming clients
    this.streamingClients.clear();
    
    if (this.client) {
      // Destroy all active torrents
      const destroyPromises = [];
      this.activeTorrents.forEach(torrent => {
        destroyPromises.push(new Promise(resolve => {
          torrent.destroy(resolve);
        }));
      });
      
      await Promise.all(destroyPromises);
      this.activeTorrents.clear();
      
      // Destroy WebTorrent client
      return new Promise(resolve => {
        this.client.destroy(resolve);
      });
    }
  }
}

module.exports = TorrentStreamer;
