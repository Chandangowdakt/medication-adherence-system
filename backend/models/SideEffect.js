import mongoose from 'mongoose';

const severityEnum = ['low', 'medium', 'high'];

/**
 * User-reported side effect linked to one of their medications.
 */
const sideEffectSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    medicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medication',
      required: [true, 'Medication is required'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    severity: {
      type: String,
      enum: {
        values: severityEnum,
        message: 'severity must be low, medium, or high',
      },
      required: [true, 'Severity is required'],
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
      default: () => new Date(),
    },
  },
  { timestamps: true }
);

sideEffectSchema.index({ userId: 1, date: -1 });
sideEffectSchema.index({ userId: 1, medicationId: 1 });

export const SideEffect = mongoose.model('SideEffect', sideEffectSchema);
export const SEVERITY_VALUES = severityEnum;
