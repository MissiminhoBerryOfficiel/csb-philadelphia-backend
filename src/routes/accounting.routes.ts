import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, SchoolCycle } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();

const verifyAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Accès non autorisé.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'csb_philadelphia_secret_2026');
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: 'Session expirée.' });
  }
};

const DEFAULT_YEARS = ['2026-2027', '2027-2028', '2028-2029', '2029-2030'];

// 1. Initialiser et lister les années scolaires (2026-2027 à 2029-2030)
router.get('/years', verifyAuth, async (_req: Request, res: Response) => {
  try {
    for (const yr of DEFAULT_YEARS) {
      await prisma.academicYear.upsert({
        where: { name: yr },
        update: {},
        create: { name: yr, isCurrent: yr === '2026-2027' },
      });
    }
    const years = await prisma.academicYear.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(years);
  } catch (error) {
    res.status(500).json({ message: 'Erreur chargement des années scolaires.', error });
  }
});

// 2. Vue complète Comptabilité & Statistiques pour une année scolaire donnée
router.get('/overview', verifyAuth, async (req: Request, res: Response) => {
  try {
    const yearName = (req.query.year as string) || '2026-2027';
    let year = await prisma.academicYear.findUnique({ where: { name: yearName } });
    if (!year) {
      year = await prisma.academicYear.create({
        data: { name: yearName, isCurrent: yearName === '2026-2027' },
      });
    }

    const classes = await prisma.class.findMany({
      where: { academicYearId: year.id },
      include: {
        students: {
          include: {
            payments: {
              where: { academicYearId: year.id },
              orderBy: { paidAt: 'desc' },
            },
          },
          orderBy: { lastName: 'asc' },
        },
      },
      orderBy: [{ cycle: 'asc' }, { name: 'asc' }],
    });

    const expenses = await prisma.generalExpense.findMany({
      where: { academicYearId: year.id },
      orderBy: { expenseDate: 'desc' },
    });

    // Statistiques d'effectifs et finances
    let totalStudents = 0;
    let primaireStudents = 0;
    let secondaireStudents = 0;
    let boysCount = 0;
    let girlsCount = 0;
    let repeatingCount = 0;
    let totalExpectedRevenue = 0;
    let totalCollectedRevenue = 0;

    const classStats = classes.map((cls) => {
      const count = cls.students.length;
      const boys = cls.students.filter((s) => s.gender === 'M').length;
      const girls = cls.students.filter((s) => s.gender === 'F').length;
      const expectedPerStudent = (cls.tuitionFee || 0) + (cls.inscriptionFee || 0);
      const classExpected = count * expectedPerStudent;
      const classCollected = cls.students.reduce(
        (sum, st) => sum + st.payments.reduce((pSum, p) => pSum + p.amount, 0),
        0
      );

      totalStudents += count;
      if (cls.cycle === 'PRIMAIRE') primaireStudents += count;
      else secondaireStudents += count;
      boysCount += boys;
      girlsCount += girls;
      repeatingCount += cls.students.filter((s) => s.isRepeating).length;
      totalExpectedRevenue += classExpected;
      totalCollectedRevenue += classCollected;

      return {
        id: cls.id,
        name: cls.name,
        cycle: cls.cycle,
        tuitionFee: cls.tuitionFee,
        inscriptionFee: cls.inscriptionFee,
        studentCount: count,
        boys,
        girls,
        expected: classExpected,
        collected: classCollected,
        remaining: Math.max(0, classExpected - classCollected),
      };
    });

    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netBalance = totalCollectedRevenue - totalExpenses;

    res.json({
      year,
      classes,
      expenses,
      stats: {
        totalStudents,
        primaireStudents,
        secondaireStudents,
        boysCount,
        girlsCount,
        repeatingCount,
        totalExpectedRevenue,
        totalCollectedRevenue,
        totalRemainingRevenue: Math.max(0, totalExpectedRevenue - totalCollectedRevenue),
        totalExpenses,
        netBalance,
        classStats,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Erreur chargement comptabilité.', error });
  }
});

// 3. Définir le cycle (PRIMAIRE/SECONDAIRE) et les frais d'inscription + scolarité d'une classe
router.put('/classes/:classId/fees', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && user.role !== 'ACCOUNTANT') {
      return res.status(403).json({ message: 'Action réservée à la Direction et au Comptable.' });
    }

    const { classId } = req.params;
    const { cycle, tuitionFee, inscriptionFee } = req.body;

    const updated = await prisma.class.update({
      where: { id: classId },
      data: {
        ...(cycle ? { cycle: cycle as SchoolCycle } : {}),
        tuitionFee: Number(tuitionFee) || 0,
        inscriptionFee: Number(inscriptionFee) || 0,
      },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Erreur mise à jour des tarifs de la classe.', error });
  }
});

// 4. frmInscription : Enregistrer un versement (Inscription / Tranche de scolarité)
router.post('/payments', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'ADMIN' &&
      user.role !== 'ACCOUNTANT' &&
      user.role !== 'SECRETARY'
    ) {
      return res.status(403).json({ message: 'Accès non autorisé.' });
    }

    const { studentId, yearName, amount, paymentType, paymentMethod, note } = req.body;
    const year = await prisma.academicYear.findUnique({
      where: { name: yearName || '2026-2027' },
    });
    if (!year) return res.status(404).json({ message: 'Année scolaire introuvable.' });

    const count = await prisma.payment.count();
    const receiptNumber = `REC-${year.name.slice(0, 4)}-${String(count + 1).padStart(4, '0')}`;

    const payment = await prisma.payment.create({
      data: {
        receiptNumber,
        studentId,
        academicYearId: year.id,
        amount: Number(amount),
        paymentType: paymentType || 'SCOLARITE',
        paymentMethod: paymentMethod || 'ESPECES',
        note: note || '',
      },
      include: {
        student: { include: { class: true } },
      },
    });

    res.status(201).json(payment);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'enregistrement du paiement.", error });
  }
});

