import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticateJWT);

router.get('/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const students = await prisma.student.findMany({
      where: { classId },
      include: { grades: true, reportCards: true },
      orderBy: { lastName: 'asc' }
    });
    res.json(students);
  } catch (error: any) {
    res.status(500).json({ message: 'Erreur chargement élèves', error: error.message });
  }
});

export default router;