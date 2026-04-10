import mongoose from 'mongoose';

/**
 * Medication belongs to a user; schedule holds daily reminder times (HH:mm).
 */
const medicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Medication name is required'],
      trim: true,
    },
    dosage: {
      type: String,
      trim: true,
      default: '',
    },
    schedule: {
      type: [String],
      default: [],
      /** e.g. ["08:00", "20:00"] — non-empty trimmed strings */
      validate: {
        validator(arr) {
          if (!Array.isArray(arr)) return false;
          return arr.every((s) => typeof s === 'string' && s.trim().length > 0);
        },
        message: 'Schedule must be an array of non-empty time strings',
      },
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

/** createdAt (and updatedAt) come from timestamps option */
export const Medication = mongoose.model('Medication', medicationSchema);
