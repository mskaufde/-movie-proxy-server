class M3UGenerator {
  constructor(serverUrl = 'http://localhost:3000') {
    this.serverUrl = serverUrl;
    this.genreMap = this.getGenreMap();
  }

  async buildM3UContent(moviesWithTorrents) {
    let m3u = '#EXTM3U\n';
    m3u += '#PLAYLIST:Movie Collection\n';
    m3u += `#EXTM3U-version="1"\n\n`;
    
    for (let i = 0; i < moviesWithTorrents.length; i++) {
      const movie = moviesWithTorrents[i];
      
      if (!movie.torrent) continue; // Skip if no torrent found
      
      // Get primary genre for grouping
      const primaryGenre = this.getPrimaryGenre(movie.genreIds);
      const allGenres = this.mapGenres(movie.genreIds);
      
      // Build EXTINF line with comprehensive metadata
      m3u += `#EXTINF:-1 `;
      m3u += `tvg-id="${movie.id}" `;
      m3u += `tvg-name="${this.sanitize(movie.title)}" `;
      m3u += `tvg-logo="${movie.poster || ''}" `;
      m3u += `group-title="${primaryGenre}" `;
      m3u += `tvg-chno="${1000 + i}" `;
      m3u += `tvg-language="en" `;
      m3u += `tvg-country="US",`;
      m3u += `${this.sanitize(movie.title)} (${movie.year})\n`;
      
      // Extended metadata tags
      m3u += `#EXTGRP:${primaryGenre}\n`;
      
      if (movie.poster) {
        m3u += `#EXTIMG:${movie.poster}\n`;
      }
      
      if (movie.backdrop) {
        m3u += `#EXTART:${movie.backdrop}\n`;
      }
      
      if (movie.description) {
        m3u += `#EXTDESC:${this.sanitizeDescription(movie.description)}\n`;
      }
      
      m3u += `#EXTRATING:${movie.rating}\n`;
      m3u += `#EXTGENRE:${allGenres}\n`;
      m3u += `#EXTYEAR:${movie.year}\n`;
      
      // Torrent-specific info
      m3u += `#EXTQUALITY:${this.extractQuality(movie.torrent.title)}\n`;
      m3u += `#EXTSEEDERS:${movie.torrent.seeders}\n`;
      m3u += `#EXTSIZE:${this.formatSize(movie.torrent.size)}\n`;
      m3u += `#EXTSOURCE:${movie.torrent.source}\n`;
      
      if (movie.torrent.verified) {
        m3u += `#EXTVERIFIED:Yes\n`;
      }
      
      // Language and type info
      m3u += `#EXTLANGUAGE:${movie.language || 'en'}\n`;
      m3u += `#EXTTYPE:${movie.type || 'movie'}\n`;
      
      // Additional movie info if available
      if (movie.runtime) {
        m3u += `#EXTDURATION:${movie.runtime}\n`;
      }
      
      if (movie.director) {
        m3u += `#EXTDIRECTOR:${this.sanitize(movie.director)}\n`;
      }
      
      if (movie.cast) {
        m3u += `#EXTCAST:${this.sanitize(movie.cast)}\n`;
      }
      
      // Popularity and vote info
      m3u += `#EXTPOPULARITY:${Math.round(movie.popularity)}\n`;
      m3u += `#EXTVOTES:${movie.voteCount}\n`;
      
      // Stream URL
      m3u += `${this.serverUrl}/stream/${movie.id}\n\n`;
    }
    
    return m3u;
  }

  // Enhanced M3U with categories
  async buildCategorizedM3U(moviesWithTorrents) {
    const categories = this.categorizeMovies(moviesWithTorrents);
    let m3u = '#EXTM3U\n';
    m3u += '#PLAYLIST:Categorized Movie Collection\n\n';
    
    for (const [category, movies] of Object.entries(categories)) {
      if (movies.length === 0) continue;
      
      m3u += `#CATEGORY:${category}\n`;
      
      for (let i = 0; i < movies.length; i++) {
        const movie = movies[i];
        
        m3u += `#EXTINF:-1 `;
        m3u += `tvg-id="${movie.id}" `;
        m3u += `tvg-name="${this.sanitize(movie.title)}" `;
        m3u += `tvg-logo="${movie.poster || ''}" `;
        m3u += `group-title="${category}" `;
        m3u += `tvg-chno="${this.getCategoryChannelNumber(category) + i}",`;
        m3u += `${this.sanitize(movie.title)} (${movie.year})\n`;
        
        m3u += `#EXTGRP:${category}\n`;
        m3u += `#EXTIMG:${movie.poster}\n`;
        m3u += `#EXTDESC:${this.sanitizeDescription(movie.description)}\n`;
        m3u += `#EXTRATING:${movie.rating}\n`;
        m3u += `#EXTQUALITY:${this.extractQuality(movie.torrent.title)}\n`;
        
        m3u += `${this.serverUrl}/stream/${movie.id}\n\n`;
      }
    }
    
    return m3u;
  }

  categorizeMovies(movies) {
    const categories = {
      'Action': [],
      'Adventure': [],
      'Animation': [],
      'Comedy': [],
      'Crime': [],
      'Documentary': [],
      'Drama': [],
      'Family': [],
      'Fantasy': [],
      'Horror': [],
      'Romance': [],
      'Sci-Fi': [],
      'Thriller': [],
      'Other': []
    };
    
    movies.forEach(movie => {
      const primaryGenre = this.getPrimaryGenre(movie.genreIds);
      if (categories[primaryGenre]) {
        categories[primaryGenre].push(movie);
      } else {
        categories['Other'].push(movie);
      }
    });
    
    return categories;
  }

  getCategoryChannelNumber(category) {
    const channelMap = {
      'Action': 1000,
      'Adventure': 1100,
      'Animation': 1200,
      'Comedy': 1300,
      'Crime': 1400,
      'Documentary': 1500,
      'Drama': 1600,
      'Family': 1700,
      'Fantasy': 1800,
      'Horror': 1900,
      'Romance': 2000,
      'Sci-Fi': 2100,
      'Thriller': 2200,
      'Other': 2300
    };
    
    return channelMap[category] || 2300;
  }

  sanitize(text) {
    if (!text) return '';
    return text
      .replace(/[^\w\s\-\(\)\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  sanitizeDescription(desc) {
    if (!desc) return 'No description available';
    return desc
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/"/g, "'")
      .replace(/[^\w\s\-\(\)\[\]'.,!?]/g, '')
      .substring(0, 200)
      .trim() + (desc.length > 200 ? '...' : '');
  }

  extractQuality(torrentTitle) {
    const title = torrentTitle.toLowerCase();
    
    if (title.includes('2160p') || title.includes('4k') || title.includes('uhd')) {
      return '4K';
    } else if (title.includes('1080p') || title.includes('fhd')) {
      return '1080p';
    } else if (title.includes('720p') || title.includes('hd')) {
      return '720p';
    } else if (title.includes('480p')) {
      return '480p';
    } else if (title.includes('360p')) {
      return '360p';
    } else {
      return 'SD';
    }
  }

  formatSize(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';
    
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  getGenreMap() {
    return {
      28: 'Action',
      12: 'Adventure',
      16: 'Animation',
      35: 'Comedy',
      80: 'Crime',
      99: 'Documentary',
      18: 'Drama',
      10751: 'Family',
      14: 'Fantasy',
      36: 'History',
      27: 'Horror',
      10402: 'Music',
      9648: 'Mystery',
      10749: 'Romance',
      878: 'Sci-Fi',
      10770: 'TV Movie',
      53: 'Thriller',
      10752: 'War',
      37: 'Western'
    };
  }

  mapGenres(genreIds) {
    if (!genreIds || genreIds.length === 0) return 'Unknown';
    return genreIds.map(id => this.genreMap[id] || 'Unknown').join('|');
  }

  getPrimaryGenre(genreIds) {
    if (!genreIds || genreIds.length === 0) return 'Other';
    const primaryGenreId = genreIds[0];
    return this.genreMap[primaryGenreId] || 'Other';
  }

  // Generate JSON playlist for API usage
  buildJSONPlaylist(moviesWithTorrents) {
    return {
      playlist: {
        name: 'Movie Collection',
        version: '1.0',
        count: moviesWithTorrents.length,
        items: moviesWithTorrents.map((movie, index) => ({
          id: movie.id,
          title: movie.title,
          year: movie.year,
          description: movie.description,
          poster: movie.poster,
          backdrop: movie.backdrop,
          rating: movie.rating,
          genres: this.mapGenres(movie.genreIds),
          quality: this.extractQuality(movie.torrent.title),
          size: this.formatSize(movie.torrent.size),
          seeders: movie.torrent.seeders,
          source: movie.torrent.source,
          streamUrl: `${this.serverUrl}/stream/${movie.id}`,
          channelNumber: 1000 + index
        }))
      }
    };
  }
}

module.exports = M3UGenerator;
