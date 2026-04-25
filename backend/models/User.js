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
    /** FCM device tokens (web/mobile). Max length enforced in controller. */
    pushTokens: [
      {
        token: { type: String, required: true },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    /** Server-driven push preferences (FCM). */
    notificationPreferences: {
      remindersEnabled: { type: Boolean, default: true },
      missedAlertsEnabled: { type: Boolean, default: true },
    },
    /**
     * IANA time zone (e.g. "America/Chicago") for schedule matching on reminders and missed alerts.
     * "UTC" matches legacy server behavior. Updated from the browser (Intl) when possible.
     */
    timeZone: {
      type: String,
      default: 'UTC',
      trim: true,
    },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