// 5. Supprimer un paiement erroné (Super Admin / Comptable)
router.delete('/payments/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ACCOUNTANT') {
      return res.status(403).json({ message: 'Action réservée au Fondateur ou au Comptable.' });
    }
    await prisma.payment.delete({ where: { id: req.params.id } });
    res.json({ message: 'Paiement annulé.' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur suppression paiement.', error });
  }
});

// 6. Frais Généraux : Enregistrer une dépense / charge de l'école
router.post('/expenses', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && user.role !== 'ACCOUNTANT') {
      return res.status(403).json({ message: 'Action réservée au Comptable ou à la Direction.' });
    }

    const { yearName, label, category, amount, paymentMethod, beneficiary, reference, expenseDate } =
      req.body;
    const year = await prisma.academicYear.findUnique({
      where: { name: yearName || '2026-2027' },
    });
    if (!year) return res.status(404).json({ message: 'Année scolaire introuvable.' });

    const expense = await prisma.generalExpense.create({
      data: {
        label,
        category: category || 'FONCTIONNEMENT',
        amount: Number(amount),
        paymentMethod: paymentMethod || 'ESPECES',
        beneficiary: beneficiary || '',
        reference: reference || '',
        expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
        academicYearId: year.id,
      },
    });

    res.status(201).json(expense);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'enregistrement de la dépense.", error });
  }
});

// 7. Supprimer une dépense (Super Admin / Comptable)
router.delete('/expenses/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ACCOUNTANT') {
      return res.status(403).json({ message: 'Action réservée au Fondateur ou au Comptable.' });
    }
    await prisma.generalExpense.delete({ where: { id: req.params.id } });
    res.json({ message: 'Dépense supprimée.' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur suppression dépense.', error });
  }
});

export default router;
