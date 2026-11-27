import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, Trimester, ValidationStatus, SchoolCycle } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

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
    return res.status(403).json({ message: 'Session expirée, veuillez vous reconnecter.' });
  }
};

const OFFICIAL_SUBJECT_ORDER = [
  'LECT_ORT', 'COM_FR', 'HIST_GEO', 'LV1_ANG', 'LV2_ESP', 'MATH',
  'SVT', 'PHILO', 'PCT', 'INFO', 'ALL', 'ECO', 'EPS', 'COND',
];

const sortSubjectsOfficial = <T extends { code: string; name: string }>(subjects: T[]): T[] => {
  return [...subjects].sort((a, b) => {
    const idxA = OFFICIAL_SUBJECT_ORDER.indexOf(a.code);
    const idxB = OFFICIAL_SUBJECT_ORDER.indexOf(b.code);
    if (idxA === -1 && idxB === -1) return a.name.localeCompare(b.name);
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
};

const getOrCreateYear = async (yearName?: string) => {
  const targetName = yearName || '2026-2027';
  let year = await prisma.academicYear.findUnique({ where: { name: targetName } });
  if (!year) {
    year = await prisma.academicYear.create({
      data: { name: targetName, isCurrent: targetName === '2026-2027' },
    });
  }
  return year;
};

// 1. Récupérer les classes (filtrées automatiquement si c'est un TEACHER ayant des attributions)
router.get('/classes', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const yearName = req.query.year as string | undefined;
    const year = await getOrCreateYear(yearName);

    const classes = await prisma.class.findMany({
      where: { academicYearId: year.id },
      include: {
        students: { orderBy: { lastName: 'asc' } },
        subjects: true,
      },
      orderBy: [{ cycle: 'asc' }, { name: 'asc' }],
    });

    if (user.role === 'TEACHER') {
      try {
        const assignments = await prisma.teacherSubject.findMany({
          where: { userId: user.id },
        });

        if (assignments.length > 0) {
          const allowedSubjectIds = new Set(assignments.map((a) => a.subjectId));
          const filteredClasses = classes
            .map((cls) => ({
              ...cls,
              subjects: sortSubjectsOfficial(
                cls.subjects.filter((s) => allowedSubjectIds.has(s.id))
              ),
            }))
            .filter((cls) => cls.subjects.length > 0);

          return res.json(filteredClasses);
        }
      } catch {
        // Ignore si TeacherSubject pas encore migré
      }
    }

    const formatted = classes.map((cls) => ({
      ...cls,
      subjects: sortSubjectsOfficial(cls.subjects),
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du chargement des classes.', error });
  }
});

// 2. Créer une nouvelle classe avec coefficients à 0
router.post('/classes', verifyAuth, async (req: Request, res: Response) => {
  try {
    const { name, cycle, tuitionFee, inscriptionFee, yearName } = req.body;
    const year = await getOrCreateYear(yearName);
    const schoolCycle: SchoolCycle = cycle === 'PRIMAIRE' ? 'PRIMAIRE' : 'SECONDAIRE';

    const newClass = await prisma.class.create({
      data: {
        name,
        cycle: schoolCycle,
        tuitionFee: Number(tuitionFee) || 0,
        inscriptionFee: Number(inscriptionFee) || 0,
        academicYearId: year.id,
      },
    });

    const disciplines =
      schoolCycle === 'PRIMAIRE'
        ? [
            { name: 'Communication Orale', code: 'COM_OR', coefficient: 0 },
            { name: 'Lecture / Écriture', code: 'LECT_ECR', coefficient: 0 },
            { name: 'Expression Écrite', code: 'EXP_ECR', coefficient: 0 },
            { name: 'Mathématiques', code: 'MATH', coefficient: 0 },
            { name: 'Éducation Scientifique et Technologique (EST)', code: 'EST', coefficient: 0 },
            { name: 'Éducation Sociale (ES)', code: 'ES', coefficient: 0 },
            { name: 'Anglais (Bilingue)', code: 'ANG_BIL', coefficient: 0 },
            { name: 'Éducation Artistique (EA)', code: 'EA', coefficient: 0 },
            { name: 'EPS', code: 'EPS', coefficient: 0 },
            { name: 'Conduite', code: 'COND', coefficient: 0 },
          ]
        : [
            { name: 'Lecture/Ort.Gr', code: 'LECT_ORT', coefficient: 0 },
            { name: 'Com. Ecrite Comp. FR', code: 'COM_FR', coefficient: 0 },
            { name: 'Hist-Géo', code: 'HIST_GEO', coefficient: 0 },
            { name: 'LV1 /Anglais', code: 'LV1_ANG', coefficient: 0 },
            { name: 'LV2 / Esp', code: 'LV2_ESP', coefficient: 0 },
            { name: 'Mathématique', code: 'MATH', coefficient: 0 },
            { name: 'Biologie / SVT', code: 'SVT', coefficient: 0 },
            { name: 'Philosophie', code: 'PHILO', coefficient: 0 },
            { name: 'Physique Chimie / PCT', code: 'PCT', coefficient: 0 },
            { name: 'Informatique', code: 'INFO', coefficient: 0 },
            { name: 'Allemand', code: 'ALL', coefficient: 0 },
            { name: 'Economie', code: 'ECO', coefficient: 0 },
            { name: 'EPS', code: 'EPS', coefficient: 0 },
            { name: 'Conduite', code: 'COND', coefficient: 0 },
          ];

    for (const d of disciplines) {
      await prisma.subject.create({
        data: {
          name: d.name,
          code: d.code,
          coefficient: d.coefficient,
          classId: newClass.id,
        },
      });
    }

    res.status(201).json(newClass);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la création de la classe.', error });
  }
});

// 2b. Supprimer une classe dont on n'a plus besoin
router.delete('/classes/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Seul le Fondateur ou le Directeur peut supprimer une classe.' });
    }
    const { id } = req.params;

    const students = await prisma.student.findMany({ where: { classId: id }, select: { id: true } });
    const studentIds = students.map((s) => s.id);
    const subjects = await prisma.subject.findMany({ where: { classId: id }, select: { id: true } });
    const subjectIds = subjects.map((s) => s.id);

    if (studentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { studentId: { in: studentIds } } });
      await prisma.grade.deleteMany({ where: { studentId: { in: studentIds } } });
      await prisma.reportCard.deleteMany({ where: { studentId: { in: studentIds } } });
      await prisma.student.deleteMany({ where: { classId: id } });
    }
    if (subjectIds.length > 0) {
      await prisma.teacherSubject.deleteMany({ where: { subjectId: { in: subjectIds } } });
      await prisma.grade.deleteMany({ where: { subjectId: { in: subjectIds } } });
      await prisma.subject.deleteMany({ where: { classId: id } });
    }

    await prisma.class.delete({ where: { id } });
    res.json({ message: 'Classe supprimée avec succès.' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la suppression de la classe.', error });
  }
});

