const mongoose = require('mongoose');
const ChatSchema = new mongoose.Schema({
  EnquiryId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Enquiry', 
    required: true 
  },
  EnquiryName: { type: String, required: true }, // cached for quick display

  Type: { 
    type: String, 
    enum: ['admin-client', 'admin-designer'], 
    required: true 
  },

  Participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  LastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },

  LastRead: [
    {
      UserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      LastReadAt: { type: Date, default: null }
    }
  ],

  CreatedAt: { type: Date, default: Date.now },
  UpdatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

ChatSchema.index({ EnquiryId: 1, Type: 1 }, { unique: true });

module.exports = mongoose.model('Chat', ChatSchema);
