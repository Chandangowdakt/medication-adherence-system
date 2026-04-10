import mongoose from 'mongoose';

/**
 * Prevents duplicate FCM sends for the same user/med/day/slot/kind (reminder vs missed).
 */
const pushDedupeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    medicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medication',
      required: true,
    },
    utcDateKey: { type: String, required: true },
    slotHm: { type: String, required: true },
    kind: {
      type: String,
      enum: ['reminder', 'missed'],
      required: true,
    },
  },
  { timestamps: true }
);

pushDedupeSchema.index(
  { userId: 1, medicationId: 1, utcDateKey: 1, slotHm: 1, kind: 1 },
  { unique: true }
);

/** Optional TTL: drop old keys after ~3 days */
pushDedupeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 3 });

export const PushDedupe = mongoose.model('PushDedupe', pushDedupeSchema);
