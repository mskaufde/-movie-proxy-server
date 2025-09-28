#!/bin/bash

echo "🎬 Movie Proxy Server Installation"
echo "=================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Installing Node.js..."
    
    # Detect OS and install Node.js
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install node
        else
            echo "Please install Homebrew first or download Node.js from nodejs.org"
            exit 1
        fi
    else
        echo "Please install Node.js manually from https://nodejs.org/"
        exit 1
    fi
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create .env from example
if [ ! -f .env ]; then
    cp .env.example .env
    echo "📝 Created .env file from .env.example"
    echo "⚠️  Please edit .env and add your TMDB_API_KEY"
fi

# Create public directory if it doesn't exist
mkdir -p public

echo "✅ Installation completed!"
echo ""
echo "🔧 Next steps:"
echo "1. Get TMDB API key from: https://www.themoviedb.org/settings/api"
echo "2. Edit .env file: nano .env"
echo "3. Add your TMDB_API_KEY to .env file"
echo "4. Start server: npm start"
echo ""
echo "📺 After starting, your playlist will be available at:"
echo "   http://your-server-ip:3000/playlist.m3u"
