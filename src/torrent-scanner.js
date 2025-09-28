const axios = require('axios');
const cheerio = require('cheerio');

class TorrentScanner {
  constructor() {
    this.sources = [
      new TPBScraper(),
      new LimeTorrentsScraper(),
      new TorrentGalaxyScraper()
    ];
    this.timeout = 10000; // 10 second timeout
  }

  async findBestTorrent(title, year, type = 'movie') {
    const searchQuery = this.buildSearchQuery(title, year, type);
    console.log(`Searching for: ${searchQuery}`);
    
    // Search all sources concurrently with timeout
    const searchPromises = this.sources.map(source => 
      Promise.race([
        source.search(searchQuery),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.timeout)
        )
      ]).catch(err => {
        console.log(`${source.name} failed: ${err.message}`);
        return [];
      })
    );
    
    const allResults = await Promise.all(searchPromises);
    const torrents = allResults.flat();
    
    if (torrents.length === 0) {
      console.log(`No torrents found for: ${searchQuery}`);
      return null;
    }
    
    // Filter and score torrents
    const validTorrents = torrents.filter(this.isValidTorrent);
    if (validTorrents.length === 0) {
      console.log(`No valid torrents found for: ${searchQuery}`);
      return null;
    }
    
    const scoredTorrents = validTorrents.map(torrent => ({
      ...torrent,
      score: this.calculateTorrentScore(torrent)
    }));
    
    // Return best torrent
    const bestTorrent = scoredTorrents.sort((a, b) => b.score - a.score)[0];
    console.log(`Best torrent for ${title}: ${bestTorrent.title} (Score: ${bestTorrent.score})`);
    
    return bestTorrent;
  }

  isValidTorrent(torrent) {
    const minSeeders = parseInt(process.env.MIN_SEEDERS_REQUIRED) || 5;
    return (
      torrent.seeders >= minSeeders &&
      torrent.magnetLink &&
      torrent.title &&
      torrent.size > 0
    );
  }

  calculateTorrentScore(torrent) {
    let score = 0;
    
    // Seeders (most important factor - 40% of score)
    score += Math.min(torrent.seeders * 2, 80);
    
    // Health ratio (seeders vs leechers)
    const healthRatio = torrent.seeders / (torrent.leechers + 1);
    score += Math.min(healthRatio * 10, 20);
    
    // Quality scoring (30% of score)
    const title = torrent.title.toLowerCase();
    if (title.includes('2160p') || title.includes('4k')) score += 25;
    else if (title.includes('1080p')) score += 20;
    else if (title.includes('720p')) score += 15;
    else if (title.includes('480p')) score += 5;
    
    // Size optimization (avoid too small/large files)
    const sizeGB = torrent.size / (1024 * 1024 * 1024);
    if (sizeGB >= 1 && sizeGB <= 10) score += 15; // Good size range
    else if (sizeGB >= 10 && sizeGB <= 20) score += 10; // Acceptable
    else if (sizeGB < 0.5) score -= 20; // Too small (likely fake)
    else if (sizeGB > 50) score -= 15; // Too large
    
    // Release group quality
    const goodGroups = ['yify', 'rarbg', 'fgt', 'sparks', 'cmrg', 'yts', 'eztv'];
    if (goodGroups.some(group => title.includes(group))) score += 10;
    
    // Codec preferences
    if (title.includes('x264') || title.includes('h264')) score += 5;
    if (title.includes('x265') || title.includes('h265')) score += 8;
    
    // Audio quality
    if (title.includes('5.1') || title.includes('7.1')) score += 5;
    if (title.includes('atmos')) score += 8;
    
    // Verified uploader bonus
    if (torrent.verified) score += 10;
    
    // Prefer recent uploads (within 1 year)
    if (torrent.uploadDate) {
      const daysSinceUpload = (Date.now() - new Date(torrent.uploadDate)) / (1000 * 60 * 60 * 24);
      if (daysSinceUpload < 365) score += 5;
    }
    
    return Math.max(score, 0);
  }

  buildSearchQuery(title, year, type) {
    // Clean title for better search results
    let cleanTitle = title
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Remove common words that might interfere
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    cleanTitle = cleanTitle.split(' ')
      .filter(word => !stopWords.includes(word.toLowerCase()) || cleanTitle.split(' ').length <= 3)
      .join(' ');
    
    return year ? `${cleanTitle} ${year}` : cleanTitle;
  }
}

// The Pirate Bay Scraper
class TPBScraper {
  constructor() {
    this.name = 'ThePirateBay';
    this.baseUrl = 'https://thepiratebay.org';
    this.searchUrl = '/search';
  }

