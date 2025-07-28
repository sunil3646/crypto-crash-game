const express = require('express');
const router = express.Router();

// Example route directly in index.js
router.get('/', (req, res) => {
  res.send('Crash Game API Running!');
});

module.exports = router;
