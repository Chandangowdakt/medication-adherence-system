import mongoose from 'mongoose';
import { Medication } from '../models/Medication.js';
import { startOfUtcDay } from '../models/MedicationLog.js';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Active on ref UTC day: within [startDate, endDate] if set (inclusive calendar days). */
function isMedicationActiveOnDay(med, refDayStart) {
  const t = refDayStart.getTime();
  const start = med.startDate ? startOfUtcDay(med.startDate)?.getTime() : null;
  const end = med.endDate ? startOfUtcDay(med.endDate)?.getTime() : null;
  if (start != null && t < start) return false;
  if (end != null && t > end) return false;
  return true;
}

/**
 * POST /api/medications — create a medication for the authenticated user.
 */
export async function addMedication(req, res) {
  try {
    const { name, dosage, schedule, startDate, endDate } = req.body;
    const userId = req.user.id;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }

    let scheduleArr = Array.isArray(schedule) ? schedule : [];
    scheduleArr = scheduleArr.map((s) => (typeof s === 'string' ? s.trim() : String(s)));

    const doc = {
      userId,
      name: name.trim(),
      dosage: dosage != null ? String(dosage).trim() : '',
      schedule: scheduleArr,
    };

    if (startDate != null && startDate !== '') {
      const d = new Date(startDate);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'Invalid startDate' });
      }
      doc.startDate = d;
    }

    if (endDate != null && endDate !== '') {
      const d = new Date(endDate);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'Invalid endDate' });
      }
      doc.endDate = d;
    }

    if (doc.startDate && doc.endDate && doc.endDate < doc.startDate) {
      return res.status(400).json({ message: 'endDate must be on or after startDate' });
    }

    const medication = await Medication.create(doc);
    return res.status(201).json({ medication });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors || {}).map((e) => e.message);
      return res.status(400).json({ message: messages[0] || 'Validation failed' });
    }
    console.error('addMedication error:', err);
    return res.status(500).json({ message: 'Server error while creating medication' });
  }
}

/**
 * GET /api/medications — list for user.
 * Query: search (name substring, case-insensitive), status=active|inactive (by date window), asOf (ISO date for active check, default today UTC).
 */
export async function getUserMedications(req, res) {
  try {
    const userId = req.user.id;
    const { search, status, asOf } = req.query;

    if (status && status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ message: 'status must be active or inactive' });
    }

    const filter = { userId };
    if (search != null && String(search).trim() !== '') {
      filter.name = { $regex: escapeRegex(String(search).trim()), $options: 'i' };
    }

    let medications = await Medication.find(filter).sort({ createdAt: -1 }).lean();

    if (status === 'active' || status === 'inactive') {
      let refDay = startOfUtcDay(new Date());
      if (asOf != null && String(asOf).trim() !== '') {
        const parsed = startOfUtcDay(asOf);
        if (!parsed) {
          return res.status(400).json({ message: 'Invalid asOf date' });
        }
        refDay = parsed;
      }
      medications = medications.filter((m) => {
        const active = isMedicationActiveOnDay(m, refDay);
        return status === 'active' ? active : !active;
      });
    }

    return res.json({ medications });
  } catch (err) {
    console.error('getUserMedications error:', err);
    return res.status(500).json({ message: 'Server error while fetching medications' });
  }
}

/**
 * DELETE /api/medications/:id — remove if it belongs to the authenticated user.
 */
export async function deleteMedication(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid medication id' });
    }

    const medication = await Medication.findOne({ _id: id, userId });

    if (!medication) {
      return res.status(404).json({ message: 'Medication not found' });
    }

    await Medication.deleteOne({ _id: id, userId });
    return res.json({ message: 'Medication deleted', id });
  } catch (err) {
    console.error('deleteMedication error:', err);
    return res.status(500).json({ message: 'Server error while deleting medication' });
  }
}
