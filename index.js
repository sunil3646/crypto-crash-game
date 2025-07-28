// Enhanced Crypto Crash Game Server with Cryptocurrency Integration
require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from 'client' folder
app.use(express.static(path.join(__dirname, 'client')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

// MongoDB connection with retry logic
async function connectToMongoDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    // Retry connection after 5 seconds
    setTimeout(connectToMongoDB, 5000);
  }
}

connectToMongoDB();

// Game state with proper error handling
let roundNumber = 1;
let currentMultiplier = 1.0;
let crashPoint = 0;
let interval;
let roundStartTime;
let isRoundActive = false;
const players = {}; // Track players' balances and bets

// Cryptocurrency configuration
const SUPPORTED_CRYPTOS = {
  BTC: { name: 'Bitcoin', symbol: 'BTC' },
  ETH: { name: 'Ethereum', symbol: 'ETH' },
  USDT: { name: 'Tether', symbol: 'USDT' }
};

// Price cache with error handling
let priceCache = {};
let lastPriceUpdate = 0;
const PRICE_CACHE_DURATION = 10000; // 10 seconds

// Provably fair algorithm with enhanced security
const GAME_SEED = process.env.GAME_SEED || 'crypto-crash-game-seed-2024';
const MAX_CRASH = 120; // Maximum crash point

/**
 * Generate provably fair crash point using SHA-256
 * @param {number} roundNumber - Current round number
 * @returns {number} Crash point value
 */
function generateProvablyFairCrashPoint(roundNumber) {
  try {
    const seed = GAME_SEED + roundNumber.toString();
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    const randomValue = parseInt(hash.substring(0, 8), 16) / Math.pow(2, 32);
    
    // House edge: 1% (99% RTP)
    const houseEdge = 0.99;
    const crashPoint = houseEdge / randomValue;
    
    // Cap at MAX_CRASH
    return Math.min(crashPoint, MAX_CRASH);
  } catch (error) {
    console.error('❌ Error generating crash point:', error);
    // Fallback to a safe default
    return 1.5;
  }
}

/**
 * Fetch real-time crypto prices with comprehensive error handling
 * @returns {Promise<Object>} Current crypto prices
 */
async function fetchCryptoPrices() {
  const now = Date.now();
  
  // Return cached prices if still valid
  if (now - lastPriceUpdate < PRICE_CACHE_DURATION && Object.keys(priceCache).length > 0) {
    return priceCache;
  }
  
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'bitcoin,ethereum,tether',
        vs_currencies: 'usd'
      },
      timeout: 5000,
      headers: {
        'User-Agent': 'CryptoCrashGame/1.0'
      }
    });
    
    if (!response.data || !response.data.bitcoin || !response.data.ethereum) {
      throw new Error('Invalid response from CoinGecko API');
    }
    
    priceCache = {
      BTC: response.data.bitcoin.usd,
      ETH: response.data.ethereum.usd,
      USDT: 1.00 // USDT is pegged to USD
    };
    
    lastPriceUpdate = now;
    console.log('📊 Updated crypto prices:', priceCache);
    return priceCache;
  } catch (error) {
    console.error('❌ Error fetching crypto prices:', error.message);
    // Return fallback prices if API fails
    return {
      BTC: 60000,
      ETH: 3000,
      USDT: 1.00
    };
  }
}

/**
 * Convert USD to crypto amount
 * @param {number} usdAmount - USD amount
 * @param {string} cryptoType - Cryptocurrency type
 * @param {number} priceAtTime - Price at time of conversion
 * @returns {number} Crypto amount
 */
function convertUSDToCrypto(usdAmount, cryptoType, priceAtTime) {
  if (!priceAtTime || priceAtTime <= 0) {
    throw new Error(`Invalid price for ${cryptoType}`);
  }
  return usdAmount / priceAtTime;
}

/**
 * Convert crypto to USD amount
 * @param {number} cryptoAmount - Crypto amount
 * @param {string} cryptoType - Cryptocurrency type
 * @param {number} priceAtTime - Price at time of conversion
 * @returns {number} USD amount
 */
function convertCryptoToUSD(cryptoAmount, cryptoType, priceAtTime) {
  if (!priceAtTime || priceAtTime <= 0) {
    throw new Error(`Invalid price for ${cryptoType}`);
  }
  return cryptoAmount * priceAtTime;
}

/**
 * Generate mock transaction hash for blockchain simulation
 * @returns {string} Transaction hash
 */
function generateTransactionHash() {
  return '0x' + crypto.randomBytes(32).toString('hex');
}

/**
 * Game round management with countdown
 * @param {number} seconds - Countdown seconds
 * @param {Function} callback - Callback function
 */
