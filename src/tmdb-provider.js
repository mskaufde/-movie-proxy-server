const axios = require('axios');

class TMDBProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.themoviedb.org/3';
    this.imageBaseUrl = 'https://image.tmdb.org/t/p';
    
    if (!apiKey) {
      throw new Error('TMDB API key is required');
    }
  }

  async getPopularMovies(page = 1) {
    try {
      const url = `${this.baseUrl}/movie/popular?api_key=${this.apiKey}&page=${page}&language=en-US`;
      const response = await axios.get(url);
      
      return response.data.results.map(movie => ({
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
        releaseDate: movie.release_date,
        poster: movie.poster_path ? `${this.imageBaseUrl}/w500${movie.poster_path}` : null,
        backdrop: movie.backdrop_path ? `${this.imageBaseUrl}/original${movie.backdrop_path}` : null,
        description: movie.overview || 'No description available',
        rating: movie.vote_average,
        voteCount: movie.vote_count,
        popularity: movie.popularity,
        genreIds: movie.genre_ids,
        adult: movie.adult,
        language: movie.original_language,
        type: 'movie'
      }));
    } catch (error) {
      console.error('Error fetching popular movies:', error.message);
      return [];
    }
  }

  async getTVSeries(page = 1) {
    try {
      const url = `${this.baseUrl}/tv/popular?api_key=${this.apiKey}&page=${page}&language=en-US`;
      const response = await axios.get(url);
      
      return response.data.results.map(show => ({
        id: show.id,
        title: show.name,
        originalTitle: show.original_name,
        year: show.first_air_date ? new Date(show.first_air_date).getFullYear() : null,
        releaseDate: show.first_air_date,
        poster: show.poster_path ? `${this.imageBaseUrl}/w500${show.poster_path}` : null,
        backdrop: show.backdrop_path ? `${this.imageBaseUrl}/original${show.backdrop_path}` : null,
        description: show.overview || 'No description available',
        rating: show.vote_average,
        voteCount: show.vote_count,
        popularity: show.popularity,
        genreIds: show.genre_ids,
        language: show.original_language,
        type: 'series',
        countries: show.origin_country
      }));
    } catch (error) {
      console.error('Error fetching TV series:', error.message);
      return [];
    }
  }

  async getMovieDetails(movieId) {
    try {
      const url = `${this.baseUrl}/movie/${movieId}?api_key=${this.apiKey}&append_to_response=credits,videos`;
      const response = await axios.get(url);
      const movie = response.data;
      
      return {
        runtime: movie.runtime,
        budget: movie.budget,
        revenue: movie.revenue,
        genres: movie.genres ? movie.genres.map(g => g.name).join('|') : '',
        director: movie.credits?.crew?.find(c => c.job === 'Director')?.name || 'Unknown',
        cast: movie.credits?.cast?.slice(0, 5).map(c => c.name).join(', ') || '',
        productionCompanies: movie.production_companies?.map(c => c.name).join(', ') || '',
        spokenLanguages: movie.spoken_languages?.map(l => l.english_name).join(', ') || '',
        trailer: this.getTrailerUrl(movie.videos?.results)
      };
    } catch (error) {
      console.error(`Error fetching movie details for ID ${movieId}:`, error.message);
      return {
        runtime: null,
        genres: '',
        director: 'Unknown',
        cast: '',
        trailer: null
      };
    }
  }

  async getTVDetails(seriesId) {
    try {
      const url = `${this.baseUrl}/tv/${seriesId}?api_key=${this.apiKey}&append_to_response=credits,videos`;
      const response = await axios.get(url);
      const series = response.data;
      
      return {
        numberOfSeasons: series.number_of_seasons,
        numberOfEpisodes: series.number_of_episodes,
        episodeRunTime: series.episode_run_time?.[0] || null,
        genres: series.genres ? series.genres.map(g => g.name).join('|') : '',
        creator: series.created_by?.[0]?.name || 'Unknown',
        cast: series.credits?.cast?.slice(0, 5).map(c => c.name).join(', ') || '',
        networks: series.networks?.map(n => n.name).join(', ') || '',
        status: series.status,
        trailer: this.getTrailerUrl(series.videos?.results)
      };
    } catch (error) {
      console.error(`Error fetching TV details for ID ${seriesId}:`, error.message);
      return {
        numberOfSeasons: null,
        numberOfEpisodes: null,
        episodeRunTime: null,
        genres: '',
        creator: 'Unknown',
        cast: ''
      };
    }
  }

  getTrailerUrl(videos) {
    if (!videos || videos.length === 0) return null;
    
    const trailer = videos.find(v => 
      v.type === 'Trailer' && 
      v.site === 'YouTube'
    );
    
    return trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
  }

  async searchMovies(query, year = null) {
    try {
      let url = `${this.baseUrl}/search/movie?api_key=${this.apiKey}&query=${encodeURIComponent(query)}`;
      if (year) {
        url += `&year=${year}`;
      }
      
      const response = await axios.get(url);
      return response.data.results.map(movie => ({
        id: movie.id,
        title: movie.title,
        year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
        poster: movie.poster_path ? `${this.imageBaseUrl}/w500${movie.poster_path}` : null,
        description: movie.overview || 'No description available',
        rating: movie.vote_average,
        type: 'movie'
      }));
    } catch (error) {
      console.error('Error searching movies:', error.message);
      return [];
    }
  }

  // Genre mapping for better categorization
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
      878: 'Science Fiction',
      10770: 'TV Movie',
      53: 'Thriller',
      10752: 'War',
      37: 'Western'
    };
  }

  mapGenres(genreIds) {
    const genreMap = this.getGenreMap();
    return genreIds.map(id => genreMap[id] || 'Unknown').join('|');
  }

  getPrimaryGenre(genreIds) {
    const genreMap = this.getGenreMap();
    return genreIds.length > 0 ? (genreMap[genreIds[0]] || 'Movies') : 'Movies';
  }
}

module.exports = TMDBProvider;