// 2c. Remettre tous les coefficients d'une classe à 0
router.post('/classes/:id/reset-coefs', verifyAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.subject.updateMany({
      where: { classId: id },
      data: { coefficient: 0 },
    });
    res.json({ message: 'Tous les coefficients de la classe ont été remis à 0.' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la réinitialisation des coefficients.', error });
  }
});

// 3. Inscrire un nouvel élève
router.post('/students', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role === 'TEACHER') {
      return res.status(403).json({ message: 'Accès refusé aux enseignants.' });
    }

    const { matricule, lastName, firstName, birthDate, gender, isRepeating, classId } = req.body;

    const student = await prisma.student.create({
      data: {
        matricule,
        lastName: lastName.toUpperCase(),
        firstName,
        birthDate: new Date(birthDate),
        gender,
        isRepeating: Boolean(isRepeating),
        classId,
      },
    });

    res.status(201).json(student);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'Ce numéro matricule existe déjà.' });
    }
    res.status(500).json({ message: "Erreur lors de l'inscription de l'élève.", error });
  }
});

// 4. Modifier les informations d'un élève
router.put('/students/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role === 'TEACHER') {
      return res.status(403).json({ message: 'Accès refusé aux enseignants.' });
    }
    const { id } = req.params;
    const { matricule, lastName, firstName, birthDate, gender, isRepeating } = req.body;

    const updated = await prisma.student.update({
      where: { id },
      data: {
        matricule,
        lastName: lastName.toUpperCase(),
        firstName,
        birthDate: new Date(birthDate),
        gender,
        isRepeating: Boolean(isRepeating),
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la modification de l'élève.", error });
  }
});