function countdownBeforeRound(seconds, callback) {
  let remaining = seconds;
  const countdownInterval = setInterval(() => {
    try {
      io.emit('countdown', remaining);
      remaining--;

      if (remaining < 0) {
        clearInterval(countdownInterval);
        callback();
      }
    } catch (error) {
      console.error('❌ Error in countdown:', error);
      clearInterval(countdownInterval);
      callback();
    }
  }, 1000);
}

/**
 * Start a new game round with provably fair crash point
 */
function startNewRound() {
  try {
    // Generate provably fair crash point
    crashPoint = generateProvablyFairCrashPoint(roundNumber);
    
    console.log(`🎮 Starting round ${roundNumber} with crash point: ${crashPoint.toFixed(2)}x`);
    console.log(`🔐 Provably fair seed: ${GAME_SEED + roundNumber.toString()}`);
    
    countdownBeforeRound(10, () => {
      currentMultiplier = 1.0;
      roundStartTime = Date.now();
      isRoundActive = true;
      
      io.emit('roundStart', { 
        roundNumber, 
        crashPoint: crashPoint.toFixed(2),
        seed: GAME_SEED + roundNumber.toString()
      });
      
      console.log(`🚀 Round ${roundNumber} started. Crash point: ${crashPoint.toFixed(2)}x`);

      // Save round to database with error handling
      saveRoundToDatabase(roundNumber, crashPoint).catch(error => {
        console.error('❌ Error saving round to database:', error);
      });

      interval = setInterval(() => {
        try {
          if (!isRoundActive) return;
          
          // Exponential growth formula
          const timeElapsed = (Date.now() - roundStartTime) / 1000;
          const growthFactor = 0.01;
          currentMultiplier = 1 + (timeElapsed * growthFactor);
          
          io.emit('multiplier', currentMultiplier.toFixed(2));

          if (currentMultiplier >= crashPoint) {
            clearInterval(interval);
            isRoundActive = false;
            io.emit('crashed', crashPoint.toFixed(2));
            console.log(`💥 Round ${roundNumber} crashed at ${crashPoint.toFixed(2)}x`);

            // Update round result in database
            updateRoundResult(roundNumber, crashPoint.toFixed(2)).catch(error => {
              console.error('❌ Error updating round result:', error);
            });

            setTimeout(() => {
              // Reset all player bets for next round
              for (const id in players) {
                players[id].currentBet = null;
                players[id].hasCashedOut = false;
              }
              roundNumber++;
              startNewRound();
            }, 5000);
          }
        } catch (error) {
          console.error('❌ Error in multiplier update:', error);
        }
      }, 100);
    });
  } catch (error) {
    console.error('❌ Error starting new round:', error);
    // Retry starting round after 5 seconds
    setTimeout(startNewRound, 5000);
  }
}

/**
 * Save round to database
 * @param {number} roundNumber - Round number
 * @param {number} crashPoint - Crash point
 */
async function saveRoundToDatabase(roundNumber, crashPoint) {
  try {
    const Round = require('./models/Round');
    await Round.updateOne(
      { roundNumber },
      { 
        roundNumber,
        crashPoint,
        startTime: new Date(),
        status: 'active'
      },
      { upsert: true }
    );
    console.log(`💾 Round ${roundNumber} saved to database`);
  } catch (error) {
    console.error('❌ Error saving round to database:', error);
    console.log('⚠️ Round not saved to database, but game continues');
  }
}

/**
 * Update round result in database
 * @param {number} roundNumber - Round number
 * @param {number} crashPoint - Crash point
 */
async function updateRoundResult(roundNumber, crashPoint) {
  try {
    const Round = require('./models/Round');
    await Round.updateOne(
      { roundNumber },
      { 
        crashPoint,
        endTime: new Date(),
        status: 'completed'
      }
    );
    console.log(`💾 Round ${roundNumber} result updated in database`);
  } catch (error) {
    console.error('❌ Error updating round result:', error);
    console.log('⚠️ Round result not updated in database, but game continues');
  }
}

/**
 * Save transaction with comprehensive logging
 * @param {string} playerId - Player ID
 * @param {number} usdAmount - USD amount
 * @param {number} cryptoAmount - Crypto amount
 * @param {string} currency - Currency type
 * @param {string} transactionType - Transaction type
 * @param {number} priceAtTime - Price at time of transaction
 */