  async search(query) {
    try {
      const searchUrl = `${this.baseUrl}${this.searchUrl}/${encodeURIComponent(query)}/1/99/200`;
      const response = await axios.get(searchUrl, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const $ = cheerio.load(response.data);
      const torrents = [];
      
      $('#searchResult tr').each((index, element) => {
        if (index === 0) return; // Skip header
        
        const $row = $(element);
        const $nameCell = $row.find('td').eq(1);
        const $seedCell = $row.find('td').eq(2);
        const $leechCell = $row.find('td').eq(3);
        
        const title = $nameCell.find('a').first().text().trim();
        const magnetLink = $nameCell.find('a[href^="magnet:"]').attr('href');
        const seeders = parseInt($seedCell.text()) || 0;
        const leechers = parseInt($leechCell.text()) || 0;
        
        if (title && magnetLink && seeders > 0) {
          torrents.push({
            title,
            magnetLink,
            seeders,
            leechers,
            size: this.extractSize($nameCell.text()),
            source: this.name,
            verified: $nameCell.find('img[title*="VIP"]').length > 0
          });
        }
      });
      
      return torrents;
    } catch (error) {
      console.error(`${this.name} search error:`, error.message);
      return [];
    }
  }

  extractSize(text) {
    const sizeMatch = text.match(/Size (\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
    if (!sizeMatch) return 0;
    
    const size = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toLowerCase();
    
    switch (unit) {
      case 'gb': return size * 1024 * 1024 * 1024;
      case 'mb': return size * 1024 * 1024;
      case 'kb': return size * 1024;
      default: return size;
    }
  }
}

// LimeTorrents Scraper
class LimeTorrentsScraper {
  constructor() {
    this.name = 'LimeTorrents';
    this.baseUrl = 'https://www.limetorrents.pro';
  }

  async search(query) {
    try {
      const searchUrl = `${this.baseUrl}/search/all/${encodeURIComponent(query)}/`;
      const response = await axios.get(searchUrl, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const $ = cheerio.load(response.data);
      const torrents = [];
      
      $('.table2 tr').each((index, element) => {
        if (index === 0) return; // Skip header
        
        const $row = $(element);
        const $cells = $row.find('td');
        
        if ($cells.length >= 5) {
          const title = $cells.eq(0).find('a').first().text().trim();
          const magnetLink = $cells.eq(0).find('a[href^="magnet:"]').attr('href');
          const sizeText = $cells.eq(2).text().trim();
          const seeders = parseInt($cells.eq(3).text()) || 0;
          const leechers = parseInt($cells.eq(4).text()) || 0;
          
          if (title && magnetLink && seeders > 0) {
            torrents.push({
              title,
              magnetLink,
              seeders,
              leechers,
              size: this.parseSize(sizeText),
              source: this.name,
              verified: false
            });
          }
        }
      });
      
      return torrents;
    } catch (error) {
      console.error(`${this.name} search error:`, error.message);
      return [];
    }
  }

  parseSize(sizeText) {
    const match = sizeText.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
    if (!match) return 0;
    
    const size = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'gb': return size * 1024 * 1024 * 1024;
      case 'mb': return size * 1024 * 1024;
      case 'kb': return size * 1024;
      default: return size;
    }
  }
}

// TorrentGalaxy Scraper
class TorrentGalaxyScraper {
  constructor() {
    this.name = 'TorrentGalaxy';
    this.baseUrl = 'https://torrentgalaxy.to';
  }

  async search(query) {
    try {
      const searchUrl = `${this.baseUrl}/torrents.php?search=${encodeURIComponent(query)}`;
      const response = await axios.get(searchUrl, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const $ = cheerio.load(response.data);
      const torrents = [];
      
      $('.tgxtablerow').each((index, element) => {
        const $row = $(element);
        
        const title = $row.find('.txlight a').first().text().trim();
        const magnetLink = $row.find('a[href^="magnet:"]').attr('href');
        const sizeText = $row.find('.txlight').eq(3).text().trim();
        const seeders = parseInt($row.find('.txlight').eq(4).text()) || 0;
        const leechers = parseInt($row.find('.txlight').eq(5).text()) || 0;
        
        if (title && magnetLink && seeders > 0) {
          torrents.push({
            title,
            magnetLink,
            seeders,
            leechers,
            size: this.parseSize(sizeText),
            source: this.name,
            verified: $row.find('.txlight img[alt*="VIP"]').length > 0
          });
        }
      });
      
      return torrents;
    } catch (error) {
      console.error(`${this.name} search error:`, error.message);
      return [];
    }
  }

  parseSize(sizeText) {
    const match = sizeText.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
    if (!match) return 0;
    
    const size = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'gb': return size * 1024 * 1024 * 1024;
      case 'mb': return size * 1024 * 1024;
      case 'kb': return size * 1024;
      default: return size;
    }
  }
}

module.exports = TorrentScanner;
