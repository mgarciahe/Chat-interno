const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    required: true
  },
  author: {
    type: String,
    required: true,
    trim: true,
    maxlength: 32
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

// Compound index for fast history queries
messageSchema.index({ channelId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
