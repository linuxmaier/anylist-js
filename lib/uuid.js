const crypto = require('crypto');

module.exports = () => crypto.randomUUID().replace(/-/g, '');
