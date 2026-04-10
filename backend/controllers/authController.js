import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

const SALT_ROUNDS = 10;

function signToken(userId, role) {
  const secret = process.env.JWT_SECRET;
  if (!secret || !String(secret).trim()) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.sign({ userId, role }, secret, { expiresIn: '7d' });
}

/**
 * POST /api/auth/register — create user with hashed password.
 */
export async function register(req, res) {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const allowedRoles = ['patient', 'doctor'];
    const userRole = allowedRoles.includes(role) ? role : 'patient';

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashed,
      role: userRole,
    });

    const token = signToken(user._id.toString(), user.role);

    return res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ message: 'Server error during registration' });
  }
}

/**
 * POST /api/auth/login — validate credentials and return JWT.
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = signToken(user._id.toString(), user.role);

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ message: 'Server error during login' });
  }
}

/**
 * GET /api/auth/me — current user from JWT (for dashboard).
 */
export async function me(req, res) {
  try {
    const user = req.userDoc;
    if (!user) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
}
