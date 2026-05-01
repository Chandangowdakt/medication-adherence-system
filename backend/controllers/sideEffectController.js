import mongoose from 'mongoose';
import { Medication } from '../models/Medication.js';
import { SideEffect, SEVERITY_VALUES } from '../models/SideEffect.js';
import {
  computeCorrelationsForUser,
  computeCorrelationForMedication,
} from '../services/sideEffectCorrelationService.js';
import { emitUserDataChanged } from '../realtime/socketHub.js';

function formatSideEffect(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  const med = o.medicationId;
  const base = {
    id: o._id,
    userId: o.userId,
    medicationId: med && med._id ? med._id : o.medicationId,
    description: o.description,
    severity: o.severity,
    date: o.date,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
  if (med && typeof med === 'object' && med.name !== undefined) {
    base.medication = { id: med._id, name: med.name, dosage: med.dosage ?? '' };
  }
  return base;
}

/**
 * POST /api/side-effects — record a side effect for the user's medication.
 */
export async function createSideEffect(req, res) {
  try {
    const userId = req.user.id;
    const { medicationId, description, severity, date: dateInput } = req.body;

    if (!medicationId) {
      return res.status(400).json({ message: 'medicationId is required' });
    }
    if (!mongoose.isValidObjectId(medicationId)) {
      return res.status(400).json({ message: 'Invalid medicationId' });
    }

    if (description == null || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ message: 'Description is required' });
    }

    if (severity == null || severity === '') {
      return res.status(400).json({ message: 'Severity is required' });
    }
    if (!SEVERITY_VALUES.includes(severity)) {
      return res.status(400).json({
        message: `severity must be one of: ${SEVERITY_VALUES.join(', ')}`,
      });
    }

    const med = await Medication.findOne({ _id: medicationId, userId });
    if (!med) {
      return res.status(404).json({ message: 'Medication not found' });
    }

    const doc = {
      userId,
      medicationId,
      description: description.trim(),
      severity,
    };

    if (dateInput != null && dateInput !== '') {
      const d = new Date(dateInput);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'Invalid date' });
      }
      doc.date = d.toISOString();
    }

    const created = await SideEffect.create(doc);
    const populated = await SideEffect.findById(created._id).populate(
      'medicationId',
      'name dosage'
    );

    emitUserDataChanged(userId);
    return res.status(201).json({ sideEffect: formatSideEffect(populated) });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const first = Object.values(err.errors || {})[0];
      return res.status(400).json({ message: first?.message || 'Validation failed' });
    }
    console.error('createSideEffect error:', err);
    return res.status(500).json({ message: 'Server error while creating side effect' });
  }
}

/**
 * GET /api/side-effects — list for user.
 * Query: severity=low|medium|high, order=asc|desc (by date, default desc).
 */
export async function getUserSideEffects(req, res) {
  try {
    const userId = req.user.id;
    const { severity, order } = req.query;

    const filter = { userId };
    if (severity != null && String(severity).trim() !== '') {
      if (!SEVERITY_VALUES.includes(severity)) {
        return res.status(400).json({
          message: `severity must be one of: ${SEVERITY_VALUES.join(', ')}`,
        });
      }
      filter.severity = severity;
    }

    let sortDir = -1;
    if (order != null && String(order).trim() !== '') {
      const o = String(order).toLowerCase();
      if (o !== 'asc' && o !== 'desc') {
        return res.status(400).json({ message: 'order must be asc or desc' });
      }
      sortDir = o === 'asc' ? 1 : -1;
    }

    const items = await SideEffect.find(filter)
      .populate('medicationId', 'name dosage')
      .sort({ date: sortDir })
      .lean();

    const sideEffects = items.map((row) => formatSideEffect(row));
    return res.json({ sideEffects });
  } catch (err) {
    console.error('getUserSideEffects error:', err);
    return res.status(500).json({ message: 'Server error while fetching side effects' });
  }
}

/**
 * GET /api/side-effects/correlations — per-medication symptom frequencies from SideEffect (same user).
 */
export async function getSideEffectCorrelations(req, res) {
  try {
    const correlations = await computeCorrelationsForUser(req.user.id);
    return res.json({ correlations });
  } catch (err) {
    console.error('getSideEffectCorrelations error:', err);
    return res.status(500).json({ message: 'Server error while computing correlations' });
  }
}

/**
 * GET /api/side-effects/correlations/:medicationId
 */
export async function getSideEffectCorrelationForMedication(req, res) {
  try {
    const { medicationId } = req.params;
    if (!mongoose.isValidObjectId(medicationId)) {
      return res.status(400).json({ message: 'Invalid medicationId' });
    }

    const correlation = await computeCorrelationForMedication(req.user.id, medicationId);
    if (!correlation.medication) {
      return res.status(404).json({ message: 'Medication not found' });
    }

    return res.json(correlation);
  } catch (err) {
    console.error('getSideEffectCorrelationForMedication error:', err);
    return res.status(500).json({ message: 'Server error while computing correlation' });
  }
}