async function saveTransaction(playerId, usdAmount, cryptoAmount, currency, transactionType, priceAtTime) {
  console.log('💾 Starting transaction save:', {
    playerId,
    usdAmount,
    cryptoAmount,
    currency,
    transactionType,
    priceAtTime
  });
  
  try {
    console.log('💾 Creating Transaction model...');
    const Transaction = require('./models/Transaction');
    console.log('💾 Transaction model loaded successfully');
    
    const transaction = new Transaction({
      playerId,
      usdAmount,
      cryptoAmount,
      currency,
      transactionType,
      transactionHash: generateTransactionHash(),
      priceAtTime,
      timestamp: new Date()
    });
    
    console.log('💾 Transaction object created:', transaction);
    console.log('💾 Saving transaction to database...');
    await transaction.save();
    console.log(`💾 Transaction saved successfully: ${transactionType} - ${usdAmount} USD -> ${cryptoAmount} ${currency}`);
  } catch (error) {
    console.error('❌ Error saving transaction:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    console.log('⚠️ Transaction not saved to database, but game continues');
  }
}

// WebSocket connection handling with comprehensive error handling
io.on('connection', (socket) => {
  console.log('📡 Player connected:', socket.id);

  // Initialize player with crypto wallets
  players[socket.id] = {
    wallets: {
      BTC: { balance: 0.001, currency: 'BTC' },
      ETH: { balance: 0.01, currency: 'ETH' },
      USDT: { balance: 100, currency: 'USDT' }
    },
    currentBet: null,
    hasCashedOut: false
  };

  // Send initial balance
  sendPlayerBalance(socket).catch(error => {
    console.error('❌ Error sending initial balance:', error);
  });

  // Handle bet placement with comprehensive validation
  socket.on('placeBet', async (data) => {
    try {
      console.log('📝 Received bet request:', data);
      const { usdAmount, cryptoType } = data;
      const player = players[socket.id];
      
      // Input validation
      if (!usdAmount || usdAmount <= 0) {
        console.log('❌ Invalid bet amount:', usdAmount);
        return socket.emit('betPlaced', { 
          success: false, 
          message: 'Invalid bet amount' 
        });
      }

      if (!SUPPORTED_CRYPTOS[cryptoType]) {
        console.log('❌ Unsupported cryptocurrency:', cryptoType);
        return socket.emit('betPlaced', { 
          success: false, 
          message: 'Unsupported cryptocurrency' 
        });
      }

      // Check if round is active
      if (!isRoundActive) {
        console.log('❌ No active round');
        return socket.emit('betPlaced', { 
          success: false, 
          message: 'No active round. Please wait for next round.' 
        });
      }

      console.log('📊 Fetching crypto prices...');
      // Get current crypto prices
      const prices = await fetchCryptoPrices();
      const priceAtTime = prices[cryptoType];
      console.log('📊 Prices fetched:', prices, 'Selected price:', priceAtTime);
      
      // Convert USD to crypto
      const cryptoAmount = convertUSDToCrypto(usdAmount, cryptoType, priceAtTime);
      console.log('💱 Conversion: $', usdAmount, '->', cryptoAmount, cryptoType);
      
      // Check if player has enough crypto balance
      console.log('💰 Player balance:', player.wallets[cryptoType].balance, 'Required:', cryptoAmount);
      if (player.wallets[cryptoType].balance < cryptoAmount) {
        console.log('❌ Insufficient balance');
        return socket.emit('betPlaced', { 
          success: false, 
          message: `Insufficient ${cryptoType} balance` 
        });
      }

      console.log('✅ Balance check passed, updating wallet...');
      // Atomic balance update
      player.wallets[cryptoType].balance -= cryptoAmount;
      player.currentBet = {
        usdAmount,
        cryptoAmount,
        cryptoType,
        priceAtTime,
        roundNumber
      };
      player.hasCashedOut = false;

      console.log('💾 Saving transaction to database...');
      // Save transaction with error handling
      try {
        await saveTransaction(
          socket.id, 
          usdAmount, 
          cryptoAmount, 
          cryptoType, 
          'bet', 
          priceAtTime
        );
      } catch (error) {
        console.error('❌ Error saving transaction, but continuing game:', error.message);
      }

      console.log('📢 Broadcasting bet to all players...');
      // Notify all players about the bet
      io.emit('playerBet', {
        playerId: socket.id,
        usdAmount,
        cryptoType
      });

      console.log('✅ Bet placed successfully');
      socket.emit('betPlaced', { 
        success: true, 
        balance: player.wallets[cryptoType].balance,
        cryptoType
      });
      
      console.log(`🎯 ${socket.id} placed a bet of $${usdAmount} (${cryptoAmount} ${cryptoType})`);
    } catch (error) {
      console.error('❌ Error placing bet:', error);
      console.error('❌ Error stack:', error.stack);
      socket.emit('betPlaced', { 
        success: false, 
        message: `Error processing bet: ${error.message}` 
      });
    }
  });

  // Handle cash out with comprehensive validation
  socket.on('cashedOut', async () => {
    try {
      const player = players[socket.id];
      
      if (!player.currentBet || player.hasCashedOut || !isRoundActive) {
        return socket.emit('cashedOutFail', { 
          message: '❌ Cannot cash out at this time.' 
        });
      }

      const { cryptoAmount, cryptoType, priceAtTime } = player.currentBet;
      const winningsCrypto = cryptoAmount * currentMultiplier;
      const winningsUSD = convertCryptoToUSD(winningsCrypto, cryptoType, priceAtTime);
      
      // Atomic balance update
      player.wallets[cryptoType].balance += winningsCrypto;
      player.hasCashedOut = true;
      player.currentBet = null;

      // Save transaction with error handling
      await saveTransaction(
        socket.id, 
        winningsUSD, 
        winningsCrypto, 
        cryptoType, 
        'cashout', 
        priceAtTime
      );

      // Notify all players about the cash out
      io.emit('playerCashout', {
        playerId: socket.id,
        multiplier: currentMultiplier.toFixed(2),
        winningsUSD: winningsUSD.toFixed(2),
        cryptoType
      });

      socket.emit('cashedOutSuccess', {
        winnings: winningsUSD.toFixed(2),
        balance: player.wallets[cryptoType].balance,
        multiplier: currentMultiplier.toFixed(2),
        cryptoType
      });

      console.log(`💸 ${socket.id} cashed out at ${currentMultiplier.toFixed(2)}x, won $${winningsUSD.toFixed(2)}`);
    } catch (error) {
      console.error('❌ Error processing cash out:', error);
      socket.emit('cashedOutFail', { 
        message: 'Error processing cash out' 
      });
    }
  });

  // Handle balance request
  socket.on('getBalance', async () => {
    try {
      await sendPlayerBalance(socket);
    } catch (error) {
      console.error('❌ Error handling balance request:', error);
    }
  });

  // Handle disconnect with cleanup
  socket.on('disconnect', () => {
    console.log('❌ Player disconnected:', socket.id);
    delete players[socket.id];
  });
});

/**
 * Helper function to send player balance with error handling
 * @param {Object} socket - Socket instance
 */
async function sendPlayerBalance(socket) {
  const player = players[socket.id];
  if (!player) return;

  try {
    const prices = await fetchCryptoPrices();
    const balanceData = {};
    
    for (const [cryptoType, wallet] of Object.entries(player.wallets)) {
      const usdValue = convertCryptoToUSD(wallet.balance, cryptoType, prices[cryptoType]);
      balanceData[cryptoType] = {
        cryptoBalance: wallet.balance,
        usdValue: usdValue,
        price: prices[cryptoType]
      };
    }
    
    socket.emit('balance', balanceData);
  } catch (error) {
    console.error('❌ Error sending balance:', error);
    // Send fallback balance data
    socket.emit('balance', {
      BTC: { cryptoBalance: 0, usdValue: 0, price: 60000 },
      ETH: { cryptoBalance: 0, usdValue: 0, price: 3000 },
      USDT: { cryptoBalance: 0, usdValue: 0, price: 1 }
    });
  }
}

// API Routes with comprehensive error handling
app.get('/api/prices', async (req, res) => {
  try {
    const prices = await fetchCryptoPrices();
    res.json({ success: true, prices });
  } catch (error) {
    console.error('❌ Error in /api/prices:', error);
    res.status(500).json({ success: false, message: 'Error fetching prices' });
  }
});

app.get('/api/rounds', async (req, res) => {
  try {
    const Round = require('./models/Round');
    const rounds = await Round.find().sort({ roundNumber: -1 }).limit(20);
    res.json({ success: true, rounds });
  } catch (error) {
    console.error('❌ Error in /api/rounds:', error);
    res.status(500).json({ success: false, message: 'Error fetching rounds' });
  }
});

app.get('/api/transactions/:playerId', async (req, res) => {
  try {
    const Transaction = require('./models/Transaction');
    const transactions = await Transaction.find({ playerId: req.params.playerId })
      .sort({ timestamp: -1 })
      .limit(50);
    res.json({ success: true, transactions });
  } catch (error) {
    console.error('❌ Error in /api/transactions:', error);
    res.status(500).json({ success: false, message: 'Error fetching transactions' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'healthy',
    roundNumber,
    isRoundActive,
    connectedPlayers: Object.keys(players).length
  });
});

// Start the game with error handling
try {
  startNewRound();
} catch (error) {
  console.error('❌ Error starting game:', error);
}

const PORT = process.env.PORT || 5000;
(async () => {
  try {
    const open = (await import('open')).default;
    server.listen(PORT, () => {
      console.log(`🚀 Enhanced Crypto Crash Game Server running on port ${PORT}`);
      console.log(`💰 Supported cryptocurrencies: ${Object.keys(SUPPORTED_CRYPTOS).join(', ')}`);
      console.log(`🔐 Provably fair seed: ${GAME_SEED}`);
      console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
      open(`http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
  }
})();
const cors = require("cors");
app.use(cors()); // OR
// app.use(cors({ origin: "https://your-frontend.netlify.app" }));
