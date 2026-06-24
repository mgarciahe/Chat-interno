const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre del canal no puede estar vacio'],
    trim: true,
    maxlength: [64, 'El nombre del canal no puede superar 64 caracteres']
  }
}, {
  timestamps: true
});

// Case-insensitive unique index
channelSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('Channel', channelSchema);
