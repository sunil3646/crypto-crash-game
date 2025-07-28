const crypto = require('crypto');

/**
 * Provably fair crash point generator
 * Formula: hash(seed + round) → number → crash point (1x to 100x)
 */
const generateCrashPoint = (roundNumber, seed = 'my_secret_salt') => {
  const data = seed + roundNumber;
  const hash = crypto.createHash('sha256').update(data).digest('hex');

  const hashPart = parseInt(hash.substring(0, 8), 16); // convert part of hash to number
  const max = 100 * 100; // 100x in decimal (2 places)
  const crashRaw = (hashPart % max) / 100 + 1;

  return parseFloat(crashRaw.toFixed(2)); // e.g., 2.47
};

module.exports = { generateCrashPoint };
