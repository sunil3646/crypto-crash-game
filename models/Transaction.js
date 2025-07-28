const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  playerId: {
    type: String,
    required: true,
    index: true
  },
  usdAmount: {
    type: Number,
    required: true
  },
  cryptoAmount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'USDT']
  },
  transactionType: {
    type: String,
    required: true,
    enum: ['bet', 'cashout']
  },
  transactionHash: {
    type: String,
    required: true,
    unique: true
  },
  priceAtTime: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('Transaction', transactionSchema);
