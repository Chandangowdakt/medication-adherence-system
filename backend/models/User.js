import mongoose from 'mongoose';

/**
 * Allowed roles for the adherence tracker (patient vs care provider).
 */
const roleEnum = ['patient', 'doctor'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false, // omit from queries unless .select('+password')
    },
    role: {
      type: String,
      enum: roleEnum,
      default: 'patient',
    },
    /** Patient only: assigned care provider (doctor user id). */
    linkedDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
