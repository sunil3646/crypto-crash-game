const Round = require('../models/Round');

const getAllRounds = async (req, res) => {
  try {
    const rounds = await Round.find().sort({ startTime: -1 });
    res.status(200).json(rounds);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rounds' });
  }
};

module.exports = {
  getAllRounds,
};
