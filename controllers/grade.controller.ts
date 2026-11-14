import { Response } from 'express';
import { PrismaClient, ValidationStatus } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth.middleware';
import { GradeCalculationService } from '../services/gradeCalculation.service';

const prisma = new PrismaClient();

export const updateGrades = async (req: AuthRequest, res: Response) => {
  try {
    const { studentId, subjectId, trimester, interrogation, devoir1, devoir2, appreciation } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (userRole === 'TEACHER') {
      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (!student) return res.status(404).json({ message: 'Élève non trouvé' });

      const assignment = await prisma.teacherSubject.findFirst({
        where: { userId, classId: student.classId, subjectId }
      });

      if (!assignment) {
        return res.status(403).json({ message: 'Interdit : Vous n\'enseignez pas cette matière dans cette classe.' });
      }
    }

    const existingGrade = await prisma.grade.findUnique({
      where: { studentId_subjectId_trimester: { studentId, subjectId, trimester } }
    });

    if (existingGrade) {
      const lockedStatuses: ValidationStatus[] = [
        ValidationStatus.PENDING_VALIDATION,
        ValidationStatus.VALIDATED,
        ValidationStatus.LOCKED
      ];
      if (lockedStatuses.includes(existingGrade.status) && userRole === 'TEACHER') {
        return res.status(423).json({
          message: 'Action refusée : Les notes sont verrouillées ou en cours de validation par la Direction.'
        });
      }
    }

    const calculatedMoy = GradeCalculationService.calculateSubjectAverage(interrogation, devoir1, devoir2);

    const result = await prisma.$transaction(async (tx) => {
      const grade = await tx.grade.upsert({
        where: { studentId_subjectId_trimester: { studentId, subjectId, trimester } },
        create: {
          studentId,
          subjectId,
          trimester,
          interrogation,
          devoir1,
          devoir2,
          calculatedMoy,
          appreciation,
          status: ValidationStatus.DRAFT
        },
        update: {
          interrogation,
          devoir1,
          devoir2,
          calculatedMoy,
          appreciation
        }
      });

      await tx.auditLog.create({
        data: {
          userId: userId!,
          action: 'UPDATE_GRADE',
          entity: 'Grade',
          entityId: grade.id,
          oldValue: existingGrade ? JSON.parse(JSON.stringify(existingGrade)) : null,
          newValue: JSON.parse(JSON.stringify(grade)),
          reason: 'Mise à jour régulière des évaluations'
        }
      });

      return grade;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ message: 'Erreur lors de la sauvegarde.', error: error.message });
  }
};

export const submitGradesToAdmin = async (req: AuthRequest, res: Response) => {
  const { classId, subjectId, trimester } = req.body;
  const userId = req.user?.id;

  try {
    const students = await prisma.student.findMany({ where: { classId } });
    const studentIds = students.map((s) => s.id);

    await prisma.$transaction(async (tx) => {
      await tx.grade.updateMany({
        where: { subjectId, trimester, studentId: { in: studentIds } },
        data: { status: ValidationStatus.PENDING_VALIDATION }
      });

      await tx.auditLog.create({
        data: {
          userId: userId!,
          action: 'SUBMIT_GRADES_TO_ADMIN',
          entity: 'SubjectGrades',
          entityId: `${classId}_${subjectId}_${trimester}`,
          reason: 'Transmission officielle des notes à la direction'
        }
      });
    });

    await GradeCalculationService.recalculateClassTrimester(classId, trimester);

    res.status(200).json({ message: 'Notes soumises avec succès. Verrouillage activé.' });
  } catch (err: any) {
    res.status(500).json({ message: 'Erreur technique lors de la soumission.', error: err.message });
  }
};

export const reviewGradesStatus = async (req: AuthRequest, res: Response) => {
  const { reportCardId, action, reason } = req.body;
  const userId = req.user?.id;

  let newStatus: ValidationStatus;
  if (action === 'APPROVE') newStatus = ValidationStatus.VALIDATED;
  else if (action === 'REJECT') newStatus = ValidationStatus.CORRECTION_REQUESTED;
  else if (action === 'ALLOW_EDIT') newStatus = ValidationStatus.MODIFICATION_ALLOWED;
  else if (action === 'LOCK_FINAL') newStatus = ValidationStatus.LOCKED;
  else return res.status(400).json({ message: 'Action invalide.' });

  const updated = await prisma.reportCard.update({
    where: { id: reportCardId },
    data: {
      status: newStatus,
      rejectionReason: reason || null,
      validatedAt: newStatus === ValidationStatus.VALIDATED ? new Date() : null
    }
  });

  await prisma.auditLog.create({
    data: {
      userId: userId!,
      action: `REPORT_CARD_${action}`,
      entity: 'ReportCard',
      entityId: reportCardId,
      reason: reason || 'Arbitrage administratif'
    }
  });

  res.status(200).json({ success: true, data: updated });
};