// 5. Supprimer un élève
router.delete('/students/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Seul le Fondateur ou le Directeur peut supprimer un élève.' });
    }
    const { id } = req.params;
    await prisma.payment.deleteMany({ where: { studentId: id } });
    await prisma.grade.deleteMany({ where: { studentId: id } });
    await prisma.reportCard.deleteMany({ where: { studentId: id } });
    await prisma.student.delete({ where: { id } });

    res.json({ message: 'Élève supprimé avec succès.' });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la suppression de l'élève.", error });
  }
});

// 6. Charger les notes d'un élève pour un trimestre
router.get('/grades/:studentId/:trimester', verifyAuth, async (req: Request, res: Response) => {
  try {
    const { studentId, trimester } = req.params;
    const grades = await prisma.grade.findMany({
      where: { studentId, trimester: trimester as Trimester },
      include: { subject: true },
    });
    res.json(grades);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du chargement des notes.', error });
  }
});

// 7. Enregistrer & Verrouiller les notes + Mise à jour du coefficient
router.post('/grades/save', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      studentId, subjectId, trimester, coefficient,
      interrogation, devoir1, devoir2, appreciation, lockAfterSave,
    } = req.body;

    if (user.role === 'TEACHER') {
      const assignments = await prisma.teacherSubject.findMany({ where: { userId: user.id } });
      if (assignments.length > 0 && !assignments.some((a) => a.subjectId === subjectId)) {
        return res.status(403).json({
          message: "Vous n'êtes pas attribué à cette matière/classe.",
        });
      }
    }

    const existing = await prisma.grade.findUnique({
      where: {
        studentId_subjectId_trimester: {
          studentId, subjectId, trimester: trimester as Trimester,
        },
      },
    });

    if (
      existing &&
      (existing.status === ValidationStatus.VALIDATED ||
        existing.status === ValidationStatus.LOCKED ||
        existing.status === ValidationStatus.PENDING_VALIDATION) &&
      user.role === 'TEACHER'
    ) {
      return res.status(403).json({
        message: 'Note verrouillée ! Seul le Fondateur ou le Directeur peut corriger cette note.',
      });
    }

    if (coefficient !== undefined && coefficient !== null && !isNaN(Number(coefficient))) {
      await prisma.subject.update({
        where: { id: subjectId },
        data: { coefficient: Number(coefficient) },
      });
    }

    const moyDev = (Number(devoir1) + Number(devoir2)) / 2;
    const calculatedMoy = Number(((Number(interrogation) + 2 * moyDev) / 3).toFixed(2));
    const nextStatus = lockAfterSave ? ValidationStatus.LOCKED : ValidationStatus.DRAFT;

    const saved = await prisma.grade.upsert({
      where: {
        studentId_subjectId_trimester: {
          studentId, subjectId, trimester: trimester as Trimester,
        },
      },
      update: {
        interrogation: Number(interrogation),
        devoir1: Number(devoir1),
        devoir2: Number(devoir2),
        calculatedMoy,
        appreciation,
        status: nextStatus,
      },
      create: {
        studentId,
        subjectId,
        trimester: trimester as Trimester,
        interrogation: Number(interrogation),
        devoir1: Number(devoir1),
        devoir2: Number(devoir2),
        calculatedMoy,
        appreciation,
        status: nextStatus,
      },
    });

    res.json(saved);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la sauvegarde de la note.', error });
  }
});

// 8. Déverrouiller une note
router.post('/grades/unlock/:gradeId', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Action réservée au Fondateur ou au Directeur.' });
    }

    const { gradeId } = req.params;
    const unlocked = await prisma.grade.update({
      where: { id: gradeId },
      data: { status: ValidationStatus.MODIFICATION_ALLOWED },
    });

    res.json(unlocked);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors du déverrouillage.', error });
  }
});

// 9. Lister tous les membres du personnel
router.get('/staff', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Accès réservé à la Direction.' });
    }
    const staff = await prisma.user.findMany({
      select: {
        id: true,
        matricule: true,
        fullName: true,
        email: true,
        role: true,
        phone: true,
        subjectsTaught: {
          select: {
            subjectId: true,
            subject: {
              select: {
                id: true,
                name: true,
                class: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(staff);
  } catch {
    const fallbackStaff = await prisma.user.findMany({
      select: { id: true, matricule: true, fullName: true, email: true, role: true, phone: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(fallbackStaff);
  }
});

// 10. Créer un nouveau compte personnel
router.post('/staff', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Action réservée au Fondateur ou au Directeur.' });
    }

    const { fullName, email, password, role, phone } = req.body;
    const cleanEmail = email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      return res.status(400).json({
        message: `L'email "${cleanEmail}" appartient déjà à ${existingUser.fullName}. Cliquez sur le crayon à droite de son nom pour le modifier.`,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const uniqueSuffix = String(Date.now()).slice(-5);

    const newStaff = await prisma.user.create({
      data: {
        matricule: `CSB-PERS-${uniqueSuffix}`,
        fullName,
        email: cleanEmail,
        password: hashedPassword,
        role: role || 'TEACHER',
        phone: phone || '',
      },
    });

    res.status(201).json({
      id: newStaff.id,
      matricule: newStaff.matricule,
      fullName: newStaff.fullName,
      email: newStaff.email,
      role: newStaff.role,
      phone: newStaff.phone,
    });
  } catch (error: any) {
    res.status(500).json({
      message: `Erreur serveur (${error?.code || 'DB'}) : vérifiez la synchronisation Prisma/Render.`,
    });
  }
});

// 10b. Modifier les coordonnées, le rôle ou le mot de passe d'un membre du personnel
router.put('/staff/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Action réservée au Fondateur ou au Directeur.' });
    }

    const { id } = req.params;
    const { fullName, email, password, role, phone } = req.body;

    const updateData: any = {
      fullName,
      email: email.toLowerCase().trim(),
      role,
      phone: phone || '',
    };

    if (password && password.trim().length > 0) {
      updateData.password = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, matricule: true, fullName: true, email: true, role: true, phone: true },
    });

    res.json(updated);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'Cet email est déjà utilisé par un autre compte.' });
    }
    res.status(500).json({ message: 'Erreur lors de la mise à jour du compte.', error });
  }
});

// 10c. Attribuer les classes et matières d'un professeur
router.post('/staff/:id/assignments', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Action réservée à la Direction.' });
    }
    const { id } = req.params;
    const { subjectIds } = req.body;

    await prisma.teacherSubject.deleteMany({ where: { userId: id } });

    if (Array.isArray(subjectIds) && subjectIds.length > 0) {
      await prisma.teacherSubject.createMany({
        data: subjectIds.map((subjectId: string) => ({
          userId: id,
          subjectId,
        })),
        skipDuplicates: true,
      });
    }

    res.json({ message: 'Classes et matières attribuées avec succès !' });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'attribution des classes.", error });
  }
});

// 11. Supprimer un compte personnel
router.delete('/staff/:id', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Seul le Fondateur peut supprimer un compte.' });
    }
    const { id } = req.params;
    if (id === user.id) {
      return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }
    await prisma.teacherSubject.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
    res.json({ message: 'Compte supprimé.' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la suppression.', error });
  }
});

export default router;
